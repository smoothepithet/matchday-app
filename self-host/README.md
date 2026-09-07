# Self-hosting on Unraid (Postgres + PostgREST + GoTrue)

Replaces Supabase's hosted platform with the same three open-source pieces
it's built on, run directly on your Unraid box behind your existing
Traefik instance. `app.js` and `dashboard/app.js` talk to this stack
exactly the way they talk to Supabase today — same URL shape
(`/auth/v1/...`, `/rest/v1/...`), same anon-key/JWT model — so no app code
changes are needed, only `CONFIG` values.

## 1. Prerequisites

- Docker Compose Manager plugin (or equivalent) installed on Unraid.
- Traefik already running and watching some Docker network (`docker
  network ls` to find its name), with a certresolver already configured
  for Let's Encrypt via Cloudflare's DNS-01 challenge (check an existing
  container's labels for `tls.certresolver=...` — `docker inspect
  <name>` if you're not sure of the name). DNS-01 doesn't require your
  box to be reachable from the internet, so Traefik can get a real,
  valid cert for `api.wyrleyrockets.uk` immediately — no self-signed/
  plain-HTTP inconsistency between local testing and once the Tunnel is
  added later.
- A local DNS override that resolves your chosen hostname (e.g.
  `api.wyrleyrockets.uk`) to your Unraid box's LAN IP — the same
  hostname you'll later point a Cloudflare Tunnel public hostname at, so
  this step never needs to change.

## 2. Configure

```bash
cd self-host
cp .env.example .env
```

Fill in `.env`:
- `APP_HOSTNAME` — your chosen hostname (see above).
- `TRAEFIK_NETWORK` — the Docker network Traefik watches.
- `TRAEFIK_CERTRESOLVER` — the certresolver name your other services
  already use (e.g. `cloudflare`).
- `POSTGRES_PASSWORD`, `AUTHENTICATOR_PASSWORD` — generate distinct
  strong passwords with `openssl rand -hex 24` each (hex, not base64 —
  these get embedded in a connection URI where `/`, `+`, or `=` would
  break parsing).
- `JWT_SECRET` — generate with `openssl rand -base64 32`.

## 3. Start the stack

```bash
docker compose up -d
docker compose logs -f
```

Watch the logs on first start — `postgres` runs `init/00-roles.sh` then
`schema.sql` (mounted directly from `../schema.sql`, so there's one
source of truth, not a copy) automatically, but **only on first start
with an empty `./data/postgres` directory**. If you need to change the
schema later, apply changes manually via `psql` — restarting the
container won't re-run these scripts.

`postgrest` and `gotrue` are pinned to specific versions (`v16.2` and
`v2.196.0` respectively, current as of when this was written — note that
`supabase/gotrue` doesn't publish a `latest` tag at all, only versioned
releases, so don't switch it to `:latest`). Env var names occasionally
shift between GoTrue versions — if either container fails to start,
check its logs first; both are vocal about missing/misnamed config.
Bump these tags deliberately when you want to, by checking the image's
tags on Docker Hub, rather than letting them drift.

## 4. Mint your keys

```bash
# anon key — goes in CONFIG.SUPABASE_ANON_KEY (public, ships in client JS)
python mint_jwt.py anon "$JWT_SECRET" 10

# service_role key — server-side only, used once below to create the
# coach login. Never put this in app.js/dashboard/app.js.
python mint_jwt.py service_role "$JWT_SECRET" 10
```

## 5. Create the coach login

GoTrue signup is disabled (`GOTRUE_DISABLE_SIGNUP=true`), so create the
one shared coach account via the admin API instead:

```bash
SERVICE_JWT="<paste service_role key from step 4>"

curl -X POST "https://${APP_HOSTNAME}/auth/v1/admin/users" \
  -H "Authorization: Bearer $SERVICE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"email":"coach@example.com","password":"choose-a-password","email_confirm":true}'
```

`email_confirm: true` is required since there's no SMTP configured — it
marks the account confirmed immediately instead of waiting on a
confirmation email that will never arrive.

## 6. Point the apps at the new stack

In both `app.js` and `dashboard/app.js`:

```js
const CONFIG = {
  TEAM_NAME: "Wyrley Rockets",
  SUPABASE_URL: "https://api.wyrleyrockets.uk",
  SUPABASE_ANON_KEY: "<anon key from step 4>",
};
```

Serve the recorder/dashboard over `http://` (not `file://`) while testing
locally — e.g. `python -m http.server` from the `files/` folder — so
browser fetches behave the same as they will once actually deployed.

## 7. Test end to end

Sign in with the coach account, record a test match, end it, and confirm
it shows up correctly via `dashboard/index.html`.

## 8. Backups

Nothing backs this up automatically anymore. A simple cron (Unraid User
Scripts plugin) running something like:

```bash
docker compose exec -T postgres pg_dump -U postgres matchday | gzip > /mnt/user/backups/matchday/$(date +%F).sql.gz
```

on a schedule, pointed at wherever you keep backups, covers it.

## 9. Exposing it later

When ready to go beyond your LAN: add `APP_HOSTNAME` as a Public Hostname
in your existing Cloudflare Tunnel config, pointed at the same target
your other Traefik-routed services already use — Traefik's HTTPS
(`websecure`) entrypoint, e.g. `https://traefik:443`, since it's already
holding a real cert for this hostname (see Prerequisites). Nothing else
changes — same hostname, same containers, same `.env`.

## 10. Frontend custom domain (GitHub Pages)

This backend is one half of moving the whole project onto
`wyrleyrockets.uk` — the other half is the recorder/dashboard, which stay
on GitHub Pages but under the custom domain instead of the `github.io`
URL. That's handled separately (a `CNAME` file at the repo root, plus DNS
records in Cloudflare pointing the apex domain at GitHub's Pages IPs) —
see the root `CLAUDE.md` for the current state of that migration.

## 11. Brute-force protection on the login endpoint

Self-hosting drops whatever abuse-mitigation Supabase Cloud runs in front
of its hosted Auth service — worth replacing before relying on this for
a real season, since there's a single shared coach email/password and
nothing else standing between it and the internet once exposed.

Because traffic to `api.wyrleyrockets.uk` always flows through
Cloudflare's edge (Tunnel traffic isn't optional-proxy like a plain DNS
record — it's always proxied), a Cloudflare WAF rate-limiting rule
covers this cheaply:

1. Cloudflare dashboard → your zone → **Security → WAF → Rate limiting
   rules** (exact location has moved around Cloudflare's dashboard
   before, so search "rate limit" if it's not there).
2. Create a rule matching: `Hostname equals api.wyrleyrockets.uk` AND
   `URI Path equals /auth/v1/token`.
3. Rate: something like 5 requests per 1 minute, per IP.
4. Action: **Managed Challenge** rather than outright Block — a coach
   who fat-fingers a password a few times pitch-side gets a challenge,
   not locked out entirely.

This only covers the sign-in endpoint — `/auth/v1/admin/*` (used once,
manually, to create the coach account) is already gated by the
`service_role` key rather than a password, so it doesn't need the same
treatment.
