import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { getTeamBySlug, teamRole, teamMembersWithUsers } from "@/lib/teams/service";
import { hostAvailabilities } from "@/lib/availability/service";
import { computeOverlap, suggestTimes } from "@/lib/scheduling/overlap";
import { displayName } from "@/lib/users/service";
import { fmtRange } from "@/lib/email/format";
import { updateTeamAction, deleteTeamAction, inviteMemberAction, setRoleAction, removeMemberAction } from "@/app/actions/teams";
import { Avatar, Badge, Field, Notice, PageHeader, TimezoneSelect } from "@/components/ui";
import { OverlapGrid } from "./overlap-grid";
import { DateTime } from "luxon";

export default async function TeamPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; saved?: string; invited?: string; week?: string }> }) {
  const user = await getCurrentUser();
  const { slug } = await params;
  const { error, saved, invited, week } = await searchParams;
  if (!user) redirect(`/login?next=/teams/${slug}`);
  const team = await getTeamBySlug(slug);
  if (!team) notFound();
  const role = await teamRole(team.id, user.did);
  if (!role) notFound();
  const isAdmin = role === "owner" || role === "admin";
  const members = await teamMembersWithUsers(team.id);
  const eventTypes = await db.query.eventTypes.findMany({ where: and(eq(schema.eventTypes.teamId, team.id), eq(schema.eventTypes.ownerKind, "team")) });
  const pending = await db.query.teamInvites.findMany({ where: and(eq(schema.teamInvites.teamId, team.id), eq(schema.teamInvites.status, "pending")) });

  // Computed overlap for the selected week (members see the overlap, not each other's raw calendars).
  const weekStart = (week ? DateTime.fromISO(week, { zone: user.timezone }) : DateTime.now().setZone(user.timezone)).startOf("week");
  const window = { start: weekStart.toMillis(), end: weekStart.plus({ days: 7 }).toMillis() };
  const availability = await hostAvailabilities(members.map((m) => ({ did: m.did })), window);
  const overlap = computeOverlap(availability, { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
  const suggestions = suggestTimes(overlap.all, 60, user.timezone, 6);

  return (
    <div className="space-y-8">
      <PageHeader
        title={team.name}
        description={
          <>
            {team.description ? <span>{team.description} · </span> : null}
            Booking page: <Link href={`/t/${team.slug}`} className="underline">/t/{team.slug}</Link>
          </>
        }
        actions={<Link href={`/event-types/new?team=${team.id}`} className="btn-primary">New team event type</Link>}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {saved ? <Notice kind="success">Saved.</Notice> : null}
      {invited ? <Notice kind="success">Invitation sent.</Notice> : null}

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">When is everyone free?</h2>
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/teams/${slug}?week=${weekStart.minus({ weeks: 1 }).toISODate()}`} className="btn-secondary px-2 py-1">‹</Link>
            <span>{weekStart.toFormat("d LLL")} – {weekStart.plus({ days: 6 }).toFormat("d LLL yyyy")}</span>
            <Link href={`/teams/${slug}?week=${weekStart.plus({ weeks: 1 }).toISODate()}`} className="btn-secondary px-2 py-1">›</Link>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted">Computed from each member&apos;s working hours minus their calendar busy times. Times shown in {user.timezone}.</p>
        <OverlapGrid
          weekStartMs={window.start}
          zone={user.timezone}
          members={members.map((m) => ({ did: m.did, name: displayName(m) }))}
          byMember={overlap.byMember}
          all={overlap.all}
          atLeast={overlap.atLeast}
        />
        {suggestions.length ? (
          <div className="mt-4 text-sm">
            <span className="font-medium">Suggested 60 minute slots where everyone is free:</span>
            <ul className="mt-1 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <li key={s.start} className="rounded bg-accent/10 px-2 py-1 text-xs">{fmtRange(new Date(s.start), new Date(s.end), user.timezone)}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">No time this week where everyone is free. Try “any” or “at least N” in a team event type, or <Link href={`/polls/new?team=${team.id}`} className="underline">run a poll</Link>.</p>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-medium">Members ({members.length})</h2>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.did} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2"><Avatar user={m} size={24} /> {displayName(m)} <span className="text-muted">@{m.handle}</span> <Badge>{m.role}</Badge></span>
                <span className="flex gap-2">
                  {role === "owner" && m.did !== user.did ? (
                    <form action={setRoleAction} className="flex gap-1">
                      <input type="hidden" name="teamId" value={team.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="did" value={m.did} />
                      <select name="role" defaultValue={m.role} className="input w-auto py-1 text-xs">
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="owner">owner</option>
                      </select>
                      <button className="text-xs underline">set</button>
                    </form>
                  ) : null}
                  {(isAdmin && m.role !== "owner") || (m.did === user.did && m.role !== "owner") ? (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="teamId" value={team.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="did" value={m.did} />
                      <button className="text-xs text-red-600 underline">{m.did === user.did ? "leave" : "remove"}</button>
                    </form>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          {pending.length ? <p className="text-xs text-muted">Pending invitations: {pending.map((p) => p.inviteeDid).join(", ")}</p> : null}
          {isAdmin ? (
            <form action={inviteMemberAction} className="flex flex-wrap gap-2 border-t border-border pt-3">
              <input type="hidden" name="teamId" value={team.id} />
              <input type="hidden" name="slug" value={slug} />
              <input name="handle" className="input flex-1" placeholder="handle.bsky.social" required />
              <select name="role" className="input w-auto"><option value="member">member</option><option value="admin">admin</option></select>
              <button className="btn-secondary">Invite</button>
            </form>
          ) : null}
        </section>

        <section className="space-y-4">
          <div className="card">
            <h2 className="mb-2 font-medium">Team event types</h2>
            {!eventTypes.length ? <p className="text-sm text-muted">None yet.</p> : null}
            <ul className="space-y-1 text-sm">
              {eventTypes.map((e) => (
                <li key={e.id} className="flex items-center justify-between">
                  <Link href={`/event-types/${e.id}`} className="hover:underline">{e.title}</Link>
                  <Badge tone={e.status === "published" ? "ok" : "neutral"}>{e.status}</Badge>
                </li>
              ))}
            </ul>
          </div>
          {isAdmin ? (
            <form action={updateTeamAction} className="card space-y-3">
              <h2 className="font-medium">Team settings</h2>
              <input type="hidden" name="teamId" value={team.id} />
              <input type="hidden" name="slug" value={slug} />
              <Field label="Name"><input name="name" className="input" defaultValue={team.name} required /></Field>
              <Field label="Description"><input name="description" className="input" defaultValue={team.description ?? ""} /></Field>
              <Field label="Time zone"><TimezoneSelect name="timezone" defaultValue={team.timezone} /></Field>
              <div className="flex gap-2">
                <button className="btn-primary">Save</button>
                {role === "owner" ? <button className="btn-danger" formAction={deleteTeamAction}>Delete team</button> : null}
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  );
}
