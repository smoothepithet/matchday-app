#!/usr/bin/env python3
"""Mint a Supabase-style HS256 JWT for the self-hosted GoTrue/PostgREST stack.

No dependencies beyond the standard library — this is just enough JWT
signing to stand in for what Supabase's dashboard normally hands you.

Usage:
    python mint_jwt.py <role> <secret> [years_valid]

Examples:
    # anon key -> goes in CONFIG.SUPABASE_ANON_KEY in app.js / dashboard/app.js
    python mint_jwt.py anon "$JWT_SECRET" 10

    # service_role key -> only used server-side, to call GoTrue's admin API
    # (e.g. to create the coach login). Never put this in client-side JS.
    python mint_jwt.py service_role "$JWT_SECRET" 10
"""
import base64
import hashlib
import hmac
import json
import sys
import time


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def mint(role: str, secret: str, years: float = 10) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "role": role,
        "iss": "matchday-self-host",
        "iat": now,
        "exp": now + int(years * 365.25 * 24 * 3600),
    }
    signing_input = (
        f"{b64url(json.dumps(header, separators=(',', ':')).encode())}."
        f"{b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    )
    signature = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f"{signing_input}.{b64url(signature)}"


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    role_arg = sys.argv[1]
    secret_arg = sys.argv[2]
    years_arg = float(sys.argv[3]) if len(sys.argv) > 3 else 10
    print(mint(role_arg, secret_arg, years_arg))
