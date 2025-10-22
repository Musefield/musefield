#!/usr/bin/env bash
set -euo pipefail
REPO="/srv/musefield"
OUT="$REPO/docs/DECISIONS.md"
cd "$REPO"

SINCE="${1:-14 days ago}"
echo "# Decisions (last 14 days)" > "$OUT"
echo >> "$OUT"
git log --since="$SINCE" --pretty='- %h %ad **%s**' --date=short >> "$OUT"

# lightweight commit if changed
if ! git diff --quiet -- "$OUT"; then
  git add "$OUT"
  git commit -m "docs: update DECISIONS.md (sync last 14 days)"
fi
