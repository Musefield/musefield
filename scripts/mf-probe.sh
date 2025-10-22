#!/usr/bin/env bash
set -euo pipefail
URL="${MF_PROBE_URL:-http://host.docker.internal:8081/healthz}"

# If the URL doesn't respond, try common fallbacks (order matters)
try_url() { curl -s -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"; }

code="$(try_url "$URL")"
if ! echo "$code" | grep -qE '^(2|3)'; then
  for p in /healthz / /metrics; do
    test_url="http://host.docker.internal:8081${p}"
    code="$(try_url "$test_url")"
    if echo "$code" | grep -qE '^(2|3)'; then URL="$test_url"; break; fi
  done
fi

# If host.docker.internal fails entirely, last-ditch: try localhost (useful on host, not in container)
if ! echo "$code" | grep -qE '^(2|3)'; then
  for p in /healthz / /metrics; do
    test_url="http://localhost:8081${p}"
    code="$(try_url "$test_url")"
    if echo "$code" | grep -qE '^(2|3)'; then URL="$test_url"; break; fi
  done
fi

n=5
ok=0
sum_ms=0
for i in $(seq 1 "$n"); do
  t=$(curl -s -o /dev/null -w "%{time_total}" "$URL" 2>/dev/null || echo "0")
  ms=$(python3 - <<PY
try:
  print(int(float("$t")*1000))
except Exception:
  print(0)
PY
)
  code=$(curl -s -o /tmp/mf_probe_body -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
  if echo "$code" | grep -qE '^(2|3)'; then
    ok=$((ok+1))
  elif grep -qi "ok" /tmp/mf_probe_body 2>/dev/null; then
    ok=$((ok+1))
  fi
  sum_ms=$((sum_ms+ms))
done

avg_ms=$(( n>0 ? sum_ms/n : 0 ))

# JSON ONLY
printf '{"url":"%s","samples":%d,"ok_count":%d,"avg_latency_ms":%d}\n' "$URL" "$n" "$ok" "$avg_ms"
