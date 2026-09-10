import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchPublicProfile } from "@/lib/atproto/identity";
import { newId } from "@/lib/ids";
import type { User } from "@/db/schema";

/** Create or refresh a user row after a successful ATProto login. */
export async function upsertUserFromLogin(did: string, fallbackHandle?: string): Promise<User> {
  const profile = await fetchPublicProfile(did);
  const handle = profile?.handle ?? fallbackHandle ?? did;
  const existing = await db.query.users.findFirst({ where: eq(schema.users.did, did) });
  if (existing) {
    const [updated] = await db
      .update(schema.users)
      .set({
        handle,
        displayName: profile?.displayName ?? existing.displayName,
        avatarUrl: profile?.avatar ?? existing.avatarUrl,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.did, did))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(schema.users)
    .values({
      did,
      handle,
      displayName: profile?.displayName ?? null,
      avatarUrl: profile?.avatar ?? null,
      lastSeenAt: new Date(),
    })
    .returning();
  // Every user gets a default weekly schedule (Mon-Fri 9-17 in their tz, UTC until they set one).
  const scheduleId = newId("sch");
  await db.insert(schema.availabilitySchedules).values({
    id: scheduleId,
    userDid: did,
    name: "Working hours",
    timezone: "UTC",
    isDefault: true,
  });
  await db.insert(schema.availabilityRules).values(
    [1, 2, 3, 4, 5].map((weekday) => ({
      id: newId("rule"),
      scheduleId,
      weekday,
      startMinutes: 9 * 60,
      endMinutes: 17 * 60,
    })),
  );
  return created;
}

export async function getUserByHandle(handle: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(schema.users.handle, handle.toLowerCase()) });
}

export async function getUserByDid(did: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(schema.users.did, did) });
}

export async function getUsersByDids(dids: string[]): Promise<Map<string, User>> {
  const out = new Map<string, User>();
  if (dids.length === 0) return out;
  const rows = await db.query.users.findMany({
    where: (u, { inArray }) => inArray(u.did, [...new Set(dids)]),
  });
  for (const r of rows) out.set(r.did, r);
  return out;
}

export function displayName(u: { displayName?: string | null; handle: string }): string {
  return u.displayName?.trim() || `@${u.handle}`;
}
