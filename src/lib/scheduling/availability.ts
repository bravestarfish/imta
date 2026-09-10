import { DateTime } from "luxon";
import { normalize, type Interval } from "./intervals";

export type WeeklyRule = { weekday: number; startMinutes: number; endMinutes: number };
export type DateOverride = {
  date: string; // YYYY-MM-DD in the schedule's timezone
  startMinutes?: number | null;
  endMinutes?: number | null;
  unavailable?: boolean;
};

export type Schedule = {
  timezone: string;
  rules: WeeklyRule[];
  overrides: DateOverride[];
};

/**
 * Expand a weekly schedule (plus date overrides) into concrete UTC intervals
 * for the given window. DST is handled by luxon: minutes are applied to the
 * local midnight of each day in the schedule's timezone.
 */
export function expandSchedule(schedule: Schedule, window: Interval): Interval[] {
  const zone = schedule.timezone || "UTC";
  const start = DateTime.fromMillis(window.start, { zone }).startOf("day");
  const end = DateTime.fromMillis(window.end, { zone }).endOf("day");
  const overridesByDate = new Map<string, DateOverride[]>();
  for (const o of schedule.overrides) {
    const list = overridesByDate.get(o.date) ?? [];
    list.push(o);
    overridesByDate.set(o.date, list);
  }

  const out: Interval[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const iso = day.toISODate();
    if (!iso) continue;
    const overrides = overridesByDate.get(iso);
    if (overrides && overrides.length > 0) {
      if (overrides.some((o) => o.unavailable)) continue;
      for (const o of overrides) {
        if (o.startMinutes == null || o.endMinutes == null) continue;
        out.push(dayWindow(day, o.startMinutes, o.endMinutes));
      }
      continue;
    }
    // luxon weekday: 1 = Monday .. 7 = Sunday; ours: 0 = Sunday .. 6 = Saturday
    const weekday = day.weekday % 7;
    for (const r of schedule.rules) {
      if (r.weekday !== weekday) continue;
      out.push(dayWindow(day, r.startMinutes, r.endMinutes));
    }
  }
  return normalize(out).flatMap((i) => {
    const s = Math.max(i.start, window.start);
    const e = Math.min(i.end, window.end);
    return s < e ? [{ start: s, end: e }] : [];
  });
}

/** Wall-clock time on a local day (DST safe: 09:00 is 09:00 even when clocks change). */
function atMinutes(day: DateTime, minutes: number): DateTime {
  if (minutes >= 24 * 60) return day.plus({ days: 1 }).startOf("day");
  return day.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 });
}

function dayWindow(day: DateTime, startMinutes: number, endMinutes: number): Interval {
  return {
    start: atMinutes(day, startMinutes).toMillis(),
    end: atMinutes(day, endMinutes).toMillis(),
  };
}

/** Validate a set of weekly rules: proper ordering, within the day, no overlap per weekday. */
export function validateRules(rules: WeeklyRule[]): string | null {
  for (const r of rules) {
    if (r.weekday < 0 || r.weekday > 6) return "Invalid weekday";
    if (r.startMinutes < 0 || r.endMinutes > 24 * 60) return "Times must be within the day";
    if (r.startMinutes >= r.endMinutes) return "End must be after start";
  }
  for (let d = 0; d < 7; d++) {
    const day = rules.filter((r) => r.weekday === d).sort((a, b) => a.startMinutes - b.startMinutes);
    for (let i = 1; i < day.length; i++) {
      if (day[i].startMinutes < day[i - 1].endMinutes) return "Overlapping windows on the same day";
    }
  }
  return null;
}
