import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeamBySlug, teamMembersWithUsers } from "@/lib/teams/service";
import { publicEventTypesOf } from "@/lib/event-types/service";
import { displayName } from "@/lib/users/service";
import { Avatar } from "@/components/ui";

export default async function TeamProfile({ params }: { params: Promise<{ team: string }> }) {
  const { team: slug } = await params;
  const team = await getTeamBySlug(slug);
  if (!team) notFound();
  const members = await teamMembersWithUsers(team.id);
  const eventTypes = await publicEventTypesOf("team", team.id);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">{team.name}</h1>
      {team.description ? <p className="mt-2 text-sm">{team.description}</p> : null}
      <div className="mt-4 flex flex-wrap gap-3">
        {members.map((m) => (
          <span key={m.did} className="flex items-center gap-2 text-sm"><Avatar user={m} size={24} /> {displayName(m)}</span>
        ))}
      </div>
      <h2 className="mt-8 mb-3 font-medium">Book a time</h2>
      {!eventTypes.length ? <p className="text-sm text-muted">No public event types right now.</p> : null}
      <ul className="space-y-2">
        {eventTypes.map((e) => (
          <li key={e.id}>
            <Link href={`/t/${team.slug}/${e.slug}`} className="card block hover:border-accent" style={{ borderLeftColor: e.color, borderLeftWidth: 4 }}>
              <div className="font-medium">{e.title}</div>
              <div className="text-xs text-muted">{e.durationMinutes} min · {e.assignmentMode === "collective" ? "whole team" : e.assignmentMode === "anyone" ? "one team member" : `${e.thresholdCount}+ team members`}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
