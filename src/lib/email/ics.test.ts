import { describe, it, expect } from "vitest";
import { buildIcs } from "./ics";

describe("buildIcs", () => {
  it("emits a REQUEST with organizer, attendees and folded lines", () => {
    const ics = buildIcs({
      uid: "abc@imta.rsvp",
      sequence: 2,
      start: new Date("2026-09-14T09:00:00Z"),
      end: new Date("2026-09-14T09:30:00Z"),
      summary: "Intro call; with, commas",
      description: "Line 1\nLine 2 " + "x".repeat(120),
      organizer: { name: "imta", email: "no-reply@imta.rsvp" },
      attendees: [{ name: "Ada", email: "ada@example.org" }],
      method: "REQUEST",
    });
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:abc@imta.rsvp");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).toContain("DTSTART:20260914T090000Z");
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("SUMMARY:Intro call\\; with\\, commas");
    expect(unfolded).toContain("DESCRIPTION:Line 1\\nLine 2");
    expect(unfolded).toContain("ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE;CN=Ada:mailto:ada@example.org");
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });

  it("emits a CANCEL with cancelled status", () => {
    const ics = buildIcs({
      uid: "abc@imta.rsvp",
      sequence: 3,
      start: new Date("2026-09-14T09:00:00Z"),
      end: new Date("2026-09-14T09:30:00Z"),
      summary: "Intro call",
      organizer: { name: "imta", email: "no-reply@imta.rsvp" },
      attendees: [],
      method: "CANCEL",
    });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });
});
