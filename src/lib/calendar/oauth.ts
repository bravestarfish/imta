import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { env, appUrl } from "@/lib/env";
import type { ProviderKind, ProviderConnection } from "@/db/schema";

/**
 * Minimal OAuth 2.0 authorization-code client for the calendar / video
 * providers. Tokens are stored encrypted at rest.
 */
export type ProviderConfig = {
  authUrl: string;
  tokenUrl: string;
  clientId: () => string;
  clientSecret: () => string;
  scopes: string[];
  extraAuthParams?: Record<string, string>;
  redirectPath: string;
};

export const PROVIDERS: Record<ProviderKind, ProviderConfig> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientId: () => env().GOOGLE_CLIENT_ID ?? "",
    clientSecret: () => env().GOOGLE_CLIENT_SECRET ?? "",
    scopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "openid",
      "email",
    ],
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    redirectPath: "/api/calendar/google/callback",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    clientId: () => env().MICROSOFT_CLIENT_ID ?? "",
    clientSecret: () => env().MICROSOFT_CLIENT_SECRET ?? "",
    scopes: ["offline_access", "User.Read", "Calendars.ReadWrite", "OnlineMeetings.ReadWrite"],
    extraAuthParams: { prompt: "select_account" },
    redirectPath: "/api/calendar/microsoft/callback",
  },
  zoom: {
    authUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    clientId: () => env().ZOOM_CLIENT_ID ?? "",
    clientSecret: () => env().ZOOM_CLIENT_SECRET ?? "",
    scopes: ["meeting:write:meeting", "meeting:delete:meeting", "user:read:user"],
    redirectPath: "/api/video/zoom/callback",
  },
};

export function authorizationUrl(provider: ProviderKind, state: string): string {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: cfg.clientId(),
    redirect_uri: appUrl(cfg.redirectPath),
    response_type: "code",
    scope: cfg.scopes.join(" "),
    state,
    ...(cfg.extraAuthParams ?? {}),
  });
  return `${cfg.authUrl}?${params}`;
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
};

async function tokenRequest(provider: ProviderKind, body: Record<string, string>): Promise<TokenResponse> {
  const cfg = PROVIDERS[provider];
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  const form = new URLSearchParams(body);
  if (provider === "zoom") {
    headers.authorization = `Basic ${Buffer.from(`${cfg.clientId()}:${cfg.clientSecret()}`).toString("base64")}`;
  } else {
    form.set("client_id", cfg.clientId());
    form.set("client_secret", cfg.clientSecret());
  }
  const res = await fetch(cfg.tokenUrl, { method: "POST", headers, body: form });
  if (!res.ok) {
    throw new Error(`${provider} token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(provider: ProviderKind, code: string): Promise<TokenResponse> {
  return tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: appUrl(PROVIDERS[provider].redirectPath),
  });
}

export function refreshToken(provider: ProviderKind, refresh: string): Promise<TokenResponse> {
  return tokenRequest(provider, { grant_type: "refresh_token", refresh_token: refresh });
}

/** Returns a valid access token for the connection, refreshing it when it is about to expire. */
export async function accessTokenFor(conn: ProviderConnection): Promise<string> {
  const soon = Date.now() + 60_000;
  if (!conn.expiresAt || conn.expiresAt.getTime() > soon) return decrypt(conn.accessTokenEnc);
  if (!conn.refreshTokenEnc) throw new Error("connection expired and has no refresh token");
  const t = await refreshToken(conn.provider, decrypt(conn.refreshTokenEnc));
  const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null;
  await db
    .update(schema.providerConnections)
    .set({
      accessTokenEnc: encrypt(t.access_token),
      refreshTokenEnc: t.refresh_token ? encrypt(t.refresh_token) : conn.refreshTokenEnc,
      expiresAt,
      lastError: null,
    })
    .where(eq(schema.providerConnections.id, conn.id));
  return t.access_token;
}

export async function markConnectionError(id: string, error: string) {
  await db.update(schema.providerConnections).set({ lastError: error.slice(0, 500) }).where(eq(schema.providerConnections.id, id));
}

/** Authenticated JSON fetch against a provider API. Throws on non-2xx. */
export async function providerFetch<T = unknown>(
  conn: ProviderConnection,
  url: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<{ status: number; data: T; headers: Headers }> {
  const token = await accessTokenFor(conn);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(url, { ...init, headers, body });
  if (res.status === 204 || res.status === 404 && init.method === "DELETE") {
    return { status: res.status, data: undefined as T, headers: res.headers };
  }
  const text = await res.text();
  if (!res.ok) throw new ProviderError(conn.provider, res.status, text.slice(0, 500));
  return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
}

export class ProviderError extends Error {
  constructor(
    public provider: ProviderKind,
    public status: number,
    body: string,
  ) {
    super(`${provider} API ${status}: ${body}`);
    this.name = "ProviderError";
  }
}
