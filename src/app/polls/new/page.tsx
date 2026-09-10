import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { myTeams } from "@/lib/teams/service";
import { createPollAction } from "@/app/actions/polls";
import { Field, Notice, PageHeader, TimezoneSelect } from "@/components/ui";

export default async function NewPoll({ searchParams }: { searchParams: Promise<{ team?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/polls/new");
  const { team, error } = await searchParams;
  const teams = await myTeams(user.did);
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="New poll" />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <form action={createPollAction} className="card space-y-4">
        <Field label="Title"><input name="title" className="input" required /></Field>
        <Field label="Description"><input name="description" className="input" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Team (optional)" hint="All members become participants.">
            <select name="teamId" className="input" defaultValue={team ?? ""}>
              <option value="">None</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Duration (min)"><input name="durationMinutes" type="number" className="input" defaultValue={60} min={5} step={5} /></Field>
          <Field label="Time zone of the options"><TimezoneSelect name="timezone" defaultValue={user.timezone} /></Field>
          <Field label="Other participants" hint="Handles, comma separated."><input name="participants" className="input" placeholder="a.bsky.social, b.eurosky.social" /></Field>
        </div>
        <fieldset>
          <legend className="label">Options</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <input key={i} name="option" type="datetime-local" className="input" />
            ))}
          </div>
        </fieldset>
        <button className="btn-primary">Create poll</button>
      </form>
    </div>
  );
}
