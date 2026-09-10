import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { myPolls } from "@/lib/polls/service";
import { Badge, Empty, PageHeader } from "@/components/ui";

export default async function Polls() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/polls");
  const polls = await myPolls(user.did);
  return (
    <div>
      <PageHeader title="Polls" description="Find a time among organizers when the computed overlap is empty or when people have not connected a calendar." actions={<Link href="/polls/new" className="btn-primary">New poll</Link>} />
      {!polls.length ? <Empty>No polls yet.</Empty> : null}
      <ul className="space-y-2">
        {polls.map((p) => (
          <li key={p.id} className="card flex items-center justify-between py-3">
            <Link href={`/polls/${p.id}`} className="font-medium hover:underline">{p.title}</Link>
            <Badge tone={p.status === "open" ? "ok" : "neutral"}>{p.status}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
