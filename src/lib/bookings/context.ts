import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Booking, EventType, Meeting, Team, User } from "@/db/schema";
import { getUsersByDids, displayName } from "@/lib/users/service";
import { appUrl } from "@/lib/env";

export type MeetingContext = {
  meeting: Meeting;
  eventType: EventType;
  team: Team | null;
  hosts: User[];
  bookings: Booking[];
};

export async function loadMeetingContext(meetingId: string): Promise<MeetingContext | null> {
  const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, meetingId) });
  if (!meeting) return null;
  const eventType = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, meeting.eventTypeId) });
  if (!eventType) return null;
  const team = eventType.teamId ? (await db.query.teams.findFirst({ where: eq(schema.teams.id, eventType.teamId) })) ?? null : null;
  const hostMap = await getUsersByDids(meeting.hostDids);
  const hosts = meeting.hostDids.map((d) => hostMap.get(d)).filter((u): u is User => Boolean(u));
  const bookings = await db.query.bookings.findMany({ where: eq(schema.bookings.meetingId, meetingId) });
  return { meeting, eventType, team, hosts, bookings };
}

export async function loadBookingContext(bookingId: string): Promise<(MeetingContext & { booking: Booking }) | null> {
  const booking = await db.query.bookings.findFirst({ where: eq(schema.bookings.id, bookingId) });
  if (!booking) return null;
  const ctx = await loadMeetingContext(booking.meetingId);
  if (!ctx) return null;
  return { ...ctx, booking };
}

export function meetingTitle(ctx: MeetingContext, attendeeName?: string): string {
  const hostNames = ctx.hosts.map(displayName).join(", ");
  const who = ctx.team ? ctx.team.name : hostNames;
  return attendeeName && ctx.eventType.capacity === 1 ? `${ctx.eventType.title}: ${attendeeName} and ${who}` : `${ctx.eventType.title} with ${who}`;
}

export function meetingLocation(ctx: MeetingContext): string | undefined {
  if (ctx.meeting.videoUrl) return ctx.meeting.videoUrl;
  if (ctx.meeting.location) return ctx.meeting.location;
  if (ctx.eventType.locationKind === "inperson" || ctx.eventType.locationKind === "custom") return ctx.eventType.locationText ?? undefined;
  if (ctx.eventType.locationKind === "phone") return ctx.eventType.locationText ? `Phone: ${ctx.eventType.locationText}` : "Phone";
  return undefined;
}

export function manageUrl(booking: Booking): string {
  return appUrl(`/b/${booking.manageToken}`);
}

export function bookingPageUrl(eventType: EventType, ownerHandle: string | null, teamSlug: string | null): string {
  const base = eventType.ownerKind === "team" ? `/t/${teamSlug}/${eventType.slug}` : `/@${ownerHandle}/${eventType.slug}`;
  const token = eventType.visibility === "link" && eventType.linkToken ? `?k=${eventType.linkToken}` : "";
  return appUrl(`${base}${token}`);
}

export async function activeBookingsOf(meetingIds: string[]): Promise<Booking[]> {
  if (!meetingIds.length) return [];
  return db.query.bookings.findMany({
    where: (b, { and }) => and(inArray(b.meetingId, meetingIds), eq(b.status, "confirmed")),
  });
}
