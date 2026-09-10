import { bookingByToken } from "@/lib/bookings/service";
import { loadMeetingContext, meetingLocation, meetingTitle } from "@/lib/bookings/context";
import { buildIcs } from "@/lib/email/ics";
import { env } from "@/lib/env";
import { displayName } from "@/lib/users/service";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const booking = await bookingByToken(token);
  if (!booking) return new Response("not found", { status: 404 });
  const m = await loadMeetingContext(booking.meetingId);
  if (!m) return new Response("not found", { status: 404 });
  const ics = buildIcs({
    uid: `${m.meeting.icsUid}-${booking.id}`,
    sequence: m.meeting.icsSequence,
    start: m.meeting.startAt,
    end: m.meeting.endAt,
    summary: meetingTitle(m, booking.attendeeName),
    description: m.eventType.description ?? undefined,
    location: meetingLocation(m),
    url: m.meeting.videoUrl ?? undefined,
    organizer: { name: env().APP_NAME, email: env().EMAIL_FROM.replace(/^.*<|>.*$/g, "") },
    attendees: [{ name: booking.attendeeName, email: booking.attendeeEmail }, ...m.hosts.filter((h) => h.email).map((h) => ({ name: displayName(h), email: h.email! }))],
    method: booking.status === "cancelled" ? "CANCEL" : "REQUEST",
  });
  return new Response(ics, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="invite.ics"' } });
}
