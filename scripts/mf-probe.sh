#!/usr/bin/env bash
set -euo pipefail
URL="${MF_PROBE_URL:-http://host.docker.internal:8081/healthz}"

# Fallback to localhost if host.docker.internal doesn't resolve
if ! curl -s -o /dev/null "$URL"; then
  URL="http://localhost:8081/healthz"
fi

n=5
ok=0
sum_ms=0

for i in $(seq 1 "$n"); do
  # time_total is seconds; convert to ms (safely)
  t=$(curl -s -o /dev/null -w "%{time_total}" "$URL" || echo "0")
  ms=$(python3 - <<PY
try:
  print(int(float("$t")*1000))
except Exception:
  print(0)
PY
)
  # treat any 2xx as ok (and also count body that includes "ok")
  code=$(curl -s -o /tmp/mf_probe_body -w "%{http_code}" "$URL" || echo "000")
  if echo "$code" | grep -qE '^2'; then ok=$((ok+1)); else
    if grep -qi "ok" /tmp/mf_probe_body 2>/dev/null; then ok=$((ok+1)); fi
  fi
  sum_ms=$((sum_ms+ms))
done

avg_ms=0
if [ "$n" -gt 0 ]; then avg_ms=$((sum_ms/n)); fi

cat <<JSON
{
  "url": "$URL",
  "samples": $n,
  "ok_count": $ok,
  "avg_latency_ms": $avg_ms
}
JSON
