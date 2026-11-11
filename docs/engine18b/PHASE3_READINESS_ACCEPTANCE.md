# Engine 18B — Gate 1 Phase 3 Readiness and Manager Handoff

**Status:** SYNTHETIC FOUNDATION FOR INDEPENDENT REVIEW. No licensed recording, production deployment, trading functionality, or new paid infrastructure has been activated.

## Implementation and tests

- Isolated branch: `engine18b-gate1-phase3-readiness-20261110`.
- Draft PR: https://github.com/bfrye1973/frye-market-backend/pull/293.
- `engine18Phase3Readiness.js`: synthetic supervisor with unique per-socket connection ID and generation, run-associated identity, retained old-generation frame provenance, sanitized WebSocket error and disconnect records, one distinct uncertain `FEED_GAP` per interrupted socket, successful/failed subscriptions with feed, physical contract and safe stream ID. Versioned metadata contains software version, Git commit, provider, API version, physical contract mapping and clock configuration.
- `engine18ClockQuality.js`: read-only `chronyc tracking -n` sample adapter, fail-closed if unsynchronized, stale or invalid. Audited offsets/uncertainty are recorded; otherwise quality explicitly `UNVERIFIED`. Opt-in periodic sampling defaults to 60 seconds and stops on recorder close. No NTP offset invented from wall-versus-monotonic arithmetic.
- `engine18BoundedReplayScan.js`: sequential gzip JSONL validation/replay, per-archive digest and manifest verification, strict sequence continuity, durable checkpoint check, bounded line buffering and no accumulation of events. Synchronous legacy crash recovery is **not** memory-bounded yet.
- Supports original UTF-8 text and exact Buffer, Uint8Array, ArrayBuffer, DataView and Blob bytes as validated base64. Mutable byte-array views are copied at receipt boundary. Unknown/malformed source frames are retained; no vendor schema is silently inferred.
- No changes to production Ironbeam reader/bootstrap, LIVE chart, Engines 11/22 or trading paths.

## Verified synthetic CI evidence

Implementation at `32c706da7e503421cfe10f55e76123eba1aac2a1`:

- Phase 3 + Phase 2 + original Gate 1 suite: **53 passed, 0 failed** — https://github.com/bfrye1973/frye-market-backend/actions/runs/42954493727
- Existing Engine 18 isolated baseline: **PASSED** — https://github.com/bfrye1973/frye-market-backend/actions/runs/42954493644
- 20,000 synthetic frames in 5.0752 seconds: **3,941 frames/sec**, **1.38 MB/sec** on that GitHub Actions runner. Not a live ES peak throughput guarantee.
- Two independent 4,004-event bounded scans: identical output; sampled process RSS **82.7 / 83.7 MiB**, maximum retained JSONL remainder **1,645 bytes**, compressed input **70,159 bytes**.
- Crash-recovery fixture: 256 frames / ~4 MiB raw data; sampled process RSS increased **101.1 → 138.5 MiB**. **Block unlimited live archives until bounded crash recovery or strict archive-size gates are validated.** These samples are not peak-memory guarantees.

## Remaining limitations before controlled licensed capture

1. Current implementation is a **synthetic noncollecting supervisor**. No real socket/worker is connected and no live feed is recorded. Recorder and reader must remain independently supervised; production backpressure/failure semantics are not yet accepted.
2. No dedicated recorder worker/disk/private encrypted object-store uploader or immutable remote inventory has been provisioned. Main backend's 100 GB `/var/data/replay` disk is exclusively owned by `frye-market-backend-1` and must remain untouched. The research service has no attached disk reported and auto-deploy remains disabled.
3. Recommend initially **separate private recorder worker with its own 50 GB persistent disk**, private R2/S3 encrypted backups, independently verified integrity inventory and restore drills. Indicative Render disk **$12.50/month** at $0.25/GB-month; illustrative minimum $7 worker + 150 GB R2 (~$2.10) totals **~$21.60/month incremental** before operations, upgrades, taxes or data-policy changes. Budget and actual compressed/day storage must be verified before purchases.
4. Owner's attestation that Ironbeam permits project recording is acknowledged. Practical storage/retention/export rules, rotated credentials and access controls still require acceptance before activation; do not request repeated authorization for development.
5. Feed semantics unresolved for Claude: complete image versus incremental versus conflation; `l`, zero deletes, `is`/`ioc`, original vendor `t`, exchange clocks, sequence scopes and suspected heartbeat `p`. **No full-book or prediction accuracy claims.**
6. Production clock measurements must be actually available from trusted Chrony/PTP/NTP source; mocked synthetic samples cannot establish host synchronization.
7. CME exceptional sessions/holidays, five consecutive authorized sessions, bounded crash recovery at real data volumes, private backup/restore, market-open capacity tests, alerting and MBP/MBO reconstruction parity remain Gate 1 requirements.
8. The future institutional zones and Engine 22 Micro/Submicro/Fibonacci context contract is documented in `docs/engine18/INSTITUTIONAL_MICRO_SUBMICRO_CONTEXT.md`; it is **not wired to this recorder**, not used to fabricate liquidity and must remain read-only after market-data integrity is established.

## Requested manager decision

Review synthetic architecture and 53-test CI, scrutinize connection/error semantics and source-time provenance, and choose **APPROVE WITH LIMITATIONS / REVISE** for the isolated Phase 3 foundation. Do not merge without explicit manager approval and do not activate continuous recording until secure storage, bounded recovery and all operating gates are accepted.
