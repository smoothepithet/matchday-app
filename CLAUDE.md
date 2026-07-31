# Wyrley Rockets — Matchday Stats App

Context for Claude Code. Read this before making changes.

## What this is

A stats app for a kids' grassroots football team, **Wyrley Rockets** (team
colours: black & white). Three pieces sharing one Supabase database:

```
recorder/           Match-day PWA — install to a phone, record events pitch-side, works offline
dashboard/           Private season-stats page — top scorers, assists, saves, results log
report-generator/    Python script that turns a match's events into a social-media-ready report
supabase/schema.sql  Database schema — source of truth for the data model
preview.html         Standalone demo build with in-memory state (no localStorage/Supabase) —
                     used to show the UI quickly; NOT the deployable app, don't treat it as one
```

## Design system

Team colours are strictly **black, white, and grey** — no other accent colour.
Rocket-launch motif carried through small touches (🚀 emoji, diagonal
"vapour trail" stripe texture on the brand strip and scoreboard top border,
chevron/dashed borders) rather than literal rocket illustrations.

Tokens (defined at the top of `recorder/styles.css`, duplicated inline in
`dashboard/index.html` and `preview.html` — keep all three in sync if you
change them):

| Token | Value | Use |
|---|---|---|
| `--void` | `#000000` | base background |
| `--panel` | `#161616` | card/panel surfaces |
| `--white` | `#ffffff` | primary text, primary buttons |
| `--silver` | `#b5b5b5` | secondary text |
| `--steel` / `--steel-light` | `#2a2a2a` / `#3d3d3d` | borders, dividers |

Type: system font stack throughout (works offline, no CDN dependency).
Scoreboard digits use `"Courier New"` monospace for a tabular LED-display feel.

Signature element: the live scoreline renders like a stadium scoreboard —
dark panel, large tabular digits, dashed/striped border details.

## Data model (`supabase/schema.sql`)

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
- Player ID resolution: `resolvePlayerId()` in `recorder/app.js` looks up
  (or creates) a `players` row by name during sync and attaches its id to
  each event row, so `player_season_stats` actually populates per-player.
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

## Conventions

- No build step anywhere — plain HTML/CSS/JS, opened directly or hosted
  statically (e.g. GitHub Pages). Keep it that way unless there's a good
  reason to add tooling.
- `localStorage` is the local persistence layer for the recorder and
  dashboard (this is a real deployable app, not a Claude.ai artifact — the
  usual "no localStorage" restriction doesn't apply here).
- Supabase config (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) lives as a `CONFIG`
  object at the top of `recorder/app.js` and `dashboard/app.js`. Same values
  go in both places.
- The auth helper (`getSession`/`setSession`/`clearSession`/`signIn`/
  `refreshSession`/`ensureFreshSession`) is duplicated verbatim in both
  `app.js` files, same convention as `CONFIG` — no shared module, since
  there's no build step. Keep both copies in sync if this logic changes.
- Team name lives as `CONFIG.TEAM_NAME` in `recorder/app.js` and
  `TEAM_NAME` in `report-generator/generate_report.py` — update both if the
  team name ever changes.

## Testing

There's a headless test at the project root's parent
(`test_recorder.js`, uses `jsdom`) that drives the recorder through a full
match: squad setup → kickoff → goal+assist → save → conceded goal → undo →
end match → checks `localStorage` persistence and the offline sync queue.
Run with `node test_recorder.js` (needs `npm install jsdom` once). Update
this test alongside any changes to the recorder's DOM structure or flow —
it currently asserts against specific element IDs and button labels.

## Suggested next step

Play a real match end-to-end (recorder → sync → dashboard) now that auth,
RLS, and player ID resolution are all wired up, and confirm the per-player
stats look right. After that, gap #1 above (social posting) is the next
open item.
