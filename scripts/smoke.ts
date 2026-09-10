/**
 * Service-level smoke test against a real database (no OAuth or providers).
 * Usage: DATABASE_URL=postgres://... pnpm tsx scripts/smoke.ts
 */
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { createTeam, respondTeamInvite } from "@/lib/teams/service";
import { createEventType } from "@/lib/event-types/service";
import { availableSlots, createBooking, cancelBookingInternal, rescheduleBooking } from "@/lib/bookings/service";
import { saveSchedule, listSchedules, hostAvailabilities } from "@/lib/availability/service";
import { computeOverlap } from "@/lib/scheduling/overlap";
import { getBoss } from "@/lib/jobs/queue";
import { buildIcs } from "@/lib/email/ics";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function user(handle: string, tz: string) {
  const did = `did:plc:${newId()}`;
  const [u] = await db.insert(schema.users).values({ did, handle, displayName: handle.split(".")[0], email: `${handle}@example.org`, timezone: tz, onboardedAt: new Date() }).returning();
  const sid = newId("sch");
  await db.insert(schema.availabilitySchedules).values({ id: sid, userDid: did, name: "Work", timezone: tz, isDefault: true });
  return u;
}

async function main() {
  const boss = await getBoss();
  const alice = await user(`alice-${newId()}.test`, "Europe/Brussels");
  const bob = await user(`bob-${newId()}.test`, "America/New_York");
  const carol = await user(`carol-${newId()}.test`, "Europe/Lisbon");

  // Availability: alice Mon-Fri 9-17 Brussels, bob Mon-Fri 9-17 New York, carol attends only.
  for (const [u, tz] of [[alice, "Europe/Brussels"], [bob, "America/New_York"]] as const) {
    const [s] = await listSchedules(u.did);
    const err = await saveSchedule(u.did, s.id, { name: "Work", timezone: tz, rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinutes: 540, endMinutes: 1020 })), overrides: [] });
    assert(!err, `schedule ${err}`);
  }

  // Team with both, "anyone" mode.
  const team = await createTeam(alice, `Team ${newId()}`, "Europe/Brussels");
  await db.insert(schema.teamInvites).values({ id: newId("tinv"), teamId: team.id, inviteeDid: bob.did, invitedBy: alice.did });
  const inv = await db.query.teamInvites.findFirst({ where: eq(schema.teamInvites.inviteeDid, bob.did) });
  await respondTeamInvite(bob.did, inv!.id, true);

  const et = await createEventType(alice, "team", team.id, {
    title: "Office hours",
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 0,
    bookingWindowDays: 30,
    capacity: 1,
    visibility: "link",
    assignmentMode: "anyone",
    thresholdCount: 1,
    hostSelection: "round_robin",
    locationKind: "video",
    videoProvider: "jitsi",
    status: "published",
    cancellationNoticeMinutes: 0,
    allowReschedule: true,
    requiresApproval: false,
    reminderMinutes: [60],
    publishSessions: false,
    color: "#4f46e5",
    questions: [{ id: "topic", label: "Topic", type: "text", required: true }],
    hosts: [
      { did: alice.did, scheduleId: null, required: true },
      { did: bob.did, scheduleId: null, required: true },
    ],
  });

  // Next Monday, Brussels.
  const monday = DateTime.now().setZone("Europe/Brussels").plus({ weeks: 1 }).startOf("week");
  const window = { start: monday.toMillis(), end: monday.plus({ days: 1 }).toMillis() };
  const { slots } = await availableSlots(et, window);
  assert(slots.length > 0, "slots generated");
  // Union of both: 09:00 Brussels .. 17:00 New York (= 23:00 Brussels) -> 28 half-hour slots.
  const first = DateTime.fromMillis(slots[0].start, { zone: "Europe/Brussels" }).toFormat("HH:mm");
  const last = DateTime.fromMillis(slots[slots.length - 1].start, { zone: "Europe/Brussels" }).toFormat("HH:mm");
  console.log("slots", slots.length, first, "→", last);
  assert(first === "09:00", "first slot 09:00 Brussels");
  assert(slots.length === 28, `28 slots expected, got ${slots.length}`);

  // Book 10:00 Brussels: only alice is free -> alice hosts.
  const at10 = slots.find((s) => DateTime.fromMillis(s.start, { zone: "Europe/Brussels" }).toFormat("HH:mm") === "10:00")!;
  const booking = await createBooking({ eventType: et, start: new Date(at10.start), attendee: carol, attendeeName: "Carol", attendeeEmail: "carol@example.org", timezone: "Europe/Lisbon", answers: { topic: "hello" } });
  const meeting = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, booking.meetingId) });
  assert(meeting?.hostDids.length === 1 && meeting.hostDids[0] === alice.did, "alice assigned");
  assert(meeting.videoUrl?.includes("meet.jit.si"), "jitsi link");
  console.log("booked", booking.id, "host", meeting.hostDids, meeting.videoUrl);

  // Same slot is now gone for alice but 16:00 Brussels (10:00 NY) is available via bob.
  const after = await availableSlots(et, window);
  assert(!after.slots.some((s) => s.start === at10.start), "10:00 no longer offered");
  await new Promise((r) => setTimeout(r, 50));

  // Double booking is rejected.
  let rejected = false;
  try {
    await createBooking({ eventType: et, start: new Date(at10.start), attendee: bob, attendeeName: "x", attendeeEmail: "x@example.org", timezone: "UTC", answers: {} });
  } catch (e) {
    rejected = /host of this event|no longer available/.test(String(e));
  }
  assert(rejected, "double booking rejected");

  // Reschedule to 11:00 Brussels, then cancel.
  const at11 = after.slots.find((s) => DateTime.fromMillis(s.start, { zone: "Europe/Brussels" }).toFormat("HH:mm") === "11:00")!;
  const moved = await rescheduleBooking(booking.id, new Date(at11.start), carol.did, "Europe/Lisbon");
  const m2 = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, moved.meetingId) });
  assert(m2?.startAt.getTime() === at11.start && m2.icsSequence === 1, "rescheduled in place with bumped sequence");
  await cancelBookingInternal(moved.id, carol.did, "test");
  const m3 = await db.query.meetings.findFirst({ where: eq(schema.meetings.id, moved.meetingId) });
  assert(m3?.status === "cancelled", "meeting cancelled with last booking");

  // Overlap view for the team.
  const av = await hostAvailabilities([{ did: alice.did }, { did: bob.did }], window);
  const overlap = computeOverlap(av, { bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
  const all = overlap.all.map((i) => [DateTime.fromMillis(i.start, { zone: "Europe/Brussels" }).toFormat("HH:mm"), DateTime.fromMillis(i.end, { zone: "Europe/Brussels" }).toFormat("HH:mm")]);
  console.log("everyone free (Brussels)", all);
  assert(all.length === 1 && all[0][0] === "15:00" && all[0][1] === "17:00", "overlap 15:00-17:00 Brussels");

  // Group session with capacity 3: two bookings share one meeting.
  const group = await createEventType(alice, "user", alice.did, {
    title: "Workshop", durationMinutes: 60, slotIntervalMinutes: 60, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, minNoticeMinutes: 0, bookingWindowDays: 30, capacity: 3,
    visibility: "public", assignmentMode: "collective", thresholdCount: 1, hostSelection: "round_robin", locationKind: "video", videoProvider: "jitsi", status: "published",
    cancellationNoticeMinutes: 0, allowReschedule: true, requiresApproval: false, reminderMinutes: [], publishSessions: false, color: "#000000", questions: [],
    hosts: [{ did: alice.did, scheduleId: null, required: true }],
  });
  const g = await availableSlots(group, window);
  const b1 = await createBooking({ eventType: group, start: new Date(g.slots[0].start), attendee: carol, attendeeName: "Carol", attendeeEmail: "carol@example.org", timezone: "UTC", answers: {} });
  const g2 = await availableSlots(group, window);
  assert(g2.openSessions.length === 1 && g2.openSessions[0].seatsLeft === 2, "open session with 2 seats left");
  const b2 = await createBooking({ eventType: group, start: new Date(g.slots[0].start), attendee: bob, attendeeName: "Bob", attendeeEmail: "bob@example.org", timezone: "UTC", meetingId: g2.openSessions[0].id, answers: {} });
  assert(b1.meetingId === b2.meetingId, "same session");

  // ICS renders.
  assert(buildIcs({ uid: "x", sequence: 0, start: new Date(), end: new Date(Date.now() + 1e6), summary: "t", organizer: { name: "imta", email: "a@b.c" }, attendees: [], method: "REQUEST" }).includes("BEGIN:VEVENT"), "ics");

  // Jobs were enqueued.
  await new Promise((r) => setTimeout(r, 200));
  const counts = await db.execute(`select name, count(*)::int as n from pgboss.job group by name order by name`);
  console.log("queued jobs", counts);
  await boss.stop({ graceful: false });
  console.log("SMOKE OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
