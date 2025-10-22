#!/usr/bin/env bash
set -euo pipefail
for f in migrations/*.sql; do
  echo "[db] applying $f"
  docker compose cp "$f" db:/tmp/m.sql
  docker compose exec -T db psql -U muse -d musefield -f /tmp/m.sql >/dev/null
done
echo "[db] done."
