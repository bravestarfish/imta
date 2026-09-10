import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Team, TeamRole, User } from "@/db/schema";
import { newId, slugify } from "@/lib/ids";
import { randomToken } from "@/lib/crypto";
import { resolveIdentity } from "@/lib/atproto/identity";
import { enqueue } from "@/lib/jobs/queue";

export const MAX_TEAM_SIZE = 12;

export async function teamRole(teamId: string, userDid: string): Promise<TeamRole | null> {
  const m = await db.query.teamMembers.findFirst({ where: and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userDid, userDid)) });
  return m?.role ?? null;
}

export async function assertAdmin(teamId: string, userDid: string): Promise<void> {
  const role = await teamRole(teamId, userDid);
  if (role !== "owner" && role !== "admin") throw new Error("Forbidden");
}

export async function createTeam(actor: User, name: string, timezone: string, description?: string): Promise<Team> {
  let slug = slugify(name);
  for (let i = 0; i < 20; i++) {
    const clash = await db.query.teams.findFirst({ where: eq(schema.teams.slug, slug) });
    if (!clash) break;
    slug = `${slugify(name)}-${i + 2}`;
  }
  if (await db.query.teams.findFirst({ where: eq(schema.teams.slug, slug) })) slug = `${slugify(name)}-${randomToken(3)}`;
  const id = newId("team");
  const [team] = await db.insert(schema.teams).values({ id, slug, name, timezone, description: description ?? null, createdBy: actor.did }).returning();
  await db.insert(schema.teamMembers).values({ teamId: id, userDid: actor.did, role: "owner" });
  return team;
}

export async function updateTeam(actor: User, teamId: string, input: { name: string; timezone: string; description?: string }): Promise<void> {
  await assertAdmin(teamId, actor.did);
  await db.update(schema.teams).set({ name: input.name, timezone: input.timezone, description: input.description ?? null }).where(eq(schema.teams.id, teamId));
}

export async function deleteTeam(actor: User, teamId: string): Promise<void> {
  const role = await teamRole(teamId, actor.did);
  if (role !== "owner") throw new Error("Only the owner can delete a team");
  await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
}

export async function myTeams(userDid: string): Promise<(Team & { role: TeamRole; memberCount: number })[]> {
  const rows = await db
    .select({ team: schema.teams, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(eq(schema.teamMembers.userDid, userDid));
  const out = [];
  for (const r of rows) {
    const members = await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.teamId, r.team.id), columns: { userDid: true } });
    out.push({ ...r.team, role: r.role, memberCount: members.length });
  }
  return out;
}

export async function teamMembersWithUsers(teamId: string): Promise<(User & { role: TeamRole })[]> {
  const rows = await db
    .select({ user: schema.users, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.did, schema.teamMembers.userDid))
    .where(eq(schema.teamMembers.teamId, teamId));
  return rows.map((r) => ({ ...r.user, role: r.role }));
}

export async function inviteToTeam(actor: User, teamId: string, handleOrDid: string, role: TeamRole = "member"): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertAdmin(teamId, actor.did);
  const members = await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.teamId, teamId) });
  if (members.length >= MAX_TEAM_SIZE) return { ok: false, error: `Teams are limited to ${MAX_TEAM_SIZE} members` };
  const identity = await resolveIdentity(handleOrDid);
  if (!identity) return { ok: false, error: "Could not find that username" };
  if (members.some((m) => m.userDid === identity.did)) return { ok: false, error: "Already a member" };
  const id = newId("tinv");
  await db
    .insert(schema.teamInvites)
    .values({ id, teamId, inviteeDid: identity.did, invitedBy: actor.did, role: role === "owner" ? "admin" : role })
    .onConflictDoUpdate({ target: [schema.teamInvites.teamId, schema.teamInvites.inviteeDid], set: { status: "pending", invitedBy: actor.did } });
  const row = await db.query.teamInvites.findFirst({ where: and(eq(schema.teamInvites.teamId, teamId), eq(schema.teamInvites.inviteeDid, identity.did)) });
  // Members who already use the app get a DM/email; others see the invite after signing in.
  if (row) await enqueue("notify.team_invite", { teamInviteId: row.id });
  return { ok: true };
}

export async function myTeamInvites(userDid: string) {
  return db
    .select({ invite: schema.teamInvites, team: schema.teams })
    .from(schema.teamInvites)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamInvites.teamId))
    .where(and(eq(schema.teamInvites.inviteeDid, userDid), eq(schema.teamInvites.status, "pending")));
}

export async function respondTeamInvite(userDid: string, inviteId: string, accept: boolean): Promise<void> {
  const inv = await db.query.teamInvites.findFirst({ where: and(eq(schema.teamInvites.id, inviteId), eq(schema.teamInvites.inviteeDid, userDid)) });
  if (!inv || inv.status !== "pending") return;
  await db.transaction(async (tx) => {
    await tx.update(schema.teamInvites).set({ status: accept ? "accepted" : "declined" }).where(eq(schema.teamInvites.id, inviteId));
    if (accept) {
      await tx.insert(schema.teamMembers).values({ teamId: inv.teamId, userDid, role: inv.role }).onConflictDoNothing();
    }
  });
}

export async function setMemberRole(actor: User, teamId: string, userDid: string, role: TeamRole): Promise<void> {
  const actorRole = await teamRole(teamId, actor.did);
  if (actorRole !== "owner") throw new Error("Only the owner can change roles");
  if (role === "owner") {
    await db.update(schema.teamMembers).set({ role: "admin" }).where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userDid, actor.did)));
  }
  await db.update(schema.teamMembers).set({ role }).where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userDid, userDid)));
}

export async function removeMember(actor: User, teamId: string, userDid: string): Promise<void> {
  const actorRole = await teamRole(teamId, actor.did);
  const targetRole = await teamRole(teamId, userDid);
  const self = actor.did === userDid;
  if (!self && actorRole !== "owner" && actorRole !== "admin") throw new Error("Forbidden");
  if (targetRole === "owner") throw new Error("The owner cannot be removed; transfer ownership first");
  await db.transaction(async (tx) => {
    await tx.delete(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userDid, userDid)));
    // Drop them from team event types they hosted.
    const ets = await tx.query.eventTypes.findMany({ where: eq(schema.eventTypes.teamId, teamId), columns: { id: true } });
    if (ets.length) {
      await tx.delete(schema.eventTypeHosts).where(and(inArray(schema.eventTypeHosts.eventTypeId, ets.map((e) => e.id)), eq(schema.eventTypeHosts.userDid, userDid)));
    }
  });
}

export async function getTeamBySlug(slug: string): Promise<Team | undefined> {
  return db.query.teams.findFirst({ where: eq(schema.teams.slug, slug) });
}
