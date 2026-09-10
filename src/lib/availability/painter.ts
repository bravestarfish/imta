import { DateTime } from "luxon";
import type { WeeklyRule, DateOverride } from "@/lib/scheduling/availability";

/**
 * Helpers for the week "painter": organizers tap half-hour cells for specific
 * dates. A painted day is stored as date overrides (one window per run of
 * cells); a day painted back to its weekly default has its overrides removed.
 */
export const STEP = 30;
export const CELLS_PER_DAY = (24 * 60) / STEP;

/** Half-hour cell indexes covered by a set of minute windows. */
export function windowsToCells(windows: { startMinutes: number; endMinutes: number }[]): number[] {
  const set = new Set<number>();
  for (const w of windows) {
    for (let m = Math.floor(w.startMinutes / STEP) * STEP; m < w.endMinutes; m += STEP) set.add(m / STEP);
  }
  return [...set].sort((a, b) => a - b);
}

/** Merge consecutive cells into windows. */
export function cellsToWindows(cells: number[]): { startMinutes: number; endMinutes: number }[] {
  const sorted = [...new Set(cells)].filter((c) => c >= 0 && c < CELLS_PER_DAY).sort((a, b) => a - b);
  const out: { startMinutes: number; endMinutes: number }[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && last.endMinutes === c * STEP) last.endMinutes = (c + 1) * STEP;
    else out.push({ startMinutes: c * STEP, endMinutes: (c + 1) * STEP });
  }
  return out;
}

/** Cells the weekly rules give for a weekday (0 = Sunday). */
export function weeklyCells(rules: WeeklyRule[], weekday: number): number[] {
  return windowsToCells(rules.filter((r) => r.weekday === weekday));
}

/** Effective cells for a date: overrides win over weekly rules. */
export function effectiveCells(rules: WeeklyRule[], overrides: DateOverride[], date: string, weekday: number): number[] {
  const dayOverrides = overrides.filter((o) => o.date === date);
  if (dayOverrides.length) {
    if (dayOverrides.some((o) => o.unavailable)) return [];
    return windowsToCells(dayOverrides.filter((o) => o.startMinutes != null && o.endMinutes != null).map((o) => ({ startMinutes: o.startMinutes!, endMinutes: o.endMinutes! })));
  }
  return weeklyCells(rules, weekday);
}

/**
 * Overrides to store for a painted day. Returns [] when the painted cells
 * equal the weekly default (so the date needs no override).
 */
export function overridesForPaintedDay(rules: WeeklyRule[], date: string, weekday: number, painted: number[]): DateOverride[] {
  const def = weeklyCells(rules, weekday);
  const cells = [...new Set(painted)].sort((a, b) => a - b);
  if (def.length === cells.length && def.every((c, i) => c === cells[i])) return [];
  if (cells.length === 0) return [{ date, unavailable: true }];
  return cellsToWindows(cells).map((w) => ({ date, startMinutes: w.startMinutes, endMinutes: w.endMinutes, unavailable: false }));
}

export function weekdayOf(date: string, zone: string): number {
  return DateTime.fromISO(date, { zone }).weekday % 7;
}
