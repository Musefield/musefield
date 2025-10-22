#!/usr/bin/env bash
set -euo pipefail
URL="${MF_PROBE_URL:-http://host.docker.internal:8081/healthz}"
if ! curl -s -o /dev/null "$URL"; then
  URL="http://localhost:8081/healthz"
fi

# Success if we get "ok" and HTTP 200
code=$(curl -s -o /tmp/mf_test_body -w "%{http_code}" "$URL" || echo "000")
if [ "$code" = "200" ] && grep -qi "ok" /tmp/mf_test_body; then
  exit 0
else
  exit 1
fi
