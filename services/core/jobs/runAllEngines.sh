#!/usr/bin/env bash
set -euo pipefail

BASE="https://frye-market-backend-1.onrender.com"

echo "== cd core =="
cd /opt/render/project/src/services/core

echo "== Engine 1: updateSmzLevels =="
node jobs/updateSmzLevels.js

echo "== Engine 1: updateSmzShelves =="
node jobs/updateSmzShelves.js

echo "== Engine 2: warm fib endpoints =="
curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=1d&degree=primary&wave=W1" >/dev/null || true
curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=1d&degree=primary&wave=W4" >/dev/null || true

curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=1h&degree=intermediate&wave=W1" >/dev/null || true
curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=1h&degree=intermediate&wave=W4" >/dev/null || true

curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=1h&degree=minor&wave=W1" >/dev/null || true
curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=1h&degree=minor&wave=W4" >/dev/null || true

curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=10m&degree=minute&wave=W1" >/dev/null || true
curl -fsS "$BASE/api/v1/fib-levels?symbol=SPY&tf=10m&degree=minute&wave=W4" >/dev/null || true

echo "== Engine 5: warm confluence =="
curl -fsS "$BASE/api/v1/confluence-score?symbol=SPY&tf=1h&degree=minor&wave=W1" >/dev/null || true

echo "ALL ENGINES DONE ✅"
