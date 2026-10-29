#!/bin/sh
# Proposed Backend-1 startCommand only, not yet selected in Render.
# exec replaces the shell with a Node supervisor that owns the actual watcher,
# core server and optional recorder child PIDs; no background shell grandchildren.
set -eu
exec node services/core/jobs/superviseBackend1V6.js
