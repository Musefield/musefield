#!/usr/bin/env bash
set -euo pipefail
if [ -f ./.env ]; then set -a; source ./.env; set +a; fi
ports=()
[ -n "${AIB_PORT:-}" ] && ports+=("$AIB_PORT")
[ -n "${WEB_PORT:-}" ] && ports+=("$WEB_PORT")
fail=0
for p in "${ports[@]}"; do
  if ss -tulpn | grep -qE "LISTEN .*:$p\b"; then
    echo "❌ Port $p is in use"; fail=1
  else
    echo "✅ Port $p is free"
  fi
done
exit $fail
