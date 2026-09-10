import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { expandSchedule, validateRules } from "./availability";
import { generateSlots, combineHosts, assignHosts, alignUp, type SlotRules, type HostAvailability } from "./slots";
import { computeOverlap, suggestTimes } from "./overlap";

const ZONE = "Europe/Brussels";
const ms = (iso: string, zone = ZONE) => DateTime.fromISO(iso, { zone }).toMillis();
const iv = (s: string, e: string, zone = ZONE) => ({ start: ms(s, zone), end: ms(e, zone) });

const baseRules: SlotRules = {
  durationMinutes: 30,
  slotIntervalMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minNoticeMinutes: 0,
  bookingWindowDays: 60,
  maxBookingsPerDay: null,
  assignmentMode: "collective",
  thresholdCount: 1,
  timezone: ZONE,
};

describe("expandSchedule", () => {
  it("expands weekly rules in the schedule timezone", () => {
    // Monday 2026-09-14 .. Tuesday 2026-09-15
    const out = expandSchedule(
      { timezone: ZONE, rules: [{ weekday: 1, startMinutes: 9 * 60, endMinutes: 17 * 60 }], overrides: [] },
      iv("2026-09-14T00:00", "2026-09-16T00:00"),
    );
    expect(out).toEqual([iv("2026-09-14T09:00", "2026-09-14T17:00")]);
  });

  it("applies date overrides and unavailable days", () => {
    const out = expandSchedule(
      {
        timezone: ZONE,
        rules: [1, 2].map((weekday) => ({ weekday, startMinutes: 9 * 60, endMinutes: 17 * 60 })),
        overrides: [
          { date: "2026-09-14", unavailable: true },
          { date: "2026-09-15", startMinutes: 13 * 60, endMinutes: 15 * 60 },
        ],
      },
      iv("2026-09-14T00:00", "2026-09-16T00:00"),
    );
    expect(out).toEqual([iv("2026-09-15T13:00", "2026-09-15T15:00")]);
  });

  it("handles a DST transition day (clocks go back on 2026-10-25 in Brussels)", () => {
    const out = expandSchedule(
      { timezone: ZONE, rules: [{ weekday: 0, startMinutes: 9 * 60, endMinutes: 10 * 60 }], overrides: [] },
      iv("2026-10-25T00:00", "2026-10-26T00:00"),
    );
    expect(out).toHaveLength(1);
    expect(DateTime.fromMillis(out[0].start, { zone: ZONE }).toFormat("HH:mm")).toBe("09:00");
    expect(out[0].end - out[0].start).toBe(60 * 60_000);
  });

  it("validates rules", () => {
    expect(validateRules([{ weekday: 1, startMinutes: 540, endMinutes: 600 }])).toBeNull();
    expect(validateRules([{ weekday: 1, startMinutes: 600, endMinutes: 540 }])).toMatch(/after start/);
    expect(
      validateRules([
        { weekday: 1, startMinutes: 540, endMinutes: 660 },
        { weekday: 1, startMinutes: 600, endMinutes: 720 },
      ]),
    ).toMatch(/Overlapping/);
  });
});

describe("generateSlots", () => {
  const monday = iv("2026-09-14T09:00", "2026-09-14T12:00");
  const window = iv("2026-09-14T00:00", "2026-09-15T00:00");
  const now = ms("2026-09-10T08:00");

  it("produces slots on the grid within availability", () => {
    const host: HostAvailability = { did: "did:a", available: [monday], busy: [] };
    const slots = generateSlots([host], baseRules, window, now);
    expect(slots).toHaveLength(6);
    expect(DateTime.fromMillis(slots[0].start, { zone: ZONE }).toFormat("HH:mm")).toBe("09:00");
    expect(DateTime.fromMillis(slots[5].start, { zone: ZONE }).toFormat("HH:mm")).toBe("11:30");
  });

  it("removes busy time with buffers", () => {
    const host: HostAvailability = {
      did: "did:a",
      available: [monday],
      busy: [iv("2026-09-14T10:00", "2026-09-14T10:30")],
    };
    const slots = generateSlots([host], { ...baseRules, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 }, window, now);
    const starts = slots.map((s) => DateTime.fromMillis(s.start, { zone: ZONE }).toFormat("HH:mm"));
    // 09:30-10:00 would end inside the 15 minute pre-buffer; 10:30-11:00 starts inside the post-buffer.
    expect(starts).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("respects minimum notice and booking window", () => {
    const host: HostAvailability = { did: "did:a", available: [monday], busy: [] };
    const late = generateSlots([host], { ...baseRules, minNoticeMinutes: 60 }, window, ms("2026-09-14T09:10"));
    expect(DateTime.fromMillis(late[0].start, { zone: ZONE }).toFormat("HH:mm")).toBe("10:30");
    const none = generateSlots([host], { ...baseRules, bookingWindowDays: 1 }, window, now);
    expect(none).toEqual([]);
  });

  it("limits bookings per day", () => {
    const host: HostAvailability = { did: "did:a", available: [monday], busy: [] };
    const slots = generateSlots([host], { ...baseRules, maxBookingsPerDay: 2 }, window, now, new Map([["2026-09-14", 2]]));
    expect(slots).toEqual([]);
  });

  it("collective mode requires every host", () => {
    const a: HostAvailability = { did: "did:a", available: [monday], busy: [] };
    const b: HostAvailability = { did: "did:b", available: [iv("2026-09-14T10:00", "2026-09-14T11:00")], busy: [] };
    const slots = generateSlots([a, b], baseRules, window, now);
    expect(slots.map((s) => s.freeHosts)).toEqual([
      ["did:a", "did:b"],
      ["did:a", "did:b"],
    ]);
  });

  it("anyone mode needs one host and reports who is free", () => {
    const a: HostAvailability = { did: "did:a", available: [iv("2026-09-14T09:00", "2026-09-14T10:00")], busy: [] };
    const b: HostAvailability = { did: "did:b", available: [iv("2026-09-14T11:00", "2026-09-14T12:00")], busy: [] };
    const slots = generateSlots([a, b], { ...baseRules, assignmentMode: "anyone" }, window, now);
    expect(slots).toHaveLength(4);
    expect(slots[0].freeHosts).toEqual(["did:a"]);
    expect(slots[3].freeHosts).toEqual(["did:b"]);
  });

  it("threshold mode needs N hosts", () => {
    const a: HostAvailability = { did: "did:a", available: [monday], busy: [] };
    const b: HostAvailability = { did: "did:b", available: [iv("2026-09-14T09:00", "2026-09-14T10:00")], busy: [] };
    const c: HostAvailability = { did: "did:c", available: [iv("2026-09-14T11:00", "2026-09-14T12:00")], busy: [] };
    const slots = generateSlots([a, b, c], { ...baseRules, assignmentMode: "threshold", thresholdCount: 2 }, window, now);
    const starts = slots.map((s) => DateTime.fromMillis(s.start, { zone: ZONE }).toFormat("HH:mm"));
    expect(starts).toEqual(["09:00", "09:30", "11:00", "11:30"]);
  });

  it("combineHosts returns nothing without hosts", () => {
    expect(combineHosts([], baseRules)).toEqual([]);
  });
});

describe("assignHosts", () => {
  it("round-robins by load", () => {
    const load = new Map([["did:a", 3], ["did:b", 1]]);
    expect(assignHosts(["did:a", "did:b"], { ...baseRules, assignmentMode: "anyone" }, load)).toEqual(["did:b"]);
    expect(assignHosts(["did:a", "did:b", "did:c"], { ...baseRules, assignmentMode: "threshold", thresholdCount: 2 }, load)).toEqual(["did:c", "did:b"]);
    expect(assignHosts(["did:a", "did:b"], baseRules, load)).toEqual(["did:a", "did:b"]);
  });
});

describe("alignUp", () => {
  it("aligns to local grid across DST", () => {
    const t = ms("2026-10-25T09:07");
    expect(DateTime.fromMillis(alignUp(t, 30 * 60_000, ZONE), { zone: ZONE }).toFormat("HH:mm")).toBe("09:30");
  });
});

describe("overlap", () => {
  it("computes all/any/threshold views and suggests times", () => {
    const a: HostAvailability = { did: "did:a", available: [iv("2026-09-14T09:00", "2026-09-14T12:00")], busy: [] };
    const b: HostAvailability = { did: "did:b", available: [iv("2026-09-14T10:00", "2026-09-14T13:00")], busy: [iv("2026-09-14T11:00", "2026-09-14T11:30")] };
    const c: HostAvailability = { did: "did:c", available: [iv("2026-09-14T08:00", "2026-09-14T10:30")], busy: [] };
    const view = computeOverlap([a, b, c], { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    expect(view.all).toEqual([iv("2026-09-14T10:00", "2026-09-14T10:30")]);
    expect(view.any).toEqual([iv("2026-09-14T08:00", "2026-09-14T13:00")]);
    expect(view.atLeast[2]).toEqual([iv("2026-09-14T09:00", "2026-09-14T11:00"), iv("2026-09-14T11:30", "2026-09-14T12:00")]);
    const suggestions = suggestTimes(view.atLeast[2], 60, ZONE, 5);
    expect(suggestions.map((s) => DateTime.fromMillis(s.start, { zone: ZONE }).toFormat("HH:mm"))).toEqual(["09:00", "10:00"]);
  });
});
