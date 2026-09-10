import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listEventTypesFor } from "@/lib/event-types/service";
import { myTeams } from "@/lib/teams/service";
import { bookingPageUrl } from "@/lib/bookings/context";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

export default async function EventTypes() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/event-types");
  const { personal, team } = await listEventTypesFor(user.did);
  const teams = await myTeams(user.did);
  return (
    <div>
      <PageHeader
        title="Event types"
        description="Each event type has its own booking link and rules: duration, buffers, notice, who hosts, and who can see it."
        actions={
          <div className="flex gap-2">
            <Link href="/event-types/new" className="btn-primary">New personal</Link>
            {teams.map((t) => (
              <Link key={t.id} href={`/event-types/new?team=${t.id}`} className="btn-secondary">New for {t.name}</Link>
            ))}
          </div>
        }
      />
      <section className="mb-8">
        <h2 className="mb-3 font-medium">Personal</h2>
        {!personal.length ? <Empty>No personal event types yet.</Empty> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {personal.map((e) => {
            const url = bookingPageUrl(e, user.handle, null);
            return (
              <li key={e.id} className="card" style={{ borderLeftColor: e.color, borderLeftWidth: 4 }}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/event-types/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                  <Badge tone={e.status === "published" ? "ok" : e.status === "draft" ? "warn" : "neutral"}>{e.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{e.durationMinutes} min · {e.visibility === "public" ? "public" : e.visibility === "link" ? "anyone with the link" : "invitation only"}{e.capacity > 1 ? ` · ${e.capacity} seats` : ""}</p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <code className="truncate text-muted">{url}</code>
                  <CopyButton text={url} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 font-medium">Team</h2>
        {!team.length ? <Empty>No team event types. Create a team first, then add a shared event type.</Empty> : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {team.map((e) => {
            const url = bookingPageUrl(e, null, e.teamSlug);
            return (
              <li key={e.id} className="card" style={{ borderLeftColor: e.color, borderLeftWidth: 4 }}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/event-types/${e.id}`} className="font-medium hover:underline">{e.title}</Link>
                  <Badge tone={e.status === "published" ? "ok" : e.status === "draft" ? "warn" : "neutral"}>{e.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted">{e.teamName} · {e.durationMinutes} min · {e.assignmentMode === "collective" ? "all hosts" : e.assignmentMode === "anyone" ? "any host" : `${e.thresholdCount}+ hosts`}</p>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <code className="truncate text-muted">{url}</code>
                  <CopyButton text={url} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
