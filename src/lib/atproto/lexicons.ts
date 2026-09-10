import { Lexicons, type LexiconDoc } from "@atproto/lexicon";
import profile from "../../../lexicons/rsvp/imta/profile.json";
import eventType from "../../../lexicons/rsvp/imta/eventType.json";
import calendarEvent from "../../../lexicons/community/lexicon/calendar/event.json";

export const NSID = {
  profile: "rsvp.imta.profile",
  eventType: "rsvp.imta.eventType",
  calendarEvent: "community.lexicon.calendar.event",
} as const;

export const lexicons = new Lexicons([
  profile as LexiconDoc,
  eventType as LexiconDoc,
  calendarEvent as LexiconDoc,
]);

export type ProfileRecord = {
  $type: typeof NSID.profile;
  displayName?: string;
  bio?: string;
  bookingUrl: string;
  timezone?: string;
  createdAt: string;
};

export type EventTypeRecord = {
  $type: typeof NSID.eventType;
  title: string;
  description?: string;
  durationMinutes: number;
  bookingUrl: string;
  hosts: string[];
  team?: string;
  mode?: string;
  capacity?: number;
  location?: string;
  createdAt: string;
};

export type CalendarEventRecord = {
  $type: typeof NSID.calendarEvent;
  name: string;
  description?: string;
  createdAt: string;
  startsAt?: string;
  endsAt?: string;
  mode?: string;
  status?: string;
  uris?: { uri: string; name?: string }[];
  rsvpExpected?: boolean;
};

export function assertValid(nsid: string, record: unknown): void {
  lexicons.assertValidRecord(nsid, record);
}
