"""
Generate (or regenerate) a match report via the real report-service
(Ollama Cloud) - the same flow record/app.js triggers automatically after
End Match, just run manually for a match_id that already synced without
one. Needed whenever a match reaches the `matches` table through a path
that doesn't also call generateAndSaveReport() - e.g. a match that sat in
the offline sync queue (record/app.js's flushSyncQueues(), before it also
called generateAndSaveReport() per-match) - or because Ollama Cloud was
briefly down/over quota when the match originally ended.

Unlike generate_report.py (a separate, Anthropic/Claude-based reference
script, not part of the live flow, and not usable as-is against this
project's locked-down RLS since it authenticates as the anon key rather
than a signed-in user), this hits the actual report-service the apps use
and saves the result into `reports` itself, exactly like the real flow
does - so a report generated this way is indistinguishable from one
generated automatically.

Usage:
    export SUPABASE_URL="https://matchday-api.shadowlan.org"
    export SUPABASE_ANON_KEY="..."
    export COACH_EMAIL="..."
    export COACH_PASSWORD="..."
    python regenerate_report.py <match_id>
"""

import os
import sys

import requests

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
COACH_EMAIL = os.environ.get("COACH_EMAIL", "")
COACH_PASSWORD = os.environ.get("COACH_PASSWORD", "")


def check(res: requests.Response, what: str) -> requests.Response:
    """res.raise_for_status() alone only prints the HTTP status, not the
    actual reason the server gave (e.g. GoTrue's "Invalid login
    credentials", or PostgREST's specific rejection message) - same
    "surface what really went wrong" approach used throughout the rest
    of this app rather than a bare traceback."""
    if not res.ok:
        try:
            detail = res.json()
        except ValueError:
            detail = res.text
        raise SystemExit(f"{what} failed (HTTP {res.status_code}): {detail}")
    return res


def sign_in() -> str:
    res = check(
        requests.post(
            f"{SUPABASE_URL}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json"},
            json={"email": COACH_EMAIL, "password": COACH_PASSWORD},
            timeout=10,
        ),
        "Sign-in",
    )
    return res.json()["access_token"]


def fetch_match(match_id: str, token: str) -> dict:
    headers = {"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"}

    match_res = check(
        requests.get(
            f"{SUPABASE_URL}/rest/v1/matches",
            params={"id": f"eq.{match_id}"},
            headers=headers,
            timeout=10,
        ),
        "Match fetch",
    )
    matches = match_res.json()
    if not matches:
        raise SystemExit(f"No match found with id {match_id}")
    match = matches[0]

    # Embedded resource syntax (players(name)) pulls the scorer's/etc.
    # name in via events.player_id's foreign key in one request, rather
    # than a separate players fetch + manual join - report-service's
    # build_prompt() wants player_name directly, not player_id.
    events_res = check(
        requests.get(
            f"{SUPABASE_URL}/rest/v1/events",
            params={
                "match_id": f"eq.{match_id}",
                "select": "event_type,minute,goal_type,players(name)",
                "order": "minute.asc",
            },
            headers=headers,
            timeout=10,
        ),
        "Events fetch",
    )
    match["events"] = [
        {
            "event_type": e["event_type"],
            "minute": e["minute"],
            "goal_type": e.get("goal_type"),
            "player_name": (e.get("players") or {}).get("name"),
        }
        for e in events_res.json()
    ]
    return match


def generate_and_save(match_id: str) -> str:
    token = sign_in()
    match = fetch_match(match_id, token)

    gen_res = check(
        requests.post(
            f"{SUPABASE_URL}/report/generate",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
            json={
                "opposition": match["opposition"],
                "venue": match["venue"],
                "competition": match.get("competition"),
                "our_score": match["our_score"],
                "their_score": match["their_score"],
                "notes": match.get("notes"),
                "kickoff_at": match.get("kickoff_at"),
                "events": match["events"],
            },
            timeout=90,
        ),
        "Report generation",
    )
    report_text = gen_res.json()["report"]

    check(
        requests.post(
            f"{SUPABASE_URL}/rest/v1/reports",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"match_id": match_id, "report_text": report_text},
            timeout=10,
        ),
        "Report save",
    )
    return report_text


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python regenerate_report.py <match_id>")
        sys.exit(1)

    if not (SUPABASE_URL and SUPABASE_ANON_KEY and COACH_EMAIL and COACH_PASSWORD):
        print("Set SUPABASE_URL, SUPABASE_ANON_KEY, COACH_EMAIL, and COACH_PASSWORD first.")
        sys.exit(1)

    report = generate_and_save(sys.argv[1])
    print("\n--- REPORT SAVED ---\n")
    print(report)
    print("\n---------------------\n")
