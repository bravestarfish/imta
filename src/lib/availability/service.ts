import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { expandSchedule, validateRules, type Schedule, type WeeklyRule, type DateOverride } from "@/lib/scheduling/availability";
import type { Interval } from "@/lib/scheduling/intervals";
import type { HostAvailability } from "@/lib/scheduling/slots";
import { busyFor } from "@/lib/calendar/service";
import type { AvailabilitySchedule } from "@/db/schema";

export type FullSchedule = AvailabilitySchedule & { rules: WeeklyRule[]; overrides: DateOverride[] };

export async function listSchedules(userDid: string): Promise<FullSchedule[]> {
  const schedules = await db.query.availabilitySchedules.findMany({
    where: eq(schema.availabilitySchedules.userDid, userDid),
    orderBy: (s, { desc, asc }) => [desc(s.isDefault), asc(s.createdAt)],
  });
  if (!schedules.length) return [];
  const ids = schedules.map((s) => s.id);
  const rules = await db.query.availabilityRules.findMany({ where: inArray(schema.availabilityRules.scheduleId, ids) });
  const overrides = await db.query.availabilityOverrides.findMany({ where: inArray(schema.availabilityOverrides.scheduleId, ids) });
  return schedules.map((s) => ({
    ...s,
    rules: rules.filter((r) => r.scheduleId === s.id).map((r) => ({ weekday: r.weekday, startMinutes: r.startMinutes, endMinutes: r.endMinutes })),
    overrides: overrides
      .filter((o) => o.scheduleId === s.id)
      .map((o) => ({ date: o.date, startMinutes: o.startMinutes, endMinutes: o.endMinutes, unavailable: o.unavailable })),
  }));
}

export async function getSchedule(userDid: string, id: string): Promise<FullSchedule | undefined> {
  return (await listSchedules(userDid)).find((s) => s.id === id);
}

export async function createSchedule(userDid: string, name: string, timezone: string): Promise<string> {
  const id = newId("sch");
  const existing = await db.query.availabilitySchedules.findMany({ where: eq(schema.availabilitySchedules.userDid, userDid), columns: { id: true } });
  await db.insert(schema.availabilitySchedules).values({ id, userDid, name, timezone, isDefault: existing.length === 0 });
  return id;
}

export async function saveSchedule(
  userDid: string,
  id: string,
  input: { name: string; timezone: string; rules: WeeklyRule[]; overrides: DateOverride[]; isDefault?: boolean },
): Promise<string | null> {
  const err = validateRules(input.rules);
  if (err) return err;
  const owned = await db.query.availabilitySchedules.findFirst({
    where: and(eq(schema.availabilitySchedules.id, id), eq(schema.availabilitySchedules.userDid, userDid)),
  });
  if (!owned) return "Schedule not found";
  await db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(schema.availabilitySchedules).set({ isDefault: false }).where(eq(schema.availabilitySchedules.userDid, userDid));
    }
    await tx
      .update(schema.availabilitySchedules)
      .set({ name: input.name, timezone: input.timezone, ...(input.isDefault ? { isDefault: true } : {}) })
      .where(eq(schema.availabilitySchedules.id, id));
    await tx.delete(schema.availabilityRules).where(eq(schema.availabilityRules.scheduleId, id));
    if (input.rules.length) {
      await tx.insert(schema.availabilityRules).values(input.rules.map((r) => ({ id: newId("rule"), scheduleId: id, ...r })));
    }
    await tx.delete(schema.availabilityOverrides).where(eq(schema.availabilityOverrides.scheduleId, id));
    if (input.overrides.length) {
      await tx.insert(schema.availabilityOverrides).values(
        input.overrides.map((o) => ({
          id: newId("ovr"),
          scheduleId: id,
          date: o.date,
          startMinutes: o.unavailable ? null : o.startMinutes ?? null,
          endMinutes: o.unavailable ? null : o.endMinutes ?? null,
          unavailable: Boolean(o.unavailable),
        })),
      );
    }
  });
  return null;
}

export async function deleteSchedule(userDid: string, id: string): Promise<void> {
  const s = await db.query.availabilitySchedules.findFirst({
    where: and(eq(schema.availabilitySchedules.id, id), eq(schema.availabilitySchedules.userDid, userDid)),
  });
  if (!s || s.isDefault) return;
  await db.delete(schema.availabilitySchedules).where(eq(schema.availabilitySchedules.id, id));
}

/**
 * Build HostAvailability for a set of hosts (working hours expanded to UTC and
 * busy blocks from calendars and existing bookings).
 */
export async function hostAvailabilities(
  hosts: { did: string; scheduleId?: string | null }[],
  window: Interval,
): Promise<HostAvailability[]> {
  if (!hosts.length) return [];
  const dids = hosts.map((h) => h.did);
  const schedules = await db.query.availabilitySchedules.findMany({ where: inArray(schema.availabilitySchedules.userDid, dids) });
  const ids = schedules.map((s) => s.id);
  const rules = ids.length ? await db.query.availabilityRules.findMany({ where: inArray(schema.availabilityRules.scheduleId, ids) }) : [];
  const overrides = ids.length ? await db.query.availabilityOverrides.findMany({ where: inArray(schema.availabilityOverrides.scheduleId, ids) }) : [];
  const busy = await busyFor(dids, window);

  return hosts.map((h) => {
    const chosen =
      (h.scheduleId ? schedules.find((s) => s.id === h.scheduleId && s.userDid === h.did) : undefined) ??
      schedules.find((s) => s.userDid === h.did && s.isDefault) ??
      schedules.find((s) => s.userDid === h.did);
    const sched: Schedule = chosen
      ? {
          timezone: chosen.timezone,
          rules: rules.filter((r) => r.scheduleId === chosen.id),
          overrides: overrides.filter((o) => o.scheduleId === chosen.id).map((o) => ({ date: o.date, startMinutes: o.startMinutes, endMinutes: o.endMinutes, unavailable: o.unavailable })),
        }
      : { timezone: "UTC", rules: [], overrides: [] };
    return { did: h.did, available: expandSchedule(sched, window), busy: busy.get(h.did) ?? [] };
  });
}
