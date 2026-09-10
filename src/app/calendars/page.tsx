import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listConnections } from "@/lib/calendar/service";
import { calendarProvider, CALENDAR_PROVIDERS, type CalendarInfo } from "@/lib/calendar";
import { providerEnabled } from "@/lib/env";
import { updateConnection, resyncConnection, disconnect } from "@/app/actions/calendars";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/email/format";

const names = { google: "Google Calendar", microsoft: "Microsoft 365 / Outlook", zoom: "Zoom" } as const;

export default async function Calendars({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/calendars");
  const { connected, error } = await searchParams;
  const connections = (await listConnections(user.did)).filter((c) => CALENDAR_PROVIDERS.includes(c.provider));

  const calendarsByConn = new Map<string, CalendarInfo[]>();
  for (const c of connections) {
    try {
      calendarsByConn.set(c.id, await calendarProvider(c.provider).listCalendars(c));
    } catch {
      calendarsByConn.set(c.id, []);
    }
  }

  return (
    <div>
      <PageHeader
        title="Calendars"
        description="Connected calendars keep your busy times out of your availability and receive the meetings you book. Only free/busy is read."
      />
      {connected ? <Notice kind="success">{names[connected as keyof typeof names] ?? connected} connected. A first sync is running.</Notice> : null}
      {error ? <Notice kind="error">Could not connect ({error}). Try again.</Notice> : null}
      <div className="mb-6 flex flex-wrap gap-2">
        {providerEnabled.google() ? <a className="btn-secondary" href="/api/calendar/google/connect">Connect Google Calendar</a> : null}
        {providerEnabled.microsoft() ? <a className="btn-secondary" href="/api/calendar/microsoft/connect">Connect Microsoft 365</a> : null}
        {!providerEnabled.google() && !providerEnabled.microsoft() ? <p className="text-sm text-muted">No calendar providers are configured on this server.</p> : null}
      </div>
      {!connections.length ? <Empty>No calendars connected.</Empty> : null}
      <div className="space-y-4">
        {connections.map((c) => {
          const cals = calendarsByConn.get(c.id) ?? [];
          return (
            <form key={c.id} action={updateConnection} className="card space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{names[c.provider]}</span> <span className="text-sm text-muted">{c.accountEmail}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  {c.lastError ? <Badge tone="danger">error</Badge> : c.lastSyncedAt ? <span>synced {fmtDateTime(c.lastSyncedAt, user.timezone)}</span> : <Badge tone="warn">not synced yet</Badge>}
                  {c.watchExpiresAt && c.watchExpiresAt > new Date() ? <Badge tone="ok">push updates</Badge> : null}
                </div>
              </div>
              {c.lastError ? <p className="text-xs text-red-600">{c.lastError}</p> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <fieldset>
                  <legend className="label">Check for busy times</legend>
                  {cals.length ? (
                    cals.map((cal) => (
                      <label key={cal.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="busy" value={cal.id} defaultChecked={c.busyCalendarIds.includes(cal.id)} /> {cal.name}
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-muted">Could not list calendars right now.</p>
                  )}
                </fieldset>
                <div className="space-y-3">
                  <label className="block">
                    <span className="label">Add bookings to</span>
                    <select name="writeCalendarId" className="input" defaultValue={c.writeCalendarId ?? ""}>
                      {cals.filter((x) => x.canWrite).map((cal) => (
                        <option key={cal.id} value={cal.id}>{cal.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="isWriteTarget" defaultChecked={c.isWriteTarget} /> Use this calendar for new bookings
                  </label>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary">Save</button>
                <button className="btn-secondary" formAction={resyncConnection}>Full resync</button>
                <button className="btn-danger" formAction={disconnect}>Disconnect</button>
              </div>
            </form>
          );
        })}
      </div>
    </div>
  );
}
