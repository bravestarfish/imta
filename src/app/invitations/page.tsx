import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { myInvitations } from "@/lib/event-types/invitations";
import { bookingPageUrl } from "@/lib/bookings/context";
import { displayName } from "@/lib/users/service";
import { respondInvitationAction } from "@/app/actions/event-types";
import { Badge, Empty, PageHeader } from "@/components/ui";

export default async function Invitations() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/invitations");
  const rows = await myInvitations(user.did);
  return (
    <div>
      <PageHeader title="Invitations" description="Event types you were invited to book. Only invited accounts can see them." />
      {!rows.length ? <Empty>No invitations.</Empty> : null}
      <ul className="space-y-2">
        {rows.map(({ inv, et, owner, team, inviter }) => (
          <li key={inv.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">{et.title} <Badge>{inv.status}</Badge></div>
              <div className="text-sm text-muted">
                from {inviter ? `${displayName(inviter)} (@${inviter.handle})` : "an organizer"} {team ? `· team ${team.name}` : ""} · {et.durationMinutes} min
              </div>
              {inv.message ? <p className="mt-1 text-sm">“{inv.message}”</p> : null}
            </div>
            <div className="flex gap-2">
              {et.status === "published" ? <Link href={bookingPageUrl(et, owner?.handle ?? null, team?.slug ?? null)} className="btn-primary">Pick a time</Link> : <Badge tone="warn">not open yet</Badge>}
              {inv.status === "pending" ? (
                <form action={respondInvitationAction}>
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <button className="btn-secondary" name="status" value="declined">Decline</button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
