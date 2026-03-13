#!/usr/bin/env bash
set -euo pipefail

echo "== cd core =="
cd /opt/render/project/src/services/core

echo "== Engine 2: updateFibLevels (WRITE fib-levels.json) =="
node jobs/updateFibLevels.js

echo "ALL ENGINES DONE ✅"
