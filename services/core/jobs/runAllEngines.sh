#!/usr/bin/env bash
set -euo pipefail

echo "== cd core =="
cd /opt/render/project/src/services/core

echo "== Engine chain (without Engine 1 duplicate, without warm curls) =="

echo "== Engine 2: updateFibLevels =="
node jobs/updateFibLevels.js

echo "== Strategy Snapshot: buildStrategySnapshot =="
node jobs/buildStrategySnapshot.js

echo "ALL_ENGINES_DONE ✅"
