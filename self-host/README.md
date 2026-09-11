# Self-hosting on Unraid (Postgres + PostgREST + GoTrue)

Replaces Supabase's hosted platform with the same three open-source pieces
it's built on, run directly on your Unraid box behind your existing
Traefik instance. `app.js` and `dashboard/app.js` talk to this stack
exactly the way they talk to Supabase today — same URL shape
(`/auth/v1/...`, `/rest/v1/...`), same anon-key/JWT model — so no app code
changes are needed, only `CONFIG` values.

The backend lives entirely on `matchday-api.shadowlan.org` (your internal
domain) — both for local testing and, later, when exposed via Cloudflare
Tunnel. `wyrleyrockets.uk` is reserved for the frontend (GitHub Pages)
only; keeping the backend on a single zone avoids needing Cloudflare API
token permissions across two separate zones.

## 1. Prerequisites

- Docker Compose Manager plugin (or equivalent) installed on Unraid.
- Traefik already running and watching some Docker network (`docker
  network ls` to find its name — e.g. `proxynet`), with a certresolver
  already configured for Let's Encrypt via Cloudflare's DNS-01 challenge
  (check an existing container's labels for `tls.certresolver=...` —
  `docker inspect <name>` if you're not sure of the name). DNS-01 doesn't
  require your box to be reachable from the internet, so Traefik can get
  a real, valid cert immediately — no self-signed/plain-HTTP
  inconsistency between local testing and once the Tunnel is added later.
- A local DNS entry resolving `matchday-api.shadowlan.org` to your Unraid
  box's LAN IP.
- The Cloudflare API token behind that certresolver needs **Zone:DNS:Edit**
  on the `shadowlan.org` zone specifically (it almost certainly already
  has this, since it's the zone your other internal services use).

  Two gotchas worth knowing about upfront, both hit while setting this up:
  - If the DNS-01 propagation pre-check ever hangs forever on "waiting
    for record propagation" with an error like `NS 127.0.0.11:53 did not
    return the expected TXT record`, it means your Docker host's default
    DNS resolver is answering `shadowlan.org` queries from a local
    override rather than forwarding to Cloudflare's real public
    nameservers — it can't see a TXT record that only exists publicly.
    Fix is on Traefik's own static config (not this repo), under the
    certresolver's `dnsChallenge`:
    ```yaml
    dnsChallenge:
      provider: cloudflare
      resolvers:
        - "1.1.1.1:53"
        - "8.8.8.8:53"
    ```
    This makes the pre-check ask real public resolvers instead. Requires
    a full Traefik restart (static config doesn't hot-reload).
  - A router rule combining multiple `Host()` matchers with `||` only
    affects HTTP-level routing — it does **not** make Traefik request a
    cert covering every hostname in the rule (automatic cert inference
    only picks up the first one). Not an issue with the single-hostname
    setup here, but worth knowing if this ever grows a second hostname
    again — the fix would be explicit `tls.domains[0].main`/`.sans`
    labels.
  - If the admin API (or sign-in) returns a 500 `"Database error
    checking email"` / logs show `relation "identities" does not exist`
    even though `\dt auth.*` clearly shows the table exists — this is
    `search_path`, not a missing table. GoTrue's own migrations fully
    qualify table names (`auth.users`, ...) so schema setup works fine
    without it, but its runtime ORM queries use unqualified names and
    rely on the connection's default `search_path` to resolve them.
    `GOTRUE_DB_DATABASE_URL` needs `?options=-c%20search_path%3Dauth`
    appended (already in `docker-compose.yml`) — a plain `postgres://...`
    URL with no `search_path` set looks in `public` by default and
    silently can't find anything in `auth`.
  - Browser calls fail with a CORS preflight error (`No 'Access-Control-
    Allow-Origin' header is present`), even though `curl` reaches
    everything fine — `curl` doesn't send preflight OPTIONS requests, so
    it never exercises this path. Supabase's real Docker stack gets CORS
    headers from **Kong**, the API gateway normally sitting in front of
    GoTrue/PostgREST; skipping Kong for a leaner Traefik-only setup means
    nothing adds those headers by default. Fixed by having Traefik's own
    `headers` middleware do Kong's job here (already in
    `docker-compose.yml`, `matchday-rest-cors`/`matchday-auth-cors`) —
    it answers preflight OPTIONS requests directly and adds the
    necessary `Access-Control-*` headers to real responses too.
  - Once exposed via the Tunnel (step 9), requests may 502 with
    `cloudflared` logging `tls: failed to verify certificate: x509:
    cannot validate certificate for 192.168.8.2 because it doesn't
    contain any IP SANs`. `cloudflared` validates the origin's cert
    against whatever it connects to — since the Tunnel's Service URL
    targets the LAN IP but Traefik's cert is issued for the hostname,
    verification fails even though the cert is perfectly valid. Fix: in
    the Tunnel's Public Hostname settings, under the TLS section, set
    **Origin Server Name** explicitly to `matchday-api.shadowlan.org`
    (exact spelling matters — a stray `.` where the `-` should be
    produces a *different*, more confusing error: cert valid for some
    `xxxx.yyyy.traefik.default` name instead, since Traefik falls back
    to its own internal default cert for any SNI that doesn't match a
    configured router). Do **not** "fix" this by just disabling TLS
    verification instead — that's a real security downgrade, not a fix.

## 2. Configure

```bash
cd self-host
cp .env.example .env
```

Fill in `.env`:
- `APP_HOSTNAME` — `matchday-api.shadowlan.org`.
- `TRAEFIK_NETWORK` — the Docker network Traefik watches (e.g. `proxynet`).
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

If `gotrue` fails on its first attempt (e.g. a migration error) and you
fix something in `init/00-roles.sh` or `schema.sql`, restarting alone
won't pick up the fix — `postgres` already has a non-empty data
directory from the failed attempt, so it skips the init scripts
entirely. Wipe it and start clean:
```bash
docker compose down
rm -rf ./data/postgres/*
docker compose up -d
```

`postgrest` and `gotrue` are pinned to specific versions (`v16.2` and
`v2.196.0` respectively, current as of when this was written — note that
`supabase/gotrue` doesn't publish a `latest` tag at all, only versioned
releases, so don't switch it to `:latest`). Env var names occasionally
shift between GoTrue versions — if either container fails to start,
check its logs first; both are vocal about missing/misnamed config.
Bump these tags deliberately when you want to, by checking the image's
tags on Docker Hub, rather than letting them drift.

Once containers are up, confirm the cert actually issued before moving
on:
```bash
curl -v https://matchday-api.shadowlan.org/ 2>&1 | grep -i "subject:"
```
Should show a real Let's Encrypt subject, not `CN=TRAEFIK DEFAULT CERT`.

## 4. Mint your keys

```bash
# anon key — goes in CONFIG.SUPABASE_ANON_KEY (public, ships in client JS)
python mint_jwt.py anon "$JWT_SECRET" 10

# service_role key — server-side only, used once below to create the
# coach login. Never put this in app.js/dashboard/app.js.
python mint_jwt.py service_role "$JWT_SECRET" 10
```

No Python on the Unraid host? Run it in a throwaway container instead:
```bash
docker run --rm -v "$(pwd)":/app -w /app python:3-alpine python mint_jwt.py anon "$JWT_SECRET" 10
```

## 5. Create the coach login

GoTrue signup is disabled (`GOTRUE_DISABLE_SIGNUP=true`), so create the
one shared coach account via the admin API instead:

```bash
SERVICE_JWT="<paste service_role key from step 4>"

curl -X POST "https://matchday-api.shadowlan.org/auth/v1/admin/users" \
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
  SUPABASE_URL: "https://matchday-api.shadowlan.org",
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

## 9. Exposing it later (confirmed working — see gotcha above)

In the Cloudflare Zero Trust dashboard → your Tunnel → Public Hostname →
Add a public hostname:
- **Subdomain**: `matchday-api`, **Domain**: `shadowlan.org`
- **Type**: `HTTPS`, **Service URL**: `https://192.168.8.2:443` (your
  Unraid box's LAN IP — Traefik's published HTTPS port)
- Under **Additional application settings → TLS**: set **Origin Server
  Name** to `matchday-api.shadowlan.org` exactly (see the gotcha above —
  this is required, not optional, and the exact spelling matters).
  Leave **No TLS Verify** off.
- Leave **Access** on defaults (no Access policy) — the app has its own
  auth via GoTrue; a Cloudflare Access gate here would just get in its way.

Nothing else changes — same hostname, same containers, same `.env`, no
`CONFIG` update needed in the apps. Verify from a connection outside
your LAN (mobile data works) before considering this done:
```bash
curl -X POST "https://matchday-api.shadowlan.org/auth/v1/token?grant_type=password" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"<coach email>","password":"<coach password>"}'
```
Should return a real `access_token`/`refresh_token` pair.

## 10. Frontend custom domain (GitHub Pages)

The frontend (recorder/dashboard) is handled entirely separately, on
`wyrleyrockets.uk` — a `CNAME` file at the repo root plus DNS records in
Cloudflare pointing the apex domain at GitHub's Pages IPs. See the root
`CLAUDE.md` for the current state of that migration. The two domains
don't need to match or interact in any way; the frontend just calls
whatever `CONFIG.SUPABASE_URL` points at, regardless of what domain it's
itself served from.

## 11. Brute-force protection on the login endpoint

Self-hosting drops whatever abuse-mitigation Supabase Cloud runs in front
of its hosted Auth service — worth replacing before relying on this for
a real season, since there's a single shared coach email/password and
nothing else standing between it and the internet once exposed.

Once exposed via the Tunnel, traffic to `matchday-api.shadowlan.org`
always flows through Cloudflare's edge (Tunnel traffic isn't
optional-proxy like a plain DNS record — it's always proxied), so a
Cloudflare WAF rate-limiting rule covers this cheaply:

1. Cloudflare dashboard → your zone → **Security → WAF → Rate limiting
   rules** (exact location has moved around Cloudflare's dashboard
   before, so search "rate limit" if it's not there).
2. Create a rule matching: `Hostname equals matchday-api.shadowlan.org`
   AND `URI Path equals /auth/v1/token`.
3. Rate: something like 5 requests per 1 minute, per IP.
4. Action: **Managed Challenge** rather than outright Block — a coach
   who fat-fingers a password a few times pitch-side gets a challenge,
   not locked out entirely.

This only covers the sign-in endpoint — `/auth/v1/admin/*` (used once,
manually, to create the coach account) is already gated by the
`service_role` key rather than a password, so it doesn't need the same
treatment.
