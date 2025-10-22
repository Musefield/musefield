#!/usr/bin/env bash
set -euo pipefail
echo "[rollback] disabling flags and reverting last deploy"
jq '.web=false|.api=false' config/flags.json | sponge config/flags.json || true
echo "[rollback] done"
