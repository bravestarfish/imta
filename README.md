# imta

Scheduling and appointment booking for the open social web, built natively on
[AT Protocol](https://atproto.com). Sign in with any Atmosphere account (Bluesky,
Eurosky, your own PDS), publish when you are free, alone or as a team, and let
people book you. Calendars stay private. Only what you choose to publish is
written to your own repository.

**Status: public alpha.** MIT licensed.

## What it does

- **ATProto login** with OAuth (DPoP, PAR, confidential client). Accounts can be
  created on [Eurosky](https://eurosky.social).
- **Personal and team availability.** Weekly hours plus date overrides per
  person, multiple schedules, DST-safe. Teams of up to 12 see the *computed*
  overlap of members, never each other's raw calendars.
- **Team event types** with three modes: *collective* (everyone attends),
  *anyone* (one free host attends, the booker does not see who), *threshold*
  (at least N hosts). Round-robin by load.
- **Booking rules:** duration, slot interval, buffers, minimum notice, booking
  window, max per day, group sessions with seats, approval, cancellation notice,
  reschedule policy, custom questions, reminders.
- **Access control:** public, anyone-with-the-link, or invitation-only for
  specific Atmosphere accounts (stored by DID, so username changes do not matter).
  Booking always requires an Atmosphere sign-in. Organizer block list and rate limits.
- **Calendars:** Google Calendar and Microsoft 365. Free/busy is read
  (start and end only), meetings are written to hosts' and attendees'
  calendars, and deleting the event in your calendar cancels the booking
  (two-way sync via push notifications and incremental sync).
- **Video:** Google Meet (via Google Calendar), Zoom (via the host's Zoom
  account), or a generated Jitsi link as fallback.
- **Notifications:** email with ICS invitations (REQUEST/CANCEL with sequence
  numbers) for every confirmation, change and cancellation, plus reminders.
  Bluesky DMs for invitations and confirmations from the organizer's account.
- **ATProto records (public data only, opt-in):** `rsvp.imta.profile` (booking
  profile), `rsvp.imta.eventType` (public event types), and public group
  sessions as `community.lexicon.calendar.event`, the lexicon used by
  atmo.rsvp. Lexicons are in [`lexicons/`](lexicons).
- **Organizer polls** for finding a time when the overlap is empty.
- **GDPR:** export everything as JSON and delete the account, which cancels
  meetings, removes calendar events, revokes tokens and deletes published
  records.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together and
[DEPLOYMENT.md](DEPLOYMENT.md) to run it in production.

## Development

Requirements: Node 22, pnpm 10, PostgreSQL 16 (a local cluster can be started
with `scripts/dev-db.sh`, no Docker needed).

```bash
pnpm install
cp .env.example .env            # defaults work for local development
scripts/dev-db.sh start         # prints the DATABASE_URL
pnpm db:migrate                 # apply migrations
pnpm dev                        # http://127.0.0.1:3000
pnpm worker                     # background jobs, in a second terminal
```

With `APP_URL=http://127.0.0.1:3000` the ATProto OAuth client runs in
"loopback" mode and needs no keys. Calendar and video providers are optional in
development; without SMTP, emails are logged instead of sent.

Checks:

```bash
pnpm check                      # typecheck + lint + unit tests
DATABASE_URL=... pnpm smoke     # end-to-end booking flow against a database
```

## Project layout

```
lexicons/           ATProto lexicon definitions (rsvp.imta.*, community.lexicon.calendar.event)
drizzle/            SQL migrations (generated from src/db/schema.ts)
scripts/            keygen, migrate, dev-db, smoke test
src/app/            Next.js routes, pages and server actions
src/components/     UI components (booking slot picker, forms)
src/db/             Drizzle schema and client
src/lib/atproto/    OAuth client, identity, Bluesky chat, PDS record publishing
src/lib/scheduling/ Pure scheduling engine (intervals, availability, slots, overlap) + tests
src/lib/calendar/   Google / Microsoft adapters, OAuth, sync, busy cache
src/lib/bookings/   Booking lifecycle, calendar mirroring, notifications
src/lib/email/      SMTP mailer and ICS generator
src/worker/         pg-boss worker (sync, reminders, notifications, publishing)
```
