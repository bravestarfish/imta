import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUrl, env } from "@/lib/env";
import { publishProfile, unpublishProfile, publishEventType, deleteRecordByUri, publishCalendarEvent } from "./records";
import { displayName } from "@/lib/users/service";
import { loadMeetingContext, bookingPageUrl } from "@/lib/bookings/context";

/** Keep the user's public rsvp.imta.profile record in sync with their opt-in. */
export async function syncProfileRecord(did: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.did, did) });
  if (!user) return;
  if (!user.publicProfile) {
    if (user.profileRecordUri) {
      await unpublishProfile(did);
      await db.update(schema.users).set({ profileRecordUri: null }).where(eq(schema.users.did, did));
    }
    return;
  }
  const uri = await publishProfile(did, {
    displayName: user.displayName ?? undefined,
    bio: user.bio ?? undefined,
    bookingUrl: appUrl(`/@${user.handle}`),
    timezone: user.timezone,
    createdAt: (user.createdAt ?? new Date()).toISOString(),
  });
  if (uri) await db.update(schema.users).set({ profileRecordUri: uri }).where(eq(schema.users.did, did));
}

/** Public event types are mirrored to the owner's PDS (team types: to every host's PDS is noisy, so only the owner/creator's). */
export async function syncEventTypeRecord(eventTypeId: string): Promise<void> {
  const et = await db.query.eventTypes.findFirst({ where: eq(schema.eventTypes.id, eventTypeId) });
  if (!et) return;
  const hosts = await db.query.eventTypeHosts.findMany({ where: eq(schema.eventTypeHosts.eventTypeId, et.id) });
  const owner = et.ownerKind === "user" ? et.ownerDid : (await db.query.teams.findFirst({ where: eq(schema.teams.id, et.teamId!) }))?.createdBy;
  if (!owner) return;
  const shouldPublish = et.status === "published" && et.visibility === "public";
  if (!shouldPublish) {
    if (et.atprotoUri) {
      await deleteRecordByUri(owner, et.atprotoUri);
      await db.update(schema.eventTypes).set({ atprotoUri: null }).where(eq(schema.eventTypes.id, et.id));
    }
    return;
  }
  const ownerUser = et.ownerDid ? await db.query.users.findFirst({ where: eq(schema.users.did, et.ownerDid) }) : null;
  const team = et.teamId ? await db.query.teams.findFirst({ where: eq(schema.teams.id, et.teamId) }) : null;
  const uri = await publishEventType(owner, et.atprotoUri, {
    title: et.title,
    description: et.description ?? undefined,
    durationMinutes: et.durationMinutes,
    bookingUrl: bookingPageUrl(et, ownerUser?.handle ?? null, team?.slug ?? null),
    hosts: hosts.map((h) => h.userDid),
    team: team?.name,
    mode: `rsvp.imta.eventType#${et.assignmentMode}`,
    capacity: et.capacity,
    location: et.locationKind === "video" ? "rsvp.imta.eventType#video" : et.locationKind === "phone" ? "rsvp.imta.eventType#phone" : "rsvp.imta.eventType#inperson",
    createdAt: et.createdAt.toISOString(),
  });
  if (uri && uri !== et.atprotoUri) await db.update(schema.eventTypes).set({ atprotoUri: uri }).where(eq(schema.eventTypes.id, et.id));
}

/** Public group sessions are published as community.lexicon.calendar.event (atmo.rsvp compatible). */
export async function syncMeetingRecord(meetingId: string): Promise<void> {
  const ctx = await loadMeetingContext(meetingId);
  if (!ctx) return;
  const { meeting, eventType } = ctx;
  const host = ctx.hosts[0];
  if (!host) return;
  const publish = eventType.publishSessions && eventType.visibility === "public" && eventType.capacity > 1;
  if (!publish && !meeting.atprotoUri) return;
  const ownerUser = eventType.ownerDid ? await db.query.users.findFirst({ where: eq(schema.users.did, eventType.ownerDid) }) : null;
  const uri = await publishCalendarEvent(host.did, meeting.atprotoUri, {
    name: eventType.title,
    description: [eventType.description ?? "", `Hosted by ${ctx.hosts.map(displayName).join(", ")} on ${env().APP_NAME}.`].filter(Boolean).join("\n\n"),
    createdAt: meeting.createdAt.toISOString(),
    startsAt: meeting.startAt.toISOString(),
    endsAt: meeting.endAt.toISOString(),
    mode: eventType.locationKind === "video" ? "community.lexicon.calendar.event#virtual" : "community.lexicon.calendar.event#inperson",
    status: meeting.status === "cancelled" ? "community.lexicon.calendar.event#cancelled" : "community.lexicon.calendar.event#scheduled",
    uris: [{ uri: bookingPageUrl(eventType, ownerUser?.handle ?? null, ctx.team?.slug ?? null), name: "Book a seat" }],
    rsvpExpected: true,
  });
  if (uri && uri !== meeting.atprotoUri) await db.update(schema.meetings).set({ atprotoUri: uri }).where(eq(schema.meetings.id, meeting.id));
}
