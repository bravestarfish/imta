import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getPoll } from "@/lib/polls/service";
import { getUsersByDids, displayName } from "@/lib/users/service";
import { fmtRange } from "@/lib/email/format";
import { voteAction, closePollAction, deletePollAction } from "@/app/actions/polls";
import { Badge, PageHeader } from "@/components/ui";

export default async function PollPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user) redirect(`/login?next=/polls/${id}`);
  const view = await getPoll(id, user.did);
  if (!view) notFound();
  const { poll, options, votes } = view;
  const users = await getUsersByDids(poll.participantDids);
  const mine = new Map(votes.filter((v) => v.userDid === user.did).map((v) => [v.optionId, v.answer]));
  const score = (optionId: string) => votes.filter((v) => v.optionId === optionId).reduce((n, v) => n + (v.answer === "yes" ? 2 : v.answer === "maybe" ? 1 : 0), 0);
  const best = [...options].sort((a, b) => score(b.id) - score(a.id))[0];
  const isOwner = poll.createdBy === user.did;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={poll.title}
        description={<>{poll.description} <Badge tone={poll.status === "open" ? "ok" : "neutral"}>{poll.status}</Badge> · {poll.durationMinutes} min · times in {user.timezone}</>}
        actions={isOwner ? <form action={deletePollAction}><input type="hidden" name="pollId" value={poll.id} /><button className="btn-danger">Delete</button></form> : null}
      />
      <form action={voteAction} className="card overflow-x-auto">
        <input type="hidden" name="pollId" value={poll.id} />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2">Option</th>
              {poll.participantDids.map((d) => (
                <th key={d} className="px-2 py-1 font-normal">{users.get(d) ? displayName(users.get(d)!) : d.slice(0, 12)}</th>
              ))}
              <th className="px-2 py-1">You</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.id} className={`border-t border-border ${poll.finalOptionId === o.id ? "bg-accent/10" : ""}`}>
                <td className="py-2 pr-2">{fmtRange(o.startAt, o.endAt, user.timezone)} {best?.id === o.id && poll.status === "open" ? <Badge tone="accent">best so far</Badge> : null}{poll.finalOptionId === o.id ? <Badge tone="ok">chosen</Badge> : null}</td>
                {poll.participantDids.map((d) => {
                  const v = votes.find((x) => x.optionId === o.id && x.userDid === d)?.answer;
                  return <td key={d} className="px-2 py-2 text-center">{v === "yes" ? "✓" : v === "maybe" ? "?" : v === "no" ? "✗" : <span className="text-muted">–</span>}</td>;
                })}
                <td className="px-2 py-2">
                  {poll.status === "open" ? (
                    <select name={`opt:${o.id}`} className="input w-auto py-1" defaultValue={mine.get(o.id) ?? ""}>
                      <option value="">–</option>
                      <option value="yes">Yes</option>
                      <option value="maybe">If needed</option>
                      <option value="no">No</option>
                    </select>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {poll.status === "open" ? <button className="btn-primary mt-3">Save my answers</button> : null}
      </form>
      {isOwner && poll.status === "open" ? (
        <form action={closePollAction} className="card mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="pollId" value={poll.id} />
          <label className="block flex-1"><span className="label">Close the poll and pick a time</span>
            <select name="finalOptionId" className="input" defaultValue={best?.id ?? ""}>
              <option value="">No time chosen</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{fmtRange(o.startAt, o.endAt, user.timezone)}</option>
              ))}
            </select>
          </label>
          <button className="btn-secondary">Close poll</button>
        </form>
      ) : null}
    </div>
  );
}
