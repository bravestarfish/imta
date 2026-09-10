import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { myTeams, myTeamInvites } from "@/lib/teams/service";
import { createTeamAction, respondTeamInviteAction } from "@/app/actions/teams";
import { Badge, Empty, Field, Notice, PageHeader, TimezoneSelect } from "@/components/ui";

export default async function Teams({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/teams");
  const { error } = await searchParams;
  const teams = await myTeams(user.did);
  const invites = await myTeamInvites(user.did);
  return (
    <div>
      <PageHeader title="Teams" description="A team shares event types. Each member keeps their own availability; the team decides how many of you need to be free." />
      {error ? <Notice kind="error">{error}</Notice> : null}
      {invites.length ? (
        <section className="mb-6 space-y-2">
          {invites.map(({ invite, team }) => (
            <form key={invite.id} action={respondTeamInviteAction} className="card flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <span>You were invited to join <strong>{team.name}</strong> as {invite.role}.</span>
              <input type="hidden" name="inviteId" value={invite.id} />
              <div className="flex gap-2">
                <button className="btn-primary" name="accept" value="1">Accept</button>
                <button className="btn-secondary" name="accept" value="0">Decline</button>
              </div>
            </form>
          ))}
        </section>
      ) : null}
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          {!teams.length ? <Empty>You are not in a team yet.</Empty> : null}
          <ul className="space-y-2">
            {teams.map((t) => (
              <li key={t.id} className="card flex items-center justify-between py-3">
                <div>
                  <Link href={`/teams/${t.slug}`} className="font-medium hover:underline">{t.name}</Link>
                  <div className="text-xs text-muted">{t.memberCount} member{t.memberCount === 1 ? "" : "s"} · {t.timezone} · <Link href={`/t/${t.slug}`} className="underline">/t/{t.slug}</Link></div>
                </div>
                <Badge tone="accent">{t.role}</Badge>
              </li>
            ))}
          </ul>
        </section>
        <form action={createTeamAction} className="card space-y-3 self-start">
          <h2 className="font-medium">New team</h2>
          <Field label="Name"><input name="name" className="input" required maxLength={80} /></Field>
          <Field label="Description"><input name="description" className="input" maxLength={300} /></Field>
          <Field label="Time zone" hint="Used to align slots and count daily limits."><TimezoneSelect name="timezone" defaultValue={user.timezone} /></Field>
          <button className="btn-primary w-full">Create team</button>
        </form>
      </div>
    </div>
  );
}
