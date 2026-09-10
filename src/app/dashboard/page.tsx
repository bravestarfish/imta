import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { listEventTypesFor } from "@/lib/event-types/service";
import { myInvitations } from "@/lib/event-types/invitations";
import { myTeamInvites } from "@/lib/teams/service";
import { listConnections } from "@/lib/calendar/service";
import { fmtRange } from "@/lib/email/format";
import { PageHeader, Empty, Badge } from "@/components/ui";

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.onboardedAt) redirect("/onboarding");

  const now = new Date();
  const hosted = (await db.query.meetings.findMany({ where: and(eq(schema.meetings.status, "scheduled"), gte(schema.meetings.startAt, now)), orderBy: (m, { asc }) => asc(m.startAt) })).filter((m) =>
    m.hostDids.includes(user.did),
  );
  const attending = await db
    .select({ meeting: schema.meetings, booking: schema.bookings })
    .from(schema.bookings)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.bookings.meetingId))
    .where(and(eq(schema.bookings.attendeeDid, user.did), inArray(schema.bookings.status, ["confirmed", "pending"]), gte(schema.meetings.startAt, now)))
    .orderBy(schema.meetings.startAt);
  const etIds = [...new Set([...hosted.map((m) => m.eventTypeId), ...attending.map((a) => a.meeting.eventTypeId)])];
  const ets = etIds.length ? await db.query.eventTypes.findMany({ where: inArray(schema.eventTypes.id, etIds) }) : [];
  const etMap = new Map(ets.map((e) => [e.id, e]));
  const { personal, team } = await listEventTypesFor(user.did);
  const invitations = (await myInvitations(user.did)).filter((i) => i.inv.status === "pending");
  const teamInvites = await myTeamInvites(user.did);
  const connections = await listConnections(user.did);
  const pending = hosted.length
    ? await db.query.bookings.findMany({ where: and(inArray(schema.bookings.meetingId, hosted.map((m) => m.id)), eq(schema.bookings.status, "pending")) })
    : [];

  return (
    <div>
      <PageHeader title={`Hello, ${user.displayName ?? "@" + user.handle}`} description="Your upcoming meetings and quick actions." />
      {invitations.length || teamInvites.length || pending.length ? (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          {invitations.length ? <Link href="/invitations" className="btn-secondary">{invitations.length} event invitation{invitations.length > 1 ? "s" : ""}</Link> : null}
          {teamInvites.length ? <Link href="/teams" className="btn-secondary">{teamInvites.length} team invitation{teamInvites.length > 1 ? "s" : ""}</Link> : null}
          {pending.length ? <Link href="/bookings" className="btn-secondary">{pending.length} booking{pending.length > 1 ? "s" : ""} awaiting approval</Link> : null}
        </div>
      ) : null}
      {!connections.length ? (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Mark when you are free in the <Link href="/availability" className="underline">week view</Link>, or connect Google Calendar or Microsoft 365 so bookings avoid your busy times automatically.</p>
          <Link href="/calendars" className="btn-primary">Connect a calendar</Link>
        </div>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-3 font-medium">Upcoming</h2>
          {!hosted.length && !attending.length ? <Empty>Nothing scheduled yet.</Empty> : null}
          <ul className="space-y-2">
            {hosted.slice(0, 8).map((m) => (
              <li key={m.id} className="card py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{etMap.get(m.eventTypeId)?.title ?? "Meeting"}</span>
                  <Badge tone="accent">hosting</Badge>
                </div>
                <div className="text-sm text-muted">{fmtRange(m.startAt, m.endAt, user.timezone)}</div>
              </li>
            ))}
            {attending.slice(0, 8).map(({ meeting, booking }) => (
              <li key={booking.id} className="card py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{etMap.get(meeting.eventTypeId)?.title ?? "Meeting"}</span>
                  <Badge tone={booking.status === "pending" ? "warn" : "ok"}>{booking.status === "pending" ? "awaiting approval" : "attending"}</Badge>
                </div>
                <div className="text-sm text-muted">{fmtRange(meeting.startAt, meeting.endAt, user.timezone)}</div>
                <Link href={`/b/${booking.manageToken}`} className="text-xs underline">Manage</Link>
              </li>
            ))}
          </ul>
          {hosted.length + attending.length > 8 ? <Link href="/bookings" className="mt-2 inline-block text-sm underline">See all</Link> : null}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Your event types</h2>
            <Link href="/event-types/new" className="text-sm underline">New</Link>
          </div>
          {!personal.length && !team.length ? <Empty>Create an event type to get a booking link.</Empty> : null}
          <ul className="space-y-2">
            {personal.map((e) => (
              <li key={e.id} className="card flex items-center justify-between gap-2 py-3">
                <div>
                  <Link href={`/event-types/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                  <div className="text-xs text-muted">{e.durationMinutes} min · {e.visibility}</div>
                </div>
                <Badge tone={e.status === "published" ? "ok" : "neutral"}>{e.status}</Badge>
              </li>
            ))}
            {team.map((e) => (
              <li key={e.id} className="card flex items-center justify-between gap-2 py-3">
                <div>
                  <Link href={`/event-types/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                  <div className="text-xs text-muted">{e.teamName} · {e.durationMinutes} min · {e.assignmentMode}</div>
                </div>
                <Badge tone={e.status === "published" ? "ok" : "neutral"}>{e.status}</Badge>
              </li>
            ))}
          </ul>
          {user.publicProfile ? (
            <p className="mt-3 text-sm text-muted">
              Public booking page: <Link href={`/@${user.handle}`} className="underline">/@{user.handle}</Link>
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
