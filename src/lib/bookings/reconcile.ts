import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProviderConnection } from "@/db/schema";
import { log } from "@/lib/log";
import { cancelBookingInternal, cancelMeetingInternal } from "./service";

/**
 * Two-way sync: when someone deletes a booking event in their own calendar we
 * treat it as a cancellation. Hosts deleting the event cancel the whole
 * meeting; attendees deleting their copy cancel only their booking.
 * Time changes made in the calendar are not propagated (the app owns the
 * schedule); the event is rewritten on the next write.
 */
export async function reconcileProviderChanges(
  conn: ProviderConnection,
  own: { externalEventId: string; meetingId: string; bookingId: string | null }[],
  changes: { externalEventId: string; deleted: boolean; start?: Date; end?: Date }[],
): Promise<void> {
  for (const change of changes) {
    if (!change.deleted) continue;
    const row = own.find((o) => o.externalEventId === change.externalEventId);
    if (!row) continue;
    const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, row.meetingId) });
    if (!meeting || meeting.status === "cancelled" || meeting.startAt.getTime() < Date.now()) continue;
    log.info("calendar: participant deleted event, cancelling", { meetingId: row.meetingId, bookingId: row.bookingId, did: conn.userDid });
    await db.delete(schema.calendarEvents).where(eq(schema.calendarEvents.externalEventId, change.externalEventId));
    if (row.bookingId) {
      await cancelBookingInternal(row.bookingId, conn.userDid, "Removed from calendar");
    } else if (meeting.hostDids.includes(conn.userDid)) {
      await cancelMeetingInternal(meeting.id, conn.userDid, "Removed from host calendar");
    }
  }
}
