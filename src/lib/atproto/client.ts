import {
  NodeOAuthClient,
  JoseKey,
  type NodeSavedSession,
  type NodeSavedState,
} from "@atproto/oauth-client-node";
import { eq } from "drizzle-orm";
import type { RuntimeLock } from "@atproto/oauth-client-node";
import { db, schema, rawSql } from "@/db";
import { env, appUrl, isLoopbackApp } from "@/lib/env";
import { log } from "@/lib/log";

/**
 * Scopes:
 *  - atproto: identity
 *  - transition:generic: read/write records (rsvp.imta.* and
 *    community.lexicon.calendar.event) plus app.bsky reads for the social graph
 *  - transition:chat.bsky: send Bluesky DMs (invitations, confirmations)
 */
export const ATPROTO_SCOPE = "atproto transition:generic transition:chat.bsky";

const stateStore = {
  async set(key: string, data: NodeSavedState) {
    await db
      .insert(schema.atprotoOauthStates)
      .values({ key, data })
      .onConflictDoUpdate({ target: schema.atprotoOauthStates.key, set: { data } });
  },
  async get(key: string) {
    const row = await db.query.atprotoOauthStates.findFirst({
      where: eq(schema.atprotoOauthStates.key, key),
    });
    return (row?.data as NodeSavedState | undefined) ?? undefined;
  },
  async del(key: string) {
    await db.delete(schema.atprotoOauthStates).where(eq(schema.atprotoOauthStates.key, key));
  },
};

const sessionStore = {
  async set(sub: string, data: NodeSavedSession) {
    await db
      .insert(schema.atprotoOauthSessions)
      .values({ did: sub, data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.atprotoOauthSessions.did,
        set: { data, updatedAt: new Date() },
      });
  },
  async get(sub: string) {
    const row = await db.query.atprotoOauthSessions.findFirst({
      where: eq(schema.atprotoOauthSessions.did, sub),
    });
    return (row?.data as NodeSavedSession | undefined) ?? undefined;
  },
  async del(sub: string) {
    await db.delete(schema.atprotoOauthSessions).where(eq(schema.atprotoOauthSessions.did, sub));
  },
};

/**
 * Serialises token refreshes per DID across web and worker processes using a
 * Postgres advisory lock on a dedicated connection.
 */
const requestLock: RuntimeLock = async (key, fn) => {
  const conn = await rawSql.reserve();
  try {
    await conn`select pg_advisory_lock(hashtext(${`atproto-oauth:${key}`}))`;
    try {
      return await fn();
    } finally {
      await conn`select pg_advisory_unlock(hashtext(${`atproto-oauth:${key}`}))`;
    }
  } finally {
    conn.release();
  }
};

declare global {
  var __imtaOauthClient: Promise<NodeOAuthClient> | undefined;
}

async function build(): Promise<NodeOAuthClient> {
  const e = env();
  const redirectUri = appUrl("/api/auth/callback");

  if (isLoopbackApp()) {
    // Development: loopback client, no keys required.
    const clientId = `http://localhost?${new URLSearchParams({
      redirect_uri: redirectUri,
      scope: ATPROTO_SCOPE,
    })}`;
    log.info("atproto oauth: using loopback client", { clientId });
    return new NodeOAuthClient({
      clientMetadata: {
        client_id: clientId,
        client_name: e.APP_NAME,
        redirect_uris: [redirectUri],
        scope: ATPROTO_SCOPE,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "web",
        token_endpoint_auth_method: "none",
        dpop_bound_access_tokens: true,
      },
      handleResolver: e.ATPROTO_HANDLE_RESOLVER,
      stateStore,
      sessionStore,
      requestLock,
      allowHttp: true,
    });
  }

  const keys = await Promise.all(
    [e.ATPROTO_PRIVATE_KEY_1, e.ATPROTO_PRIVATE_KEY_2, e.ATPROTO_PRIVATE_KEY_3]
      .filter((k): k is string => Boolean(k))
      // Keys from `pnpm keygen` carry their own kid; passing another one is rejected.
      .map((k) => JoseKey.fromImportable(k)),
  );
  if (keys.length === 0) {
    throw new Error("ATPROTO_PRIVATE_KEY_1 is required (run `pnpm keygen`)");
  }

  return new NodeOAuthClient({
    clientMetadata: {
      client_id: appUrl("/oauth-client-metadata.json"),
      client_name: e.APP_NAME,
      client_uri: appUrl("/"),
      tos_uri: appUrl("/terms"),
      policy_uri: appUrl("/privacy"),
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      scope: ATPROTO_SCOPE,
      response_types: ["code"],
      application_type: "web",
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      dpop_bound_access_tokens: true,
      jwks_uri: appUrl("/oauth/jwks.json"),
    },
    keyset: keys,
    handleResolver: e.ATPROTO_HANDLE_RESOLVER,
    stateStore,
    sessionStore,
    requestLock,
  });
}

export function getOAuthClient(): Promise<NodeOAuthClient> {
  if (!globalThis.__imtaOauthClient) globalThis.__imtaOauthClient = build();
  return globalThis.__imtaOauthClient;
}
