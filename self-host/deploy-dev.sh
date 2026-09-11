#!/usr/bin/env bash
# Same as deploy.sh, but for the dev overlay (docker-compose.dev.yml):
# starts/updates the dev containers alongside prod, applies schema.sql
# to matchday_dev, and reloads postgrest-dev's schema cache. Never
# touches prod data — matchday_dev is a separate database on the same
# Postgres server. Safe to rerun any time.
#
# Run from self-host/ (or anywhere — it cds to its own directory):
#   ./deploy-dev.sh
set -euo pipefail
cd "$(dirname "$0")"

echo "==> docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

echo "==> Applying schema.sql to matchday_dev"
docker compose exec -T postgres psql -U postgres -d matchday_dev < ../schema.sql

echo "==> Reloading postgrest-dev's schema cache"
docker compose exec postgres psql -U postgres -d matchday_dev -c "NOTIFY pgrst, 'reload schema';"

echo "==> Done"
