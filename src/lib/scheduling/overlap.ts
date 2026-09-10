import { DateTime } from "luxon";
import { atLeast, intersectAll, union, type Interval } from "./intervals";
import { hostFree, type HostAvailability, type SlotRules } from "./slots";

export type OverlapView = {
  /** Everyone is free. */
  all: Interval[];
  /** At least one member is free. */
  any: Interval[];
  /** Free intervals per member. */
  byMember: Record<string, Interval[]>;
  /** Threshold views for 2..n-1 members. */
  atLeast: Record<number, Interval[]>;
};

/** Compute the computed-overlap view organizers see for their team. */
export function computeOverlap(hosts: HostAvailability[], rules: Pick<SlotRules, "bufferBeforeMinutes" | "bufferAfterMinutes">): OverlapView {
  const base: SlotRules = {
    durationMinutes: 0,
    slotIntervalMinutes: 0,
    bufferBeforeMinutes: rules.bufferBeforeMinutes,
    bufferAfterMinutes: rules.bufferAfterMinutes,
    minNoticeMinutes: 0,
    bookingWindowDays: 0,
    assignmentMode: "collective",
    thresholdCount: 1,
    timezone: "UTC",
  };
  const byMember: Record<string, Interval[]> = {};
  const free: Interval[][] = [];
  for (const h of hosts) {
    const f = hostFree(h, base);
    byMember[h.did] = f;
    free.push(f);
  }
  const thresholds: Record<number, Interval[]> = {};
  for (let k = 2; k < hosts.length; k++) thresholds[k] = atLeast(free, k);
  return {
    all: intersectAll(free),
    any: union(...free),
    byMember,
    atLeast: thresholds,
  };
}

/**
 * Suggest meeting times of `durationMinutes` where everyone is free, ordered by
 * earliest first, aligned to 15 minutes in the given zone.
 */
export function suggestTimes(
  common: Interval[],
  durationMinutes: number,
  zone: string,
  limit = 10,
  workingHoursOnly: { startHour: number; endHour: number } | null = { startHour: 8, endHour: 20 },
): Interval[] {
  const durationMs = durationMinutes * 60_000;
  const step = 15 * 60_000;
  const out: Interval[] = [];
  for (const block of common) {
    let cursor = Math.ceil(block.start / step) * step;
    while (cursor + durationMs <= block.end && out.length < limit) {
      const local = DateTime.fromMillis(cursor, { zone });
      const inHours =
        !workingHoursOnly ||
        (local.hour >= workingHoursOnly.startHour && local.hour + durationMinutes / 60 <= workingHoursOnly.endHour);
      if (inHours) out.push({ start: cursor, end: cursor + durationMs });
      cursor += Math.max(step, durationMs);
    }
    if (out.length >= limit) break;
  }
  return out;
}
