# Wyrley Rockets — Matchday Stats App

Continuing this project in VS Code / Claude Code? Read `CLAUDE.md` first —
it has the full design system, data model, and known-gaps list.

Three pieces that share one Supabase database:

```
recorder/           Match-day PWA — install to a phone, record events pitch-side, works offline
dashboard/           Private season-stats page — top scorers, assists, saves, results log
report-generator/    Python script that turns a match's events into a social-media-ready report
supabase/schema.sql  Database schema — run this first
```

## 1. Set up the database

1. Create a free project at supabase.com
2. In the SQL editor, run `supabase/schema.sql`
3. Copy your project URL and anon key from Settings → API

## 2. Configure the apps

Paste your Supabase URL + anon key into:
- `recorder/app.js` (top of file, `CONFIG`)
- `dashboard/app.js` (top of file, `CONFIG`)

## 3. Try the recorder

Open `recorder/index.html` on a phone (host it somewhere simple — GitHub Pages
works well and is free). Add it to your home screen for the full app-like feel.
It works fully offline; events queue locally and sync automatically once
you're back on signal.

## 4. Try the dashboard

Open `dashboard/index.html` anywhere. It reads two views defined in the
schema — `player_season_stats` and `results_log` — so there's no app logic
to duplicate if you want to build other views later (e.g. a league table).

## 5. Generate a match report

```bash
cd report-generator
pip install anthropic requests
export SUPABASE_URL="..."
export SUPABASE_ANON_KEY="..."
export ANTHROPIC_API_KEY="..."
python generate_report.py <match_id>
```

This prints a caption-ready report. For now, posting is manual (copy/paste) —
see the note on social APIs below.

## Known limitations / next steps

- **Player ID resolution isn't wired up yet.** The recorder now has proper
  player profiles (name + shirt number, added once via "Manage Squad" and
  reused every match), but the sync step still sends player *names* to
  Supabase rather than looking up/creating matching rows in the `players`
  table. Worth fixing before relying on the dashboard's per-player stats.
- **Row Level Security is wide open** (`allow all for now` policies). Fine
  for testing, but lock this down with Supabase Auth before any real personal
  data (even just kids' first names) sits in a publicly reachable database.
- **No automated social posting.** Instagram/Facebook require Meta app review
  and business verification; X requires a paid API tier for posting. Given
  the overhead for a grassroots team, manual copy-paste is the pragmatic v1.
  Worth revisiting if this becomes a multi-team tool.
- **Report images aren't generated yet** — just text. Could add a simple
  HTML-to-image template (badge, scoreline, sponsor logo) as a follow-up.

## Suggested next step

Get the recorder + dashboard working end-to-end with one real match first —
that'll surface any rough edges in the data model before we build further.
