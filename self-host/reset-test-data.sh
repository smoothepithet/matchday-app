#!/usr/bin/env bash
# Wipes match history from the PROD `matchday` database — matches, events,
# awards, and reports — while keeping the players table untouched, so the
# squad roster doesn't need re-entering. Intended for clearing out test
# data before a season starts for real.
#
# This is destructive and NOT reversible without a backup. Run it only on
# the box hosting the prod stack (same place you run ./deploy.sh), from
# self-host/:
#   ./reset-test-data.sh
#
# It asks for a typed confirmation before touching anything.
set -euo pipefail
cd "$(dirname "$0")"

echo "This will PERMANENTLY delete all matches, events, awards, and"
echo "reports from the PROD 'matchday' database. Players are kept."
read -r -p "Type RESET to continue: " confirm
if [ "$confirm" != "RESET" ]; then
  echo "Aborted — nothing was deleted."
  exit 1
fi

echo "==> Truncating matches, events, awards, reports on matchday"
docker compose exec -T postgres psql -U postgres -d matchday -c \
  "truncate table events, matches, awards, reports restart identity cascade;"

echo "==> Reloading PostgREST's schema cache"
docker compose exec postgres psql -U postgres -d matchday -c "NOTIFY pgrst, 'reload schema';"

echo "==> Done — players table untouched, everything else is now empty."
