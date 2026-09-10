import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { safeEqual } from "@/lib/crypto";

/** Google Calendar push notification: schedule an incremental sync. */
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-goog-channel-token") ?? "";
  const secret = env().WEBHOOK_SECRET ?? "";
  if (!secret || !safeEqual(token, secret)) return new NextResponse("forbidden", { status: 403 });
  const channelId = req.headers.get("x-goog-channel-id");
  if (!channelId) return new NextResponse("ok");
  const conn = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.watchChannelId, channelId) });
  if (conn) await enqueue("calendar.sync", { connectionId: conn.id }, { singletonKey: `sync:${conn.id}`, singletonSeconds: 30 });
  return new NextResponse("ok");
}
