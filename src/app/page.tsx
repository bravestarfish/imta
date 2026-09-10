import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

export default async function Home() {
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/dashboard");
  const signup = env().ATPROTO_SIGNUP_URL;
  return (
    <div className="mx-auto max-w-3xl py-10">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Scheduling for the open social web.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Sign in with your ATProto account, share when you are free, and let people book you, alone or together with your team. Your
        calendar stays private; only what you choose to publish goes to your account.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/login" className="btn-primary px-5 py-3 text-base">Sign in with ATProto</Link>
        <a href={signup} className="btn-secondary px-5 py-3 text-base" target="_blank" rel="noreferrer">
          Create an account on Eurosky
        </a>
      </div>
      <div className="mt-14 grid gap-6 sm:grid-cols-3">
        {[
          ["Team availability", "Each organizer sets their own hours. Offer times where everyone is free, where any one of you is free, or where at least N of you are."],
          ["Private by design", "Free/busy from Google Calendar and Microsoft 365 is read, never titles. Bookings and invitations live only in this app's database."],
          ["Native to ATProto", "Invite people by their handle, notify them with a Bluesky DM, and publish public event types and sessions to your own repository."],
        ].map(([title, body]) => (
          <div key={title} className="card">
            <h2 className="font-medium">{title}</h2>
            <p className="mt-2 text-sm text-muted">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
