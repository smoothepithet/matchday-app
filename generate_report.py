"""
Match report generator.

Pulls a completed match + its events from Supabase and asks Claude
to write a short, social-media-ready match report. Prints the report
to stdout — wire up posting once you've decided on a platform/API.

Usage:
    export SUPABASE_URL="https://xxxx.supabase.co"
    export SUPABASE_ANON_KEY="..."
    export ANTHROPIC_API_KEY="..."
    python generate_report.py <match_id>
"""

import os
import sys
import json
import requests
from anthropic import Anthropic

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
TEAM_NAME = "Wyrley Rockets"


def fetch_match(match_id: str) -> dict:
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    }
    match_res = requests.get(
        f"{SUPABASE_URL}/rest/v1/matches",
        params={"id": f"eq.{match_id}"},
        headers=headers,
        timeout=10,
    )
    match_res.raise_for_status()
    matches = match_res.json()
    if not matches:
        raise ValueError(f"No match found with id {match_id}")
    match = matches[0]

    events_res = requests.get(
        f"{SUPABASE_URL}/rest/v1/events",
        params={"match_id": f"eq.{match_id}", "order": "minute.asc"},
        headers=headers,
        timeout=10,
    )
    events_res.raise_for_status()
    match["events"] = events_res.json()
    return match


def build_prompt(match: dict) -> str:
    events_text = "\n".join(
        f"- Minute {e.get('minute', '?')}: {e['event_type']}"
        + (f" (player_id: {e['player_id']})" if e.get("player_id") else "")
        for e in match["events"]
    )

    return f"""You are writing a short, upbeat match report for {TEAM_NAME}, a kids'
grassroots football team, for their social media (Instagram/Facebook caption
length — under 120 words).

Match facts:
- Team: {TEAM_NAME}
- Opposition: {match['opposition']}
- Venue: {match['venue']}
- Competition: {match.get('competition') or 'Friendly'}
- Final score ({TEAM_NAME} – Opposition): {match['our_score']} – {match['their_score']}

Event log (chronological):
{events_text or 'No individual events recorded.'}

Write in a warm, encouraging tone appropriate for kids' grassroots football —
celebrate effort and teamwork, not just the scoreline. Mention standout
moments from the event log where relevant. End with 2-3 relevant hashtags.
Do not invent names or stats that aren't in the data provided."""


def generate_report(match_id: str) -> str:
    match = fetch_match(match_id)
    prompt = build_prompt(match)

    client = Anthropic()  # reads ANTHROPIC_API_KEY from environment
    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python generate_report.py <match_id>")
        sys.exit(1)

    if not (SUPABASE_URL and SUPABASE_ANON_KEY):
        print("Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables first.")
        sys.exit(1)

    report = generate_report(sys.argv[1])
    print("\n--- MATCH REPORT ---\n")
    print(report)
    print("\n---------------------\n")
    print("Copy this into your team's social media app to post.")
