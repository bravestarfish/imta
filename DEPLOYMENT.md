# Deployment

## Recommended: one VPS in the EU with Docker Compose

Hetzner (Falkenstein or Helsinki) is the least effort: a CX22-class server is
plenty for an alpha, and everything runs from `docker-compose.yml`. UpCloud or
Scaleway work the same way. If you prefer a platform, Coolify on that same VPS
gives you push-to-deploy with the compose file, and Railway or Fly.io have EU
regions but you must pick them explicitly.

Keep the database on the same box for now (nightly `pg_dump` to object storage
in the EU). Move to a managed EU Postgres later if needed.

### Steps

1. DNS: point `imta.rsvp` at the server.
2. Copy the repo, then `cp .env.example .env` and fill it in (see below).
3. `docker compose up -d --build`
4. `docker compose run --rm worker pnpm db:migrate`
5. Open `https://imta.rsvp`. Caddy obtains the TLS certificate automatically.

Upgrades: pull, `docker compose up -d --build`, run migrations again.

### Environment

| Variable | Notes |
| --- | --- |
| `APP_URL` | `https://imta.rsvp`. Decides OAuth client id and redirect URIs. |
| `DATABASE_URL` | Set by compose; override for external Postgres. |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`. Losing it invalidates stored provider tokens (users reconnect). |
| `ATPROTO_PRIVATE_KEY_1` | `pnpm keygen` (or `docker compose run --rm worker pnpm keygen`). Add `_2` to rotate. |
| `SMTP_URL`, `EMAIL_FROM` | Any SMTP relay. EU options: Scaleway Transactional Email, Mailgun EU, Brevo. Set SPF/DKIM for the from-domain. |
| `GOOGLE_CLIENT_ID/SECRET` | Google Cloud → OAuth client (Web). Redirect: `https://imta.rsvp/api/calendar/google/callback`. Scopes: calendar.events, calendar.readonly, openid, email. Publish the consent screen or add testers. |
| `MICROSOFT_CLIENT_ID/SECRET` | Entra → App registration, "Accounts in any org directory and personal accounts". Redirect: `https://imta.rsvp/api/calendar/microsoft/callback`. Delegated permissions: Calendars.ReadWrite, OnlineMeetings.ReadWrite, User.Read, offline_access. |
| `ZOOM_CLIENT_ID/SECRET` | Zoom Marketplace → User-managed OAuth app. Redirect: `https://imta.rsvp/api/video/zoom/callback`. Scopes: meeting:write:meeting, meeting:delete:meeting, user:read:user. |
| `WEBHOOK_SECRET` | Random string; enables calendar push notifications. |
| `JITSI_BASE_URL` | Defaults to meet.jit.si; point at your own Jitsi for privacy. |

### ATProto client metadata

Served at `https://imta.rsvp/oauth-client-metadata.json` with JWKS at
`/oauth/jwks.json`. Nothing to register: ATProto authorization servers fetch it
by URL. The `client_id` is the metadata URL itself.

### Operations

- Logs: `docker compose logs -f web worker`. JSON lines.
- Backups: `docker compose exec db pg_dump -U imta imta | gzip > backup.sql.gz`.
- Scaling: run more `web` replicas behind Caddy; one worker is enough for
  thousands of users, more are safe (pg-boss handles locking).
- Health: `GET /oauth-client-metadata.json` returns 200 when the app is up.

### Without Docker

Build with `pnpm build`, run `node .next/standalone/server.js` (copy
`public/` and `.next/static` into the standalone folder first) and
`pnpm worker` under a process manager such as systemd, behind Caddy or nginx.
