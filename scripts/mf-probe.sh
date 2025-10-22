#!/usr/bin/env bash
set -euo pipefail
URL="${MF_PROBE_URL:-http://host.docker.internal:8081/healthz}"

# In Linux containers, host.docker.internal may not resolve; fallback to localhost.
if ! curl -s -o /dev/null "$URL"; then
  URL="http://localhost:8081/healthz"
fi

n=5
ok=0
sum_ms=0
for i in $(seq 1 $n); do
  t=$(curl -s -o /dev/null -w "%{time_total}" "$URL" || echo "0")
  # convert seconds -> ms safely
  ms=$(python3 - <<PY
try:
  print(int(float("$t")*1000))
except:
  print(0)
PY
)
  body="$(curl -s "$URL" || true)"
  if echo "$body" | grep -qi "ok"; then ok=$((ok+1)); fi
  sum_ms=$((sum_ms+ms))
done

avg_ms=$(( n>0 ? sum_ms/n : 0 ))
cat <<JSON
{
  "url": "$URL",
  "samples": $n,
  "ok_count": $ok,
  "avg_latency_ms": $avg_ms
}
JSON
