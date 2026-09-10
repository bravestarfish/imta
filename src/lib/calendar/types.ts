import type { Interval } from "@/lib/scheduling/intervals";
import type { ProviderConnection } from "@/db/schema";

export type CalendarInfo = { id: string; name: string; primary: boolean; canWrite: boolean };

export type EventInput = {
  title: string;
  description: string;
  start: Date;
  end: Date;
  timezone: string;
  location?: string;
  /** Attendees to invite through the provider (they receive the provider's own invite). */
  attendees: { email: string; name?: string }[];
  /** Ask the provider to create its own conference link (Google Meet / Teams). */
  createConference?: boolean;
  icsUid: string;
  sequence: number;
};

export type WrittenEvent = { externalEventId: string; externalCalendarId: string; conferenceUrl?: string };

/** Result of an incremental sync: busy intervals to upsert and ids that vanished. */
export type SyncResult = {
  upserts: { externalId: string; start: Date; end: Date }[];
  deletions: string[];
  cursor: Record<string, string>;
  /** Provider event ids for events we wrote that were deleted or moved on the provider side. */
  changedOwnEvents: { externalEventId: string; deleted: boolean; start?: Date; end?: Date }[];
  full: boolean;
};

export interface CalendarProvider {
  listCalendars(conn: ProviderConnection): Promise<CalendarInfo[]>;
  accountInfo(conn: ProviderConnection): Promise<{ id?: string; email?: string }>;
  freeBusy(conn: ProviderConnection, calendarIds: string[], window: Interval): Promise<Interval[]>;
  sync(conn: ProviderConnection, window: Interval, ownEventIds: Set<string>): Promise<SyncResult>;
  createEvent(conn: ProviderConnection, calendarId: string, input: EventInput): Promise<WrittenEvent>;
  updateEvent(conn: ProviderConnection, calendarId: string, eventId: string, input: EventInput): Promise<WrittenEvent>;
  deleteEvent(conn: ProviderConnection, calendarId: string, eventId: string): Promise<void>;
  watch?(conn: ProviderConnection, calendarId: string): Promise<{ channelId: string; resourceId: string; expiresAt: Date } | null>;
  unwatch?(conn: ProviderConnection): Promise<void>;
}
