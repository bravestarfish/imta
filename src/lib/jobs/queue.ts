import { PgBoss } from "pg-boss";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Background jobs run through pg-boss (Postgres backed, no extra service).
 * The web app only enqueues; `src/worker` processes.
 */
export type JobPayloads = {
  "calendar.sync": { connectionId: string };
  "calendar.write": { meetingId: string; reason: "created" | "updated" | "cancelled" };
  "notify.booking": { bookingId: string; kind: "confirmed" | "cancelled" | "rescheduled" | "reminder" | "host_new" | "host_cancelled" | "pending" };
  "notify.invitation": { invitationId: string };
  "notify.team_invite": { teamInviteId: string };
  "atproto.publish": { kind: "profile" | "eventType" | "meeting"; id: string };
  "maintenance.tick": Record<string, never>;
  "reminders.tick": Record<string, never>;
  "sync.tick": Record<string, never>;
};

export type JobName = keyof JobPayloads;

declare global {
  var __imtaBoss: Promise<PgBoss> | undefined;
}

export function getBoss(): Promise<PgBoss> {
  if (!globalThis.__imtaBoss) {
    globalThis.__imtaBoss = (async () => {
      const boss = new PgBoss({ connectionString: env().DATABASE_URL, schema: "pgboss" });
      boss.on("error", (e: Error) => log.error("pg-boss error", { error: e.message }));
      await boss.start();
      for (const name of QUEUES) await boss.createQueue(name).catch(() => undefined);
      return boss;
    })();
  }
  return globalThis.__imtaBoss;
}

export const QUEUES: JobName[] = [
  "calendar.sync",
  "calendar.write",
  "notify.booking",
  "notify.invitation",
  "notify.team_invite",
  "atproto.publish",
  "maintenance.tick",
  "reminders.tick",
  "sync.tick",
];

export async function enqueue<N extends JobName>(
  name: N,
  data: JobPayloads[N],
  options: { singletonKey?: string; singletonSeconds?: number; startAfter?: number | Date; retryLimit?: number } = {},
): Promise<void> {
  try {
    const boss = await getBoss();
    await boss.send(name, data, {
      retryLimit: options.retryLimit ?? 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 15 * 60,
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.singletonSeconds ? { singletonSeconds: options.singletonSeconds } : {}),
      ...(options.startAfter !== undefined ? { startAfter: options.startAfter } : {}),
    });
  } catch (e) {
    // Never fail a user request because the queue is unavailable; the periodic ticks will catch up.
    log.error("enqueue failed", { name, error: e instanceof Error ? e.message : String(e) });
  }
}
