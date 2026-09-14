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
generate_report.py               Manual Python script (Claude-based) that turns a match's
                                  events into a social-media-ready report — superseded day-
                                  to-day by the automatic Ollama Cloud flow below, kept as a
                                  standalone fallback/reference
self-host/report-service/        Stdlib-only Python service, behind Traefik at /report on
                                  the self-hosted backend — the recorder POSTs match events
                                  here on "End Match" and gets a drafted report back from an
                                  Ollama Cloud model, then saves it to the `reports` table
                                  itself
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

`record/`'s chrome (back/forward chevrons, Half Time's pause/play,
Sign out, remove-player, undo) uses a small hand-authored inline-SVG
icon set (`ICONS`/`svgIcon()` near the top of `record/app.js`, plus a
few one-off `<svg>`s in static HTML for content that's never
JS-rendered) instead of plain "←"/"→"/"⏸"/"▶" text glyphs — those
render via whatever system font is active rather than being drawn
consistently, so they looked thin/misaligned next to real UI. No icon
font or CDN: everything's inline `currentColor` stroke SVG so it still
works fully offline, matching the rest of this app's philosophy. Goal
(Us)/Save on the match screen also got custom `rocket`/`shield` icons
(replacing the 🧤/🚀 emoji that were there originally) once it was
clear side-by-side with the new icon set they read as inconsistent —
the header's 🚀 brand-mark is the one deliberate exception left, since
that's a logo/mascot touch rather than an action button. The shield
icon uses `stroke-linejoin="miter"` rather than the `"round"` every
other icon uses — with `round`, its top point and shoulders blurred
into a rounded blob at 18-20px; `miter` keeps the corners crisp enough
to actually read as a shield at that size. Screen transitions
(`.screen` class + `@keyframes screen-in` in `record/styles.css`) and
the picker sheet's slide-up (`@keyframes sheet-in`) fire automatically
whenever an element goes from `display:none` to visible, so no JS
beyond the existing `classList.toggle("hidden")` calls was needed.

Tokens (defined at the top of `record/styles.css`, duplicated inline in
`dashboard/index.html` and `preview.html` — keep all three in sync if you
change them). Both `record/` and `dashboard/` are dark (`--void` body);
`dashboard/` was originally a light read-only page with red scoped down
to just Sign In/login errors, but was redone to match the recorder's
dark theme and given a real accent role for red throughout, plus a
second accent (`--gold`) reserved for the Awards theme — see below:

| Token | Value | Use |
|---|---|---|
| `--void` | `#000000` | base background |
| `--panel` | `#161616` | card/panel surfaces |
| `--white` | `#ffffff` | primary text, secondary/neutral buttons |
| `--silver` | `#b5b5b5` | secondary text |
| `--steel` / `--steel-light` | `#2a2a2a` / `#3d3d3d` | borders, dividers, `dashboard/` nested card surfaces (report cards) |
| `--red` / `--red-dark` | `#d71920` / `#a30f17` | accent #1 — "our team"/primary actions: `record/`'s Goal (Us) button, score digit, scoreboard frame, Sign In/Kick Off/Add Player CTAs; `dashboard/`'s Clean sheets value, Goals-per-match chart bars, Win badge, active tab underline, Sign In button |
| `--gold` / `--gold-dark` | `#e8b04b` / `#b8842e` | accent #2, `dashboard/`-only — Season Awards heading/pills, Draw badge; kept distinct from red so red's "us" meaning stays unambiguous elsewhere on the same page |

Result badges on `dashboard/` are colour-coded now (W=red, D=gold,
L=steel-light) rather than the original all-grey scheme, but every badge
still carries its own W/D/L letter — color reinforces the label, never
replaces it as the only identity channel.

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
- `matches` — `opposition`, `match_date`, `venue`, `competition`,
  `our_score`, `their_score`, `status`, `notes` (free text, nullable —
  end-of-match coach context separate from any per-event data, e.g.
  "played a man short from the 20th minute"; fed into the report prompt
  alongside the event log when present, in both `self-host/report-service`
  and `generate_report.py`; recorder-side UI to actually capture it is
  not built yet — see "Known gaps" #5 below). `venue` is free text, not a
  home/away enum — league and cup matches are always played at one of
  several shared centres (Rushall, Chasetown, Bilston, more added as
  they're confirmed over the season), never at a Wyrley "home" ground.
  `record/index.html` offers these (plus "Home"/"Away", still valid for
  a genuine two-team friendly fixture) as a `<datalist>` on a free-text
  input, so a coach can type a new centre the moment it's confirmed with
  no code change needed. `dashboard`'s Venue filter is built dynamically
  from whatever venue names are actually in the data
  (`populateVenueFilter()`), not a hard-coded list.
- `events` — one row per goal / assist / save / goal_against / appearance
  / woodwork / half_time / full_time, linked to a match and (eventually)
  a player. `woodwork` (hit the bar/post), `half_time`, and `full_time`
  are match-timeline moments rather than player actions — `player_id`
  was already nullable before these were added (never `NOT NULL`), so
  no schema change was needed for them to be logged with no player
  attached. `minute` already stores minutes-elapsed-into-the-match
  (computed client-side by `currentMinute()` in `record/app.js`,
  accounting for half-time/stoppage pauses), not device wall-clock time
  — that was true before these event types existed too, not something
  this addition changed. Recorder-side UI to actually log these three
  new types isn't built yet — see "Known gaps" #5 below. `appearance` has no
  minute and isn't a real "moment" — one row per player checked in the
  recorder's "Who's Playing Today?" list, added purely so
  `player_season_stats.appearances` is correct for a player who plays
  the whole match without ever scoring/assisting/saving (previously the
  only way to be counted as appearing at all was to have some other
  event attached). Overlapping with a goal/save/assist row for the same
  player+match is harmless — `appearances` is `count(distinct
  match_id)`, so it collapses fine either way. `goal_against` means "the opposition's
  score went up" — the recorder's single Goal Them button doesn't
  distinguish how (open play, penalty, a genuine own goal), so this
  covers all of it. Used to be mislabeled `own_goal`, which is wrong for
  the common case and, worse, fed raw unlabeled text straight into the
  report prompt — that's why generated reports once described a normal
  conceded goal as a nonsensical "home goal". `schema.sql` includes a
  migration (`update events set event_type = 'goal_against' where
  event_type = 'own_goal'` + swapping the CHECK constraint) for an
  already-initialized database; both `self-host/report-service` and
  `generate_report.py` now map every `event_type` through an
  `EVENT_TYPE_LABELS` dict to plain English before it reaches the
  prompt, so this class of bug (raw internal names leaking into
  LLM-facing text) can't recur silently. The same fix covers a second,
  related case: a `goal` event with no player attached (coach skipped
  the scorer picker) used to render as a bare, context-free line in the
  event log and the model would fabricate an explanation for it — one
  report described two unattributed goals as "the opposition gifted us
  two own-goals," which isn't in the data at all. Both prompt builders
  now render this explicitly as "(scorer not recorded)" and the prompt's
  closing instructions explicitly forbid guessing a mechanism (own goal,
  gift, etc.) for it. Goal events also carry `goal_type`
  (`open_play` / `free_kick` / `penalty`, null for non-goal events) —
  added via `alter table events add column if not exists ...` rather than
  folded into the original `create table`, so re-running `schema.sql`
  against an already-initialized database picks it up (same migration
  pattern as `awards`/`reports`, see `self-host/README.md` step 13).
- `awards` — `award_type` (`training_potw` / `managers_potw` /
  `parents_potw` / `player_of_month`), `player_id`, `period_date`,
  `notes`. **Not** tied to a match — the two "Player of the Match"
  awards are actually decided weekly on the strength of both weekend
  matches combined (the team plays two matches/week), same cadence as
  the training award, so `period_date` just means "which week/month
  this represents" (week-ending Sunday, or first-of-month for the
  monthly award).
- `reports` — `match_id`, `report_text`, `created_at`. One row per match,
  written by `record/app.js` right after a successful `syncMatch()`, using
  the text returned by `self-host/report-service` (Ollama Cloud). Not
  auto-created on an already-running Postgres — same "migrate the live DB
  by hand" situation `awards` hit, see `self-host/README.md` step 13.
- Views: `player_season_stats` (goals/assists/saves/appearances per player,
  includes `squad_number`), `results_log` (W/D/L per completed match),
  `season_awards` (award history joined with player name/squad_number)

RLS now requires a signed-in Supabase Auth session (`to authenticated`
policies) — the `anon` role has no grants at all on the 5 tables or the 3
views. Both apps gate their UI behind a login screen (single shared coach
email/password account) and send the user's access token as the bearer on
every data call; the anon key alone can no longer read or write anything.

## Current status

Working:
- Recorder: squad management (add/remove players with name + shirt number,
  persisted in `localStorage` under key `squad`), match setup (Competition
  defaults to League rather than an unselected placeholder — the
  placeholder meant a coach who never touched the dropdown got an empty
  `competition` value silently saved for every match), live
  scoreboard, goal/assist/save capture via player picker, goal type
  (`openGoalTypePicker()` — Open Play/Free Kick/Penalty, defaults to Open
  Play on skip, only asked once a scorer is picked; the assist prompt is
  skipped entirely for penalties), undo,
  half-time/stoppage pause (`togglePause()` — pauses the clock, disables
  the scoring buttons, tracks `match.totalPausedMs` so resuming doesn't
  count real-world break time as match time), offline queue
  (`localStorage` key `sync_queue`), best-effort sync to Supabase REST
  API on match end and on `online` event. Deployed to GitHub Pages.
- Awards screen (reachable from setup, alongside Manage Squad): records
  Training/Manager's/Parents' Player of the Week and Player of the
  Month, reusing the same player-picker sheet as match events and
  `resolvePlayerId()` for the player lookup. Own offline queue
  (`localStorage` key `award_sync_queue`), flushed on the same `online`
  event as match sync. Shows the 10 most recent awards on the same screen.
- Dashboard: reads `player_season_stats`, `results_log`, `season_awards`,
  and `reports` (embedding its parent `matches` row for date/opposition/
  score) directly. Results filterable by venue/result/competition,
  awards filterable by award type — client-side over the already-fetched
  data (`allResults`/`allAwards`), not separate queries per filter
  change. Two tabs (`switchTab()`): Overview (stat tiles + Goals per
  Match chart + Player Stats/Results/Awards panels) and Match Reports
  (read-only, newest first, no filters). A Results row's score is a
  clickable `.score-link` whenever that match has a generated report
  (checked against `reportMatchIds`, a `Set` of `match_id`s built from
  the `reports` fetch) — clicking it switches to the Reports tab and
  scrolls/briefly highlights (`showReport()`) the matching card, id'd
  `report-${match_id}`.
- Dashboard headline stats: a 2-column `.stat-grid` (matches played /
  goals scored / clean sheets / win rate — `renderStatCards()`) replaced
  the old separate "Season record" W/D/L tile + standalone Clean sheets
  tile; win rate folds W/D/L into one number so the dedicated W/D/L tile
  became redundant once it existed (per-match results are still visible
  as badges in Recent results/All results below). Whole-season and
  filter-independent, same "headline stat" treatment the old tiles had —
  computed from `allResults`, not the filtered view. Below that: Top
  scorers (`renderTopScorers()` — top 5 by goals, squad-number badge +
  name + a bar proportional to the top scorer's count so the leader's
  bar is always full-width, `player_season_stats` already comes back
  goals-desc so no re-sort needed) and Recent results
  (`renderRecentResults()` — the 5 most recent completed matches as
  compact opponent/result rows, same score-link-to-report behavior as
  the full table) sit above the existing Goals per Match chart / Player
  Stats / "All results" (renamed from "Results" to read distinctly next
  to the new Recent results) / Season Awards panels, which are otherwise
  unchanged. Header simplified to a single-line title + right-aligned
  season label (`currentSeasonLabel()` — flips over July 1st, not the
  calendar year boundary, since a grassroots season runs roughly
  Aug-May) alongside the existing Recorder/Sign out nav; wraps to two
  rows via `flex-wrap` at narrow widths rather than squeezing the title
  itself onto two lines (same fix as the recorder's brand-strip earlier).
  Card radius standardized to 12px across `.panel`/`.stat-card`.
  `renderGoalsChart()` is a hand-rolled SVG bar
  chart (no charting library, consistent with the rest of the app having
  no build step) — chronological left-to-right (`results_log` comes back
  newest-first, reversed for the chart), bars capped at 20 viewBox units
  thick and shrinking to fit when there are many matches, gridlines/axis
  labels rounded to nice steps, a `<title>` per bar for native hover
  tooltips, and x-axis date labels thinned to ~8 evenly spaced ticks so
  they never overlap regardless of season length.
- Automatic match reports: pressing "End Match" POSTs the match's events
  to `self-host/report-service` (stdlib-only, no deps), which prompts an
  **Ollama Cloud** model (`OLLAMA_MODEL`, default `gpt-oss:120b` — no
  `-cloud` suffix; that's only for the local `ollama` CLI, not direct API
  access) —
  chosen over the coach's local Unraid Ollama instance specifically so
  that instance never has to be exposed to the internet. The service is
  stateless (no DB access of its own) and requires a valid signed-in
  bearer token, verified against the same `JWT_SECRET` PostgREST/GoTrue
  use, so it can't be hit anonymously to burn through the Ollama Cloud
  quota. `record/app.js`'s `generateAndSaveReport()` then writes the
  returned text to `reports` itself. Best-effort only and never blocks or
  re-queues the match — `syncMatch()` has already succeeded by the time
  this runs, so a failure here just means that one match ends up without
  a generated report. `generate_report.py` (manual, Claude-based) still
  exists as a standalone fallback/reference but isn't part of this flow.
  Each goal's `goal_type` is included in the event log sent to the
  prompt (as "— penalty"/"— free kick", omitted for open play) so
  penalties/free kicks can show up as standout moments in the generated
  text. The prompt's event-log intro line now says explicitly "already
  sorted chronologically by minute — keep them in this exact order" —
  the events array was always built chronologically anyway (the client
  pushes each event in real time as it happens during a live match,
  never re-sorted), but an LLM asked to "mention standout moments" had
  been observed re-ordering them for narrative flow regardless, so it's
  told not to rather than just labelled "chronological" and hoped for.
  `EVENT_TYPE_LABELS` now also covers `woodwork`/`half_time`/`full_time`
  (both `self-host/report-service` and `generate_report.py`), and
  `matches.notes` — when present — is appended to the prompt as a
  labelled "Coach's notes" block after the event log.
- Cross-app nav: the recorder's brand-strip has a "Dashboard" link
  (`../dashboard/`) and the dashboard's header has a "Recorder" link
  (`../record/`) — plain same-window `<a>` tags, deliberately not
  `target="_blank"`, since the recorder is installed as a standalone PWA
  (see `record/manifest.json`) with no address bar, and popping a new
  browser tab would defeat the point. The recorder hides its Dashboard
  link while `match-screen` is active (added/removed in the Kick Off
  handler in `record/app.js`) because match events only live in memory
  until End Match syncs them — navigating away mid-match would silently
  lose whatever's been recorded; it reappears after the `location.reload()`
  that follows End Match. The dashboard's Recorder link has no such
  restriction (dashboard is read-only, nothing to lose).
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
- "Who's Playing Today?" checklist on the setup screen: lets the coach
  tick which squad members are actually present before kickoff, so
  `appearances` stat is accurate for players who play but never touch
  the ball. Deliberately reads from the local `squad` (already kept
  current via the pull-sync above) rather than fetching fresh from the
  database at kickoff — the recorder is offline-first specifically so
  it works pitch-side without signal, and a live fetch here would
  undermine that. Defaults every squad member to checked
  (`todaySquadSelected`/`todaySquadKnownIds` in `record/app.js` — the
  latter tracks which player ids have already had the default applied,
  so a newly added player defaults to checked without silently
  re-checking someone the coach already unticked on a later re-render,
  e.g. after `syncSquadFromSupabase()` pulls in an update mid-setup).
  The checked names are captured as `match.todaySquad` at kickoff and
  turned into `appearance` event rows on sync.
- The goal-scorer and assist pickers (`openPicker("Who scored?", ...)` /
  `openPicker("Assist? (optional)", ...)`) are restricted to
  `playingSquad()` — squad members checked in "Who's Playing Today?" —
  rather than the full squad, since someone marked not-playing can't
  score or assist. `openPicker(title, onPick, players = squad)` takes an
  optional player list for this; callers that should still see everyone
  (the awards "Who won this award?" picker, which isn't tied to a
  specific match day) simply omit the third argument.
- `syncMatch()`'s events POST is checked for `res.ok` (mirroring the fix
  already applied to `saveAward()`) — it previously wasn't, so a
  rejected batch (e.g. deploying the `appearance` event type change to
  the recorder before running its `schema.sql` migration on the live
  DB, so the old CHECK constraint rejected every event) silently
  dropped an entire match's events — goals, saves, assists, all of it —
  while still reporting "Synced to dashboard ✓". A real rejection now
  surfaces via `alert()` and returns `null` instead of the saved match
  (so `generateAndSaveReport()` correctly doesn't run). It does *not*
  queue the match for retry on this path, unlike a genuine network
  failure — the `matches` row already saved by that point, so retrying
  the whole match would create a duplicate. Moral: after any
  `schema.sql` change, run `self-host/deploy.sh` (or the manual
  migration steps) on the live DB *before* relying on the matching app
  change in production.
- That same fix surfaced a second, independent, longer-standing bug
  once it stopped being silently swallowed: PostgREST's bulk insert
  requires every object in a JSON array to have identical keys ("All
  object keys must match") — but the `assist` and `appearance` rows in
  `syncMatch()`'s `eventRows` were missing the `goal_type` key that
  `goal`/`save`/`goal_against` rows always carry, so any batch mixing
  shapes (i.e. almost every real match, now that `appearance` rows are
  always present) got rejected outright. This was very likely happening
  silently ever since `goal_type` was added, not just since
  `appearance` — the missing `res.ok` check just never reported it.
  Fixed by giving every row in `eventRows` the same keys, `goal_type:
  null` where it doesn't apply.

Known gaps (in priority order for next work):
1. **No automated social posting.** Meta (Instagram/Facebook) requires app
   review + business verification; X posting requires a paid API tier.
   The report itself is now generated automatically (see above); current
   plan is still manual copy-paste of that generated text into whatever
   app posts it — revisit only if this becomes a bigger multi-team tool.
2. **No report image/template**, just text.
3. Squad sync is one-way-lazy on the push side: `syncSquadFromSupabase()`
   pulls the `players` table down into the local squad on every login/boot
   (merging by name, so a new device doesn't need everyone re-typed in),
   but a `players` row still only gets *created* lazily via
   `resolvePlayerId()` the first time someone is involved in a recorded
   event. This mostly stopped mattering once "Who's Playing Today?"
   shipped — a player just needs to be checked as playing (not to
   actually score/assist/save) for their `appearance` event to trigger
   `resolvePlayerId()` — but someone left unchecked, or added to the
   squad after a match starts, still won't get a `players` row until
   they're actually involved in something. Removing a player locally
   also doesn't deactivate their `players` row.
4. **No automated tests exist.** Earlier drafts of this file referenced a
   `test_recorder.js` (jsdom-based, driving squad setup → kickoff →
   goal/assist/save → undo → end match) but it was never committed — the
   `.gitignore`'s Node/jsdom entries are the only trace of it. If test
   coverage is wanted, it needs to be written from scratch.
5. **`record/` has no UI yet for `woodwork`/`half_time`/`full_time`
   events or `matches.notes`**, even though `schema.sql` and both report
   prompt-builders already support all four (see "Data model" above and
   the "Automatic match reports" bullet). What's needed in
   `record/index.html`/`app.js`, following the existing action-button +
   picker patterns:
   - A "Woodwork" action button alongside Goal/Save/Goal (Them), logging
     `{ type: "woodwork", minute: currentMinute() }` with no player
     picker (or an optional one, coach's call).
   - Buttons or a flow to explicitly log `half_time`/`full_time` events
     — currently `togglePause()`/`btn-pause` only pauses the clock
     locally and creates no event at all; End Match doesn't create a
     `full_time` event either. Whether `half_time` should be `btn-pause`
     itself gaining an event side-effect, or a separate action, needs a
     product call, not just an engineering one.
   - A `<textarea>` for `notes`, shown once `full_time` is logged (per
     the original request that prompted all of this — see git history
     around the schema/dashboard changes), and included in the
     `matches` POST body in `syncMatch()`.
   - `syncMatch()`'s `eventRows` construction needs `woodwork`/
     `half_time`/`full_time` rows to carry the same key set as every
     other row (`match_id`/`player_id`/`event_type`/`minute`/
     `goal_type: null`) — PostgREST's bulk insert has bitten this exact
     class of omission before (see the "All object keys must match" fix
     above), so this isn't optional polish, it'll hard-fail sync if
     missed.

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
- Dates are stored/transmitted as ISO (`YYYY-MM-DD`) everywhere, but
  displayed as `DD-MM-YYYY` — `formatDate()` (duplicated in both
  `app.js` files, same convention as `CONFIG`/the auth helpers) does
  that reformatting; `dashboard/app.js` also has `shortDate()` (`DD/MM`)
  for the Goals-per-match chart's x-axis ticks, where a full year would
  crowd out the bars. This only affects dates the app itself renders as
  text — the native `<input type="date">` picker's own displayed format
  is controlled entirely by the device/browser's OS locale setting and
  can't be overridden from CSS or JS.
- `input[type="date"]` fields (`.setup`/`.award-field` in
  `record/styles.css`) need two separate fixes to render at the same
  height as every other field, not just one: `-webkit-appearance: none`
  strips the native chrome, but Safari's internal
  `::-webkit-datetime-edit` part still carries its own line-height/
  padding independent of that, and needs resetting directly too — the
  first fix alone looked complete on some devices but not others.
- Mobile viewport/PWA fit (`record/styles.css`, top of the file):
  `.app` uses `100dvh` (with a `100vh` fallback for browsers that don't
  support it) instead of plain `100vh`, since `100vh` includes the space
  behind a mobile browser's collapsing address bar and can leave content
  needing a scroll to reach the bottom even when it should fit. `body`
  has `env(safe-area-inset-top)` padding alongside the existing bottom
  inset — needed because `apple-mobile-web-app-status-bar-style:
  black-translucent` (in `record/index.html`) makes content draw
  underneath the status bar/notch once installed. `html, body` has
  `overscroll-behavior-y: contain` so a pitch-side swipe doesn't trigger
  the browser's pull-to-refresh mid-match, and `button, input, select`
  has `touch-action: manipulation` so rapid tapping on the match-screen
  action buttons doesn't trigger double-tap-to-zoom.

## Testing

No automated tests currently exist in this repo (see known gap #4 above).
Verify changes manually: open `record/index.html` for the recorder and
`dashboard/index.html` for the dashboard directly in a browser, or via the
deployed GitHub Pages site.

## Suggested next step

Deploy `self-host/report-service` (get an Ollama Cloud API key, then
`self-host/deploy.sh` — `docker compose up -d` plus the `schema.sql`
migration and PostgREST schema reload in one command, `deploy-dev.sh`
for the dev overlay), then play a real match end-to-end and confirm a
report actually shows up on the dashboard after "End Match". After
that, gap #1 above (social posting) is the next open item.
