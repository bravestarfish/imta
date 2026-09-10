import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs/queue";
import { safeEqual } from "@/lib/crypto";

/** Microsoft Graph change notifications (with the validation handshake). */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const validation = url.searchParams.get("validationToken");
  if (validation) return new NextResponse(validation, { headers: { "content-type": "text/plain" } });

  const secret = env().WEBHOOK_SECRET ?? "";
  const body = (await req.json().catch(() => ({}))) as { value?: { subscriptionId: string; clientState?: string }[] };
  for (const n of body.value ?? []) {
    if (!secret || !n.clientState || !safeEqual(n.clientState, secret)) continue;
    const conn = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.watchChannelId, n.subscriptionId) });
    if (conn) await enqueue("calendar.sync", { connectionId: conn.id }, { singletonKey: `sync:${conn.id}`, singletonSeconds: 30 });
  }
  return new NextResponse(null, { status: 202 });
}
