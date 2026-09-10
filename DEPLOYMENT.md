# Deployment

## Recommended: one VPS in the EU with Docker Compose

Hetzner (Falkenstein or Helsinki) is the least effort: a CX22-class server is
plenty for an alpha, and everything runs from `docker-compose.yml`. UpCloud or
Scaleway work the same way. If you prefer a platform, Coolify on that same VPS
gives you push-to-deploy with the compose file, and Railway or Fly.io have EU
regions but you must pick them explicitly.

Keep the database on the same box for now (nightly `pg_dump` to object storage
in the EU). Move to a managed EU Postgres later if needed.

### UpCloud walkthrough

1. **Create the server.** UpCloud Hub → Deploy server. Zone `de-fra1`
   (Frankfurt), `fi-hel1` (Helsinki) or `nl-ams1`. Plan: General Purpose 2
   vCPU / 4 GB is comfortable for an alpha (1 vCPU / 2 GB works but builds
   are slow). OS: Ubuntu 24.04. Add your SSH key. Enable automatic backups
   (daily) in the server's Backups tab.
2. **DNS.** Create an `A` record for `imta.rsvp` pointing at the server's
   public IPv4 (and `AAAA` for IPv6 if you like). Wait until it resolves;
   Caddy needs it to issue the certificate.
3. **Bootstrap.** SSH in as root and run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/bravestarfish/imta/main/scripts/bootstrap-server.sh | bash
   ```

   This installs Docker, opens ports 22/80/443 in ufw, clones the repo to
   `/opt/imta`, and writes `/opt/imta/.env` with generated `ENCRYPTION_KEY`,
   `WEBHOOK_SECRET`, `POSTGRES_PASSWORD` and `ATPROTO_PRIVATE_KEY_1`.
4. **Fill in the rest of `.env`:** `SMTP_URL` / `EMAIL_FROM`, and the
   Google, Microsoft and Zoom client ids and secrets (table below). Missing
   providers are simply hidden in the UI, so you can start with SMTP only.
5. **Start and migrate:**

   ```bash
   cd /opt/imta
   docker compose up -d --build
   docker compose run --rm worker pnpm db:migrate
   ```

6. Open `https://imta.rsvp`, sign in with your handle, complete onboarding.
   Check `https://imta.rsvp/oauth-client-metadata.json` loads with
   `token_endpoint_auth_method: "private_key_jwt"`.

Upgrades: `cd /opt/imta && git pull && docker compose up -d --build && docker compose run --rm worker pnpm db:migrate`.

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
