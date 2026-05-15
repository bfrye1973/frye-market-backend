#!/usr/bin/env bash
set -euo pipefail

echo "== cd core =="
cd /opt/render/project/src/services/core

echo "== Engine chain (without Engine 1 duplicate, without warm curls) =="

echo "== Engine 2: updateFibLevels =="
node jobs/updateFibLevels.js

echo "== Strategy Snapshots: SPY + ES =="
node jobs/buildAllStrategySnapshots.js

echo "ALL_ENGINES_DONE ✅"
