#!/bin/sh
# Proposed Backend-1 launcher. NOT selected in Render; owner approval required.
# Preserve Engine8 watcher, HTTP server, and optional Engine27 worker.
set -u
watcher_pid=""
recorder_pid=""
server_pid=""
shutting_down=0
shutdown() {
  if [ "$shutting_down" -ne 0 ]; then return; fi
  shutting_down=1
  [ -z "$recorder_pid" ] || kill -TERM "$recorder_pid" 2>/dev/null || true
  [ -z "$watcher_pid" ] || kill -TERM "$watcher_pid" 2>/dev/null || true
  [ -z "$server_pid" ] || kill -TERM "$server_pid" 2>/dev/null || true
  [ -z "$recorder_pid" ] || wait "$recorder_pid" 2>/dev/null || true
  [ -z "$watcher_pid" ] || wait "$watcher_pid" 2>/dev/null || true
  [ -z "$server_pid" ] || wait "$server_pid" 2>/dev/null || true
}
trap shutdown TERM INT EXIT
(
  while :; do
    node services/core/jobs/watchEngine8RealSchwabFills.js
    sleep 5
  done
) &
watcher_pid=$!
if [ "${ENGINE27_V6_RECORDER_ENABLED:-false}" = "true" ]; then
  (
    worker_child=""
    stop_worker() {
      [ -z "$worker_child" ] || kill -TERM "$worker_child" 2>/dev/null || true
      [ -z "$worker_child" ] || wait "$worker_child" 2>/dev/null || true
      exit 0
    }
    trap stop_worker TERM INT
    attempts=0
    while [ "$attempts" -lt 5 ]; do
      node services/core/jobs/runEngine27V6Recorder.js &
      worker_child=$!
      wait "$worker_child"
      result=$?
      worker_child=""
      [ "$result" -ne 0 ] || exit 0
      attempts=$((attempts + 1))
      [ "$attempts" -lt 5 ] || break
      sleep 60
    done
    echo "[engine27-v6-recorder] stopped after bounded restart attempts" >&2
    exit 1
  ) &
  recorder_pid=$!
fi
node services/core/server.js &
server_pid=$!
wait "$server_pid"
