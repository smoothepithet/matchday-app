#!/usr/bin/env bash
# Brings the prod stack up to date: starts/updates containers, applies
# schema.sql to the live `matchday` database, and tells PostgREST to
# reload its schema cache. Safe to rerun any time — every statement in
# schema.sql is create-if-not-exists / alter-if-not-exists, so this
# picks up new tables/columns without touching existing data.
#
# Run from self-host/ (or anywhere — it cds to its own directory):
#   ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> docker compose up -d"
docker compose up -d

echo "==> Applying schema.sql to matchday"
docker compose exec -T postgres psql -U postgres -d matchday < ../schema.sql

echo "==> Reloading PostgREST's schema cache"
docker compose exec postgres psql -U postgres -d matchday -c "NOTIFY pgrst, 'reload schema';"

echo "==> Done"
