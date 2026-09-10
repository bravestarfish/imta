import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { teamRole, teamMembersWithUsers } from "@/lib/teams/service";
import { listSchedules } from "@/lib/availability/service";
import { listInvitationsOf } from "@/lib/event-types/invitations";
import { bookingPageUrl } from "@/lib/bookings/context";
import { displayName } from "@/lib/users/service";
import { deleteEventTypeAction, duplicateEventTypeAction, inviteAction, revokeInvitationAction } from "@/app/actions/event-types";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { EventTypeForm, type HostOption } from "../form";

export default async function EditEventType({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; error?: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;
  const { tab, error } = await searchParams;
  if (!user) redirect(`/login?next=/event-types/${id}`);
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, id) });
  if (!et) notFound();
  const ownerId = et.ownerKind === "user" ? et.ownerDid! : et.teamId!;
  if (et.ownerKind === "user" ? ownerId !== user.did : !(await teamRole(ownerId, user.did))) notFound();
  const team = et.teamId ? await db.query.teams.findFirst({ where: eq(schema.teams.id, et.teamId) }) : null;
  const hostRows = await db.query.eventTypeHosts.findMany({ where: eq(schema.eventTypeHosts.eventTypeId, id) });

  let hosts: HostOption[];
  if (et.ownerKind === "team") {
    const members = await teamMembersWithUsers(ownerId);
    hosts = await Promise.all(members.map(async (m) => ({ did: m.did, label: `${displayName(m)} (@${m.handle})`, schedules: (await listSchedules(m.did)).map((s) => ({ id: s.id, name: s.name })) })));
  } else {
    hosts = [{ did: user.did, label: `${displayName(user)} (@${user.handle})`, schedules: (await listSchedules(user.did)).map((s) => ({ id: s.id, name: s.name })) }];
  }
  const invitations = await listInvitationsOf(id);
  const url = bookingPageUrl(et, et.ownerKind === "user" ? user.handle : null, team?.slug ?? null);

  return (
    <div>
      <PageHeader
        title={et.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={et.status === "published" ? "ok" : "warn"}>{et.status}</Badge>
            <code className="text-xs">{url}</code>
            <CopyButton text={url} />
            <Link href={url} className="text-xs underline" target="_blank">Preview</Link>
          </span>
        }
        actions={
          <>
            <form action={duplicateEventTypeAction}><input type="hidden" name="id" value={id} /><button className="btn-secondary">Duplicate</button></form>
            <form action={deleteEventTypeAction}><input type="hidden" name="id" value={id} /><button className="btn-danger">Delete</button></form>
          </>
        }
      />
      <div className="mb-6 flex gap-4 border-b border-border text-sm">
        <Link href={`/event-types/${id}`} className={`-mb-px border-b-2 px-1 py-2 ${tab !== "invitations" ? "border-accent" : "border-transparent text-muted"}`}>Settings</Link>
        <Link href={`/event-types/${id}?tab=invitations`} className={`-mb-px border-b-2 px-1 py-2 ${tab === "invitations" ? "border-accent" : "border-transparent text-muted"}`}>
          Invitations {invitations.length ? `(${invitations.length})` : ""}
        </Link>
      </div>
      {tab === "invitations" ? (
        <div className="space-y-4">
          {error ? <Notice kind="error">{error}</Notice> : null}
          {et.visibility !== "invite" ? (
            <Notice>This event type is currently {et.visibility === "public" ? "public" : "available to anyone with the link"}. Set visibility to “Invitation only” in Settings to restrict it to the accounts below.</Notice>
          ) : null}
          <form action={inviteAction} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="eventTypeId" value={id} />
            <input name="handle" className="input" placeholder="username.bsky.social or did:plc:…" required />
            <input name="message" className="input" placeholder="Optional message" maxLength={300} />
            <button className="btn-primary">Invite</button>
            <p className="text-xs text-muted sm:col-span-3">Invitees get an email (if they have used imta) and a Bluesky DM from you, when their settings allow it.</p>
          </form>
          <ul className="space-y-2">
            {invitations.map((inv) => (
              <li key={inv.id} className="card flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <span className="font-medium">@{inv.inviteeHandle ?? inv.inviteeDid}</span>{" "}
                  <Badge tone={inv.status === "accepted" ? "ok" : inv.status === "declined" ? "danger" : "neutral"}>{inv.status}</Badge>
                  <div className="text-xs text-muted">
                    {inv.notifiedDmAt ? "DM sent" : "DM not delivered"} · {inv.notifiedEmailAt ? "email sent" : "no email"}
                  </div>
                </div>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="eventTypeId" value={id} />
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <button className="text-xs underline">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <EventTypeForm
          id={id}
          ownerKind={et.ownerKind}
          ownerId={ownerId}
          hosts={hosts}
          initial={{
            ...et,
            description: et.description ?? "",
            locationText: et.locationText ?? "",
            hosts: hostRows.map((h) => ({ did: h.userDid, scheduleId: h.scheduleId, required: h.required })),
          }}
        />
      )}
    </div>
  );
}
