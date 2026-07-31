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

RLS is currently wide open (`allow all for now` policies) — **fine for
development, must be locked down with real auth before this holds any real
personal data** (even just kids' first names) in a publicly reachable
database. Don't forget this when wiring up auth later.

## Current status

Working:
- Recorder: squad management (add/remove players with name + shirt number,
  persisted in `localStorage` under key `squad`), match setup, live
  scoreboard, goal/assist/save capture via player picker, undo, offline
  queue (`localStorage` key `sync_queue`), best-effort sync to Supabase REST
  API on match end and on `online` event
- Dashboard: reads `player_season_stats` and `results_log` views directly
- Report generator: pulls a match + events from Supabase, prompts Claude to
  draft a caption-length report

Known gaps (in priority order for next work):
1. **Player ID resolution isn't wired up in the sync path.** `recorder/app.js`
   sends event rows to Supabase without a `player_id` — the schema has the
   column, but nothing populates it yet. Since squad is now a proper list of
   `{id, name, number}` objects, this is a straightforward fix: look up the
   matching `players` row (or create one on first sync) and attach its id to
   each event. Do this before relying on the dashboard's per-player stats
   for real matches.
2. **RLS policies are placeholders** — see above.
3. **No automated social posting.** Meta (Instagram/Facebook) requires app
   review + business verification; X posting requires a paid API tier.
   Current plan is manual copy-paste from the generated report — revisit
   only if this becomes a bigger multi-team tool.
4. **No report image/template**, just text.
5. Squad list is per-device (`localStorage`), not synced to Supabase yet —
   fine for a single coach's phone, would need syncing if multiple people
   use the recorder.

## Conventions

- No build step anywhere — plain HTML/CSS/JS, opened directly or hosted
  statically (e.g. GitHub Pages). Keep it that way unless there's a good
  reason to add tooling.
- `localStorage` is the local persistence layer for the recorder and
  dashboard (this is a real deployable app, not a Claude.ai artifact — the
  usual "no localStorage" restriction doesn't apply here).
- Supabase config (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) lives as a `CONFIG`
  object at the top of `recorder/app.js` and `dashboard/app.js` — currently
  blank placeholders. Same values go in both places.
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

Wire up player ID resolution in the sync path (gap #1 above) so the
dashboard's per-player stats actually work end-to-end once real match data
starts flowing in.
