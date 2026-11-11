# Engine 18B — Gate 1 Phase 5 Operational Readiness (SYNTHETIC ONLY)

**Status:** Isolated development PR #298, awaiting Engine 18 Manager and Claude audit. **No licensed recording, no paid resources, no Render deployment, no chart/trading modifications.** This extends approved Phase 4, not a replacement.

## Code and architecture

```text
 [EXISTING live ES reader and chart]      [FUTURE independently supervised source]
             UNCHANGED                             NOT CONNECTED
                                                       |
                                            (after explicit live gate)
                                                       v
 [Synthetic source] -> [nonblocking bounded parent IPC] -> [isolated child worker]
                                      |                       |
                              receipt: hrtime + UTC wall      | fsync + checkpoint
                              queued IPC != lost              v
                                                       dedicated disk (PROPOSED)
                                                            |
           +------------------------------------------- sealed .gz + manifest
           |                                                 |
           v                                                 v
   current .jsonl.open continues       independent closed-hour backup scheduler
   uninterrupted; no backup reads        | mock + S3-compatible SigV4 adapter
           |                             | AES-256-GCM, versioned key ID
           +-----------------------------v
                                     private remote archive +
                                     signed immutable inventory objects
                                     | independently PIN final lastSeq
                                     v
                                  verified restore/replay
```

The shipped Phase 5 code remains **synthetic-only** and does not open any Ironbeam subscription or deploy a worker. The actual capture-source transport must be separately verified and approved. No Engine 2 chart, Engine 11 candle, Engine 22 waves/strategy/Fibs, execution, or existing production reader files changed.

### Changed components

- `engine18Phase4Backup.js`: `backupClosed()` now selects only sealed gzip/manifests and works while a later `.jsonl.open` is active. Existing remote objects are verified rather than overwritten; simulates successful upload with ACK loss and verifies the stored object before retry. Records backup failures, attempts, retry counts and lag.
- `engine18ContinuousBackup.js`: background scheduling with no await in market-data intake; one in-flight scan, private lag/failure health and clean stop. Does not read/modify the active file.
- `engine18Phase4SyntheticWorker.js`: exits **76** on unexpected parent IPC disconnection (unclean; no STOP), preserving committed records and allowing durable recovery GAP. Synthetic disk delay injection is confined to the child.
- `engine18Phase4WorkerBridge.js`: `child.send(false)` means IPC queue pressure, **not data loss**. The source callback increments `ipcQueuedSignals`, enforces a separate strict in-flight limit, and returns without waiting for fsync. Actual IPC send callbacks/errors still fail closed. Uses receipt clock metadata.
- `engine18ReceiptClock.js`: monotonic nanosecond clock anchored to wall milliseconds for **sub-ms wall-time estimates**, reported as `HOST_WALL_ANCHORED_MONOTONIC` and `SUBMILLISECOND_ESTIMATE`. Accuracy and clock sync remain **UNVERIFIED** without a trusted Chrony/PTP observation; raw vendor timestamps are preserved separately, never replaced or invented.
- `gate1RawRecorder.js`: optional extra clock-source/precision/quality fields for Phase 5 synthetic envelopes; v2 raw fidelity and sequence ordering preserved.
- `engine18S3PrivateStore.js`: inactive S3-compatible AWS SigV4 requests with HTTPS, explicit least-privilege credential inputs, AES-256-GCM file encryption, versioned key ID, client SHA-256 checks, immutable conditional PUT, nonce- and ACK-safe retries, authenticated remote plaintext confirmation on duplicate upload, bounded streaming restore and encrypted inventory query. `retentionDays` is only metadata; **actual provider-side bucket retention/lifecycle MUST be configured separately**.
- `engine18Phase5S3Coordinator.js`: seals archive + manifest, then appends hash-linked AES-GCM encrypted inventory records to a separate remote prefix; verifies sequence continuity and requires an **independently supplied pinned high-watermark** for certified complete restore. Works while current hour remains open. Remote inventory/head pin must later be anchored outside the same bucket to detect adversarial whole-tail deletion.
- `engine18Phase5Operations.test.js` + `fixtures/engine18Phase5Parent.js`: dedicated worker crash, slow storage and buffered source callback, queued `send(false)`, exact text/binary, 24,000-frame synthetic sustained three-hour schedule, active-hour sealed backup, AES-GCM SigV4 mocked endpoint, retry/restore, inventory deletion and retained clock metadata.
- `.github/workflows/engine18b-gate1-phase5.yml`: complete Gate 1/Phases 2–5 and R1–R3 regressions in **both UTC and America/Phoenix**.

### Failure and recovery invariants

1. Frames are persisted with `localSeq`, `runId`, stream generation, unchanged raw string/binary-as-base64, receipt/write clocks. A successful fsync/checkpoint can precede a lost parent ACK; **persisted frames may exceed delivered ACK counts after a crash**. No exactly-once parent-ACK guarantee exists.
2. If parent dies, child faults and exits without a fraudulent clean STOP; restart's bounded recorder recovery emits GAP while preserving durable events. IPC backpressure counters are separate from actual delivery failure. Sustained overload remains fail-closed.
3. Backup uploads only finalized immutable gzip and matching original manifest. An active `.jsonl.open` remains untouched. Backup failure is reported privately and does not synchronously block intake; lag/space thresholds must nevertheless stop collection if safety budgets are exceeded.
4. S3-compatible adapter uses a versioned client-side encryption key and private signed requests. No `DeleteObject` method was implemented. Enforce operational retention through explicit approved bucket lifecycle and limited IAM credentials. Mock tests do **not** prove R2 production compatibility.
5. Remote inventory hash chaining detects internal missing/duplicate/out-of-order entries; independently pinned lastSeq detects a missing final entry. **Do not certify remote completeness without a separately trusted pin**; same-account compromise could still remove objects unless stronger provider retention/immutability is configured.
6. Existing Phase 4 bounded crash recovery remains the accepted basis; Phase 5 does not recreate it or change the production reader.

## Verified synthetic CI

GitHub Actions `Engine18B Gate1 Phase5 Synthetic Operations` runs the complete suites in two timezones, with original Gate 1, Phase 2, Phase 3, Phase 4 and R1–R3 regression tests also executed. Exact final HEAD CI links are recorded on PR #298.

### Representative CI measurements (mock data, not real ES market opening)

| Fixture | UTC CI measurement | Arizona CI measurement |
| --- | ---: | ---: |
| Three-hour simulated, 24,000 depth/quote/trade frames + backup/restore | 4,089 frames/sec, 201 MiB sampled RSS | 3,272 frames/sec, 202 MiB sampled RSS |
| Isolated worker 20,000 frames | 3,565 frames/sec, callback p95 5.8 µs, p99 21.9 µs | 2,854 frames/sec, p95 11.2 µs, p99 30.4 µs |
| Previous Phase 4 102.5 MiB recovery | 776 ms, sampled RSS 224 → 225 MiB | 1,836 ms, sampled RSS 223 → 224 MiB |

**These numbers are runner-dependent.** Multi-hour timestamps were simulated over seconds, not a real three-hour continuous run; sampled RSS is not peak memory, and source sizes are synthetic. A real ES peak-load and multi-session soak remain blocking operational acceptance.

## Render placement, pricing and conditional budget

Direct Render audit:
- Main backend `frye-market-backend-1` `srv-d2ds5nodl3ps73b7i2og` has 100 GB disk `dsk-d6a9f9fgi27c73affbdg` mounted `/var/data/replay`. **Never share, resize, write to or move it.**
- Isolated research service `srv-dbpijnon74is73e2sprg` remains on the Engine 18 foundation branch, autoDeploy OFF, with **no disk** reported. No service changes.
- Private recorder proposal is a **new dedicated** background worker, one instance in Oregon, autoDeploy OFF, own **50 GB** persistent disk at `/var/data/engine18-recorder`, no public HTTP endpoint, private S3/R2 object store, separate encryption key and independent inventory. Reference the nondeployable `docs/engine18b/phase4-recorder-render.example.yaml` and `engine18Phase4DeploymentGuard.js`: starting it exits 78 even when flags are changed.

Current public list prices (Nov 2026; verify actual account billing before provisioning):
- Render entry worker **$7/month** (0.5c/512 MiB), disk **50×$0.25=$12.50/month**.
- Cloudflare R2 Standard **10 GB-month free**, **$0.015/GB-month** beyond, plus Class A/B operations; 150 GB-month steady example **$2.10/month**.
- **Illustrative total $21.60/month**, leaving **$0.40 headroom** under the owner's conditional ~$22 monthly incremental approval. Does **not** include taxes, larger worker, monitor, unpredictable operations, additional storage, restore traffic, snapshots, or possible R2 rounding. If measured capacity demands 1 CPU/2 GB ($25 worker) or backup exceeds 150 GB-month, **STOP** and obtain revised owner budget approval before provisioning.
- Compressed data per session remains UNMEASURED. At 20% disk reserve, 50 GB gives ~40 GB working space, which lasts ~40 days at 1 GB/day, ~8 days at 5 GB/day, or ~2 days at 20 GB/day. **These are scenarios, not Ironbeam data measurements.**
- R2 Standard Class A 1 million requests/mo free then $4.50/million; Class B 10 million free then $0.36/million. Operation and monthly GB rounding may exceed the $0.40 margin. The manager must verify pricing, storage scope, private bucket lifecycle and key policies in the actual account.

Reference prices: https://render.com/pricing, https://render.com/docs/disks, https://developers.cloudflare.com/r2/pricing/, https://developers.cloudflare.com/r2/buckets/object-lifecycles/.

## Future controlled pilot / rollback procedure — NO ACTIONS YET

1. Manager and Claude approve this synthetic PR, including source/clock/data semantics and safe IPC/backup behavior.
2. Authorize any remaining engineering changes to the isolated worker, real S3 transport against **private mock/staging only**, external inventory high-watermark anchor, retention/locked deletion, key rotation and byte-exact restore drills.
3. Independently verify Ironbeam license scope (owner already attested project recording permitted), new worker credentials, trusted clock synchronisation on the actual host, complete CME session calendar, physical ES contract and stream IDs. Source depth full-image/delta/conflation, `l`, `sz=0`, implied fields and `t` still require Claude validation.
4. Verify sustained volume, spool capacity, backup lag, safe crash/restore and monitored alerts on the proposed instance size. If $7/512MiB is inadequate or variable costs exceed the $22 budget, stop and request revised owner approval **before any purchase**.
5. After separate infrastructure authorization only: provision new private worker + its own disk, create private R2 bucket/credentials and independently anchored inventory, configure retention and alarms, deploy with raw recording OFF and restore-only verification.
6. **Separate explicit manager live-capture acceptance** is still required to enable any time-limited licensed ES pilot. Never infer live authority from the budget or merge approval.
7. Rollback: disable intake, stop isolated worker if healthy and record STOP; on failure, preserve open files and GAP evidence. Verify closed archives and independent pinned backup receipts; keep disk mounted to the worker. Restore into an **empty dedicated private path** and verify SHA-256, manifest/clock/source generations and replay sequence. Roll back only isolated worker code; never affect main backend/chart/Engine 11/22 or its 100 GB disk.

## Research context remains frozen

Read-only future price context is defined by `docs/engine18/INSTITUTIONAL_MICRO_SUBMICRO_CONTEXT.md` (ES institutional zones, Engine 22 Micro/Submicro owner-approved strategy/Fib targets). These do not manufacture order-book liquidity and are not part of Phase 5 recording; no nodes, strategy cards, Fibonacci algorithms, chart or trading signal code were changed.
