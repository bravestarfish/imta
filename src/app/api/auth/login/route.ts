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
    const name = e instanceof Error ? e.name : "";
    log.warn("login: authorize failed", { handle, error: errMessage(e), name });
    // Only identity resolution failures are the user's problem; everything else is ours.
    const code = name === "OAuthResolverError" || /resolve/i.test(errMessage(e)) ? "resolve" : "config";
    return NextResponse.redirect(appUrl(`/login?error=${code}`), 303);
  }
}

function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}
