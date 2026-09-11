# Wyrley Rockets — Matchday Stats App

Context for Claude Code. Read this before making changes.

## What this is

A stats app for a kids' grassroots football team, **Wyrley Rockets** (team
colours: black & white). Three pieces sharing one Supabase database:

```
record/                          Match-day recorder PWA — install to a phone, record events
                                  pitch-side, works offline
dashboard/                       Private season-stats page — top scorers, assists, saves,
                                  results log
generate_report.py               Python script that turns a match's events into a
                                  social-media-ready report
schema.sql                       Database schema — source of truth for the data model, run
                                  this first
preview.html                     Standalone demo build with in-memory state (no
                                  localStorage/Supabase) — used to show the UI quickly; NOT
                                  the deployable app, don't treat it as one
```

Note: the report generator and schema have always lived at the repo
root (never in `report-generator/` or `supabase/` subfolders, despite
what older drafts of this file said). The recorder (`index.html`,
`app.js`, `styles.css`) lived at the repo root too until it moved into
its own `record/` folder — the root now just holds a redirect
`index.html` pointing there, for any bookmark/home-screen shortcut
saved from before the move. Dashboard has always been its own
top-level `dashboard/` folder (moved once, early on, from a nested
build-output path).

## Design system

Base is **black, white, and grey**, plus **red** as one deliberate accent
colour (added once a real club crest arrived — see below). Red is used
purposefully, not scattered: it means "our team" / primary action —
the Goal (Us) button, our score digit, the scoreboard's frame, and
primary CTAs (Sign In, Kick Off, Add Player). "Them"/secondary actions
stay on the neutral white/grey palette so the two read distinctly at a
glance during a live match. Rocket-launch motif carried through small
touches in the UI itself (🚀 emoji, diagonal "vapour trail" stripe
texture on the brand strip and scoreboard top border, chevron/dashed
borders) rather than literal rocket illustrations there — the one
deliberate exception is the actual club crest (`record/icon-*.png`,
used as the PWA home-screen icon), which is a real illustrated rocket;
that's a finished badge asset, not a UI touch, so the "no literal
illustrations" rule was never meant to cover it.

Tokens (defined at the top of `record/styles.css`, duplicated inline in
`dashboard/index.html` and `preview.html` — keep all three in sync if you
change them; `--red`/`--red-dark` are new as of the crest/restyle and
**not yet ported to dashboard/preview**, so they'll be out of sync
until that happens):

| Token | Value | Use |
|---|---|---|
| `--void` | `#000000` | base background |
| `--panel` | `#161616` | card/panel surfaces |
| `--white` | `#ffffff` | primary text, secondary/neutral buttons |
| `--silver` | `#b5b5b5` | secondary text |
| `--steel` / `--steel-light` | `#2a2a2a` / `#3d3d3d` | borders, dividers |
| `--red` / `--red-dark` | `#d71920` / `#a30f17` | accent — "our team"/primary actions (record/ only so far) |

Type: system font stack throughout (works offline, no CDN dependency).
Scoreboard digits use `"Courier New"` monospace for a tabular LED-display feel.

Signature element: the live scoreline renders like a stadium scoreboard —
dark panel, large tabular digits, dashed/striped border details.

## Domain migration (in progress)

Supabase's free-tier project got paused. Rather than upgrade to Pro,
decided to self-host the backend (Postgres + PostgREST + GoTrue — the
same open-source pieces Supabase Cloud runs) on the coach's Unraid box,
behind an existing Traefik instance and Cloudflare Tunnel, rather than
pay for AWS/DigitalOcean/Supabase Pro. See `self-host/README.md` for the
full stack and setup steps — status as of this writing: **fully working
end-to-end**. Stack is running, TLS is valid, coach login is created,
and `record/app.js`/`dashboard/app.js` are pointed at it — a real match has
been recorded (squad management, live scoreboard, sync) and confirmed
showing up correctly on the dashboard. Along the way this surfaced (and
fixed) four real self-hosting gotchas now documented in
`self-host/README.md`'s Prerequisites section: the `auth` schema not
auto-creating itself, a DNS-01 propagation check needing external
resolvers, GoTrue's runtime queries needing an explicit `search_path`,
and CORS needing a Traefik middleware to replace the role Kong normally
plays in Supabase's reference stack.

`matchday-api.shadowlan.org` is now exposed externally via the
Cloudflare Tunnel (confirmed working — sign-in tested successfully from
outside the LAN) — Public Hostname → `https://192.168.8.2:443`, with
**Origin Server Name** explicitly set to `matchday-api.shadowlan.org` in
the Tunnel's TLS settings. That last part matters: `cloudflared`
validates the origin's certificate against whatever it connects to, and
Traefik's cert is issued for the hostname, not the IP — without
explicitly telling `cloudflared` which hostname to validate against, it
fails cert verification even though the cert itself is perfectly valid.

A Cloudflare rate-limit rule on `/auth/v1/token` is live (step 11) —
Free plan constraints meant much blunter settings than originally
planned (no Managed Challenge/1-minute-window options on Free): `5`
requests per `10s`, per IP → `Block` for `10s`. Still a meaningful
throttle for a single-shared-account hobby app, just not as strong as a
paid plan would allow.

Postgres backups (step 8) are done too — a `pgbackups` service
(`prodrigestivill/postgres-backup-local`) in `docker-compose.yml` runs
`pg_dump` daily (plus once on startup) with rotated daily/weekly/
monthly retention, written to `BACKUP_DIR` (should point at the main
parity-protected array, not the appdata/cache pool the rest of the
stack lives on). The restore path has been **actually tested**, not
just configured: restored a real daily dump into a scratch database
and confirmed the test match + full squad came back intact before
dropping it — see `self-host/README.md` step 8 for the restore
commands. **This closes out the Supabase Cloud migration** — the
self-hosted stack is fully working, exposed, rate-limited, and backed
up.

The backend lives entirely on `matchday-api.shadowlan.org` (the coach's
existing internal domain) — both for local testing and, later, once
exposed via Cloudflare Tunnel. This was originally planned as a dual
setup (`matchday-api.shadowlan.org` for testing, `api.wyrleyrockets.uk`
for the eventual public address), but that hit a real snag worth
remembering: a single Traefik cert covering hostnames from two different
Cloudflare zones needs the DNS-01 challenge to succeed against *both*
zones, and the Cloudflare API token in use was only scoped to
`shadowlan.org` — simplified to one hostname/one zone instead of
widening the token's scope.

Also bought `wyrleyrockets.uk`, reserved for the **frontend only**:
apex (`wyrleyrockets.uk`) → GitHub Pages, same repo/paths as today
(recorder at `/record/`, dashboard at `/dashboard/`, with a redirect
`index.html` at `/` for any bookmark/home-screen shortcut saved from
before the recorder moved off the root path). A `CNAME` file has been
added to the repo root for this; DNS (A records at the apex pointing to
GitHub's Pages IPs, added as DNS-only/grey-cloud in Cloudflare so
GitHub's Let's Encrypt cert can validate) and enabling "Enforce HTTPS"
in the repo's Pages settings are still outstanding, done outside this
repo. The two domains don't interact — the frontend just calls whatever
`CONFIG.SUPABASE_URL` points at, regardless of what domain it's itself
served from.

## Data model (`schema.sql`)

- `players` — `name`, `squad_number`, `active`
- `matches` — `opposition`, `match_date`, `venue` (home/away), `competition`,
  `our_score`, `their_score`, `status`
- `events` — one row per goal / assist / save / own_goal, linked to a match
  and (eventually) a player
- Views: `player_season_stats` (goals/assists/saves/appearances per player,
  includes `squad_number`), `results_log` (W/D/L per completed match)

RLS now requires a signed-in Supabase Auth session (`to authenticated`
policies) — the `anon` role has no grants at all on the 3 tables or the 2
views. Both apps gate their UI behind a login screen (single shared coach
email/password account) and send the user's access token as the bearer on
every data call; the anon key alone can no longer read or write anything.

## Current status

Working:
- Recorder: squad management (add/remove players with name + shirt number,
  persisted in `localStorage` under key `squad`), match setup, live
  scoreboard, goal/assist/save capture via player picker, undo, offline
  queue (`localStorage` key `sync_queue`), best-effort sync to Supabase REST
  API on match end and on `online` event. Deployed to GitHub Pages.
- Dashboard: reads `player_season_stats` and `results_log` views directly
- Report generator: pulls a match + events from Supabase, prompts Claude to
  draft a caption-length report
- Auth: both recorder and dashboard are gated behind a login screen backed
  by Supabase Auth (single shared coach email/password account, created
  manually via Supabase Dashboard → Authentication → Users). Session
  (`access_token`/`refresh_token`/`expires_at`) is stored in `localStorage`
  under `auth_session` and refreshed opportunistically; the recorder never
  blocks on a refresh failure (keeps working offline pitch-side), the
  dashboard bounces back to the login screen on a definite auth failure.
- Player ID resolution: `resolvePlayerId()` in `record/app.js` looks up (or
  creates) a `players` row by name during sync and attaches its id to each
  event row, so `player_season_stats` actually populates per-player.
  Resolved name→id pairs are cached in `localStorage` under `player_ids`.
- Squad pull-sync: `syncSquadFromSupabase()` fetches `players` on
  login/boot and merges it into the local squad by name (updates shirt
  numbers, adds anyone missing locally) — a new device doesn't start
  from an empty squad list.

Known gaps (in priority order for next work):
1. **No automated social posting.** Meta (Instagram/Facebook) requires app
   review + business verification; X posting requires a paid API tier.
   Current plan is manual copy-paste from the generated report — revisit
   only if this becomes a bigger multi-team tool.
2. **No report image/template**, just text.
3. Squad sync is one-way-lazy on the push side: `syncSquadFromSupabase()`
   pulls the `players` table down into the local squad on every login/boot
   (merging by name, so a new device doesn't need everyone re-typed in),
   but a `players` row still only gets *created* lazily via
   `resolvePlayerId()` the first time someone is involved in a recorded
   event. A bench player who never scores/assists/saves won't appear on
   the server (or in another coach's pulled-down squad) until they do.
   Removing a player locally also doesn't deactivate their `players` row.
4. **No automated tests exist.** Earlier drafts of this file referenced a
   `test_recorder.js` (jsdom-based, driving squad setup → kickoff →
   goal/assist/save → undo → end match) but it was never committed — the
   `.gitignore`'s Node/jsdom entries are the only trace of it. If test
   coverage is wanted, it needs to be written from scratch.

## Conventions

- No build step anywhere — plain HTML/CSS/JS, opened directly or hosted
  statically (e.g. GitHub Pages). Keep it that way unless there's a good
  reason to add tooling.
- `localStorage` is the local persistence layer for the recorder and
  dashboard (this is a real deployable app, not a Claude.ai artifact — the
  usual "no localStorage" restriction doesn't apply here).
- Backend config (`SUPABASE_URL`, `SUPABASE_ANON_KEY` — named for the
  Supabase-shaped API they still point at, even though the backend is
  now self-hosted) lives as a `CONFIG` object at the top of
  `record/app.js` and `dashboard/app.js`. Same values go in both places.
  Both fall back to `localStorage` overrides
  (`dev_supabase_url`/`dev_supabase_anon_key`) before the hardcoded prod
  values — see `self-host/README.md` step 12 for testing against the
  dev backend without ever editing these files.
- The auth helper (`getSession`/`setSession`/`clearSession`/`signIn`/
  `refreshSession`/`ensureFreshSession`) is duplicated verbatim in both
  `app.js` files, same convention as `CONFIG` — no shared module, since
  there's no build step. Keep both copies in sync if this logic changes.
- Team name lives as `CONFIG.TEAM_NAME` in `record/app.js` and
  `TEAM_NAME` in `generate_report.py` — update both if the team name
  ever changes.

## Testing

No automated tests currently exist in this repo (see known gap #4 above).
Verify changes manually: open `record/index.html` for the recorder and
`dashboard/index.html` for the dashboard directly in a browser, or via the
deployed GitHub Pages site.

## Suggested next step

Play a real match end-to-end (recorder → sync → dashboard) now that auth,
RLS, and player ID resolution are all wired up, and confirm the per-player
stats look right. After that, gap #1 above (social posting) is the next
open item.
