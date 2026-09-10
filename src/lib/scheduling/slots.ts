import { DateTime } from "luxon";
import { atLeast, intersectAll, normalize, pad, subtract, union, type Interval } from "./intervals";

export type AssignmentMode = "collective" | "anyone" | "threshold";

export type HostAvailability = {
  did: string;
  /** Working hours expanded to UTC intervals for the window. */
  available: Interval[];
  /** Busy intervals from calendars and existing bookings (already padded with buffers where relevant). */
  busy: Interval[];
};

export type SlotRules = {
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  bookingWindowDays: number;
  maxBookingsPerDay?: number | null;
  assignmentMode: AssignmentMode;
  thresholdCount: number;
  /** Timezone used for "per day" limits and for aligning slot boundaries. */
  timezone: string;
};

export type Slot = {
  start: number;
  end: number;
  /** Hosts free for this slot (all hosts in collective mode). */
  freeHosts: string[];
};

export function hostFree(h: HostAvailability, rules: SlotRules): Interval[] {
  // Buffers protect the host from back-to-back meetings: pad existing busy blocks.
  const busy = pad(h.busy, rules.bufferAfterMinutes * 60_000, rules.bufferBeforeMinutes * 60_000);
  return subtract(h.available, busy);
}

/**
 * Combine hosts' free time according to the assignment mode.
 *  - collective: every required host must be free
 *  - anyone: at least one host free
 *  - threshold: at least N hosts free
 */
export function combineHosts(hosts: HostAvailability[], rules: SlotRules): Interval[] {
  const free = hosts.map((h) => hostFree(h, rules));
  if (hosts.length === 0) return [];
  switch (rules.assignmentMode) {
    case "collective":
      return intersectAll(free);
    case "anyone":
      return union(...free);
    case "threshold":
      return atLeast(free, Math.min(Math.max(rules.thresholdCount, 1), hosts.length));
  }
}

/**
 * Generate bookable slots inside `window` (UTC ms). `now` is used for minimum
 * notice and the booking window. `existingStartsPerDay` counts bookings that
 * already exist per local day (YYYY-MM-DD in rules.timezone).
 */
export function generateSlots(
  hosts: HostAvailability[],
  rules: SlotRules,
  window: Interval,
  now: number,
  existingStartsPerDay: Map<string, number> = new Map(),
): Slot[] {
  const durationMs = rules.durationMinutes * 60_000;
  const stepMs = Math.max(rules.slotIntervalMinutes, 5) * 60_000;
  const earliest = Math.max(window.start, now + rules.minNoticeMinutes * 60_000);
  const latest = Math.min(window.end, now + rules.bookingWindowDays * 86_400_000);
  if (earliest >= latest) return [];

  const combined = combineHosts(hosts, rules);
  const freeByHost = new Map(hosts.map((h) => [h.did, hostFree(h, rules)]));
  const perDay = new Map(existingStartsPerDay);
  const slots: Slot[] = [];

  for (const block of normalize(combined)) {
    // Align to the slot grid in the organizer's timezone (so 09:00, 09:30, ... regardless of DST).
    let cursor = alignUp(Math.max(block.start, earliest), stepMs, rules.timezone);
    while (cursor + durationMs <= block.end && cursor + durationMs <= latest) {
      const probe = { start: cursor, end: cursor + durationMs };
      const freeHosts = hosts
        .filter((h) => covers(freeByHost.get(h.did) ?? [], probe))
        .map((h) => h.did);
      if (enoughHosts(freeHosts.length, hosts.length, rules)) {
        const dayKey = DateTime.fromMillis(cursor, { zone: rules.timezone }).toISODate() ?? "";
        const count = perDay.get(dayKey) ?? 0;
        if (rules.maxBookingsPerDay == null || count < rules.maxBookingsPerDay) {
          slots.push({ ...probe, freeHosts });
        }
      }
      cursor += stepMs;
    }
  }
  return slots;
}

function enoughHosts(free: number, total: number, rules: SlotRules): boolean {
  if (total === 0) return false;
  switch (rules.assignmentMode) {
    case "collective":
      return free === total;
    case "anyone":
      return free >= 1;
    case "threshold":
      return free >= Math.min(Math.max(rules.thresholdCount, 1), total);
  }
}

function covers(intervals: Interval[], probe: Interval): boolean {
  return intervals.some((i) => i.start <= probe.start && i.end >= probe.end);
}

/** Round `t` up to the next multiple of `stepMs` measured from local midnight. */
export function alignUp(t: number, stepMs: number, zone: string): number {
  const local = DateTime.fromMillis(t, { zone });
  const midnight = local.startOf("day").toMillis();
  const offset = t - midnight;
  const rounded = Math.ceil(offset / stepMs) * stepMs;
  return midnight + rounded;
}

/**
 * Pick which hosts attend a slot.
 *  - collective: everyone
 *  - threshold: the first N free hosts (ordered by fewest upcoming bookings)
 *  - anyone: one host; round-robin = fewest upcoming bookings, ties by order
 */
export function assignHosts(
  freeHosts: string[],
  rules: SlotRules,
  load: Map<string, number>,
): string[] {
  const sorted = [...freeHosts].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0));
  switch (rules.assignmentMode) {
    case "collective":
      return freeHosts;
    case "anyone":
      return sorted.slice(0, 1);
    case "threshold":
      return sorted.slice(0, Math.min(Math.max(rules.thresholdCount, 1), sorted.length));
  }
}
