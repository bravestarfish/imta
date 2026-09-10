import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { calendarProvider } from "@/lib/calendar";
import { writeTargetFor } from "@/lib/calendar/service";
import type { EventInput } from "@/lib/calendar/types";
import { newId } from "@/lib/ids";
import { log, errMessage } from "@/lib/log";
import { displayName } from "@/lib/users/service";
import { loadMeetingContext, manageUrl, meetingLocation, meetingTitle, type MeetingContext } from "./context";
import { updateZoomMeeting, deleteZoomMeeting } from "@/lib/video/zoom";
import { connectionOfProvider } from "@/lib/calendar/service";

/**
 * Mirror a meeting into every participant's connected calendar:
 *  - hosts get one event each (attendees listed as guests so the provider sends its own invite)
 *  - attendees with a connected calendar get their own copy (no guests)
 * Everyone also receives an ICS by email (see notify.ts), so this is best effort.
 */
export async function writeMeetingToCalendars(meetingId: string, reason: "created" | "updated" | "cancelled"): Promise<void> {
  const ctx = await loadMeetingContext(meetingId);
  if (!ctx) return;
  if (reason === "cancelled" || ctx.meeting.status === "cancelled") {
    await removeAll(ctx);
    return;
  }
  const active = ctx.bookings.filter((b) => b.status === "confirmed");
  const participants: { did: string; role: "host" | "attendee"; bookingId: string | null }[] = [
    ...ctx.hosts.map((h) => ({ did: h.did, role: "host" as const, bookingId: null })),
    ...active.filter((b) => !ctx.meeting.hostDids.includes(b.attendeeDid)).map((b) => ({ did: b.attendeeDid, role: "attendee" as const, bookingId: b.id })),
  ];

  let conferenceUrl: string | undefined;
  for (const p of participants) {
    const conn = await writeTargetFor(p.did);
    if (!conn || !conn.writeCalendarId) continue;
    const api = calendarProvider(conn.provider);
    const existing = await db.query.calendarEvents.findFirst({
      where: and(eq(schema.calendarEvents.connectionId, conn.id), eq(schema.calendarEvents.meetingId, ctx.meeting.id)),
    });
    const booking = p.bookingId ? active.find((b) => b.id === p.bookingId) : undefined;
    const input: EventInput = {
      title: meetingTitle(ctx, booking?.attendeeName ?? (ctx.eventType.capacity === 1 ? active[0]?.attendeeName : undefined)),
      description: [
        ctx.eventType.description ?? "",
        ctx.meeting.videoUrl ? `Join: ${ctx.meeting.videoUrl}` : "",
        `Hosts: ${ctx.hosts.map((h) => `${displayName(h)} (@${h.handle})`).join(", ")}`,
        booking ? `Manage: ${manageUrl(booking)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      start: ctx.meeting.startAt,
      end: ctx.meeting.endAt,
      timezone: "UTC",
      location: meetingLocation(ctx),
      attendees: p.role === "host" ? active.map((b) => ({ email: b.attendeeEmail, name: b.attendeeName })) : [],
      createConference: p.role === "host" && ctx.meeting.videoProvider === "google_meet" && !ctx.meeting.videoUrl && conn.provider === "google",
      icsUid: p.role === "host" ? ctx.meeting.icsUid : `${ctx.meeting.icsUid}-${p.bookingId}`,
      sequence: ctx.meeting.icsSequence,
    };
    try {
      const written = existing
        ? await api.updateEvent(conn, existing.externalCalendarId, existing.externalEventId, input)
        : await api.createEvent(conn, conn.writeCalendarId, input);
      if (!existing) {
        await db.insert(schema.calendarEvents).values({
          id: newId("cev"),
          connectionId: conn.id,
          meetingId: ctx.meeting.id,
          bookingId: p.bookingId,
          role: p.role,
          externalCalendarId: written.externalCalendarId,
          externalEventId: written.externalEventId,
        });
      } else {
        await db.update(schema.calendarEvents).set({ lastSyncedAt: new Date() }).where(eq(schema.calendarEvents.id, existing.id));
      }
      if (written.conferenceUrl && !ctx.meeting.videoUrl && !conferenceUrl) conferenceUrl = written.conferenceUrl;
    } catch (e) {
      log.warn("calendar write failed", { meetingId, did: p.did, provider: conn.provider, error: errMessage(e) });
    }
  }

  // A Google Meet link created by the host's calendar becomes the meeting's link.
  if (conferenceUrl && !ctx.meeting.videoUrl) {
    await db.update(schema.meetings).set({ videoUrl: conferenceUrl, updatedAt: new Date() }).where(eq(schema.meetings.id, ctx.meeting.id));
    // Re-run so attendee copies and descriptions carry the link.
    await writeMeetingToCalendars(meetingId, "updated");
  }
}

async function removeAll(ctx: MeetingContext) {
  const rows = await db.query.calendarEvents.findMany({ where: eq(schema.calendarEvents.meetingId, ctx.meeting.id) });
  for (const row of rows) {
    const conn = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.id, row.connectionId) });
    if (conn) {
      try {
        await calendarProvider(conn.provider).deleteEvent(conn, row.externalCalendarId, row.externalEventId);
      } catch (e) {
        log.warn("calendar delete failed", { meetingId: ctx.meeting.id, error: errMessage(e) });
      }
    }
    await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, row.id));
  }
}

/** Remove one attendee's copy (their booking was cancelled while the meeting continues). */
export async function removeAttendeeCalendarCopy(bookingId: string) {
  const rows = await db.query.calendarEvents.findMany({ where: eq(schema.calendarEvents.bookingId, bookingId) });
  for (const row of rows) {
    const conn = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.id, row.connectionId) });
    if (conn) await calendarProvider(conn.provider).deleteEvent(conn, row.externalCalendarId, row.externalEventId).catch(() => undefined);
    await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.id, row.id));
  }
}

/** Keep a Zoom meeting aligned with the meeting time, or delete it. */
export async function syncZoom(ctx: MeetingContext, action: "update" | "delete") {
  if (ctx.meeting.videoProvider !== "zoom" || !ctx.meeting.videoUrl) return;
  const m = ctx.meeting.videoUrl.match(/\/j\/(\d+)/);
  if (!m) return;
  const host = ctx.hosts[0];
  if (!host) return;
  const zoom = await connectionOfProvider(host.did, "zoom");
  if (!zoom) return;
  try {
    if (action === "delete") await deleteZoomMeeting(zoom, m[1]);
    else
      await updateZoomMeeting(zoom, m[1], {
        start: ctx.meeting.startAt,
        durationMinutes: Math.round((ctx.meeting.endAt.getTime() - ctx.meeting.startAt.getTime()) / 60_000),
        timezone: host.timezone,
      });
  } catch (e) {
    log.warn("zoom sync failed", { meetingId: ctx.meeting.id, error: errMessage(e) });
  }
}
