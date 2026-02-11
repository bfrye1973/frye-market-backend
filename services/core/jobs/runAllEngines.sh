#!/usr/bin/env bash
set -euo pipefail

echo "== cd core =="
cd /opt/render/project/src/services/core

API_BASE="${API_BASE:-http://127.0.0.1:10000}"
SYMBOL="${SYMBOL:-SPY}"

echo "== Engine 1: runEngine1AndShelves (levels + shelves) =="
node jobs/runEngine1AndShelves.js

echo "== Engine 2: updateFibLevels (WRITE fib-levels.json) =="
node jobs/updateFibLevels.js

echo "== Engine 2: warm fib endpoints (READ, verify) =="
# 10m minute
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=10m&degree=minute&wave=W1" >/dev/null || true
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=10m&degree=minute&wave=W4" >/dev/null || true
# 1h minor
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=1h&degree=minor&wave=W1" >/dev/null || true
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=1h&degree=minor&wave=W4" >/dev/null || true
# 1h intermediate
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=1h&degree=intermediate&wave=W1" >/dev/null || true
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=1h&degree=intermediate&wave=W4" >/dev/null || true
# 1d primary
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=1d&degree=primary&wave=W1" >/dev/null || true
curl -fsS "${API_BASE}/api/v1/fib-levels?symbol=${SYMBOL}&tf=1d&degree=primary&wave=W4" >/dev/null || true

echo "== Engine 5: warm confluence (READ) =="
# These hits make sure confluence is hot for dashboard-snapshot
curl -fsS "${API_BASE}/api/v1/confluence-score?symbol=${SYMBOL}&tf=10m&degree=minute&wave=W1&strategyId=intraday_scalp@10m" >/dev/null || true
curl -fsS "${API_BASE}/api/v1/confluence-score?symbol=${SYMBOL}&tf=1h&degree=minor&wave=W1&strategyId=minor_swing@1h" >/dev/null || true
curl -fsS "${API_BASE}/api/v1/confluence-score?symbol=${SYMBOL}&tf=4h&degree=intermediate&wave=W1&strategyId=intermediate_long@4h" >/dev/null || true

echo "ALL ENGINES DONE ✅"

