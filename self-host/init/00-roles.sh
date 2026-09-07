#!/bin/bash
# Runs once, before 01-schema.sql, only on first container start (empty
# data dir). Creates the PostgREST role model: a low-privilege login role
# ("authenticator") that PostgREST connects as, which can SET ROLE to
# "anon" or "authenticated" per-request based on the caller's JWT.
# schema.sql's GRANT/REVOKE statements target "anon"/"authenticated" and
# will fail if these roles don't already exist, so this must run first —
# the "00-" filename prefix guarantees that (initdb.d runs files in
# alphabetical order).
#
# Also creates the "auth" schema GoTrue's own migrations expect to
# already exist (CREATE TABLE auth.users ... fails otherwise, even for a
# superuser — Postgres won't auto-create a missing schema). Real
# Supabase deployments get this from their custom Postgres image; plain
# postgres:16-alpine needs it done explicitly.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  create schema if not exists auth;

  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role authenticator noinherit login password '$AUTHENTICATOR_PASSWORD';
  grant anon to authenticator;
  grant authenticated to authenticator;
EOSQL
