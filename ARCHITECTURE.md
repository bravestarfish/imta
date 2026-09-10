# Architecture

## Principles

1. **Private by default.** Everything about who books whom, when, and what
   their calendar looks like lives in the imta database. Nothing is written to
   an ATProto repository unless the user opts in, and then only public data.
2. **ATProto for identity and graph.** Users are DIDs. Invitations, teams and
   blocks are keyed by DID; handles are display data that can change.
3. **Free/busy only.** Calendar integrations read intervals, never titles or
   attendees, and cache them as `busy_blocks`.
4. **Pure scheduling core.** `src/lib/scheduling` has no I/O and is unit
   tested, including DST edge cases.

## Components

```
 browser ──▶ Next.js (web)  ──▶ Postgres ◀── worker (pg-boss)
                 │                             │
                 ├─ ATProto OAuth / PDS        ├─ Google / Microsoft sync + writes
                 ├─ /api/slots (JSON)          ├─ email + ICS, Bluesky DMs
                 └─ server actions             └─ reminders, publishing, housekeeping
```

- **web**: Next.js 16 App Router. Pages are server components; mutations are
  server actions; a few route handlers serve OAuth metadata, webhooks, slots
  and ICS downloads.
- **worker**: same codebase, `pnpm worker`. Jobs are queued in Postgres with
  pg-boss, so no extra infrastructure. Cron ticks: calendar sync every 15
  minutes, reminders every 5 minutes, housekeeping nightly.
- **Postgres**: single source of truth; migrations via drizzle-kit.

## Data model (src/db/schema.ts)

- `users` (DID primary key), `app_sessions`, `atproto_oauth_sessions` /
  `atproto_oauth_states` (stores for the OAuth client).
- `availability_schedules` → `availability_rules` (weekly) and
  `availability_overrides` (per date).
- `teams`, `team_members` (owner / admin / member), `team_invites`.
- `event_types` (all booking rules, visibility, assignment mode) →
  `event_type_hosts` (host + optional schedule) and `event_invitations`.
- `meetings` (one occurrence, hosts, video link, ICS uid/sequence) →
  `bookings` (one per attendee; capacity > 1 gives group sessions).
- `provider_connections` (encrypted tokens, chosen calendars, sync cursors,
  watch channels) → `busy_blocks` (cache) and `calendar_events` (what we wrote
  where).
- `polls`, `poll_options`, `poll_votes`; `notification_log`, `rate_limits`,
  `audit_log`, `blocks`.

## Availability and slots

`availableSlots(eventType, window)`:

1. Load each host's schedule, expand to UTC intervals in the schedule's zone
   (`expandSchedule`, DST safe via wall-clock times).
2. Subtract busy intervals: cached calendar busy blocks plus meetings the host
   hosts or attends, padded by the event's buffers.
3. Combine hosts by assignment mode: intersection (collective), union
   (anyone), or sweep-line "at least N" (threshold).
4. Walk the slot grid aligned to the organizer's local midnight, apply minimum
   notice, booking window and per-day limits.

Booking re-validates the slot inside a transaction guarded by a per-event-type
advisory lock, so concurrent bookers cannot take the same slot. In "anyone"
mode the host is picked by fewest upcoming meetings; the booker is never told
which hosts were free (`/api/slots` strips that).

## Calendar sync

- Google: `events.list` with `syncToken` (full sync on 410), push channels via
  `events.watch`. Microsoft Graph: `calendarView/delta`, subscriptions with
  `clientState`. Both incremental syncs run in the worker.
- Events we created are recognised by `calendar_events`; if a participant
  deletes one in their calendar, `reconcile.ts` cancels the booking (attendee)
  or the meeting (host).
- Writes: hosts get an event with attendees as guests (so the provider sends
  its own invite too); attendees with a connected calendar get their own copy.
  Everyone also gets an ICS by email as the universal fallback.
- Google Meet links come back from the host's Google event and are propagated
  to the meeting; Zoom meetings are created and updated through the host's
  Zoom connection; Jitsi links are generated locally.

## ATProto integration

- OAuth via `@atproto/oauth-client-node` with database-backed state and
  session stores. Production uses a confidential client
  (`private_key_jwt`, ES256 keys from `pnpm keygen`), loopback mode locally.
  Scopes: `atproto transition:generic transition:chat.bsky`.
- Identity: handle/DID resolution with `@atproto/identity`; profiles from the
  public AppView.
- Bluesky DMs: `chat.bsky.convo.*` through the `bsky_chat` service proxy,
  sent from the organizer's account. Delivery is best effort (recipient
  settings may block it) and logged.
- Records: `rsvp.imta.profile` (key `self`), `rsvp.imta.eventType`, and
  `community.lexicon.calendar.event` for public group sessions. Records are
  validated against the bundled lexicons before writing and removed when the
  user unpublishes or deletes their account.

## Security notes

- Provider tokens are AES-256-GCM encrypted with `ENCRYPTION_KEY`.
- Sessions are 256-bit random ids in an httpOnly, SameSite=Lax cookie.
- OAuth `state` for calendar providers is bound to a short-lived cookie.
- Webhooks are verified with `WEBHOOK_SECRET` (Google channel token, Graph
  `clientState`).
- Postgres-backed fixed-window rate limits on login and booking.
- Manage links (`/b/<token>`) use unguessable tokens; changes still respect the
  event's cancellation policy unless a host performs them.
