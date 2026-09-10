import { NextResponse, type NextRequest } from "next/server";
import { getOAuthClient } from "@/lib/atproto/client";
import { appUrl } from "@/lib/env";
import { log, errMessage } from "@/lib/log";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";

/** Starts the ATProto OAuth flow for a handle (or DID). */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const handle = String(form.get("handle") ?? "").trim().replace(/^@/, "");
  const next = String(form.get("next") ?? "/dashboard");
  if (!handle) return NextResponse.redirect(appUrl("/login?error=missing"), 303);

  const ip = clientIp(req);
  if (!(await checkRateLimit(`login:${ip}`, 20, 60 * 10))) {
    return NextResponse.redirect(appUrl("/login?error=ratelimited"), 303);
  }

  try {
    const client = await getOAuthClient();
    const state = Buffer.from(JSON.stringify({ next: safeNext(next), n: Date.now() })).toString("base64url");
    const url = await client.authorize(handle, { state });
    return NextResponse.redirect(url.toString(), 303);
  } catch (e) {
    log.warn("login: authorize failed", { handle, error: errMessage(e) });
    return NextResponse.redirect(appUrl("/login?error=resolve"), 303);
  }
}

function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
