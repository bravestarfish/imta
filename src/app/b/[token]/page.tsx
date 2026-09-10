import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { bookingByToken, attendeeMayChange } from "@/lib/bookings/service";
import { loadMeetingContext, meetingLocation } from "@/lib/bookings/context";
import { displayName } from "@/lib/users/service";
import { fmtRange } from "@/lib/email/format";
import { cancelBookingAction } from "@/app/actions/bookings";
import { Badge, Notice, TIMEZONES } from "@/components/ui";
import { SlotPicker } from "@/components/booking/slot-picker";
import { AddToCalendar } from "./add-to-calendar";

export default async function ManageBooking({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string; cancelled?: string; rescheduled?: string; error?: string; reschedule?: string }> }) {
  const { token } = await params;
  const q = await searchParams;
  const booking = await bookingByToken(token);
  if (!booking) notFound();
  const ctx = await loadMeetingContext(booking.meetingId);
  if (!ctx) notFound();
  const viewer = await getCurrentUser();
  const isHost = viewer ? ctx.meeting.hostDids.includes(viewer.did) : false;
  const zone = viewer?.timezone ?? booking.timezone;
  const policy = attendeeMayChange(ctx.eventType, ctx.meeting);
  const active = booking.status === "confirmed" || booking.status === "pending";
  const canChange = active && (isHost || policy.ok);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {q.new ? <Notice kind="success">{booking.status === "pending" ? "Your request was sent. You will get an email once the organizer approves it." : "Booked. A confirmation with a calendar invitation is on its way."}</Notice> : null}
      {q.rescheduled ? <Notice kind="success">Moved. Updated invitations have been sent.</Notice> : null}
      {q.cancelled ? <Notice>Booking cancelled.</Notice> : null}
      {q.error ? <Notice kind="error">{q.error}</Notice> : null}

      <div className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{ctx.eventType.title}</h1>
          <Badge tone={booking.status === "confirmed" ? "ok" : booking.status === "pending" ? "warn" : "danger"}>{booking.status}</Badge>
        </div>
        <p className="text-sm">{fmtRange(ctx.meeting.startAt, ctx.meeting.endAt, zone)}</p>
        <p className="text-sm text-muted">With {ctx.hosts.map((h) => `${displayName(h)} (@${h.handle})`).join(", ")}</p>
        <p className="text-sm text-muted">Attendee: {booking.attendeeName} (@{booking.attendeeHandle ?? booking.attendeeDid})</p>
        {ctx.meeting.videoUrl && active ? (
          <p className="text-sm">Join: <a className="underline" href={ctx.meeting.videoUrl} target="_blank" rel="noreferrer">{ctx.meeting.videoUrl}</a></p>
        ) : meetingLocation(ctx) ? (
          <p className="text-sm">Where: {meetingLocation(ctx)}</p>
        ) : null}
        {active ? <AddToCalendar token={token} /> : null}
      </div>

      {active && !canChange ? <p className="text-sm text-muted">{policy.ok ? "" : policy.reason}</p> : null}

      {canChange && q.reschedule && (ctx.eventType.allowReschedule || isHost) ? (
        <section>
          <h2 className="mb-2 font-medium">Pick a new time</h2>
          <SlotPicker
            eventTypeId={ctx.eventType.id}
            durationMinutes={ctx.eventType.durationMinutes}
            bookingWindowDays={ctx.eventType.bookingWindowDays}
            capacity={ctx.eventType.capacity}
            questions={[]}
            linkKey={ctx.eventType.linkToken}
            timezones={TIMEZONES}
            viewer={{ name: booking.attendeeName, email: booking.attendeeEmail, timezone: zone }}
            reschedule={{ token }}
            loginUrl="/login"
          />
        </section>
      ) : null}

      {canChange && !q.reschedule ? (
        <div className="card flex flex-wrap items-end gap-3">
          {ctx.eventType.allowReschedule || isHost ? <a href={`/b/${token}?reschedule=1`} className="btn-secondary">Reschedule</a> : null}
          <form action={cancelBookingAction} className="flex flex-1 flex-wrap items-end gap-2">
            <input type="hidden" name="token" value={token} />
            <label className="block flex-1"><span className="label">Reason (optional)</span><input name="reason" className="input" maxLength={500} /></label>
            <button className="btn-danger">Cancel booking</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
