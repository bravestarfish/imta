import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "@/db";
import type { EventType, EventTypeHost, Meeting, Booking, User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { randomToken } from "@/lib/crypto";
import { hostAvailabilities } from "@/lib/availability/service";
import { generateSlots, assignHosts, type Slot, type SlotRules } from "@/lib/scheduling/slots";
import type { Interval } from "@/lib/scheduling/intervals";
import { resolveVideo } from "@/lib/video";
import { enqueue } from "@/lib/jobs/queue";
import { log } from "@/lib/log";
import { syncZoom } from "./calendar-write";
import { loadMeetingContext } from "./context";
import { appUrl } from "@/lib/env";

export class BookingError extends Error {
  constructor(
    message: string,
    public code: string = "booking_error",
  ) {
    super(message);
    this.name = "BookingError";
  }
}

export function rulesFor(et: EventType, timezone: string): SlotRules {
  return {
    durationMinutes: et.durationMinutes,
    slotIntervalMinutes: et.slotIntervalMinutes,
    bufferBeforeMinutes: et.bufferBeforeMinutes,
    bufferAfterMinutes: et.bufferAfterMinutes,
    minNoticeMinutes: et.minNoticeMinutes,
    bookingWindowDays: et.bookingWindowDays,
    maxBookingsPerDay: et.maxBookingsPerDay,
    assignmentMode: et.assignmentMode,
    thresholdCount: et.thresholdCount,
    timezone,
  };
}

export async function eventTypeHosts(eventTypeId: string): Promise<EventTypeHost[]> {
  return db.query.eventTypeHosts.findMany({ where: eq(schema.eventTypeHosts.eventTypeId, eventTypeId) });
}

/** Timezone used to align slots and count "per day" limits: the team's or the first host's. */
export async function organizerTimezone(et: EventType, hosts: EventTypeHost[]): Promise<string> {
  if (et.teamId) {
    const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, et.teamId) });
    if (team) return team.timezone;
  }
  const first = hosts[0];
  if (first) {
    const u = await db.query.users.findFirst({ where: eq(schema.users.did, first.userDid) });
    if (u) return u.timezone;
  }
  return "UTC";
}

/**
 * Slots for an event type in a window. Group sessions with free seats are
 * offered as slots too (so several attendees can join the same session).
 */
export async function availableSlots(et: EventType, window: Interval, now = Date.now()): Promise<{ slots: Slot[]; openSessions: (Meeting & { seatsLeft: number })[] }> {
  const hosts = await eventTypeHosts(et.id);
  const tz = await organizerTimezone(et, hosts);
  const rules = rulesFor(et, tz);
  const from = new Date(window.start);
  const to = new Date(window.end);

  const existing = await db.query.meetings.findMany({
    where: and(eq(schema.meetings.eventTypeId, et.id), eq(schema.meetings.status, "scheduled"), gte(schema.meetings.startAt, from), lte(schema.meetings.startAt, to)),
  });
  const perDay = new Map<string, number>();
  for (const m of existing) {
    const key = DateTime.fromJSDate(m.startAt, { zone: tz }).toISODate() ?? "";
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  const availability = await hostAvailabilities(
    hosts.map((h) => ({ did: h.userDid, scheduleId: h.scheduleId, availabilityMode: h.availabilityMode })),
    window,
    et.id,
  );
  const slots = generateSlots(availability, rules, window, now, perDay);

  let openSessions: (Meeting & { seatsLeft: number })[] = [];
  if (et.capacity > 1 && existing.length) {
    const counts = await db
      .select({ meetingId: schema.bookings.meetingId, n: sql<number>`count(*)::int` })
      .from(schema.bookings)
      .where(and(inArray(schema.bookings.meetingId, existing.map((m) => m.id)), eq(schema.bookings.status, "confirmed")))
      .groupBy(schema.bookings.meetingId);
    const countMap = new Map(counts.map((c) => [c.meetingId, c.n]));
    openSessions = existing
      .map((m) => ({ ...m, seatsLeft: m.capacity - (countMap.get(m.id) ?? 0) }))
      .filter((m) => m.seatsLeft > 0 && m.startAt.getTime() >= now + et.minNoticeMinutes * 60_000);
  }
  return { slots, openSessions };
}

export type BookingInput = {
  eventType: EventType;
  start: Date;
  attendee: User;
  attendeeName: string;
  attendeeEmail: string;
  timezone: string;
  answers: Record<string, string | boolean>;
  /** Join an existing group session instead of creating a new meeting. */
  meetingId?: string;
};

/** Create a booking (and a meeting when needed). Concurrency-safe through a per-event-type advisory lock. */
export async function createBooking(input: BookingInput): Promise<Booking> {
  const et = input.eventType;
  if (et.status !== "published") throw new BookingError("This event is not open for bookings", "closed");
  const hosts = await eventTypeHosts(et.id);
  if (!hosts.length) throw new BookingError("This event has no hosts", "no_hosts");
  if (hosts.some((h) => h.userDid === input.attendee.did)) throw new BookingError("You are a host of this event", "self");
  const blocked = await db.query.blocks.findFirst({
    where: and(inArray(schema.blocks.userDid, hosts.map((h) => h.userDid)), eq(schema.blocks.blockedDid, input.attendee.did)),
  });
  if (blocked) throw new BookingError("You cannot book this event", "blocked");

  const end = new Date(input.start.getTime() + et.durationMinutes * 60_000);
  const tz = await organizerTimezone(et, hosts);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${et.id}))`);

    let meeting: Meeting | undefined;
    if (input.meetingId) {
      meeting = await tx.query.meetings.findFirst({ where: and(eq(schema.meetings.id, input.meetingId), eq(schema.meetings.eventTypeId, et.id)) });
      if (!meeting || meeting.status !== "scheduled") throw new BookingError("That session is no longer available", "gone");
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.bookings)
        .where(and(eq(schema.bookings.meetingId, meeting.id), eq(schema.bookings.status, "confirmed")));
      if (n >= meeting.capacity) throw new BookingError("That session is full", "full");
      const dup = await tx.query.bookings.findFirst({
        where: and(eq(schema.bookings.meetingId, meeting.id), eq(schema.bookings.attendeeDid, input.attendee.did), eq(schema.bookings.status, "confirmed")),
      });
      if (dup) throw new BookingError("You already have a seat in this session", "duplicate");
    } else {
      // Re-validate the slot against current availability (inside the lock).
      const window = { start: input.start.getTime() - 86_400_000, end: end.getTime() + 86_400_000 };
      const { slots } = await availableSlots(et, window);
      const slot = slots.find((s) => s.start === input.start.getTime());
      if (!slot) throw new BookingError("That time is no longer available", "unavailable");

      const load = await hostLoad(slot.freeHosts);
      const hostDids = assignHosts(slot.freeHosts, rulesFor(et, tz), load);
      const video = et.locationKind === "video" ? await resolveVideo(hostDids[0], et.videoProvider, { topic: et.title, start: input.start, durationMinutes: et.durationMinutes, timezone: tz }) : null;

      const id = newId("mtg");
      [meeting] = await tx
        .insert(schema.meetings)
        .values({
          id,
          eventTypeId: et.id,
          startAt: input.start,
          endAt: end,
          hostDids,
          capacity: et.capacity,
          status: "scheduled",
          videoProvider: video?.provider ?? null,
          videoUrl: video?.url ?? null,
          location: et.locationKind !== "video" ? et.locationText : null,
          icsUid: `${id}@${new URL(appUrl()).hostname}`,
        })
        .returning();
    }

    const [booking] = await tx
      .insert(schema.bookings)
      .values({
        id: newId("bk"),
        meetingId: meeting.id,
        eventTypeId: et.id,
        attendeeDid: input.attendee.did,
        attendeeHandle: input.attendee.handle,
        attendeeName: input.attendeeName,
        attendeeEmail: input.attendeeEmail,
        timezone: input.timezone,
        answers: input.answers,
        status: et.requiresApproval ? "pending" : "confirmed",
        manageToken: randomToken(24),
      })
      .returning();
    afterCommit(async () => {
      await enqueue("notify.booking", { bookingId: booking.id, kind: et.requiresApproval ? "pending" : "confirmed" });
      await enqueue("notify.booking", { bookingId: booking.id, kind: "host_new" });
      if (!et.requiresApproval) await enqueue("calendar.write", { meetingId: meeting.id, reason: input.meetingId ? "updated" : "created" });
      if (et.publishSessions && et.visibility === "public" && et.capacity > 1) await enqueue("atproto.publish", { kind: "meeting", id: meeting.id });
    });
    return booking;
  });
}

/** Upcoming confirmed meeting count per host, used for round-robin. */
async function hostLoad(dids: string[]): Promise<Map<string, number>> {
  const load = new Map<string, number>(dids.map((d) => [d, 0]));
  if (!dids.length) return load;
  const rows = await db.query.meetings.findMany({
    where: and(eq(schema.meetings.status, "scheduled"), gte(schema.meetings.startAt, new Date())),
    columns: { hostDids: true },
  });
  for (const r of rows) for (const d of r.hostDids) if (load.has(d)) load.set(d, (load.get(d) ?? 0) + 1);
  return load;
}

function afterCommit(fn: () => Promise<void>) {
  // Transactions here are short; defer side effects to the next tick so they run after commit.
  setTimeout(() => {
    fn().catch((e) => log.error("post-commit hook failed", { error: e instanceof Error ? e.message : String(e) }));
  }, 0);
}

export async function approveBooking(bookingId: string, actorDid: string): Promise<void> {
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
  if (!booking || booking.status !== "pending") return;
  const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, booking.meetingId) });
  if (!meeting || !meeting.hostDids.includes(actorDid)) throw new BookingError("Not a host", "forbidden");
  await db.update(schema.bookings).set({ status: "confirmed", updatedAt: new Date() }).where(eq(schema.bookings.id, bookingId));
  await enqueue("notify.booking", { bookingId, kind: "confirmed" });
  await enqueue("calendar.write", { meetingId: meeting.id, reason: "created" });
}

/** Cancel one attendee's booking. Cancels the meeting too when it was a one-to-one. */
export async function cancelBookingInternal(bookingId: string, actorDid: string, reason: string | null): Promise<void> {
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
  if (!booking || booking.status === "cancelled") return;
  await db
    .update(schema.bookings)
    .set({ status: "cancelled", cancelReason: reason, cancelledBy: actorDid, cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.bookings.id, bookingId));
  const ctx = await loadMeetingContext(booking.meetingId);
  if (!ctx) return;
  const remaining = ctx.bookings.filter((b) => b.id !== bookingId && b.status === "confirmed");
  await enqueue("notify.booking", { bookingId, kind: "cancelled" });
  if (actorDid !== ctx.hosts[0]?.did) await enqueue("notify.booking", { bookingId, kind: "host_cancelled" });
  if (remaining.length === 0) {
    await db
      .update(schema.meetings)
      .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, icsSequence: ctx.meeting.icsSequence + 1, updatedAt: new Date() })
      .where(eq(schema.meetings.id, ctx.meeting.id));
    await syncZoom(ctx, "delete");
    await enqueue("calendar.write", { meetingId: ctx.meeting.id, reason: "cancelled" });
  } else {
    const { removeAttendeeCalendarCopy } = await import("./calendar-write");
    await removeAttendeeCalendarCopy(bookingId);
    await enqueue("calendar.write", { meetingId: ctx.meeting.id, reason: "updated" });
  }
}

/** Cancel a whole meeting (host action). */
export async function cancelMeetingInternal(meetingId: string, actorDid: string, reason: string | null): Promise<void> {
  const ctx = await loadMeetingContext(meetingId);
  if (!ctx || ctx.meeting.status === "cancelled") return;
  await db
    .update(schema.meetings)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason, icsSequence: ctx.meeting.icsSequence + 1, updatedAt: new Date() })
    .where(eq(schema.meetings.id, meetingId));
  for (const b of ctx.bookings) {
    if (b.status === "cancelled") continue;
    await db
      .update(schema.bookings)
      .set({ status: "cancelled", cancelReason: reason, cancelledBy: actorDid, cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.bookings.id, b.id));
    await enqueue("notify.booking", { bookingId: b.id, kind: "cancelled" });
  }
  await syncZoom(ctx, "delete");
  await enqueue("calendar.write", { meetingId, reason: "cancelled" });
  if (ctx.meeting.atprotoUri) await enqueue("atproto.publish", { kind: "meeting", id: meetingId });
}

/** Policy check for attendee-initiated changes. */
export function attendeeMayChange(et: EventType, meeting: Meeting, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (meeting.startAt.getTime() <= now) return { ok: false, reason: "This meeting has already started." };
  if (et.cancellationNoticeMinutes > 0 && meeting.startAt.getTime() - now < et.cancellationNoticeMinutes * 60_000) {
    return { ok: false, reason: `Changes are only possible up to ${humanMinutes(et.cancellationNoticeMinutes)} before the start. Contact the organizer.` };
  }
  return { ok: true };
}

export function humanMinutes(m: number): string {
  if (m % 1440 === 0) return `${m / 1440} day${m / 1440 === 1 ? "" : "s"}`;
  if (m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? "" : "s"}`;
  return `${m} minutes`;
}

/**
 * Reschedule: create a new booking at the new time and cancel the old one,
 * linking both. For one-to-one meetings the new meeting keeps the video link
 * when possible (Zoom is updated in place).
 */
export async function rescheduleBooking(bookingId: string, newStart: Date, actorDid: string, timezone: string): Promise<Booking> {
  const old = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
  if (!old || old.status === "cancelled") throw new BookingError("Booking not found", "not_found");
  const ctx = await loadMeetingContext(old.meetingId);
  if (!ctx) throw new BookingError("Booking not found", "not_found");
  const attendee = await db.query.users.findFirst({ where: eq(schema.users.did, old.attendeeDid) });
  if (!attendee) throw new BookingError("Attendee not found", "not_found");

  const isOneToOne = ctx.eventType.capacity === 1;
  if (isOneToOne) {
    // Move the meeting itself: keeps hosts, video link and calendar events (updated in place).
    const window = { start: newStart.getTime() - 86_400_000, end: newStart.getTime() + 86_400_000 };
    const { slots } = await availableSlots(ctx.eventType, window);
    const slot = slots.find((s) => s.start === newStart.getTime() && ctx.meeting.hostDids.every((h) => s.freeHosts.includes(h)));
    if (!slot) throw new BookingError("That time is no longer available", "unavailable");
    const end = new Date(newStart.getTime() + ctx.eventType.durationMinutes * 60_000);
    await db
      .update(schema.meetings)
      .set({ startAt: newStart, endAt: end, icsSequence: ctx.meeting.icsSequence + 1, updatedAt: new Date() })
      .where(eq(schema.meetings.id, ctx.meeting.id));
    const [updated] = await db
      .update(schema.bookings)
      .set({ timezone, updatedAt: new Date(), rescheduledFromId: old.id })
      .where(eq(schema.bookings.id, old.id))
      .returning();
    const fresh = await loadMeetingContext(ctx.meeting.id);
    if (fresh) await syncZoom(fresh, "update");
    await enqueue("notify.booking", { bookingId: old.id, kind: "rescheduled" });
    await enqueue("notify.booking", { bookingId: old.id, kind: "host_new" });
    await enqueue("calendar.write", { meetingId: ctx.meeting.id, reason: "updated" });
    return updated;
  }

  // Group session: book a seat at the new time, then cancel the old seat.
  const created = await createBooking({
    eventType: ctx.eventType,
    start: newStart,
    attendee,
    attendeeName: old.attendeeName,
    attendeeEmail: old.attendeeEmail,
    timezone,
    answers: old.answers,
  });
  await db.update(schema.bookings).set({ rescheduledFromId: old.id }).where(eq(schema.bookings.id, created.id));
  await db.update(schema.bookings).set({ rescheduledToId: created.id }).where(eq(schema.bookings.id, old.id));
  await cancelBookingInternal(old.id, actorDid, "Rescheduled");
  return created;
}

export async function bookingByToken(token: string) {
  return db.query.bookings.findFirst({ where: eq(schema.bookings.manageToken, token) });
}
