import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { encrypt } from "@/lib/crypto";
import { newId } from "@/lib/ids";
import { log, errMessage } from "@/lib/log";
import { calendarProvider, CALENDAR_PROVIDERS } from "./index";
import { exchangeCode, markConnectionError } from "./oauth";
import type { ProviderConnection, ProviderKind } from "@/db/schema";
import type { Interval } from "@/lib/scheduling/intervals";

/** How far ahead we keep busy blocks in sync. */
export const SYNC_HORIZON_DAYS = 90;

export async function completeConnection(userDid: string, provider: ProviderKind, code: string): Promise<ProviderConnection> {
  const tokens = await exchangeCode(provider, code);
  const id = newId("conn");
  const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
  const [conn] = await db
    .insert(schema.providerConnections)
    .values({
      id,
      userDid,
      provider,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiresAt,
      scopes: tokens.scope ?? null,
      isWriteTarget: CALENDAR_PROVIDERS.includes(provider),
      useForBusy: CALENDAR_PROVIDERS.includes(provider),
    })
    .returning();

  if (CALENDAR_PROVIDERS.includes(provider)) {
    const api = calendarProvider(provider);
    try {
      const info = await api.accountInfo(conn);
      const calendars = await api.listCalendars(conn);
      const primary = calendars.find((c) => c.primary) ?? calendars.find((c) => c.canWrite);
      // Only one write target per user: the first calendar connection wins until changed.
      const others = await db.query.providerConnections.findMany({
        where: and(eq(schema.providerConnections.userDid, userDid), inArray(schema.providerConnections.provider, CALENDAR_PROVIDERS)),
      });
      const hasWriteTarget = others.some((o) => o.id !== conn.id && o.isWriteTarget);
      const [updated] = await db
        .update(schema.providerConnections)
        .set({
          accountId: info.id ?? null,
          accountEmail: info.email ?? null,
          writeCalendarId: primary?.id ?? (provider === "microsoft" ? "default" : "primary"),
          busyCalendarIds: primary ? [primary.id] : [],
          isWriteTarget: !hasWriteTarget,
        })
        .where(eq(schema.providerConnections.id, conn.id))
        .returning();
      return updated;
    } catch (e) {
      await markConnectionError(conn.id, errMessage(e));
      log.warn("calendar: post-connect setup failed", { provider, error: errMessage(e) });
    }
  } else if (provider === "zoom") {
    try {
      const { zoomAccountInfo } = await import("@/lib/video/zoom");
      const info = await zoomAccountInfo(conn);
      const [updated] = await db
        .update(schema.providerConnections)
        .set({ accountId: info.id ?? null, accountEmail: info.email ?? null, isWriteTarget: false, useForBusy: false })
        .where(eq(schema.providerConnections.id, conn.id))
        .returning();
      return updated;
    } catch (e) {
      await markConnectionError(conn.id, errMessage(e));
    }
  }
  return conn;
}

export async function listConnections(userDid: string): Promise<ProviderConnection[]> {
  return db.query.providerConnections.findMany({
    where: eq(schema.providerConnections.userDid, userDid),
    orderBy: (c, { asc }) => asc(c.createdAt),
  });
}

export async function removeConnection(userDid: string, id: string): Promise<void> {
  const conn = await db.query.providerConnections.findFirst({
    where: and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.userDid, userDid)),
  });
  if (!conn) return;
  if (CALENDAR_PROVIDERS.includes(conn.provider)) {
    await calendarProvider(conn.provider).unwatch?.(conn).catch(() => undefined);
  }
  await db.delete(schema.providerConnections).where(eq(schema.providerConnections.id, id));
}

/**
 * Busy intervals for a set of users in a window: cached provider busy blocks
 * plus confirmed meetings they host or attend.
 */
export async function busyFor(userDids: string[], window: Interval): Promise<Map<string, Interval[]>> {
  const out = new Map<string, Interval[]>(userDids.map((d) => [d, []]));
  if (userDids.length === 0) return out;
  const from = new Date(window.start);
  const to = new Date(window.end);

  const blocks = await db
    .select({ userDid: schema.busyBlocks.userDid, startAt: schema.busyBlocks.startAt, endAt: schema.busyBlocks.endAt })
    .from(schema.busyBlocks)
    .innerJoin(schema.providerConnections, eq(schema.providerConnections.id, schema.busyBlocks.connectionId))
    .where(
      and(
        inArray(schema.busyBlocks.userDid, userDids),
        eq(schema.providerConnections.useForBusy, true),
        lte(schema.busyBlocks.startAt, to),
        gte(schema.busyBlocks.endAt, from),
      ),
    );
  for (const b of blocks) out.get(b.userDid)?.push({ start: b.startAt.getTime(), end: b.endAt.getTime() });

  const hosted = await db.query.meetings.findMany({
    where: and(eq(schema.meetings.status, "scheduled"), lte(schema.meetings.startAt, to), gte(schema.meetings.endAt, from)),
    columns: { startAt: true, endAt: true, hostDids: true, id: true },
  });
  for (const m of hosted) {
    for (const did of m.hostDids) out.get(did)?.push({ start: m.startAt.getTime(), end: m.endAt.getTime() });
  }

  const attended = await db
    .select({ did: schema.bookings.attendeeDid, startAt: schema.meetings.startAt, endAt: schema.meetings.endAt })
    .from(schema.bookings)
    .innerJoin(schema.meetings, eq(schema.meetings.id, schema.bookings.meetingId))
    .where(
      and(
        inArray(schema.bookings.attendeeDid, userDids),
        eq(schema.bookings.status, "confirmed"),
        lte(schema.meetings.startAt, to),
        gte(schema.meetings.endAt, from),
      ),
    );
  for (const b of attended) out.get(b.did)?.push({ start: b.startAt.getTime(), end: b.endAt.getTime() });
  return out;
}

/** Run an incremental sync for one connection and persist the busy cache. */
export async function syncConnection(conn: ProviderConnection): Promise<{ upserts: number; deletions: number }> {
  if (!CALENDAR_PROVIDERS.includes(conn.provider)) return { upserts: 0, deletions: 0 };
  const api = calendarProvider(conn.provider);
  const window: Interval = {
    start: Date.now() - 86_400_000,
    end: Date.now() + SYNC_HORIZON_DAYS * 86_400_000,
  };
  const own = await db.query.calendarEvents.findMany({
    where: eq(schema.calendarEvents.connectionId, conn.id),
    columns: { externalEventId: true, meetingId: true, bookingId: true },
  });
  const ownIds = new Set(own.map((o) => o.externalEventId));
  try {
    const result = await api.sync(conn, window, ownIds);
    await db.transaction(async (tx) => {
      if (result.full) {
        await tx.delete(schema.busyBlocks).where(eq(schema.busyBlocks.connectionId, conn.id));
      }
      for (const u of result.upserts) {
        await tx
          .insert(schema.busyBlocks)
          .values({ id: newId("busy"), connectionId: conn.id, userDid: conn.userDid, externalId: u.externalId, startAt: u.start, endAt: u.end, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [schema.busyBlocks.connectionId, schema.busyBlocks.externalId],
            set: { startAt: u.start, endAt: u.end, updatedAt: new Date() },
          });
      }
      if (result.deletions.length) {
        await tx.delete(schema.busyBlocks).where(and(eq(schema.busyBlocks.connectionId, conn.id), inArray(schema.busyBlocks.externalId, result.deletions)));
      }
      await tx
        .update(schema.providerConnections)
        .set({ syncCursor: result.cursor, lastSyncedAt: new Date(), lastError: null })
        .where(eq(schema.providerConnections.id, conn.id));
    });
    if (result.changedOwnEvents.length) {
      const { reconcileProviderChanges } = await import("@/lib/bookings/reconcile");
      await reconcileProviderChanges(conn, own, result.changedOwnEvents);
    }
    return { upserts: result.upserts.length, deletions: result.deletions.length };
  } catch (e) {
    await markConnectionError(conn.id, errMessage(e));
    log.warn("calendar sync failed", { connectionId: conn.id, provider: conn.provider, error: errMessage(e) });
    throw e;
  }
}

/** (Re)register push notifications when supported and about to expire. */
export async function ensureWatch(conn: ProviderConnection): Promise<void> {
  if (!CALENDAR_PROVIDERS.includes(conn.provider)) return;
  const api = calendarProvider(conn.provider);
  if (!api.watch) return;
  if (conn.watchExpiresAt && conn.watchExpiresAt.getTime() > Date.now() + 12 * 3_600_000) return;
  try {
    await api.unwatch?.(conn);
    const w = await api.watch(conn, conn.writeCalendarId ?? "primary");
    if (!w) return;
    await db
      .update(schema.providerConnections)
      .set({ watchChannelId: w.channelId, watchResourceId: w.resourceId, watchExpiresAt: w.expiresAt })
      .where(eq(schema.providerConnections.id, conn.id));
  } catch (e) {
    log.warn("calendar watch failed", { connectionId: conn.id, error: errMessage(e) });
  }
}

export async function writeTargetFor(userDid: string): Promise<ProviderConnection | undefined> {
  return db.query.providerConnections.findFirst({
    where: and(
      eq(schema.providerConnections.userDid, userDid),
      eq(schema.providerConnections.isWriteTarget, true),
      inArray(schema.providerConnections.provider, CALENDAR_PROVIDERS),
    ),
  });
}

export async function connectionOfProvider(userDid: string, provider: ProviderKind): Promise<ProviderConnection | undefined> {
  return db.query.providerConnections.findFirst({
    where: and(eq(schema.providerConnections.userDid, userDid), eq(schema.providerConnections.provider, provider)),
  });
}
