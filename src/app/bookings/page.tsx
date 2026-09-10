import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { fmtRange } from "@/lib/email/format";
import { getUsersByDids, displayName } from "@/lib/users/service";
import { hostCancelMeetingAction, approveBookingAction, declineBookingAction } from "@/app/actions/bookings";
import { Badge, Empty, PageHeader } from "@/components/ui";

export default async function Bookings({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/bookings");
  const { view } = await searchParams;
  const past = view === "past";
  const now = new Date();
  const timeFilter = past ? lt(schema.meetings.startAt, now) : gte(schema.meetings.startAt, now);

  const hostedAll = await db.query.meetings.findMany({ where: timeFilter, orderBy: (m, { asc, desc }) => (past ? desc(m.startAt) : asc(m.startAt)), limit: 400 });
  const hosted = hostedAll.filter((m) => m.hostDids.includes(user.did)).slice(0, 100);
  const hostedBookings = hosted.length ? await db.query.bookings.findMany({ where: inArray(schema.bookings.meetingId, hosted.map((m) => m.id)) }) : [];
  const attending = await db
    .select({ meeting: schema.meetings, booking: schema.bookings })
    .from(schema.bookings)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.bookings.meetingId))
    .where(and(eq(schema.bookings.attendeeDid, user.did), timeFilter))
    .orderBy(past ? schema.meetings.startAt : schema.meetings.startAt)
    .limit(100);
  const etIds = [...new Set([...hosted.map((m) => m.eventTypeId), ...attending.map((a) => a.meeting.eventTypeId)])];
  const ets = etIds.length ? await db.query.eventTypes.findMany({ where: inArray(schema.eventTypes.id, etIds) }) : [];
  const etMap = new Map(ets.map((e) => [e.id, e]));
  const hostUsers = await getUsersByDids(hosted.flatMap((m) => m.hostDids).concat(attending.flatMap((a) => a.meeting.hostDids)));

  return (
    <div>
      <PageHeader
        title="Bookings"
        actions={
          <div className="flex gap-2 text-sm">
            <Link href="/bookings" className={past ? "btn-secondary" : "btn-primary"}>Upcoming</Link>
            <Link href="/bookings?view=past" className={past ? "btn-primary" : "btn-secondary"}>Past</Link>
          </div>
        }
      />
      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-3 font-medium">You host</h2>
          {!hosted.length ? <Empty>Nothing here.</Empty> : null}
          <ul className="space-y-2">
            {hosted.map((m) => {
              const bs = hostedBookings.filter((b) => b.meetingId === m.id);
              const et = etMap.get(m.eventTypeId);
              return (
                <li key={m.id} className="card space-y-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{et?.title ?? "Meeting"}</span>
                    <Badge tone={m.status === "cancelled" ? "danger" : "ok"}>{m.status}</Badge>
                  </div>
                  <div className="text-sm text-muted">{fmtRange(m.startAt, m.endAt, user.timezone)}</div>
                  {m.hostDids.length > 1 ? <div className="text-xs text-muted">Hosts: {m.hostDids.map((d) => hostUsers.get(d)).filter(Boolean).map((u) => displayName(u!)).join(", ")}</div> : null}
                  {m.videoUrl ? <a href={m.videoUrl} className="text-xs underline" target="_blank" rel="noreferrer">{m.videoUrl}</a> : null}
                  <ul className="space-y-1 text-sm">
                    {bs.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {b.attendeeName} <span className="text-muted">@{b.attendeeHandle ?? b.attendeeDid}</span> <Badge tone={b.status === "confirmed" ? "ok" : b.status === "pending" ? "warn" : "neutral"}>{b.status}</Badge>
                        </span>
                        {b.status === "pending" && m.status === "scheduled" ? (
                          <span className="flex gap-2">
                            <form action={approveBookingAction}><input type="hidden" name="bookingId" value={b.id} /><button className="text-xs underline">approve</button></form>
                            <form action={declineBookingAction}><input type="hidden" name="bookingId" value={b.id} /><button className="text-xs text-red-600 underline">decline</button></form>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {Object.keys(bs[0]?.answers ?? {}).length ? (
                    <details className="text-xs text-muted"><summary>Answers</summary>
                      {bs.map((b) => (
                        <div key={b.id} className="mt-1">{b.attendeeName}: {Object.entries(b.answers).map(([k, v]) => `${et?.questions.find((q) => q.id === k)?.label ?? k}: ${String(v)}`).join(" · ")}</div>
                      ))}
                    </details>
                  ) : null}
                  {m.status === "scheduled" && !past ? (
                    <form action={hostCancelMeetingAction} className="flex gap-2">
                      <input type="hidden" name="meetingId" value={m.id} />
                      <input name="reason" className="input py-1 text-xs" placeholder="Reason (optional)" />
                      <button className="btn-danger px-2 py-1 text-xs">Cancel meeting</button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 font-medium">You attend</h2>
          {!attending.length ? <Empty>Nothing here.</Empty> : null}
          <ul className="space-y-2">
            {attending.map(({ meeting: m, booking: b }) => (
              <li key={b.id} className="card space-y-1 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{etMap.get(m.eventTypeId)?.title ?? "Meeting"}</span>
                  <Badge tone={b.status === "confirmed" ? "ok" : b.status === "pending" ? "warn" : "neutral"}>{b.status}</Badge>
                </div>
                <div className="text-sm text-muted">{fmtRange(m.startAt, m.endAt, user.timezone)}</div>
                <div className="text-xs text-muted">With {m.hostDids.map((d) => hostUsers.get(d)).filter(Boolean).map((u) => displayName(u!)).join(", ")}</div>
                {m.videoUrl && b.status === "confirmed" ? <a href={m.videoUrl} className="text-xs underline" target="_blank" rel="noreferrer">Join</a> : null}{" "}
                <Link href={`/b/${b.manageToken}`} className="text-xs underline">Manage</Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
