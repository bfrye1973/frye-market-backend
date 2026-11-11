# Engine 18B Gate 1 — Synthetic Recorder Implementation & Acceptance Evidence

Date: 2026-11-10 (Arizona). Status: **implementation candidate / manager and Claude review pending**. This report does not grant production deployment, licensed market-data recording, trading, or Gate 1 exit approval.

## Scope
- Isolated Node.js module: `services/core/logic/engine18/gate1RawRecorder.js`.
- Node `node:test` regression suite: `services/core/tests/engine18Gate1RawRecorder.test.js`.
- Scoped GitHub Actions workflow: `.github/workflows/engine18b-gate1-recorder.yml`.
- Source branch: `engine18b-gate1-recorder-synthetic-20261110`; review target `engine18-liquidity-intelligence-foundation-20261109`.
- **Schema v2**: `engine18.raw.v2` envelopes retain `localSeq`, fresh process `runId`, `receivedWallNs`, `receivedMonoNs`, `writtenMonoNs`, stream generation, class, status code, `rawEncoding` and `raw`. Text `utf8` is preserved unmodified; binary `base64` preserves exact bytes.
- `capture()` obtains receipt wall/monotonic clocks before any disk operation; `appendReceived()` writes the captured receipt unchanged. `append()` combines those operations for synchronous callers. Synthetic `at` injection represents receipt time and partitions by receipt, not write time.
- Every process writes `RECORDER_START` and clean `RECORDER_STOP` events. Restart without a prior STOP emits `GAP` **before** the new START, including when the prior segment was already rotated. `localSeq` remains globally increasing, while monotonic clock comparisons are scoped to the new `runId`.
- Hourly gzip archives partition by provider / physical contract / provisional CME ETH trade date / UTC hour. SHA-256 manifest includes counts, time range, byte count and sequence range.
- Crash recovery truncates an incomplete trailing JSONL line, finalizes valid records, emits a durable recorder-recovery `GAP` when prior STOP is missing, and never silently fabricates an unobserved market message.
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
CI workflow on PR #291 runs both. The Engine 18B v2 suite has 22 regression cases covering the new lifecycle/encoding/clock behavior plus original integrity safeguards. Consult the latest GitHub Actions run and its exact test count.

## Security boundary
- `provider !== SYNTHETIC` is explicitly rejected.
- No Ironbeam WebSocket connection, secrets, bearer URL, Render disk mount, S3/R2 upload, market-data purchase, chart change, Engine 11/22 edit, or trading code has been added.
- Callers must never pass secret-bearing control messages; status records must be generated from safe codes and sanitized descriptions. No public raw payload endpoint exists.
- Gzip SHA-256 detects accidental edits; it is **not cryptographic authenticity against an attacker who can rewrite the file and manifest**. Production design needs private storage access controls, encryption, retention and immutable/audited storage as appropriate.

## Limits and blockers (not complete)
1. CME session calendar: provisional Chicago 17:00 ETH boundary is implemented for synthetic fixtures, **not holiday/special-session aware**. Need approved versioned exchange calendar before live operation.
2. Monotonic clocks are scoped to each fresh `runId`; global `localSeq` orders cross-run events. True NTP offset/quality sample instrumentation still requires an operational independently validated source.
3. No bounded/backpressured asynchronous ingest, process isolation, high-throughput benchmark or per-session sizing study yet. Synchronous fsync is intentionally conservative for offline fixtures; no latency claims.
4. Writer lock cannot be used across shared/network/multi-host disks and is not a substitute for fencing tokens in distributed storage.
5. A synthetic `GAP` denotes unclean prior recorder lifecycle (missing STOP), **not a verified upstream market-data gap**. Production feed-adapter GAP events must distinguish upstream disconnect/sequence loss, unknown intervals, and safe restart with detailed classifications and measured bounds. GAP counter includes subsequent explicit GAP records. Source sequence semantics require separate adapter and reference validation.
6. No five consecutive authorized market sessions; Ironbeam licensing/retention/rotation and protected storage gate remain unresolved.
7. Gate 1 MBP/MBO feed-semantic tests (T1–T12, I1–I8), vendor reconstruction and real latency remain outstanding and out of scope for this recorder milestone.
8. No private archival object-store uploads. Must approve license, retention, access control, encryption, cost, and restore procedures first.

## Manager decision requested
Review the recorder as a **synthetic, noncollecting Gate 1 building block**; merge into the protected Engine 18 foundation branch only if code review and CI approve. Do not merge or deploy to production as a live recorder. Do not declare Gate 1 complete.

## November 10 — Claude B1–B4 corrections
- **B1**: Persistent START/STOP status events; missing STOP on last recorded event yields recovery GAP even if last archive finalized. Crash-after-rotation and clean restart fixtures.
- **B2**: `runId` generated via `randomUUID()` at construction; field included in every envelope. Monotonic comparisons within current run only; localSeq continues across runs.
- **B3**: Separate receipt wall/mono and write mono fields. `capture`/`appendReceived` allow artificial disk delay; filenames use capture receipt date/hour.
- **B4**: `utf8` accepts exact text; `base64` accepts byte arrays or canonical encoding, validated strictly; replay returns original base64 bytes.
- **Gap count**: increment every new GAP; prior persisted GAPs counted by replay on startup.
- **Migration**: v2 cannot transparently consume v1 archives; this is a synthetic-only branch and no licensed data is migrated. Fail closed on unexpected version.

- **Lifecycle hardening**: `close()` is idempotent; after successful shutdown, no further frame capture or append is allowed. An additional regression test prevents duplicate STOP records.
