import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { buildIcs } from "@/lib/email/ics";
import { fmtRange } from "@/lib/email/format";
import { env } from "@/lib/env";
import { notifyEmail, notifyDm } from "@/lib/notifications";
import { displayName } from "@/lib/users/service";
import { loadBookingContext, manageUrl, meetingLocation, meetingTitle, type MeetingContext } from "./context";
import type { Booking, User } from "@/db/schema";
import { appUrl } from "@/lib/env";

type Kind = "confirmed" | "cancelled" | "rescheduled" | "reminder" | "host_new" | "host_cancelled" | "pending";

function organizerAddress(): { name: string; email: string } {
  const from = env().EMAIL_FROM;
  const m = from.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  return { name: (m?.[1] || env().APP_NAME).trim(), email: (m?.[2] || from).trim() };
}

function icsFor(ctx: MeetingContext, booking: Booking, method: "REQUEST" | "CANCEL", forHost: User | null) {
  const attendees = forHost
    ? ctx.bookings.filter((b) => b.status === "confirmed").map((b) => ({ name: b.attendeeName, email: b.attendeeEmail }))
    : [{ name: booking.attendeeName, email: booking.attendeeEmail }];
  return buildIcs({
    uid: forHost ? ctx.meeting.icsUid : `${ctx.meeting.icsUid}-${booking.id}`,
    sequence: ctx.meeting.icsSequence,
    start: ctx.meeting.startAt,
    end: ctx.meeting.endAt,
    summary: meetingTitle(ctx, booking.attendeeName),
    description: descriptionFor(ctx, booking),
    location: meetingLocation(ctx),
    url: ctx.meeting.videoUrl ?? undefined,
    organizer: organizerAddress(),
    attendees: [...attendees, ...ctx.hosts.filter((h) => h.email).map((h) => ({ name: displayName(h), email: h.email as string }))],
    method,
    createdAt: ctx.meeting.createdAt,
  });
}

function descriptionFor(ctx: MeetingContext, booking: Booking): string {
  const lines = [ctx.eventType.description?.trim() ?? "", ""];
  if (ctx.meeting.videoUrl) lines.push(`Join: ${ctx.meeting.videoUrl}`);
  const loc = meetingLocation(ctx);
  if (loc && loc !== ctx.meeting.videoUrl) lines.push(`Where: ${loc}`);
  lines.push(`Hosts: ${ctx.hosts.map((h) => `${displayName(h)} (@${h.handle})`).join(", ")}`);
  lines.push(`Manage your booking: ${manageUrl(booking)}`);
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim();
}

/** Attendee facing notification for a booking. */
export async function notifyBooking(bookingId: string, kind: Kind): Promise<void> {
  const ctx = await loadBookingContext(bookingId);
  if (!ctx) return;
  const { booking } = ctx;
  const when = fmtRange(ctx.meeting.startAt, ctx.meeting.endAt, booking.timezone);
  const title = meetingTitle(ctx, booking.attendeeName);
  const hostsText = ctx.hosts.map((h) => `${displayName(h)} (@${h.handle})`).join(", ");

  if (kind === "host_new" || kind === "host_cancelled") {
    for (const host of ctx.hosts) {
      if (!host.email || !host.notifyEmail) continue;
      const hostWhen = fmtRange(ctx.meeting.startAt, ctx.meeting.endAt, host.timezone);
      const isNew = kind === "host_new";
      const answers = Object.entries(booking.answers)
        .map(([k, v]) => `${ctx.eventType.questions.find((q) => q.id === k)?.label ?? k}: ${String(v)}`)
        .join("\n");
      await notifyEmail(
        kind,
        booking.id,
        {
          to: { email: host.email, name: displayName(host) },
          subject: isNew ? `${booking.status === "pending" ? "Booking request" : "New booking"}: ${booking.attendeeName}, ${hostWhen}` : `Cancelled: ${booking.attendeeName}, ${hostWhen}`,
          text: [
            isNew
              ? `${booking.attendeeName} (@${booking.attendeeHandle ?? booking.attendeeDid}) ${booking.status === "pending" ? "requested" : "booked"} "${ctx.eventType.title}".${booking.status === "pending" ? ` Approve or decline it at ${appUrl("/bookings")}.` : ""}`
              : `${booking.attendeeName} cancelled "${ctx.eventType.title}".`,
            "",
            `When: ${hostWhen}`,
            ctx.meeting.videoUrl ? `Join: ${ctx.meeting.videoUrl}` : "",
            booking.attendeeEmail ? `Email: ${booking.attendeeEmail}` : "",
            answers ? `\n${answers}` : "",
            booking.cancelReason ? `\nReason: ${booking.cancelReason}` : "",
            "",
            `Bookings: ${appUrl("/bookings")}`,
          ].join("\n"),
          ics: isNew ? { content: icsFor(ctx, booking, "REQUEST", host), method: "REQUEST" } : undefined,
          replyTo: booking.attendeeEmail,
        },
        host.did,
      );
    }
    return;
  }

  const base = [
    `When: ${when}`,
    `With: ${hostsText}`,
    ctx.meeting.videoUrl ? `Join: ${ctx.meeting.videoUrl}` : "",
    meetingLocation(ctx) && meetingLocation(ctx) !== ctx.meeting.videoUrl ? `Where: ${meetingLocation(ctx)}` : "",
    "",
    `Manage (cancel or reschedule): ${manageUrl(booking)}`,
  ].join("\n");

  const subjects: Record<Kind, string> = {
    confirmed: `Confirmed: ${title}, ${when}`,
    pending: `Requested: ${title}, ${when}`,
    rescheduled: `Rescheduled: ${title}, ${when}`,
    cancelled: `Cancelled: ${title}, ${when}`,
    reminder: `Reminder: ${title}, ${when}`,
    host_new: "",
    host_cancelled: "",
  };
  const intro: Record<Kind, string> = {
    confirmed: `Your booking is confirmed.`,
    pending: `Your request was sent to the organizer and is awaiting approval.`,
    rescheduled: `Your booking was moved to a new time.`,
    cancelled: `Your booking was cancelled${booking.cancelReason ? `: ${booking.cancelReason}` : "."}`,
    reminder: `This is a reminder for your upcoming meeting.`,
    host_new: "",
    host_cancelled: "",
  };

  const method = kind === "cancelled" ? "CANCEL" : "REQUEST";
  await notifyEmail(
    kind,
    booking.id,
    {
      to: { email: booking.attendeeEmail, name: booking.attendeeName },
      subject: subjects[kind],
      text: `${intro[kind]}\n\n${title}\n${base}`,
      ics: kind === "pending" ? undefined : { content: icsFor(ctx, booking, method, null), method },
      replyTo: ctx.hosts.find((h) => h.email)?.email ?? undefined,
    },
    booking.attendeeDid,
  );

  // Bluesky DM from the first host that has a session, if the attendee is on ATProto.
  if (kind === "confirmed" || kind === "rescheduled" || kind === "cancelled") {
    const sender = ctx.hosts[0];
    if (sender && booking.attendeeDid !== sender.did) {
      await notifyDm(kind, booking.id, sender.did, booking.attendeeDid, `${intro[kind]} ${title}. ${when}. Details: ${manageUrl(booking)}`);
    }
  }
}

export async function notifyInvitation(invitationId: string): Promise<void> {
  const inv = await db.query.eventInvitations.findFirst({ where: eq(schema.eventInvitations.id, invitationId) });
  if (!inv) return;
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, inv.eventTypeId) });
  if (!et) return;
  const inviter = await db.query.users.findFirst({ where: eq(schema.users.did, inv.invitedBy) });
  const invitee = await db.query.users.findFirst({ where: eq(schema.users.did, inv.inviteeDid) });
  const url = appUrl(`/invitations`);
  const text = `${inviter ? displayName(inviter) : "Someone"} invited you to book "${et.title}" on ${env().APP_NAME}.${inv.message ? ` "${inv.message}"` : ""} Pick a time: ${url}`;

  const updates: Partial<typeof inv> = {};
  if (invitee?.email && invitee.notifyEmail) {
    const r = await notifyEmail("invitation", inv.id, { to: { email: invitee.email, name: displayName(invitee) }, subject: `Invitation: ${et.title}`, text }, invitee.did);
    if (r.ok) updates.notifiedEmailAt = new Date();
  }
  const dm = await notifyDm("invitation", inv.id, inv.invitedBy, inv.inviteeDid, text);
  if (dm.ok) updates.notifiedDmAt = new Date();
  if (Object.keys(updates).length) {
    await db.update(schema.eventInvitations).set(updates).where(eq(schema.eventInvitations.id, inv.id));
  }
}

export async function notifyTeamInvite(teamInviteId: string): Promise<void> {
  const inv = await db.query.teamInvites.findFirst({ where: eq(schema.teamInvites.id, teamInviteId) });
  if (!inv) return;
  const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, inv.teamId) });
  const inviter = await db.query.users.findFirst({ where: eq(schema.users.did, inv.invitedBy) });
  const invitee = await db.query.users.findFirst({ where: eq(schema.users.did, inv.inviteeDid) });
  if (!team) return;
  const text = `${inviter ? displayName(inviter) : "Someone"} invited you to join the team "${team.name}" on ${env().APP_NAME}: ${appUrl("/teams")}`;
  if (invitee?.email && invitee.notifyEmail) {
    await notifyEmail("team_invite", inv.id, { to: { email: invitee.email, name: displayName(invitee) }, subject: `Team invitation: ${team.name}`, text }, invitee.did);
  }
  await notifyDm("team_invite", inv.id, inv.invitedBy, inv.inviteeDid, text);
}
