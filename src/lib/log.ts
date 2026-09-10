import { env } from "./env";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function enabled(level: Level): boolean {
  let min: Level = "info";
  try {
    min = env().LOG_LEVEL;
  } catch {
    /* env not loaded yet */
  }
  return order[level] >= order[min];
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (!enabled(level)) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
