import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { authorizationUrl } from "@/lib/calendar/oauth";
import { completeConnection } from "@/lib/calendar/service";
import { appUrl, providerEnabled } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { log, errMessage } from "@/lib/log";
import { enqueue } from "@/lib/jobs/queue";
import type { ProviderKind } from "@/db/schema";

export const PROVIDER_STATE_COOKIE = "imta_provider_state";

export function isProvider(p: string): p is ProviderKind {
  return p === "google" || p === "microsoft" || p === "zoom";
}

function backPath(provider: ProviderKind): string {
  return provider === "zoom" ? "/settings" : "/calendars";
}

/** Step 1: redirect the signed-in user to the provider's consent screen. */
export async function startConnect(provider: string): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl(`/login?next=/calendars`), 303);
  if (!isProvider(provider) || !providerEnabled[provider]()) {
    return NextResponse.redirect(appUrl(`/calendars?error=provider`), 303);
  }
  const state = randomToken(16);
  const store = await cookies();
  store.set(PROVIDER_STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https"),
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authorizationUrl(provider, state), 303);
}

/** Step 2: exchange the code, store the (encrypted) tokens, kick off a sync. */
export async function finishConnect(req: NextRequest, provider: string): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl(`/login`), 303);
  if (!isProvider(provider)) return NextResponse.redirect(appUrl(`/calendars?error=provider`), 303);
  const back = backPath(provider);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const store = await cookies();
  const expected = store.get(PROVIDER_STATE_COOKIE)?.value;
  store.delete(PROVIDER_STATE_COOKIE);
  if (!code || !state || expected !== `${provider}:${state}`) {
    return NextResponse.redirect(appUrl(`${back}?error=state`), 303);
  }
  try {
    const conn = await completeConnection(user.did, provider, code);
    if (provider !== "zoom") {
      await enqueue("calendar.sync", { connectionId: conn.id }, { singletonKey: `sync:${conn.id}` });
    }
    return NextResponse.redirect(appUrl(`${back}?connected=${provider}`), 303);
  } catch (e) {
    log.warn("provider callback failed", { provider, error: errMessage(e) });
    return NextResponse.redirect(appUrl(`${back}?error=exchange`), 303);
  }
}
