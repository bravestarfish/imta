import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { expandSchedule, validateRules, applyDateWindows, expandDateWindows, type Schedule, type WeeklyRule, type DateOverride } from "@/lib/scheduling/availability";
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
  hosts: { did: string; scheduleId?: string | null; availabilityMode?: "schedule" | "painted" }[],
  window: Interval,
  eventTypeId?: string,
): Promise<HostAvailability[]> {
  if (!hosts.length) return [];
  const dids = hosts.map((h) => h.did);
  const painted = eventTypeId
    ? await db.query.eventHostAvailability.findMany({
        where: and(
          eq(schema.eventHostAvailability.eventTypeId, eventTypeId),
          inArray(schema.eventHostAvailability.userDid, dids),
          gte(schema.eventHostAvailability.date, DateTime.fromMillis(window.start).minus({ days: 1 }).toISODate()!),
          lte(schema.eventHostAvailability.date, DateTime.fromMillis(window.end).plus({ days: 1 }).toISODate()!),
        ),
      })
    : [];
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
    const mine = painted.filter((p) => p.userDid === h.did);
    const available =
      h.availabilityMode === "painted"
        ? expandDateWindows(mine, window)
        : applyDateWindows(expandSchedule(sched, window), mine, window);
    return { did: h.did, available, busy: busy.get(h.did) ?? [] };
  });
}

/**
 * Persist painted days: each entry replaces the overrides for that date.
 * Cells are half-hour indexes (0 = 00:00, 47 = 23:30) in the schedule's zone.
 */
export async function savePaintedDays(userDid: string, scheduleId: string, days: { date: string; cells: number[] }[]): Promise<string | null> {
  const { overridesForPaintedDay, weekdayOf } = await import("./painter");
  const schedule = await getSchedule(userDid, scheduleId);
  if (!schedule) return "Schedule not found";
  await db.transaction(async (tx) => {
    for (const day of days) {
      await tx.delete(schema.availabilityOverrides).where(and(eq(schema.availabilityOverrides.scheduleId, scheduleId), eq(schema.availabilityOverrides.date, day.date)));
      const overrides = overridesForPaintedDay(schedule.rules, day.date, weekdayOf(day.date, schedule.timezone), day.cells);
      if (overrides.length) {
        await tx.insert(schema.availabilityOverrides).values(
          overrides.map((o) => ({
            id: newId("ovr"),
            scheduleId,
            date: o.date,
            startMinutes: o.unavailable ? null : o.startMinutes ?? null,
            endMinutes: o.unavailable ? null : o.endMinutes ?? null,
            unavailable: Boolean(o.unavailable),
          })),
        );
      }
    }
  });
  return null;
}

/* -------------------------------------------------------------------------- */
/* Event-specific painted availability                                         */
/* -------------------------------------------------------------------------- */

/** The timezone a host paints in: their default schedule's, else their profile's. */
export async function hostPaintZone(userDid: string): Promise<string> {
  const def = await db.query.availabilitySchedules.findFirst({ where: and(eq(schema.availabilitySchedules.userDid, userDid), eq(schema.availabilitySchedules.isDefault, true)) });
  if (def) return def.timezone;
  const u = await db.query.users.findFirst({ where: eq(schema.users.did, userDid), columns: { timezone: true } });
  return u?.timezone ?? "UTC";
}

export async function eventPaintRows(eventTypeId: string, userDid: string, from: string, to: string) {
  return db.query.eventHostAvailability.findMany({
    where: and(
      eq(schema.eventHostAvailability.eventTypeId, eventTypeId),
      eq(schema.eventHostAvailability.userDid, userDid),
      gte(schema.eventHostAvailability.date, from),
      lte(schema.eventHostAvailability.date, to),
    ),
  });
}

/** Replace the painted windows of the given dates for this host and event. */
export async function saveEventPaint(eventTypeId: string, userDid: string, timezone: string, days: { date: string; cells: number[] }[]): Promise<string | null> {
  const { cellsToWindows } = await import("./painter");
  const host = await db.query.eventTypeHosts.findFirst({ where: and(eq(schema.eventTypeHosts.eventTypeId, eventTypeId), eq(schema.eventTypeHosts.userDid, userDid)) });
  if (!host) return "You are not a host of this event";
  await db.transaction(async (tx) => {
    for (const day of days) {
      await tx
        .delete(schema.eventHostAvailability)
        .where(and(eq(schema.eventHostAvailability.eventTypeId, eventTypeId), eq(schema.eventHostAvailability.userDid, userDid), eq(schema.eventHostAvailability.date, day.date)));
      const windows = cellsToWindows(day.cells);
      const rows = windows.length
        ? windows.map((w) => ({ id: newId("eha"), eventTypeId, userDid, date: day.date, timezone, startMinutes: w.startMinutes, endMinutes: w.endMinutes, unavailable: false }))
        : [{ id: newId("eha"), eventTypeId, userDid, date: day.date, timezone, startMinutes: null, endMinutes: null, unavailable: true }];
      await tx.insert(schema.eventHostAvailability).values(rows);
    }
  });
  return null;
}

/** Forget every painted day for this host and event (back to the schedule). */
export async function clearEventPaint(eventTypeId: string, userDid: string): Promise<void> {
  await db.delete(schema.eventHostAvailability).where(and(eq(schema.eventHostAvailability.eventTypeId, eventTypeId), eq(schema.eventHostAvailability.userDid, userDid)));
}

export async function setHostAvailabilityMode(eventTypeId: string, userDid: string, mode: "schedule" | "painted"): Promise<void> {
  await db.update(schema.eventTypeHosts).set({ availabilityMode: mode }).where(and(eq(schema.eventTypeHosts.eventTypeId, eventTypeId), eq(schema.eventTypeHosts.userDid, userDid)));
}

/** Per host: how many future dates they painted for this event. */
export async function eventPaintSummary(eventTypeId: string): Promise<Map<string, number>> {
  const rows = await db.query.eventHostAvailability.findMany({
    where: and(eq(schema.eventHostAvailability.eventTypeId, eventTypeId), gte(schema.eventHostAvailability.date, DateTime.now().toISODate()!)),
    columns: { userDid: true, date: true },
  });
  const out = new Map<string, Set<string>>();
  for (const r of rows) (out.get(r.userDid) ?? out.set(r.userDid, new Set()).get(r.userDid)!).add(r.date);
  return new Map([...out].map(([k, v]) => [k, v.size]));
}
