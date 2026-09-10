import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { completeOnboarding } from "@/app/actions/profile";
import { Field, Notice, TimezoneSelect } from "@/components/ui";

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const user = await getCurrentUser();
  const { next, error } = await searchParams;
  if (!user) redirect("/login");
  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-2xl font-semibold">Welcome, @{user.handle}</h1>
      <p className="mt-2 text-sm text-muted">
        Two things before you start. Your email is needed for calendar invitations and reminders; it is never published.
      </p>
      <form action={completeOnboarding} className="card mt-6 space-y-4">
        {error ? <Notice kind="error">Please enter a valid email address.</Notice> : null}
        <Field label="Email">
          <input name="email" type="email" className="input" defaultValue={user.email ?? ""} required autoFocus />
        </Field>
        <Field label="Time zone" hint="Used for your working hours and to display times.">
          <TimezoneSelect name="timezone" defaultValue={user.timezone !== "UTC" ? user.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone} />
        </Field>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <button className="btn-primary w-full">Continue</button>
      </form>
    </div>
  );
}
