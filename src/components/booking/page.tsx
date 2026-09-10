import Link from "next/link";
import type { EventType, Team, User } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/session";
import { eventTypeHosts } from "@/lib/bookings/service";
import { getUsersByDids, displayName } from "@/lib/users/service";
import { humanMinutes } from "@/lib/bookings/service";
import { Avatar, TIMEZONES } from "@/components/ui";
import { SlotPicker } from "./slot-picker";
import { env } from "@/lib/env";

/** Shared server component for personal and team booking pages. */
export async function BookingPage({ eventType, ownerUser, team, access, currentPath, linkKey }: { eventType: EventType; ownerUser: User | null; team: Team | null; access: "ok" | "login" | "invite" | "link" | "closed"; currentPath: string; linkKey?: string | null }) {
  const viewer = await getCurrentUser();
  const hosts = await eventTypeHosts(eventType.id);
  const hostUsers = await getUsersByDids(hosts.map((h) => h.userDid));
  const hostList = hosts.map((h) => hostUsers.get(h.userDid)).filter((u): u is User => Boolean(u));
  const loginUrl = `/login?next=${encodeURIComponent(currentPath)}`;
  const showHosts = eventType.assignmentMode === "collective";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="flex -space-x-2">
          {(showHosts ? hostList : team ? [] : hostList).slice(0, 5).map((h) => (
            <Avatar key={h.did} user={h} size={44} />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">{team ? team.name : ownerUser ? `${displayName(ownerUser)} · @${ownerUser.handle}` : ""}</p>
          <h1 className="text-2xl font-semibold" style={{ color: eventType.color }}>{eventType.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {eventType.durationMinutes} min · {eventType.locationKind === "video" ? "video call" : eventType.locationKind === "phone" ? "phone" : eventType.locationText || "in person"}
            {eventType.capacity > 1 ? ` · group session, ${eventType.capacity} seats` : ""}
            {team && !showHosts ? ` · with ${eventType.assignmentMode === "anyone" ? "one of" : `${eventType.thresholdCount} of`} the ${team.name} team` : ""}
          </p>
          {showHosts && hostList.length > 1 ? <p className="mt-1 text-xs text-muted">With {hostList.map((h) => displayName(h)).join(", ")}</p> : null}
          {eventType.description ? <p className="mt-3 whitespace-pre-wrap text-sm">{eventType.description}</p> : null}
          {eventType.cancellationNoticeMinutes ? <p className="mt-2 text-xs text-muted">Cancellations up to {humanMinutes(eventType.cancellationNoticeMinutes)} before the start.</p> : null}
        </div>
      </div>

      {access === "closed" ? <div className="card text-center text-sm text-muted">This event is not open for bookings.</div> : null}
      {access === "link" ? <div className="card text-center text-sm text-muted">This event can only be booked through its private link.</div> : null}
      {access === "login" ? (
        <div className="card text-center">
          <p className="text-sm">This event is by invitation. Sign in to check whether you were invited.</p>
          <Link href={loginUrl} className="btn-primary mt-3">Sign in</Link>
          <p className="mt-2 text-xs text-muted">No account? <a className="underline" href={env().ATPROTO_SIGNUP_URL}>Create one on Eurosky</a>.</p>
        </div>
      ) : null}
      {access === "invite" ? <div className="card text-center text-sm text-muted">Your account (@{viewer?.handle}) is not on the invitation list for this event.</div> : null}
      {access === "ok" ? (
        <SlotPicker
          eventTypeId={eventType.id}
          durationMinutes={eventType.durationMinutes}
          bookingWindowDays={eventType.bookingWindowDays}
          capacity={eventType.capacity}
          questions={eventType.questions}
          linkKey={linkKey}
          timezones={TIMEZONES}
          viewer={viewer ? { name: viewer.displayName ?? viewer.handle, email: viewer.email ?? "", timezone: viewer.timezone } : null}
          loginUrl={loginUrl}
        />
      ) : null}
      {!viewer && access === "ok" ? (
        <p className="mt-3 text-center text-xs text-muted">No account? <a className="underline" href={env().ATPROTO_SIGNUP_URL}>Create one on Eurosky</a>.</p>
      ) : null}
    </div>
  );
}
