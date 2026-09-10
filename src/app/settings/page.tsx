import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { listConnections } from "@/lib/calendar/service";
import { fetchPublicProfiles } from "@/lib/atproto/identity";
import { providerEnabled, env } from "@/lib/env";
import { saveProfile, addBlock, removeBlock, disconnectProvider, deleteMyAccount } from "@/app/actions/profile";
import { Field, Notice, PageHeader, TimezoneSelect } from "@/components/ui";
import { ExportButton } from "./export-button";

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; connected?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  const { saved, error, connected } = await searchParams;
  const connections = await listConnections(user.did);
  const zoom = connections.find((c) => c.provider === "zoom");
  const blocks = await db.query.blocks.findMany({ where: eq(schema.blocks.userDid, user.did) });
  const blockedProfiles = await fetchPublicProfiles(blocks.map((b) => b.blockedDid));

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description={`Signed in as @${user.handle} (${user.did})`} />
      {saved ? <Notice kind="success">Saved.</Notice> : null}
      {connected === "zoom" ? <Notice kind="success">Zoom connected.</Notice> : null}
      {error ? <Notice kind="error">{error}</Notice> : null}

      <form action={saveProfile} className="card space-y-4">
        <h2 className="font-medium">Profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" hint="Required for calendar invitations and reminders. Never published.">
            <input name="email" type="email" className="input" defaultValue={user.email ?? ""} required />
          </Field>
          <Field label="Time zone">
            <TimezoneSelect name="timezone" defaultValue={user.timezone} />
          </Field>
          <Field label="Display name" hint="Defaults to your Atmosphere profile name.">
            <input name="displayName" className="input" defaultValue={user.displayName ?? ""} />
          </Field>
          <Field label="Bio (public booking page)">
            <input name="bio" className="input" defaultValue={user.bio ?? ""} maxLength={500} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="publicProfile" defaultChecked={user.publicProfile} className="mt-1" />
          <span>
            Public booking profile at <code>/@{user.handle}</code>. This also writes a <code>rsvp.imta.profile</code> record to your Atmosphere
            repository so other apps can find your booking page. Only public event types are listed.
          </span>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notifyEmail" defaultChecked={user.notifyEmail} /> Email notifications
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notifyDm" defaultChecked={user.notifyDm} /> Bluesky direct messages from organizers
          </label>
        </div>
        <button className="btn-primary">Save</button>
      </form>

      <section className="card space-y-3">
        <h2 className="font-medium">Video conferencing</h2>
        <p className="text-sm text-muted">
          Google Meet links are created automatically when Google Calendar is connected. Connect Zoom to use it instead. Without either, a Jitsi
          link is generated for every video meeting.
        </p>
        {zoom ? (
          <form action={disconnectProvider} className="flex items-center justify-between text-sm">
            <span>Zoom connected as {zoom.accountEmail ?? zoom.accountId}</span>
            <input type="hidden" name="id" value={zoom.id} />
            <button className="btn-danger">Disconnect</button>
          </form>
        ) : providerEnabled.zoom() ? (
          <a href="/api/video/zoom/connect" className="btn-secondary">Connect Zoom</a>
        ) : (
          <p className="text-xs text-muted">Zoom is not configured on this server.</p>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Blocked accounts</h2>
        <p className="text-sm text-muted">Blocked accounts cannot book any of your event types.</p>
        <ul className="space-y-1 text-sm">
          {blocks.map((b) => (
            <li key={b.blockedDid} className="flex items-center justify-between">
              <span>@{blockedProfiles.get(b.blockedDid)?.handle ?? b.blockedDid}</span>
              <form action={removeBlock}>
                <input type="hidden" name="did" value={b.blockedDid} />
                <button className="text-xs underline">Unblock</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addBlock} className="flex gap-2">
          <input name="handle" className="input" placeholder="username.bsky.social" />
          <button className="btn-secondary">Block</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Your data</h2>
        <p className="text-sm text-muted">
          Download everything {env().APP_NAME} stores about you as JSON, or delete your account. Deletion cancels your upcoming meetings, removes
          calendar events we created, revokes provider access, deletes records we published to your repository, and erases your data here.
        </p>
        <ExportButton />
        <form action={deleteMyAccount} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <Field label={`Type your handle (${user.handle}) to delete your account`}>
            <input name="confirm" className="input" autoComplete="off" />
          </Field>
          <button className="btn-danger">Delete my account</button>
        </form>
      </section>
      <form action="/api/auth/logout" method="post">
        <button className="btn-secondary">Sign out</button>
      </form>
    </div>
  );
}
