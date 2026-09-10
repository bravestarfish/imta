import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { resolveIdentity } from "@/lib/atproto/identity";
import { enqueue } from "@/lib/jobs/queue";
import { assertCanManage } from "./service";

export async function inviteToEventType(actor: User, eventTypeId: string, handleOrDid: string, message?: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, eventTypeId) });
  if (!et) return { ok: false, error: "Event not found" };
  await assertCanManage(actor, et.ownerKind, et.ownerKind === "user" ? et.ownerDid! : et.teamId!);
  const identity = await resolveIdentity(handleOrDid);
  if (!identity) return { ok: false, error: "Could not resolve that handle" };
  const id = newId("inv");
  await db
    .insert(schema.eventInvitations)
    .values({ id, eventTypeId, inviteeDid: identity.did, inviteeHandle: identity.handle, invitedBy: actor.did, message: message ?? null })
    .onConflictDoNothing();
  const row = await db.query.eventInvitations.findFirst({ where: and(eq(schema.eventInvitations.eventTypeId, eventTypeId), eq(schema.eventInvitations.inviteeDid, identity.did)) });
  if (row) await enqueue("notify.invitation", { invitationId: row.id });
  return { ok: true };
}

export async function revokeInvitation(actor: User, invitationId: string): Promise<void> {
  const inv = await db.query.eventInvitations.findFirst({ where: eq(schema.eventInvitations.id, invitationId) });
  if (!inv) return;
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, inv.eventTypeId) });
  if (!et) return;
  await assertCanManage(actor, et.ownerKind, et.ownerKind === "user" ? et.ownerDid! : et.teamId!);
  await db.delete(schema.eventInvitations).where(eq(schema.eventInvitations.id, invitationId));
}

export async function listInvitationsOf(eventTypeId: string) {
  return db.query.eventInvitations.findMany({ where: eq(schema.eventInvitations.eventTypeId, eventTypeId), orderBy: (i, { desc }) => desc(i.createdAt) });
}

/** Invitations addressed to the current user, with event and owner info for the inbox page. */
export async function myInvitations(userDid: string) {
  const rows = await db
    .select({ inv: schema.eventInvitations, et: schema.eventTypes })
    .from(schema.eventInvitations)
    .innerJoin(schema.eventTypes, eq(schema.eventTypes.id, schema.eventInvitations.eventTypeId))
    .where(eq(schema.eventInvitations.inviteeDid, userDid))
    .orderBy(schema.eventInvitations.createdAt);
  const out = [];
  for (const r of rows) {
    const owner = r.et.ownerDid ? await db.query.users.findFirst({ where: eq(schema.users.did, r.et.ownerDid) }) : null;
    const team = r.et.teamId ? await db.query.teams.findFirst({ where: eq(schema.teams.id, r.et.teamId) }) : null;
    const inviter = await db.query.users.findFirst({ where: eq(schema.users.did, r.inv.invitedBy) });
    out.push({ ...r, owner: owner ?? null, team: team ?? null, inviter: inviter ?? null });
  }
  return out;
}

export async function respondInvitation(userDid: string, invitationId: string, status: "accepted" | "declined") {
  await db.update(schema.eventInvitations).set({ status }).where(and(eq(schema.eventInvitations.id, invitationId), eq(schema.eventInvitations.inviteeDid, userDid)));
}
