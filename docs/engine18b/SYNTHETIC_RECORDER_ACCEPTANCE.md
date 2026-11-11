# Engine 18B Gate 1 — Synthetic Recorder Implementation & Acceptance Evidence

Date: 2026-11-10 (Arizona). Status: **implementation candidate / manager and Claude review pending**. This report does not grant production deployment, licensed market-data recording, trading, or Gate 1 exit approval.

## Scope
- Isolated Node.js module: `services/core/logic/engine18/gate1RawRecorder.js`.
- Node `node:test` regression suite: `services/core/tests/engine18Gate1RawRecorder.test.js`.
- Scoped GitHub Actions workflow: `.github/workflows/engine18b-gate1-recorder.yml`.
- Source branch: `engine18b-gate1-recorder-synthetic-20261110`; review target `engine18-liquidity-intelligence-foundation-20261109`.
- All raw events use the **exact input string** as the `raw` field; JSONL envelopes include `localSeq`, wall/monotonic timestamps, stream generation, class, and safe status code.
- Hourly gzip archives partition by provider / physical contract / provisional CME ETH trade date / UTC hour. SHA-256 manifest includes counts, time range, byte count and sequence range.
- Crash recovery truncates an incomplete trailing JSONL line, finalizes valid records, emits a durable `GAP` status record, and never silently fabricates an unobserved market message.
- Archive manifest and gzip are published with temp+rename and file/directory fsync; interrupted temp files are handled conservatively; archives verified before replay; missing sequences are errors.
- A per-ack durable high-watermark checkpoint detects loss of the **last** archived segment even when its manifest is also deleted, provided the checkpoint remains intact. This is local crash-consistency evidence, not independent remote attestation; deletion or tampering of all local state cannot be ruled out.
- Missing original gzip manifest produces a durable `integrity-unverified.json` record and refuses replay/recovery. No recomputed manifest can masquerade as evidence of original integrity.
- A separate-process expected byte fixture and real OS `SIGKILL`/restart regression test assert acknowledged events are not duplicated and recovery GAP is persisted.
- Per-root writer lock is **single-host local filesystem only**. Malformed active lock or live PID causes fail-closed.
- Health API is an in-process object of counters and nonsecret identity only. **There is no HTTP health route in this milestone.**

## Repeatable test command
```bash
node --check services/core/logic/engine18/gate1RawRecorder.js
node --test services/core/tests/engine18Gate1RawRecorder.test.js
```
CI workflow on PR #291 runs both. The manager's additional synthetic tests expand the suite to 16. Consult latest GitHub Actions run rather than relying on an outdated copied number.

## Security boundary
- `provider !== SYNTHETIC` is explicitly rejected.
- No Ironbeam WebSocket connection, secrets, bearer URL, Render disk mount, S3/R2 upload, market-data purchase, chart change, Engine 11/22 edit, or trading code has been added.
- Callers must never pass secret-bearing control messages; status records must be generated from safe codes and sanitized descriptions. No public raw payload endpoint exists.
- Gzip SHA-256 detects accidental edits; it is **not cryptographic authenticity against an attacker who can rewrite the file and manifest**. Production design needs private storage access controls, encryption, retention and immutable/audited storage as appropriate.

## Limits and blockers (not complete)
1. CME session calendar: provisional Chicago 17:00 ETH boundary is implemented for synthetic fixtures, **not holiday/special-session aware**. Need approved versioned exchange calendar before live operation.
2. Global monotonic clock resets on process restart; `localSeq` is the cross-restart ordering authority. Wall/mono clock and true NTP offset/quality sample instrumentation need operational source validation.
3. No bounded/backpressured asynchronous ingest, process isolation, high-throughput benchmark or per-session sizing study yet. Synchronous fsync is intentionally conservative for offline fixtures; no latency claims.
4. Writer lock cannot be used across shared/network/multi-host disks and is not a substitute for fencing tokens in distributed storage.
5. Recovery detects local truncated line and creates GAP evidence, **not a verified upstream vendor sequence gap**. The synthetic `GAP` currently denotes recorder restart/recovery, not an empirically proven interval of missing source messages; production needs a structured reason/generation and time bounds. Source sequence semantics require separate adapter and reference validation.
6. No five consecutive authorized market sessions; Ironbeam licensing/retention/rotation and protected storage gate remain unresolved.
7. Gate 1 MBP/MBO feed-semantic tests (T1–T12, I1–I8), vendor reconstruction and real latency remain outstanding and out of scope for this recorder milestone.
8. No private archival object-store uploads. Must approve license, retention, access control, encryption, cost, and restore procedures first.

## Manager decision requested
Review the recorder as a **synthetic, noncollecting Gate 1 building block**; merge into the protected Engine 18 foundation branch only if code review and CI approve. Do not merge or deploy to production as a live recorder. Do not declare Gate 1 complete.
