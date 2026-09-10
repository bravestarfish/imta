import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { applyDateWindows, expandDateWindows, expandSchedule } from "./availability";

const ZONE = "Europe/Brussels";
const ms = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toMillis();
const iv = (s: string, e: string) => ({ start: ms(s), end: ms(e) });

describe("event painted windows", () => {
  const window = iv("2026-09-14T00:00", "2026-09-16T00:00");
  const base = expandSchedule({ timezone: ZONE, rules: [1, 2].map((weekday) => ({ weekday, startMinutes: 540, endMinutes: 1020 })), overrides: [] }, window);

  it("replaces only the painted dates", () => {
    const out = applyDateWindows(base, [{ date: "2026-09-14", timezone: ZONE, startMinutes: 780, endMinutes: 840 }], window);
    expect(out).toEqual([iv("2026-09-14T13:00", "2026-09-14T14:00"), iv("2026-09-15T09:00", "2026-09-15T17:00")]);
  });

  it("blocks a painted-empty date entirely", () => {
    const out = applyDateWindows(base, [{ date: "2026-09-15", timezone: ZONE, startMinutes: null, endMinutes: null, unavailable: true }], window);
    expect(out).toEqual([iv("2026-09-14T09:00", "2026-09-14T17:00")]);
  });

  it("painted-only mode uses just the painted windows", () => {
    const out = expandDateWindows([{ date: "2026-09-15", timezone: ZONE, startMinutes: 600, endMinutes: 660 }, { date: "2026-09-15", timezone: ZONE, startMinutes: 660, endMinutes: 720 }], window);
    expect(out).toEqual([iv("2026-09-15T10:00", "2026-09-15T12:00")]);
  });
});
