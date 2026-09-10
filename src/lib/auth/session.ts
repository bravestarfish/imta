import { cookies, headers } from "next/headers";
import { eq, and, gt, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken } from "@/lib/crypto";
import type { User } from "@/db/schema";
import { cache } from "react";

export const SESSION_COOKIE = "imta_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export async function createSession(userDid: string): Promise<string> {
  const id = randomToken(32);
  const h = await headers();
  await db.insert(schema.appSessions).values({
    id,
    userDid,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
  });
  return id;
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}

/** Returns the current user (or null). Memoised per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const rows = await db
    .select({ user: schema.users })
    .from(schema.appSessions)
    .innerJoin(schema.users, eq(schema.users.did, schema.appSessions.userDid))
    .where(and(eq(schema.appSessions.id, id), gt(schema.appSessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthorizedError";
  }
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await db.delete(schema.appSessions).where(eq(schema.appSessions.id, id));
  store.delete(SESSION_COOKIE);
}

export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(schema.appSessions).where(lt(schema.appSessions.expiresAt, new Date()));
  await db
    .delete(schema.atprotoOauthStates)
    .where(lt(schema.atprotoOauthStates.createdAt, new Date(Date.now() - 1000 * 60 * 60)));
}
