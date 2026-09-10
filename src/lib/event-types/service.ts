import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { EventType, BookingQuestion, User } from "@/db/schema";
import { newId, slugify } from "@/lib/ids";
import { randomToken } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs/queue";
import { teamRole } from "@/lib/teams/service";

export const eventTypeInput = z.object({
  title: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(60).optional(),
  description: z.string().trim().max(5000).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(1440),
  slotIntervalMinutes: z.coerce.number().int().min(5).max(1440),
  bufferBeforeMinutes: z.coerce.number().int().min(0).max(480).default(0),
  bufferAfterMinutes: z.coerce.number().int().min(0).max(480).default(0),
  minNoticeMinutes: z.coerce.number().int().min(0).max(43200).default(240),
  maxBookingsPerDay: z.coerce.number().int().min(1).max(100).nullable().optional(),
  bookingWindowDays: z.coerce.number().int().min(1).max(365).default(60),
  capacity: z.coerce.number().int().min(1).max(500).default(1),
  visibility: z.enum(["public", "link", "invite"]).default("link"),
  assignmentMode: z.enum(["collective", "anyone", "threshold"]).default("collective"),
  thresholdCount: z.coerce.number().int().min(1).max(12).default(1),
  hostSelection: z.enum(["round_robin", "least_booked"]).default("round_robin"),
  locationKind: z.enum(["video", "inperson", "phone", "custom"]).default("video"),
  videoProvider: z.enum(["auto", "google_meet", "zoom", "jitsi", "none"]).default("auto"),
  locationText: z.string().trim().max(500).optional(),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  cancellationNoticeMinutes: z.coerce.number().int().min(0).max(43200).default(0),
  allowReschedule: z.coerce.boolean().default(true),
  requiresApproval: z.coerce.boolean().default(false),
  reminderMinutes: z.array(z.number().int().min(5).max(20160)).default([1440, 60]),
  publishSessions: z.coerce.boolean().default(false),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#4f46e5"),
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        label: z.string().trim().min(1).max(200),
        type: z.enum(["text", "textarea", "select", "checkbox"]),
        required: z.boolean().default(false),
        options: z.array(z.string().trim().min(1).max(100)).optional(),
      }),
    )
    .default([]),
  hosts: z.array(z.object({ did: z.string(), scheduleId: z.string().nullable().optional(), required: z.boolean().default(true) })).min(1),
});

export type EventTypeInput = z.infer<typeof eventTypeInput>;

async function uniqueSlug(base: string, ownerKind: "user" | "team", ownerId: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  for (let i = 0; i < 50; i++) {
    const clash = await db.query.eventTypes.findFirst({
      where: and(
        eq(schema.eventTypes.slug, slug),
        ownerKind === "user" ? eq(schema.eventTypes.ownerDid, ownerId) : eq(schema.eventTypes.teamId, ownerId),
        eq(schema.eventTypes.ownerKind, ownerKind),
      ),
    });
    if (!clash || clash.id === excludeId) return slug;
    slug = `${slugify(base)}-${i + 2}`;
  }
  return `${slugify(base)}-${randomToken(3)}`;
}

/** Ensure the actor may manage the event type's owner (self, or team admin/owner). */
export async function assertCanManage(actor: User, ownerKind: "user" | "team", ownerId: string): Promise<void> {
  if (ownerKind === "user") {
    if (ownerId !== actor.did) throw new Error("Forbidden");
    return;
  }
  const role = await teamRole(ownerId, actor.did);
  if (!role) throw new Error("Forbidden");
}

export async function createEventType(actor: User, ownerKind: "user" | "team", ownerId: string, input: EventTypeInput): Promise<EventType> {
  await assertCanManage(actor, ownerKind, ownerId);
  await assertHostsValid(ownerKind, ownerId, input.hosts.map((h) => h.did));
  const id = newId("evt");
  const slug = await uniqueSlug(input.slug || input.title, ownerKind, ownerId);
  const [created] = await db
    .insert(schema.eventTypes)
    .values({
      id,
      ownerKind,
      ownerDid: ownerKind === "user" ? ownerId : null,
      teamId: ownerKind === "team" ? ownerId : null,
      slug,
      linkToken: randomToken(9),
      ...columns(input),
    })
    .returning();
  await db.insert(schema.eventTypeHosts).values(input.hosts.map((h) => ({ eventTypeId: id, userDid: h.did, scheduleId: h.scheduleId ?? null, required: h.required })));
  await enqueue("atproto.publish", { kind: "eventType", id });
  return created;
}

export async function updateEventType(actor: User, id: string, input: EventTypeInput): Promise<EventType> {
  const existing = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, id) });
  if (!existing) throw new Error("Not found");
  const ownerId = existing.ownerKind === "user" ? existing.ownerDid! : existing.teamId!;
  await assertCanManage(actor, existing.ownerKind, ownerId);
  await assertHostsValid(existing.ownerKind, ownerId, input.hosts.map((h) => h.did));
  const slug = input.slug && input.slug !== existing.slug ? await uniqueSlug(input.slug, existing.ownerKind, ownerId, id) : existing.slug;
  const [updated] = await db
    .update(schema.eventTypes)
    .set({ ...columns(input), slug, updatedAt: new Date() })
    .where(eq(schema.eventTypes.id, id))
    .returning();
  await db.delete(schema.eventTypeHosts).where(eq(schema.eventTypeHosts.eventTypeId, id));
  await db.insert(schema.eventTypeHosts).values(input.hosts.map((h) => ({ eventTypeId: id, userDid: h.did, scheduleId: h.scheduleId ?? null, required: h.required })));
  await enqueue("atproto.publish", { kind: "eventType", id });
  return updated;
}

export async function deleteEventType(actor: User, id: string): Promise<void> {
  const existing = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, id) });
  if (!existing) return;
  const ownerId = existing.ownerKind === "user" ? existing.ownerDid! : existing.teamId!;
  await assertCanManage(actor, existing.ownerKind, ownerId);
  if (existing.atprotoUri && existing.ownerDid) {
    const { deleteRecordByUri } = await import("@/lib/atproto/records");
    await deleteRecordByUri(existing.ownerDid, existing.atprotoUri).catch(() => undefined);
  }
  await db.delete(schema.eventTypes).where(eq(schema.eventTypes.id, id));
}

export async function duplicateEventType(actor: User, id: string): Promise<EventType> {
  const existing = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, id) });
  if (!existing) throw new Error("Not found");
  const hosts = await db.query.eventTypeHosts.findMany({ where: eq(schema.eventTypeHosts.eventTypeId, id) });
  const ownerId = existing.ownerKind === "user" ? existing.ownerDid! : existing.teamId!;
  const { id: _id, slug: _slug, atprotoUri: _uri, linkToken: _t, createdAt: _c, updatedAt: _u, ownerKind, ownerDid, teamId, ...rest } = existing;
  void _id; void _slug; void _uri; void _t; void _c; void _u; void ownerDid; void teamId;
  return createEventType(actor, ownerKind, ownerId, {
    ...rest,
    title: `${existing.title} (copy)`,
    description: rest.description ?? undefined,
    locationText: rest.locationText ?? undefined,
    status: "draft",
    hosts: hosts.map((h) => ({ did: h.userDid, scheduleId: h.scheduleId, required: h.required })),
  });
}

function columns(input: EventTypeInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    durationMinutes: input.durationMinutes,
    slotIntervalMinutes: input.slotIntervalMinutes,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    bufferAfterMinutes: input.bufferAfterMinutes,
    minNoticeMinutes: input.minNoticeMinutes,
    maxBookingsPerDay: input.maxBookingsPerDay ?? null,
    bookingWindowDays: input.bookingWindowDays,
    capacity: input.capacity,
    visibility: input.visibility,
    assignmentMode: input.assignmentMode,
    thresholdCount: input.thresholdCount,
    hostSelection: input.hostSelection,
    locationKind: input.locationKind,
    videoProvider: input.videoProvider,
    locationText: input.locationText ?? null,
    status: input.status,
    cancellationNoticeMinutes: input.cancellationNoticeMinutes,
    allowReschedule: input.allowReschedule,
    requiresApproval: input.requiresApproval,
    reminderMinutes: input.reminderMinutes,
    publishSessions: input.publishSessions,
    color: input.color,
    questions: input.questions as BookingQuestion[],
  };
}

async function assertHostsValid(ownerKind: "user" | "team", ownerId: string, dids: string[]) {
  if (ownerKind === "user") {
    if (dids.length !== 1 || dids[0] !== ownerId) throw new Error("Personal event types have exactly one host: you");
    return;
  }
  const members = await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.teamId, ownerId) });
  const memberDids = new Set(members.map((m) => m.userDid));
  for (const d of dids) if (!memberDids.has(d)) throw new Error("All hosts must be team members");
  if (dids.length > 12) throw new Error("At most 12 hosts");
}

/** Event types the user owns or hosts, grouped for the dashboard. */
export async function listEventTypesFor(userDid: string): Promise<{ personal: EventType[]; team: (EventType & { teamName: string; teamSlug: string })[] }> {
  const personal = await db.query.eventTypes.findMany({
    where: and(eq(schema.eventTypes.ownerKind, "user"), eq(schema.eventTypes.ownerDid, userDid)),
    orderBy: (e, { asc }) => asc(e.createdAt),
  });
  const memberships = await db.query.teamMembers.findMany({ where: eq(schema.teamMembers.userDid, userDid) });
  const teamIds = memberships.map((m) => m.teamId);
  if (!teamIds.length) return { personal, team: [] };
  const rows = await db
    .select({ et: schema.eventTypes, teamName: schema.teams.name, teamSlug: schema.teams.slug })
    .from(schema.eventTypes)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.eventTypes.teamId))
    .where(inArray(schema.eventTypes.teamId, teamIds));
  return { personal, team: rows.map((r) => ({ ...r.et, teamName: r.teamName, teamSlug: r.teamSlug })) };
}

/** Resolve a public booking URL to an event type and check access. */
export async function resolveBookable(
  owner: { handle?: string; teamSlug?: string },
  slug: string,
  viewer: User | null,
  linkKey?: string | null,
): Promise<{ eventType: EventType; ownerUser: User | null; team: typeof schema.teams.$inferSelect | null; access: "ok" | "login" | "invite" | "link" | "closed" } | null> {
  let eventType: EventType | undefined;
  let ownerUser: User | null = null;
  let team: typeof schema.teams.$inferSelect | null = null;
  if (owner.handle) {
    ownerUser = (await db.query.users.findFirst({ where: eq(schema.users.handle, owner.handle.toLowerCase()) })) ?? null;
    if (!ownerUser) return null;
    eventType = await db.query.eventTypes.findFirst({ where: and(eq(schema.eventTypes.ownerDid, ownerUser.did), eq(schema.eventTypes.ownerKind, "user"), eq(schema.eventTypes.slug, slug)) });
  } else if (owner.teamSlug) {
    team = (await db.query.teams.findFirst({ where: eq(schema.teams.slug, owner.teamSlug) })) ?? null;
    if (!team) return null;
    eventType = await db.query.eventTypes.findFirst({ where: and(eq(schema.eventTypes.teamId, team.id), eq(schema.eventTypes.ownerKind, "team"), eq(schema.eventTypes.slug, slug)) });
  }
  if (!eventType) return null;
  const isHost = viewer ? Boolean(await db.query.eventTypeHosts.findFirst({ where: and(eq(schema.eventTypeHosts.eventTypeId, eventType.id), eq(schema.eventTypeHosts.userDid, viewer.did)) })) : false;
  if (eventType.status !== "published" && !isHost) return { eventType, ownerUser, team, access: "closed" };
  if (eventType.visibility === "link" && !isHost && linkKey !== eventType.linkToken) return { eventType, ownerUser, team, access: "link" };
  if (eventType.visibility === "invite" && !isHost) {
    if (!viewer) return { eventType, ownerUser, team, access: "login" };
    const inv = await db.query.eventInvitations.findFirst({
      where: and(eq(schema.eventInvitations.eventTypeId, eventType.id), eq(schema.eventInvitations.inviteeDid, viewer.did)),
    });
    if (!inv || inv.status === "declined") return { eventType, ownerUser, team, access: "invite" };
  }
  return { eventType, ownerUser, team, access: "ok" };
}

export async function publicEventTypesOf(ownerKind: "user" | "team", ownerId: string): Promise<EventType[]> {
  return db.query.eventTypes.findMany({
    where: and(
      eq(schema.eventTypes.ownerKind, ownerKind),
      ownerKind === "user" ? eq(schema.eventTypes.ownerDid, ownerId) : eq(schema.eventTypes.teamId, ownerId),
      eq(schema.eventTypes.status, "published"),
      eq(schema.eventTypes.visibility, "public"),
    ),
    orderBy: (e, { asc }) => asc(e.createdAt),
  });
}
