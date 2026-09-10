import { z } from "zod";

/**
 * Runtime configuration. Everything is read lazily so that `next build` and
 * unit tests do not need a full environment.
 */
const schema = z.object({
  APP_URL: z.string().url().default("http://127.0.0.1:3000"),
  APP_NAME: z.string().default("imta"),
  DATABASE_URL: z
    .string()
    .default("postgres://imta:imta@localhost:5432/imta"),
  ENCRYPTION_KEY: z.string().optional(),

  ATPROTO_PRIVATE_KEY_1: z.string().optional(),
  ATPROTO_PRIVATE_KEY_2: z.string().optional(),
  ATPROTO_PRIVATE_KEY_3: z.string().optional(),
  ATPROTO_HANDLE_RESOLVER: z.string().url().default("https://bsky.social"),
  ATPROTO_SIGNUP_URL: z.string().url().default("https://eurosky.social"),

  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("imta <no-reply@imta.rsvp>"),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  JITSI_BASE_URL: z.string().url().default("https://meet.jit.si"),

  WEBHOOK_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid environment: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ")}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function appUrl(path = "/"): string {
  const base = env().APP_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isLoopbackApp(): boolean {
  const u = new URL(env().APP_URL);
  return (
    u.hostname === "127.0.0.1" ||
    u.hostname === "localhost" ||
    u.hostname === "[::1]"
  );
}

export const providerEnabled = {
  google: () => Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET),
  microsoft: () =>
    Boolean(env().MICROSOFT_CLIENT_ID && env().MICROSOFT_CLIENT_SECRET),
  zoom: () => Boolean(env().ZOOM_CLIENT_ID && env().ZOOM_CLIENT_SECRET),
  email: () => Boolean(env().SMTP_URL),
};
