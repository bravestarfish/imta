"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { resolveBookable } from "@/lib/event-types/service";
import { createBooking, cancelBookingInternal, cancelMeetingInternal, rescheduleBooking, approveBooking, bookingByToken, attendeeMayChange, BookingError } from "@/lib/bookings/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request";

const bookSchema = z.object({
  eventTypeId: z.string(),
  start: z.coerce.number().int(),
  meetingId: z.string().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  timezone: z.string().min(1).max(64),
  linkKey: z.string().optional(),
  answers: z.record(z.string(), z.union([z.string().max(2000), z.boolean()])).default({}),
});

export type BookResult = { ok: true; token: string; pending: boolean } | { ok: false; error: string; code?: string };

export async function bookAction(input: unknown): Promise<BookResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to book", code: "login" };
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  if (!(await checkRateLimit(`book:${user.did}`, 20, 3600)) || !(await checkRateLimit(`book-ip:${await clientIpFromHeaders()}`, 60, 3600))) {
    return { ok: false, error: "Too many bookings in a short time. Try again later." };
  }
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, d.eventTypeId) });
  if (!et) return { ok: false, error: "Event not found" };
  const owner = et.ownerKind === "user" ? await db.query.users.findFirst({ where: eq(schema.users.did, et.ownerDid!) }) : null;
  const team = et.ownerKind === "team" ? await db.query.teams.findFirst({ where: eq(schema.teams.id, et.teamId!) }) : null;
  const access = await resolveBookable(et.ownerKind === "user" ? { handle: owner?.handle } : { teamSlug: team?.slug }, et.slug, user, d.linkKey ?? null);
  if (!access || access.access !== "ok") return { ok: false, error: "You do not have access to this event", code: access?.access };
  for (const q of et.questions) {
    const v = d.answers[q.id];
    if (q.required && (v === undefined || v === "" || v === false)) return { ok: false, error: `“${q.label}” is required` };
  }
  try {
    const booking = await createBooking({
      eventType: et,
      start: new Date(d.start),
      attendee: user,
      attendeeName: d.name,
      attendeeEmail: d.email,
      timezone: d.timezone,
      answers: d.answers,
      meetingId: d.meetingId,
    });
    if (!user.email) await db.update(schema.users).set({ email: d.email }).where(eq(schema.users.did, user.did));
    return { ok: true, token: booking.manageToken, pending: booking.status === "pending" };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
}

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const reason = String(formData.get("reason") ?? "").slice(0, 500) || null;
  const booking = await bookingByToken(token);
  if (!booking) redirect("/");
  const user = await getCurrentUser();
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, booking.eventTypeId) });
  const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, booking.meetingId) });
  if (!et || !meeting) redirect("/");
  const isHost = user ? meeting.hostDids.includes(user.did) : false;
  if (!isHost) {
    const policy = attendeeMayChange(et, meeting);
    if (!policy.ok) redirect(`/b/${token}?error=${encodeURIComponent(policy.reason)}`);
  }
  await cancelBookingInternal(booking.id, user?.did ?? booking.attendeeDid, reason);
  revalidatePath(`/b/${token}`);
  redirect(`/b/${token}?cancelled=1`);
}

export async function rescheduleAction(input: { token: string; start: number; timezone: string }): Promise<BookResult> {
  const booking = await bookingByToken(input.token);
  if (!booking) return { ok: false, error: "Booking not found" };
  const user = await getCurrentUser();
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, booking.eventTypeId) });
  const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, booking.meetingId) });
  if (!et || !meeting) return { ok: false, error: "Booking not found" };
  const isHost = user ? meeting.hostDids.includes(user.did) : false;
  if (!isHost) {
    if (!et.allowReschedule) return { ok: false, error: "Rescheduling is not allowed for this event" };
    const policy = attendeeMayChange(et, meeting);
    if (!policy.ok) return { ok: false, error: policy.reason };
  }
  try {
    const nb = await rescheduleBooking(booking.id, new Date(input.start), user?.did ?? booking.attendeeDid, input.timezone);
    return { ok: true, token: nb.manageToken, pending: nb.status === "pending" };
  } catch (e) {
    if (e instanceof BookingError) return { ok: false, error: e.message, code: e.code };
    throw e;
  }
}

export async function hostCancelMeetingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const meetingId = String(formData.get("meetingId") ?? "");
  const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, meetingId) });
  if (!meeting || !meeting.hostDids.includes(user.did)) redirect("/bookings");
  await cancelMeetingInternal(meetingId, user.did, String(formData.get("reason") ?? "").slice(0, 500) || null);
  revalidatePath("/bookings");
  redirect("/bookings");
}

export async function approveBookingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  await approveBooking(String(formData.get("bookingId") ?? ""), user.did);
  revalidatePath("/bookings");
}

export async function declineBookingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("bookingId") ?? "");
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, id) });
  const meeting = booking ? await db.query.meetings.findFirst({ where: eq(schema.meetings.id, booking.meetingId) }) : null;
  if (!booking || !meeting || !meeting.hostDids.includes(user.did)) redirect("/bookings");
  await cancelBookingInternal(id, user.did, "Declined by the organizer");
  revalidatePath("/bookings");
}
