import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getOAuthClient } from "@/lib/atproto/client";
import { upsertUserFromLogin } from "@/lib/users/service";
import { createSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";
import { log, errMessage } from "@/lib/log";

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  try {
    const client = await getOAuthClient();
    const { session, state } = await client.callback(params);
    const user = await upsertUserFromLogin(session.did);
    const sessionId = await createSession(user.did);
    let next = user.onboardedAt ? "/dashboard" : "/onboarding";
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
        if (typeof parsed.next === "string" && parsed.next.startsWith("/") && user.onboardedAt) {
          next = parsed.next;
        } else if (typeof parsed.next === "string" && parsed.next.startsWith("/")) {
          next = `/onboarding?next=${encodeURIComponent(parsed.next)}`;
        }
      } catch {
        /* ignore malformed state */
      }
    }
    const store = await cookies();
    store.set(SESSION_COOKIE, sessionId, sessionCookieOptions(appUrl().startsWith("https")));
    return NextResponse.redirect(appUrl(next), 303);
  } catch (e) {
    log.warn("oauth callback failed", { error: errMessage(e) });
    return NextResponse.redirect(appUrl("/login?error=callback"), 303);
  }
}
