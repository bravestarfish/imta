import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { teamRole, teamMembersWithUsers } from "@/lib/teams/service";
import { listSchedules } from "@/lib/availability/service";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { PageHeader } from "@/components/ui";
import { EventTypeForm, type HostOption } from "../form";
import { displayName } from "@/lib/users/service";

export default async function NewEventType({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/event-types/new");
  const { team: teamId } = await searchParams;
  let hosts: HostOption[];
  let ownerKind: "user" | "team" = "user";
  let ownerId = user.did;
  let teamName: string | undefined;
  if (teamId) {
    if (!(await teamRole(teamId, user.did))) redirect("/event-types");
    const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId) });
    if (!team) redirect("/event-types");
    ownerKind = "team";
    ownerId = teamId;
    teamName = team.name;
    const members = await teamMembersWithUsers(teamId);
    hosts = await Promise.all(members.map(async (m) => ({ did: m.did, label: `${displayName(m)} (@${m.handle})`, schedules: (await listSchedules(m.did)).map((s) => ({ id: s.id, name: s.name })) })));
  } else {
    hosts = [{ did: user.did, label: `${displayName(user)} (@${user.handle})`, schedules: (await listSchedules(user.did)).map((s) => ({ id: s.id, name: s.name })) }];
  }
  return (
    <div>
      <PageHeader title={teamName ? `New event type for ${teamName}` : "New event type"} />
      <EventTypeForm id={null} ownerKind={ownerKind} ownerId={ownerId} hosts={hosts} initial={null} />
    </div>
  );
}
