# Wyrley Rockets — Matchday Stats App

Continuing this project in VS Code / Claude Code? Read `CLAUDE.md` first —
it has the full design system, data model, and known-gaps list.

Three pieces that share one Supabase database:

```
index.html, app.js, styles.css   Match-day recorder PWA — install to a phone, record events
                                  pitch-side, works offline
dashboard/                       Private season-stats page — top scorers, assists, saves,
                                  results log
generate_report.py               Python script that turns a match's events into a
                                  social-media-ready report
schema.sql                       Database schema — run this first
```

## 1. Set up the database

1. Create a free project at supabase.com
2. In the SQL editor, run `schema.sql`
3. Copy your project URL and anon key from Settings → API

## 2. Configure the apps

Paste your Supabase URL + anon key into:
- `app.js` (top of file, `CONFIG`)
- `dashboard/app.js` (top of file, `CONFIG`)

## 3. Create the coach login

Both apps are gated behind a Supabase Auth login (one shared account is
enough for a single-team app):

1. Supabase Dashboard → Authentication → Users → **Add user**
2. Set an email + password, and check **Auto Confirm User** (otherwise
   sign-in fails with "Email not confirmed")
3. Optional but recommended: Authentication → Settings → raise the JWT/
   session expiry above the 1hr default, since matches can run 90+ minutes

## 4. Try the recorder

Open `index.html` on a phone (host it somewhere simple — GitHub Pages
works well and is free), sign in with the coach account, and add it to your
home screen for the full app-like feel. It works fully offline once signed
in; events queue locally and sync automatically once you're back on signal.

## 5. Try the dashboard

Open `dashboard/index.html` anywhere and sign in with the same coach
account. It reads two views defined in the schema — `player_season_stats`
and `results_log` — so there's no app logic to duplicate if you want to
build other views later (e.g. a league table).

## 6. Generate a match report

```bash
pip install anthropic requests
export SUPABASE_URL="..."
export SUPABASE_ANON_KEY="..."
export ANTHROPIC_API_KEY="..."
python generate_report.py <match_id>
```

This prints a caption-ready report. For now, posting is manual (copy/paste) —
see the note on social APIs below.

## Known limitations / next steps

- **No automated social posting.** Instagram/Facebook require Meta app review
  and business verification; X requires a paid API tier for posting. Given
  the overhead for a grassroots team, manual copy-paste is the pragmatic v1.
  Worth revisiting if this becomes a multi-team tool.
- **Report images aren't generated yet** — just text. Could add a simple
  HTML-to-image template (badge, scoreline, sponsor logo) as a follow-up.

## Suggested next step

Get the recorder + dashboard working end-to-end with one real match first —
that'll surface any rough edges in the data model before we build further.
