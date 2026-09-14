#!/usr/bin/env python3
"""
Match report service — stdlib-only HTTP server that turns a match's
events into a short, social-media-ready report using an Ollama Cloud
model. Sits behind Traefik at /report on the same APP_HOSTNAME as
postgrest/gotrue (see ../docker-compose.yml).

Stateless: takes match+events JSON in the request body, returns the
generated report text. It never touches Postgres itself — the caller
(record/app.js) already holds an authenticated PostgREST session, so
it writes the returned text to the `reports` table itself, the same
pattern already used for events/awards.

OLLAMA_API_KEY stays server-side only here, same reasoning as why
ANTHROPIC_API_KEY is only ever used in generate_report.py and never
shipped to client-side JS. Requests must carry a valid Supabase-style
bearer token, checked against JWT_SECRET (the same secret PostgREST
and GoTrue verify with) — otherwise this would be an open,
unauthenticated way for anyone to burn through the Ollama Cloud quota.

Env vars:
    JWT_SECRET       same secret PostgREST/GoTrue use (HS256)
    OLLAMA_API_KEY   from https://ollama.com/settings/keys
    OLLAMA_MODEL     e.g. gpt-oss:120b (default below) — note this is the
                     *direct API* model name, with no "-cloud" suffix;
                     that suffix is only used by the local `ollama` CLI
                     to reference a cloud model, not by ollama.com's own
                     hosted API.
    TEAM_NAME        default "Wyrley Rockets"
    PORT             default 8080
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zoneinfo import ZoneInfo

JWT_SECRET = os.environ["JWT_SECRET"]
OLLAMA_API_KEY = os.environ["OLLAMA_API_KEY"]
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gpt-oss:120b")
TEAM_NAME = os.environ.get("TEAM_NAME", "Wyrley Rockets")
PORT = int(os.environ.get("PORT", "8080"))
OLLAMA_URL = "https://ollama.com/api/chat"


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_jwt(token: str) -> dict:
    """Verify signature + expiry of a Supabase-style HS256 JWT. Raises
    ValueError on anything invalid. Mirrors mint_jwt.py's signing side."""
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError:
        raise ValueError("malformed token")
    signing_input = f"{header_b64}.{payload_b64}".encode()
    expected_sig = hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected_sig, b64url_decode(sig_b64)):
        raise ValueError("bad signature")
    payload = json.loads(b64url_decode(payload_b64))
    if payload.get("exp", 0) < time.time():
        raise ValueError("expired")
    if payload.get("role") != "authenticated":
        raise ValueError("wrong role")
    return payload


GOAL_TYPE_LABELS = {"open_play": "open play", "free_kick": "free kick", "penalty": "penalty"}

# Raw event_type values are internal names, not sentences - printing
# them straight into the prompt (as this used to do for "own_goal")
# gives the model no context and it fills the gap with a guess, which
# is how a normal conceded goal once turned into a nonsensical "home
# goal" in a generated report. Every value gets a plain-English label
# here instead.
EVENT_TYPE_LABELS = {
    "goal": "goal",
    "assist": "assist",
    "save": "save",
    "goal_against": "goal conceded (opposition scored)",
    "woodwork": "hit the woodwork (bar/post)",
    "half_time": "half-time",
    "full_time": "full-time",
}


UK_TZ = ZoneInfo("Europe/London")


def format_kickoff(kickoff_at: str | None) -> str | None:
    """kickoff_at is the ISO UTC timestamp record/app.js captured when Kick
    Off was pressed (match.startedAt) - converts it to a human-readable UK
    local time/date. Returns None for a missing/malformed value (matches
    synced before this field existed) rather than raising, since a report
    should still generate fine without it."""
    if not kickoff_at:
        return None
    try:
        dt = datetime.fromisoformat(kickoff_at.replace("Z", "+00:00")).astimezone(UK_TZ)
    except ValueError:
        return None
    # No-padding day/hour built manually rather than via strftime's
    # "%-d"/"%-I" - that's a glibc extension, not guaranteed to work the
    # same way (or at all) under Alpine's musl libc, which this actually
    # runs under. %A/%B are plain strftime and portable everywhere.
    hour12 = dt.hour % 12 or 12
    ampm = "am" if dt.hour < 12 else "pm"
    return f"{dt.strftime('%A')} {dt.day} {dt.strftime('%B')}, {hour12}:{dt.minute:02d}{ampm}"


def build_prompt(match: dict) -> str:
    # The caller (record/app.js) builds this array in real time as events
    # happen during the live match, so it's already chronological by
    # construction - never re-sorted here. Told to the model explicitly
    # anyway (rather than just labelled "chronological" and hoped for)
    # since an LLM asked to "mention standout moments" has otherwise been
    # observed re-ordering them for narrative flow.
    events = match.get("events") or []
    lines = []
    for e in events:
        label = EVENT_TYPE_LABELS.get(e.get("event_type"), e.get("event_type"))
        line = f"- Minute {e.get('minute', '?')}: {label}"
        if e.get("player_name"):
            line += f" ({e['player_name']})"
        elif e.get("event_type") == "goal":
            # A goal with no player attached means the coach skipped the
            # scorer picker (unknown/missed in the moment) - explicit here
            # so the model doesn't invent an explanation for the gap, the
            # same failure mode that turned an unattributed goal into a
            # fabricated "own goal gifted to us" in a past report.
            line += " (scorer not recorded)"
        if e.get("goal_type") and e["goal_type"] != "open_play":
            line += f" — {GOAL_TYPE_LABELS[e['goal_type']]}"
        lines.append(line)
    events_text = "\n".join(lines)

    notes = (match.get("notes") or "").strip()
    notes_block = f"\n\nCoach's notes (additional context for this match):\n{notes}" if notes else ""

    kickoff = format_kickoff(match.get("kickoff_at"))
    kickoff_line = f"\n- Kick-off: {kickoff}" if kickoff else ""

    return f"""You are writing a short, upbeat match report for {TEAM_NAME}, a kids'
grassroots football team, for their social media (Instagram/Facebook caption
length — under 120 words).

Match facts:
- Team: {TEAM_NAME}
- Opposition: {match.get('opposition', 'the opposition')}
- Venue: {match.get('venue', '')}
- Competition: {match.get('competition') or 'Friendly'}
- Final score ({TEAM_NAME} – Opposition): {match.get('our_score', 0)} – {match.get('their_score', 0)}{kickoff_line}

Event log (already sorted chronologically by minute — keep them in this
exact order, do not re-sort or re-group them for narrative effect):
{events_text or 'No individual events recorded.'}{notes_block}

Write in a warm, encouraging tone appropriate for kids' grassroots football —
celebrate effort and teamwork, not just the scoreline. Mention standout
moments from the event log where relevant, by name. End with 2-3 relevant
hashtags. Do not invent names, stats, or explanations that aren't in the
data provided — if a goal is marked "scorer not recorded", just count it
towards the team's total without guessing who scored it or how (never
describe it as an own goal, a gift, or anything else not stated above).
Do not invent atmospheric or scene-setting details that aren't given above
either — time of day, weather, lighting (e.g. "under the floodlights" for
a match with no stated kick-off time), pitch conditions, crowd size, and
so on. If kick-off time isn't listed above, don't guess or imply one."""


def call_ollama(prompt: str) -> str:
    body = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }).encode()
    req = urllib.request.Request(
        OLLAMA_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {OLLAMA_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        data = json.loads(res.read())
    return (data.get("message", {}).get("content") or "").strip()


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path == "/healthz":
            self._send_json(200, {"ok": True})
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/generate":
            self._send_json(404, {"error": "not found"})
            return

        auth = self.headers.get("Authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else ""
        try:
            verify_jwt(token)
        except ValueError as err:
            self._send_json(401, {"error": f"unauthorized: {err}"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            match = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON body"})
            return

        prompt = build_prompt(match)
        try:
            report = call_ollama(prompt)
        except urllib.error.HTTPError as err:
            self._send_json(502, {"error": f"ollama error: {err.read().decode(errors='replace')[:300]}"})
            return
        except urllib.error.URLError as err:
            self._send_json(502, {"error": f"ollama unreachable: {err}"})
            return

        if not report:
            self._send_json(502, {"error": "ollama returned an empty response"})
            return

        self._send_json(200, {"report": report})

    def log_message(self, fmt, *args):
        pass  # keep container logs quiet; docker still captures stdout/stderr on crash


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"report-service listening on :{PORT}")
    server.serve_forever()
