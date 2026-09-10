/**
 * Background worker: run with `pnpm worker`. Uses the same database and code
 * as the web app; can be scaled independently.
 */
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getBoss, enqueue, type JobPayloads } from "@/lib/jobs/queue";
import type { Job } from "pg-boss";
import { syncConnection, ensureWatch } from "@/lib/calendar/service";
import { CALENDAR_PROVIDERS } from "@/lib/calendar";
import { writeMeetingToCalendars } from "@/lib/bookings/calendar-write";
import { notifyBooking, notifyInvitation, notifyTeamInvite } from "@/lib/bookings/notify";
import { syncProfileRecord, syncEventTypeRecord, syncMeetingRecord } from "@/lib/atproto/publish";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { log, errMessage } from "@/lib/log";

async function main() {
  const boss = await getBoss();
  log.info("worker started");

  await boss.work<JobPayloads["calendar.sync"]>("calendar.sync", { batchSize: 5 }, async (jobs: Job<JobPayloads["calendar.sync"]>[]) => {
    for (const job of jobs) {
      const conn = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.id, job.data.connectionId) });
      if (!conn) continue;
      await syncConnection(conn);
      await ensureWatch(conn);
    }
  });

  await boss.work<JobPayloads["calendar.write"]>("calendar.write", async ([job]: Job<JobPayloads["calendar.write"]>[]) => {
    await writeMeetingToCalendars(job.data.meetingId, job.data.reason);
  });

  await boss.work<JobPayloads["notify.booking"]>("notify.booking", { batchSize: 5 }, async (jobs: Job<JobPayloads["notify.booking"]>[]) => {
    for (const job of jobs) await notifyBooking(job.data.bookingId, job.data.kind);
  });

  await boss.work<JobPayloads["notify.invitation"]>("notify.invitation", async ([job]: Job<JobPayloads["notify.invitation"]>[]) => {
    await notifyInvitation(job.data.invitationId);
  });

  await boss.work<JobPayloads["notify.team_invite"]>("notify.team_invite", async ([job]: Job<JobPayloads["notify.team_invite"]>[]) => {
    await notifyTeamInvite(job.data.teamInviteId);
  });

  await boss.work<JobPayloads["atproto.publish"]>("atproto.publish", async ([job]: Job<JobPayloads["atproto.publish"]>[]) => {
    const { kind, id } = job.data;
    if (kind === "profile") await syncProfileRecord(id);
    else if (kind === "eventType") await syncEventTypeRecord(id);
    else await syncMeetingRecord(id);
  });

  // Periodic: incremental calendar sync every 15 minutes (push notifications trigger sooner).
  await boss.work<JobPayloads["sync.tick"]>("sync.tick", async () => {
    const conns = await db.query.providerConnections.findMany({ where: inArray(schema.providerConnections.provider, CALENDAR_PROVIDERS) });
    for (const c of conns) await enqueue("calendar.sync", { connectionId: c.id }, { singletonKey: `sync:${c.id}`, singletonSeconds: 60 });
  });

  // Periodic: reminders.
  await boss.work<JobPayloads["reminders.tick"]>("reminders.tick", async () => {
    await sendDueReminders();
  });

  // Periodic: housekeeping.
  await boss.work<JobPayloads["maintenance.tick"]>("maintenance.tick", async () => {
    await purgeExpiredSessions();
    await db.execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
    await db.execute(sql`delete from notification_log where created_at < now() - interval '90 days'`);
    await db.execute(sql`delete from busy_blocks where end_at < now() - interval '2 days'`);
  });

  await boss.schedule("sync.tick", "*/15 * * * *", {}, { tz: "UTC" });
  await boss.schedule("reminders.tick", "*/5 * * * *", {}, { tz: "UTC" });
  await boss.schedule("maintenance.tick", "17 3 * * *", {}, { tz: "UTC" });

  const stop = async () => {
    log.info("worker stopping");
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

/** Send reminders whose offset has been reached for upcoming confirmed bookings. */
async function sendDueReminders() {
  const now = Date.now();
  const horizon = new Date(now + 15 * 86_400_000);
  const rows = await db
    .select({ booking: schema.bookings, meeting: schema.meetings, et: schema.eventTypes })
    .from(schema.bookings)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.bookings.meetingId))
    .innerJoin(schema.eventTypes, eq(schema.eventTypes.id, schema.bookings.eventTypeId))
    .where(and(eq(schema.bookings.status, "confirmed"), eq(schema.meetings.status, "scheduled"), gte(schema.meetings.startAt, new Date(now)), lte(schema.meetings.startAt, horizon)));
  for (const r of rows) {
    const minutesLeft = (r.meeting.startAt.getTime() - now) / 60_000;
    const due = r.et.reminderMinutes.filter((m) => minutesLeft <= m && !r.booking.remindersSent.includes(m));
    if (!due.length) continue;
    // Only send the largest due reminder once (avoid a burst when a booking is made late).
    const sent = [...r.booking.remindersSent, ...due];
    await db.update(schema.bookings).set({ remindersSent: sent }).where(eq(schema.bookings.id, r.booking.id));
    if (minutesLeft > 5) await enqueue("notify.booking", { bookingId: r.booking.id, kind: "reminder" });
  }
}

main().catch((e) => {
  log.error("worker crashed", { error: errMessage(e) });
  process.exit(1);
});
