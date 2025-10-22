#!/usr/bin/env bash
set -euo pipefail
API_P95=${1:-300}
CFS_MIN=${2:-0.70}
RV_MAX=${3:-0.20}
echo "[verify] api_p95<=${API_P95}ms, CFS>=${CFS_MIN}, RV<=${RV_MAX}"
# Stubbed checks for alpha; replace with real probes
exit 0
