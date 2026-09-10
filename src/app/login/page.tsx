import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { Notice } from "@/components/ui";

const errors: Record<string, string> = {
  missing: "Enter your handle to continue.",
  resolve: "We could not find that handle. Check the spelling, e.g. name.bsky.social or name.eurosky.social.",
  callback: "Sign-in was not completed. Try again.",
  ratelimited: "Too many attempts. Wait a few minutes and try again.",
  config: "Sign-in is not working right now because of a server-side configuration problem. The operator has been notified in the logs.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  const { error, next } = await searchParams;
  if (user) redirect(next && next.startsWith("/") ? next : "/dashboard");
  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-muted">Use any ATProto account: Bluesky, Eurosky, or your own PDS.</p>
      <form method="post" action="/api/auth/login" className="card mt-6 space-y-4">
        {error ? <Notice kind="error">{errors[error] ?? "Something went wrong."}</Notice> : null}
        <label className="block">
          <span className="label">Your handle</span>
          <input name="handle" className="input" placeholder="you.eurosky.social" autoComplete="username" autoFocus required />
        </label>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <button className="btn-primary w-full" type="submit">Continue</button>
        <p className="text-center text-xs text-muted">
          No account yet?{" "}
          <a className="underline" href={env().ATPROTO_SIGNUP_URL} target="_blank" rel="noreferrer">
            Create one on Eurosky
          </a>
        </p>
      </form>
    </div>
  );
}
