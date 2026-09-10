"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { removeConnection } from "@/lib/calendar/service";
import { enqueue } from "@/lib/jobs/queue";
import { CALENDAR_PROVIDERS } from "@/lib/calendar";

export async function updateConnection(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const conn = await db.query.providerConnections.findFirst({ where: and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.userDid, user.did)) });
  if (!conn) return;
  const busy = formData.getAll("busy").map(String);
  const writeCalendarId = String(formData.get("writeCalendarId") ?? conn.writeCalendarId ?? "");
  const isWriteTarget = formData.get("isWriteTarget") === "on";
  await db.transaction(async (tx) => {
    if (isWriteTarget) {
      await tx
        .update(schema.providerConnections)
        .set({ isWriteTarget: false })
        .where(and(eq(schema.providerConnections.userDid, user.did), inArray(schema.providerConnections.provider, CALENDAR_PROVIDERS)));
    }
    await tx
      .update(schema.providerConnections)
      .set({ busyCalendarIds: busy, writeCalendarId: writeCalendarId || conn.writeCalendarId, isWriteTarget, useForBusy: busy.length > 0, syncCursor: {} })
      .where(eq(schema.providerConnections.id, id));
  });
  await enqueue("calendar.sync", { connectionId: id }, { singletonKey: `sync:${id}` });
  revalidatePath("/calendars");
}

export async function resyncConnection(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const conn = await db.query.providerConnections.findFirst({ where: and(eq(schema.providerConnections.id, id), eq(schema.providerConnections.userDid, user.did)) });
  if (!conn) return;
  await db.update(schema.providerConnections).set({ syncCursor: {} }).where(eq(schema.providerConnections.id, id));
  await enqueue("calendar.sync", { connectionId: id }, { singletonKey: `sync:${id}` });
  revalidatePath("/calendars");
}

export async function disconnect(formData: FormData): Promise<void> {
  const user = await requireUser();
  await removeConnection(user.did, String(formData.get("id") ?? ""));
  revalidatePath("/calendars");
}
