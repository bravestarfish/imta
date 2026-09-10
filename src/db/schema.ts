import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Identity and sessions                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  did: text("did").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  pdsUrl: text("pds_url"),
  email: text("email"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  /** Opt-in: publish a `rsvp.imta.profile` record and expose /@handle. */
  publicProfile: boolean("public_profile").notNull().default(false),
  bio: text("bio"),
  profileRecordUri: text("profile_record_uri"),
  /** Notification preferences. */
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifyDm: boolean("notify_dm").notNull().default(true),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

/** Persisted ATProto OAuth sessions (tokens + DPoP key), keyed by DID. */
export const atprotoOauthSessions = pgTable("atproto_oauth_sessions", {
  did: text("did").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Short-lived state for in-flight authorization requests. */
export const atprotoOauthStates = pgTable("atproto_oauth_states", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Browser sessions: opaque random id in an httpOnly cookie. */
export const appSessions = pgTable(
  "app_sessions",
  {
    id: text("id").primaryKey(),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("app_sessions_user_idx").on(t.userDid)],
);

export const emailVerifications = pgTable("email_verifications", {
  token: text("token").primaryKey(),
  userDid: text("user_did")
    .notNull()
    .references(() => users.did, { onDelete: "cascade" }),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Organizer block list: blocked DIDs cannot book with this organizer. */
export const blocks = pgTable(
  "blocks",
  {
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    blockedDid: text("blocked_did").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userDid, t.blockedDid] })],
);

/* -------------------------------------------------------------------------- */
/* Calendar and video provider connections                                    */
/* -------------------------------------------------------------------------- */

export type ProviderKind = "google" | "microsoft" | "zoom";

export const providerConnections = pgTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderKind>().notNull(),
    accountId: text("account_id"),
    accountEmail: text("account_email"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    /** Calendar used for writing bookings (Google calendarId / Graph calendar id). */
    writeCalendarId: text("write_calendar_id"),
    /** Calendars whose busy times are read, JSON array of ids. */
    busyCalendarIds: jsonb("busy_calendar_ids").$type<string[]>().notNull().default([]),
    useForBusy: boolean("use_for_busy").notNull().default(true),
    isWriteTarget: boolean("is_write_target").notNull().default(true),
    /** Incremental sync cursors. */
    syncCursor: jsonb("sync_cursor").$type<Record<string, string>>().notNull().default({}),
    watchChannelId: text("watch_channel_id"),
    watchResourceId: text("watch_resource_id"),
    watchExpiresAt: timestamp("watch_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_connections_user_idx").on(t.userDid)],
);

/** Cached busy intervals from connected calendars (free/busy only, no titles). */
export const busyBlocks = pgTable(
  "busy_blocks",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("busy_blocks_conn_ext_idx").on(t.connectionId, t.externalId),
    index("busy_blocks_user_time_idx").on(t.userDid, t.startAt, t.endAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

export const availabilitySchedules = pgTable(
  "availability_schedules",
  {
    id: text("id").primaryKey(),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("availability_schedules_user_idx").on(t.userDid)],
);

/** Weekly recurring rule: weekday 0 = Sunday .. 6 = Saturday, minutes from midnight. */
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => availabilitySchedules.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(),
    startMinutes: integer("start_minutes").notNull(),
    endMinutes: integer("end_minutes").notNull(),
  },
  (t) => [index("availability_rules_schedule_idx").on(t.scheduleId)],
);

/** Date-specific override. `unavailable` blocks the whole day; otherwise the windows replace the weekly rule for that date. */
export const availabilityOverrides = pgTable(
  "availability_overrides",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => availabilitySchedules.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    startMinutes: integer("start_minutes"),
    endMinutes: integer("end_minutes"),
    unavailable: boolean("unavailable").notNull().default(false),
  },
  (t) => [index("availability_overrides_schedule_date_idx").on(t.scheduleId, t.date)],
);

/* -------------------------------------------------------------------------- */
/* Teams                                                                      */
/* -------------------------------------------------------------------------- */

export type TeamRole = "owner" | "admin" | "member";

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  timezone: text("timezone").notNull().default("UTC"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    role: text("role").$type<TeamRole>().notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userDid] })],
);

export const teamInvites = pgTable(
  "team_invites",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    inviteeDid: text("invitee_did").notNull(),
    invitedBy: text("invited_by").notNull(),
    role: text("role").$type<TeamRole>().notNull().default("member"),
    status: text("status").$type<"pending" | "accepted" | "declined">().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_invites_unique_idx").on(t.teamId, t.inviteeDid)],
);

/* -------------------------------------------------------------------------- */
/* Event types                                                                */
/* -------------------------------------------------------------------------- */

export type Visibility = "public" | "link" | "invite";
export type AssignmentMode = "collective" | "anyone" | "threshold";
export type LocationKind = "video" | "inperson" | "phone" | "custom";
export type VideoProvider = "auto" | "google_meet" | "zoom" | "jitsi" | "none";
export type EventStatus = "draft" | "published" | "archived";

export type BookingQuestion = {
  id: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox";
  required: boolean;
  options?: string[];
};

export const eventTypes = pgTable(
  "event_types",
  {
    id: text("id").primaryKey(),
    ownerKind: text("owner_kind").$type<"user" | "team">().notNull(),
    ownerDid: text("owner_did").references(() => users.did, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull().default(30),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(240),
    maxBookingsPerDay: integer("max_bookings_per_day"),
    bookingWindowDays: integer("booking_window_days").notNull().default(60),
    /** Seats per meeting. 1 = one-to-one, >1 = group session. */
    capacity: integer("capacity").notNull().default(1),
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(false),
    visibility: text("visibility").$type<Visibility>().notNull().default("link"),
    /** Random token appended to link-only URLs. */
    linkToken: text("link_token"),
    assignmentMode: text("assignment_mode").$type<AssignmentMode>().notNull().default("collective"),
    thresholdCount: integer("threshold_count").notNull().default(1),
    /** For "anyone" mode: how the host is picked when several are free. */
    hostSelection: text("host_selection").$type<"round_robin" | "least_booked">().notNull().default("round_robin"),
    locationKind: text("location_kind").$type<LocationKind>().notNull().default("video"),
    videoProvider: text("video_provider").$type<VideoProvider>().notNull().default("auto"),
    locationText: text("location_text"),
    questions: jsonb("questions").$type<BookingQuestion[]>().notNull().default([]),
    status: text("status").$type<EventStatus>().notNull().default("draft"),
    /** Attendee cannot cancel/reschedule within this many minutes of start. 0 = always allowed. */
    cancellationNoticeMinutes: integer("cancellation_notice_minutes").notNull().default(0),
    allowReschedule: boolean("allow_reschedule").notNull().default(true),
    requiresApproval: boolean("requires_approval").notNull().default(false),
    /** Minutes before start at which reminders are sent. */
    reminderMinutes: jsonb("reminder_minutes").$type<number[]>().notNull().default([1440, 60]),
    /** Public group sessions are published to hosts' PDS as community.lexicon.calendar.event. */
    publishSessions: boolean("publish_sessions").notNull().default(false),
    /** Public event types are published to the owner's PDS as rsvp.imta.eventType. */
    atprotoUri: text("atproto_uri"),
    color: text("color").notNull().default("#4f46e5"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_types_user_slug_idx")
      .on(t.ownerDid, t.slug)
      .where(sql`${t.ownerKind} = 'user'`),
    uniqueIndex("event_types_team_slug_idx")
      .on(t.teamId, t.slug)
      .where(sql`${t.ownerKind} = 'team'`),
  ],
);

/** Hosts of an event type. For user-owned types the owner is the single host. */
export const eventTypeHosts = pgTable(
  "event_type_hosts",
  {
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id, { onDelete: "cascade" }),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    /** null = host's default schedule. */
    scheduleId: text("schedule_id").references(() => availabilitySchedules.id, { onDelete: "set null" }),
    /** Whether this host must be present (collective) or is optional. */
    required: boolean("required").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventTypeId, t.userDid] })],
);

/** Invitation-only access. Stored by DID (handles change). */
export const eventInvitations = pgTable(
  "event_invitations",
  {
    id: text("id").primaryKey(),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id, { onDelete: "cascade" }),
    inviteeDid: text("invitee_did").notNull(),
    inviteeHandle: text("invitee_handle"),
    invitedBy: text("invited_by").notNull(),
    message: text("message"),
    status: text("status").$type<"pending" | "accepted" | "declined">().notNull().default("pending"),
    notifiedEmailAt: timestamp("notified_email_at", { withTimezone: true }),
    notifiedDmAt: timestamp("notified_dm_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("event_invitations_unique_idx").on(t.eventTypeId, t.inviteeDid),
    index("event_invitations_invitee_idx").on(t.inviteeDid),
  ],
);

/* -------------------------------------------------------------------------- */
/* Meetings and bookings                                                      */
/* -------------------------------------------------------------------------- */

export type MeetingStatus = "scheduled" | "cancelled";
export type BookingStatus = "confirmed" | "pending" | "cancelled" | "waitlisted";

/** A concrete occurrence (one-to-one meeting or a group session). */
export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    hostDids: jsonb("host_dids").$type<string[]>().notNull().default([]),
    capacity: integer("capacity").notNull().default(1),
    status: text("status").$type<MeetingStatus>().notNull().default("scheduled"),
    videoProvider: text("video_provider").$type<Exclude<VideoProvider, "auto">>(),
    videoUrl: text("video_url"),
    location: text("location"),
    icsUid: text("ics_uid").notNull(),
    icsSequence: integer("ics_sequence").notNull().default(0),
    /** community.lexicon.calendar.event record uri if published. */
    atprotoUri: text("atproto_uri"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meetings_event_type_start_idx").on(t.eventTypeId, t.startAt),
    index("meetings_start_idx").on(t.startAt),
  ],
);

/** One attendee's registration in a meeting. */
export const bookings = pgTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    eventTypeId: text("event_type_id")
      .notNull()
      .references(() => eventTypes.id, { onDelete: "cascade" }),
    attendeeDid: text("attendee_did").notNull(),
    attendeeHandle: text("attendee_handle"),
    attendeeName: text("attendee_name").notNull(),
    attendeeEmail: text("attendee_email").notNull(),
    timezone: text("timezone").notNull(),
    answers: jsonb("answers").$type<Record<string, string | boolean>>().notNull().default({}),
    status: text("status").$type<BookingStatus>().notNull().default("confirmed"),
    cancelReason: text("cancel_reason"),
    cancelledBy: text("cancelled_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    rescheduledFromId: text("rescheduled_from_id"),
    rescheduledToId: text("rescheduled_to_id"),
    /** Secret token for manage links in emails (cancel / reschedule). */
    manageToken: text("manage_token").notNull(),
    remindersSent: jsonb("reminders_sent").$type<number[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bookings_meeting_idx").on(t.meetingId),
    index("bookings_attendee_idx").on(t.attendeeDid),
    uniqueIndex("bookings_manage_token_idx").on(t.manageToken),
  ],
);

/** Calendar events written to provider calendars for meetings / bookings. */
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => providerConnections.id, { onDelete: "cascade" }),
    meetingId: text("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    role: text("role").$type<"host" | "attendee">().notNull(),
    externalCalendarId: text("external_calendar_id").notNull(),
    externalEventId: text("external_event_id").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("calendar_events_meeting_idx").on(t.meetingId),
    uniqueIndex("calendar_events_ext_idx").on(t.connectionId, t.externalEventId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Organizer polls (find a time among organizers)                             */
/* -------------------------------------------------------------------------- */

export const polls = pgTable("polls", {
  id: text("id").primaryKey(),
  teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.did, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  timezone: text("timezone").notNull(),
  status: text("status").$type<"open" | "closed">().notNull().default("open"),
  finalOptionId: text("final_option_id"),
  participantDids: jsonb("participant_dids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollOptions = pgTable(
  "poll_options",
  {
    id: text("id").primaryKey(),
    pollId: text("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("poll_options_poll_idx").on(t.pollId)],
);

export const pollVotes = pgTable(
  "poll_votes",
  {
    optionId: text("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    userDid: text("user_did")
      .notNull()
      .references(() => users.did, { onDelete: "cascade" }),
    answer: text("answer").$type<"yes" | "maybe" | "no">().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.userDid] })],
);

/* -------------------------------------------------------------------------- */
/* Operations                                                                 */
/* -------------------------------------------------------------------------- */

export const notificationLog = pgTable(
  "notification_log",
  {
    id: text("id").primaryKey(),
    recipientDid: text("recipient_did"),
    recipientEmail: text("recipient_email"),
    channel: text("channel").$type<"email" | "bsky_dm">().notNull(),
    kind: text("kind").notNull(),
    subjectRef: text("subject_ref"),
    status: text("status").$type<"sent" | "failed" | "skipped">().notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_log_recipient_idx").on(t.recipientDid, t.createdAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorDid: text("actor_did"),
    action: text("action").notNull(),
    subject: text("subject"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_actor_idx").on(t.actorDid, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type AvailabilitySchedule = typeof availabilitySchedules.$inferSelect;
export type AvailabilityRule = typeof availabilityRules.$inferSelect;
export type AvailabilityOverride = typeof availabilityOverrides.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type EventType = typeof eventTypes.$inferSelect;
export type EventTypeHost = typeof eventTypeHosts.$inferSelect;
export type EventInvitation = typeof eventInvitations.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type Poll = typeof polls.$inferSelect;
export type PollOption = typeof pollOptions.$inferSelect;
export type PollVote = typeof pollVotes.$inferSelect;
