import { describe, it, expect } from "vitest";
import { cellsToWindows, windowsToCells, effectiveCells, overridesForPaintedDay } from "./painter";

const rules = [{ weekday: 1, startMinutes: 540, endMinutes: 720 }, { weekday: 1, startMinutes: 780, endMinutes: 1020 }];

describe("painter", () => {
  it("round-trips windows and cells", () => {
    const cells = windowsToCells(rules);
    expect(cells[0]).toBe(18);
    expect(cells).toHaveLength(6 + 8);
    expect(cellsToWindows(cells)).toEqual([{ startMinutes: 540, endMinutes: 720 }, { startMinutes: 780, endMinutes: 1020 }]);
  });

  it("uses overrides when present", () => {
    expect(effectiveCells(rules, [{ date: "2026-09-14", unavailable: true }], "2026-09-14", 1)).toEqual([]);
    expect(effectiveCells(rules, [{ date: "2026-09-14", startMinutes: 600, endMinutes: 660 }], "2026-09-14", 1)).toEqual([20, 21]);
    expect(effectiveCells(rules, [], "2026-09-14", 1)).toHaveLength(14);
  });

  it("produces no override when the painted day equals the weekly default", () => {
    expect(overridesForPaintedDay(rules, "2026-09-14", 1, windowsToCells(rules))).toEqual([]);
  });

  it("produces an unavailable override for an empty day and windows otherwise", () => {
    expect(overridesForPaintedDay(rules, "2026-09-14", 1, [])).toEqual([{ date: "2026-09-14", unavailable: true }]);
    expect(overridesForPaintedDay(rules, "2026-09-14", 1, [20, 21, 30])).toEqual([
      { date: "2026-09-14", startMinutes: 600, endMinutes: 660, unavailable: false },
      { date: "2026-09-14", startMinutes: 900, endMinutes: 930, unavailable: false },
    ]);
  });
});
