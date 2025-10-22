#!/usr/bin/env bash
set -euo pipefail
LEDGER="${1:-/srv/musefield/reports/musefund-flow.csv}"
PERIOD="${2:-$(date -u +%Y-%m)}"
PROFIT="${3:-0}"
PCT="${4:-0.10}"
NOTES="${5:-initial allocation}"

alloc=$(python3 - <<PY
profit=float("$PROFIT"); pct=float("$PCT")
print(round(profit*pct, 2))
PY
)
echo "$(date -u +%F),$PERIOD,$PROFIT,$PCT,$alloc,$NOTES" >> "$LEDGER"
echo "Recorded: period=$PERIOD profit=$PROFIT pct=$PCT allocated=$alloc -> $LEDGER"
