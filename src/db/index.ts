import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { env } from "@/lib/env";

declare global {
  var __imtaSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  return postgres(env().DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    prepare: false,
  });
}

// Reuse the connection pool across hot reloads in development.
const sql = globalThis.__imtaSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalThis.__imtaSql = sql;

export const db = drizzle(sql, { schema });
/** Raw postgres.js client, for advisory locks and reserved connections. */
export const rawSql = sql;
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
