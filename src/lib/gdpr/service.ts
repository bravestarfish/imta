import { eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { getOAuthClient } from "@/lib/atproto/client";
import { unpublishProfile, deleteRecordByUri } from "@/lib/atproto/records";
import { calendarProvider, CALENDAR_PROVIDERS } from "@/lib/calendar";
import { cancelMeetingInternal, cancelBookingInternal } from "@/lib/bookings/service";
import { log, errMessage } from "@/lib/log";

/** Everything we hold about a user, as a JSON document (GDPR art. 15/20). */
export async function exportUserData(user: User) {
  const did = user.did;
  const [connections, schedules, teams, eventTypes, hostedMeetings, bookings, invitations, polls, notifications, blocks] = await Promise.all([
    db.query.providerConnections.findMany({ where: eq(schema.providerConnections.userDid, did) }),
    db.query.availabilitySchedules.findMany({ where: eq(schema.availabilitySchedules.userDid, did) }),
    db
      .select({ team: schema.teams, role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
      .where(eq(schema.teamMembers.userDid, did)),
    db.query.eventTypes.findMany({ where: eq(schema.eventTypes.ownerDid, did) }),
    db.query.meetings.findMany(),
    db.query.bookings.findMany({ where: eq(schema.bookings.attendeeDid, did) }),
    db.query.eventInvitations.findMany({ where: or(eq(schema.eventInvitations.inviteeDid, did), eq(schema.eventInvitations.invitedBy, did)) }),
    db.query.polls.findMany({ where: eq(schema.polls.createdBy, did) }),
    db.query.notificationLog.findMany({ where: eq(schema.notificationLog.recipientDid, did) }),
    db.query.blocks.findMany({ where: eq(schema.blocks.userDid, did) }),
  ]);
  const scheduleIds = schedules.map((s) => s.id);
  const rules = scheduleIds.length ? await db.query.availabilityRules.findMany({ where: inArray(schema.availabilityRules.scheduleId, scheduleIds) }) : [];
  const overrides = scheduleIds.length ? await db.query.availabilityOverrides.findMany({ where: inArray(schema.availabilityOverrides.scheduleId, scheduleIds) }) : [];
  return {
    exportedAt: new Date().toISOString(),
    profile: { ...user },
    calendarConnections: connections.map((c) => ({ id: c.id, provider: c.provider, accountEmail: c.accountEmail, createdAt: c.createdAt, lastSyncedAt: c.lastSyncedAt })),
    availability: schedules.map((s) => ({ ...s, rules: rules.filter((r) => r.scheduleId === s.id), overrides: overrides.filter((o) => o.scheduleId === s.id) })),
    teams,
    eventTypes,
    hostedMeetings: hostedMeetings.filter((m) => m.hostDids.includes(did)),
    bookings,
    invitations,
    polls,
    blocks,
    notifications,
  };
}

/**
 * Delete the account (GDPR art. 17): cancel future meetings, remove calendar
 * events we wrote, revoke provider tokens, delete PDS records we published,
 * then delete the user row (cascades to everything else).
 */
export async function deleteUserAccount(user: User): Promise<void> {
  const did = user.did;
  const now = new Date();
  const hosted = (await db.query.meetings.findMany({ where: eq(schema.meetings.status, "scheduled") })).filter((m) => m.hostDids.includes(did) && m.startAt > now);
  for (const m of hosted) await cancelMeetingInternal(m.id, did, "Organizer account deleted").catch(() => undefined);
  const attending = await db.query.bookings.findMany({ where: eq(schema.bookings.attendeeDid, did) });
  for (const b of attending) if (b.status === "confirmed") await cancelBookingInternal(b.id, did, "Account deleted").catch(() => undefined);

  const conns = await db.query.providerConnections.findMany({ where: eq(schema.providerConnections.userDid, did) });
  for (const c of conns) {
    if (CALENDAR_PROVIDERS.includes(c.provider)) await calendarProvider(c.provider).unwatch?.(c).catch(() => undefined);
  }

  const ets = await db.query.eventTypes.findMany({ where: eq(schema.eventTypes.ownerDid, did) });
  for (const et of ets) if (et.atprotoUri) await deleteRecordByUri(did, et.atprotoUri).catch(() => undefined);
  if (user.profileRecordUri) await unpublishProfile(did).catch(() => undefined);

  try {
    const client = await getOAuthClient();
    await client.revoke(did);
  } catch (e) {
    log.warn("oauth revoke failed during deletion", { did, error: errMessage(e) });
  }
  // Teams owned solely by the user: hand over to another admin/member or delete.
  const owned = await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.userDid, did) });
  for (const m of owned) {
    if (m.role !== "owner") continue;
    const others = (await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.teamId, m.teamId) })).filter((o) => o.userDid !== did);
    const heir = others.find((o) => o.role === "admin") ?? others[0];
    if (heir) await db.update(schema.teamMembers).set({ role: "owner" }).where(eq(schema.teamMembers.userDid, heir.userDid));
    else await db.delete(schema.teams).where(eq(schema.teams.id, m.teamId));
  }
  await db.delete(schema.users).where(eq(schema.users.did, did));
  await db.delete(schema.atprotoOauthSessions).where(eq(schema.atprotoOauthSessions.did, did));
  await db.insert(schema.auditLog).values({ id: `aud_${Date.now().toString(36)}`, actorDid: null, action: "account.deleted", subject: null, meta: { at: now.toISOString() } });
}
