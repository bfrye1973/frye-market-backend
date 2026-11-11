# Engine 18B Gate 1 Phase 2 — Recorder Preparation and Storage Proposal
**Status:** Synthetic implementation only. No licensed recording enabled, no deployment, no purchases. Updated November 10, 2026 (Arizona).

## Baseline audited directly
- Backend branch: `engine18-liquidity-intelligence-foundation-20261109`, Engine 18 research service ID `srv-dbpijnon74is73e2sprg`, paid **starter** web service in Oregon, `autoDeploy=no`, `autoDeployTrigger=off`, attached to the foundation branch, one instance.
- Startup `node services/core/logic/engine18/bootstrapServer.js`. It currently authenticates and receives quotes/depth/trades when existing demo monitor flags are enabled. **Do not change this existing behavior.**
- The **isolated research service** has no disk reported in its Render service details. The **main backend service** has an independently confirmed 100 GB attached disk (details below). These are different services. Current free bytes and disk contents were not inspected.
- Ironbeam reader `ironbeamV2Level2Monitor.js` receives WebSocket `message` and parses JSON before zone scoring. The future authorized hook point is **before `JSON.parse`**, passing the unmodified event data to a separately supervised recorder tap. No hook was installed on this branch, because live raw storage rights remain unresolved.
- Subscriptions use `quotes`, `depths`, `trades`; actual depth shape inspected in `ironbeamV2Level2Zones.js` is `d:[{s:'XCME:ES.Z26',b:[{p,sz,o,t,l,is,ioc}],a:[...]}]`. Feed **full-image vs incremental vs conflated** is NOT confirmed. The current zone reader filters zero-size rows; synthetic adapter diagnostics are raw-prefilter and do NOT reproduce that filtering.

## Verified existing disk — preserve and never repurpose
Direct Render service inspection confirms:
- Main production backend `frye-market-backend-1`, service `srv-d2ds5nodl3ps73b7i2og`, branch `main`, auto-deploy ON.
- Existing persistent disk ID `dsk-d6a9f9fgi27c73affbdg`, **100 GB** mounted at `/var/data/replay`, exclusively attached to the main backend. **Do not move, mount, resize, write to, or repurpose this disk.**
- Isolated research `frye-engine18-liquidity-research`, service `srv-dbpijnon74is73e2sprg`, no disk reported, auto-deploy OFF, follows the foundation branch.
- Render persistent disks are single-service attachments; **another worker cannot mount the existing backend disk**. There is no verified free-space figure for the 100 GB disk. This discovery does NOT create storage authority for Engine 18.
- The owner has confirmed that **Ironbeam allows recording market data for this project**, according to the Engine 18 Manager's November 10 handoff. This is owner attestation of permission; exact retention, export, reuse, redistribution and credential terms still need to be checked during operational setup, not repeated development authorization.

## New isolated components
- `ironbeamV2RecorderAdapter.js`: raw-first receipt capture before JSON classification, quote/depth/trade/unknown/malformed binary-safe classification, synthetic lifecycle control codes, shape counters/histograms before any level filtering, monotonic interarrival histogram, and an explicit `authorized:false` guard.
- **Synthetic WebSocket injection seam:** `createSyntheticRecorderWebSocketImpl(FakeWebSocket,{tap})` provides an optional constructor compatible with the existing reader's `WebSocketImpl` parameter. It stamps receipt and snapshots raw input synchronously but forwards the original frame to the reader **without waiting** for parsing/disk/fsync. Recorder-side classification and persistence run in a separate serialized async queue. Bounded ingress overflow faults recording but **does not close or delay the existing reader**; supervision must record and alert on the recorder fault. The wrapper automatically captures CONNECTED, DISCONNECTED, RECONNECT and synthetic error GAP events, respecting source order through a serialized recorder queue. No change was made to `ironbeamV2Level2Monitor.js` or its Render startup wiring. Actual licensed WebSocket use is NOT authorized or activated. It does NOT connect a socket. `t` is unverified vendor semantics; no invented exchange timestamp.
- `engine18BufferedRecorder.js`: bounded queue, intake-time receipt stamps, groups consecutive records into an append/one-fsync/one-high-watermark-commit batch, acknowledges only AFTER durable group commit. Queue overflow -> fail closed and reject unacknowledged messages; previous run lacks STOP -> durable GAP on restart.
- Existing `gate1RawRecorder.js` enhanced with `appendBatch()` and `rotateStreaming()` while keeping legacy synchronous `append()` behavior and original v2 schema. Streaming gzip creates a temp archive, fsyncs file and directory, publishes its SHA-256 manifest, then removes the open source. **Normal hourly finalization now validates JSONL incrementally in bounded chunks and hashes the compressed file incrementally.** Crash recovery and replay verification still use whole-file reads and require further memory-bounded acceptance before an unattended multi-session deployment.
- In-process `health()` only: active, received, committed, unacknowledged, rejected, GAP count, recorded bytes, last receipt, disk total/free, reconnects, and clock-offset `UNVERIFIED`. No HTTP endpoint was added; the trusted NTP/chrony source is not configured.
- No claims of exact physical ES source identity beyond the existing configured symbol. Multiple-source-message frames or source controls need verified vendor semantics.

## Replay and timing
- Source receipt order is canonical `localSeq`; `runId` disambiguates monotonic clock restarts.
- `receivedWallNs` and `receivedMonoNs` are captured before buffering, and `writtenMonoNs` is recorded before write. UTC hour + provisional CME ETH date follow receipt, not flush time.
- `GAP` on recorder crash means an interruption in collection reliability; it does NOT automatically prove a vendor sequence-number gap or a loss of ES depth.
- Raw is stored with original UTF-8 content or exact binary bytes as canonical base64. A future live adapter must support its WebSocket implementation's exact text/Buffer/Blob behavior, and sanitize token-bearing control/status messages without silently discarding source messages. Current synthetic adapter supports strings and Buffer/Uint8Array, not Blob.

## Storage recommendation — owner approval required
Use a **separate single-writer private Render background worker** with its own dedicated persistent SSD and appropriate application/backup encryption, not the existing main backend disk, public research monitor or chart service. The owner must first verify Ironbeam market-data historical storage/replay rights, secret rotation and policies. Attach persistent storage only to the new service, not Engine 11 or the chart. Add a distinct private S3-compatible encrypted R2 bucket for uploaded **closed** archives/manifests, with least-privilege credentials, private access, retention lifecycle, automatic checksum verification after upload, independent immutable inventory/high-watermark and restore drill. Keep licensed data private and do not expose raw payloads in public monitoring.

A persistent Render disk is single-instance; attaching one prevents zero-downtime deployment and disk size cannot be reduced. Schedule deploys around the calendar, stop and flush cleanly, record maintenance GAP and verify subsequent resynchronization.

### Pricing — indicative, not a purchase authorization
Official published prices checked November 10, 2026:
- Render SSD persistent disk: **$0.25/GB-month**; 20 GB = **$5/month**, 50 GB = **$12.50/month**, 100 GB = **$25/month**.
- Cloudflare R2 Standard storage: first 10 GB-month free; then **$0.015/GB-month**, plus API operation charges if thresholds are exceeded.
- Render starter service listed from **$7/month**; a **new** worker may have additional compute cost depending on size and features, not included in disk pricing. Existing research starter cost is separate.
- Example one-month closed-archive retention: 1 GB/day ~30 GB -> roughly $0.30/month R2 capacity after allowance; 5 GB/day ~150 GB -> roughly $2.10; 20 GB/day ~600 GB -> roughly $8.85 (using full-month equivalence, excluding operations and overhead).
- **Recommended INITIAL new disk: 50 GB**, at $12.50/month, dedicated only to the recorder worker (subject to pilot sizing and manager approval). A separate $7/month minimum worker + illustrative 150 GB R2 (~$2.10/month) totals **about $21.60/month incremental**, before operations, higher compute, monitoring, backup requests, retrieval, taxes or different licensing charges. Consider 100 GB at $25/month if the authorized pilot shows high local backlog or restore requirements. A 50 GB disk with 10 GB reserved gives 40 GB effective backlog: ~8 days at 5 GB/day or ~2 days at 20 GB/day; not sufficient if private backup is unavailable for extended periods. Trigger escalating space alerts and stop recording safely well before disk exhaustion.
- Storage size is NOT yet based on real Ironbeam frame statistics or market-open bursts; measure frame/sec and compressed GB/session during an authorized pilot before locking capacity or costs.

References: https://render.com/docs/disks ; https://render.com/pricing ; https://www.cloudflare.com/plans/

## Remaining Gate 1 work before any live capture
1. Owner attestation of Ironbeam recording permission is acknowledged. Before live switch, manager/operator must confirm practical license scope (retention, export/backup/replay limitations), rotated credentials, storage provider choice, cost cap and deletion policy; **no need to reauthorize development**.
2. Manager: approve new private worker/disk architecture; verify Render plan and actual available disk quota; approve backup encryption, least-privilege key scope, retention and restore policies.
3. Claude: verify Ironbeam frame shapes and `l`, `sz=0`, `is`/`ioc`, vendor timestamps, full-vs-delta and conflation against written feed docs and at least five authorized ETH/RTH sessions; compare reference feed.
4. Engineering: implement a true live wire transport after permission, independent bounded memory pipeline and restore tests, NTP offset samples from trusted host source, market/session calendar and outage alerting, clock offset/session coverage, protected health endpoint. Wire metrics without public data.
5. Gate 1 I1-I8 and historical MBO T1-T12, reconciliation and replay parity remain independent work. Tests passing here do not authorize trading or calibrated probabilities.

## Synthetic acceptance commands
```bash
node --check services/core/logic/engine18/ironbeamV2RecorderAdapter.js
node --check services/core/logic/engine18/engine18BufferedRecorder.js
node --test services/core/tests/engine18Gate1RawRecorder.test.js services/core/tests/engine18Phase2Preparation.test.js
```
Run CI from latest PR head and record the exact numbers and synthetic throughput. Benchmark output is measured on a GitHub Actions runner, **not a measured live ES peak or production hardware guarantee**.

## Measured synthetic CI evidence — November 10
- Isolated Phase 2 + original Gate 1 tests: **36 passed, 0 failed** at synthetic WebSocket bridge commit `6d49f6062a15e742c32bfbfcb0448219840a0816`; GitHub Actions https://github.com/bfrye1973/frye-market-backend/actions/runs/42949351352
- Existing Engine 18 isolated baseline: **PASSED** https://github.com/bfrye1973/frye-market-backend/actions/runs/42949351335
- Existing synthetic recorder workflow: **PASSED** https://github.com/bfrye1973/frye-market-backend/actions/runs/42949351359
- 20,000 synthetic frames / 4,486.6 ms = **4,458 frames/sec**, **1.56 MB/sec** on the latest GitHub Actions runner. This is only a synthetic benchmark: payload size, host storage, compressibility, concurrency, real Ironbeam network characteristics, and peak ES open bursts will differ. Other CI runs observed 5,123, 5,593 and 9,469 frames/sec, demonstrating substantial runner variability.
- Synthetic tests include exact depth/trade/quote/unknown/malformed and binary preservation, real Ironbeam-style `d:[{s,b,a}]` raw shapes with `sz=0`, `l`, `is`, `ioc`, receipt-before-parse clock boundary, interarrival counters, queue overflow fail-closed, 20k high-load batch commits, streaming rotation/checksum, SIGKILL and deterministic replay.
- **No actual Ironbeam feed capture occurred.** Synthetic WebSocket bridge is tested against a fake transport and can be injected through the existing reader's constructor seam in a future authorized service. Live adapter injection into the real WebSocket receiver remains deferred pending owner/manager license and production isolation authorization. Nothing here establishes feed snapshot/delta/conflation semantics.

- Synthetic bridge tests also verify the pre-existing reader callback cannot see messages before recorder fsync/ACK, and that a bounded synthetic transport queue fails closed on overload rather than silently forwarding or reordering frames.

## November 10 manager corrections — closure and CI
- **Automatic lifecycle evidence**: `createSyntheticRecorderWebSocketImpl` records synthetic CONNECTED/DISCONNECTED/RECONNECT and error GAP controls durably through `tap.captureControl` + `tap.persistControl`, in arrival order with frames. It stores safe codes and `raw:''`; token-bearing WebSocket URLs are not copied. The adapter's explicit SUBSCRIBED event remains available to a future authorized supervisor (the current WebSocket wrapper cannot infer REST subscription acknowledgments).
- **Reader isolation**: raw receive clock and defensive source snapshot occur at callback entry; WebSocket reader callbacks are forwarded without awaiting parsing, queue, fsync or compression. Recorder overflow faults the recorder and produces safe failure notification; it does **not** close the market reader socket. Separate-process worker transport for real operation remains a live-gate item. Minimal synchronous capture/copy can still add CPU overhead; measured production p95/p99 reader lag is not yet known.
- **Failure injection**: synthetic `testFault` permits ENOSPC-before-fsync, partial batch write, and post-checkpoint disruption. In-flight group promises are rejected, no group is falsely acknowledged, recovered files are integrity-checked and uncertain events remain replayable with GAP evidence. Group-commit/high-watermark has no independent remote attestation until a backup uploader and inventory are authorized.
- **Shutdown race**: close rejects new offers while allowing previously captured messages to finish, then writes clean STOP; no duplicate STOP. Queue overflow rejects unresolved receipts and leaves an unclean lifecycle for GAP on restart.
- **Latest verified synthetic tests at code commit `e138dd99f8a42d66f695e822a2decddbdb842dfb`**: **42 passed / 0 failed** in https://github.com/bfrye1973/frye-market-backend/actions/runs/42951067572. Engine 18 isolated baseline PASS https://github.com/bfrye1973/frye-market-backend/actions/runs/42951067635; original recorder PASS https://github.com/bfrye1973/frye-market-backend/actions/runs/42951067687.
- The latest 20,000-message synthetic CI sample: **9,769 frames/second** over 2.0474 seconds (3.43 MB/sec); prior samples ranged roughly 4,458–9,469 frames/sec, demonstrating variable CI host performance. No real ES market-open throughput assurance is implied.

## Manager review still required
- Normal hourly finalization now scans JSONL and compressed SHA-256 in chunks and has an explicit 16 MiB maximum single-line safety limit. **Synchronous crash recovery and replay verification still load whole archive files**, and require memory-bounded refactoring or measured size limits before unattended multi-session production. A synthetic 20k-frame benchmark is not proof of high-volume live hour sizing.
- The synthetic wrapper does not replace a separate lossless capture worker. Real transport, worker failure action, capacity alarms, independent object-store backup/restore and exact entitlement terms must be designed and accepted before activating capture.
- Claude must determine depth full-image vs incremental vs conflated, the meaning of `p` heartbeat candidate, `l`, `sz=0`, `is`, `ioc`, vendor `t`, exchange time, batching and missing source-message behavior. The recorder retains unknown/rejected frames, but cannot decide those vendor semantics.

- **Bounded finalization regression:** a >240 KiB raw message crossing multiple 64 KiB read chunks and an hour boundary must replay byte-identically with valid SHA-256 manifests. See `engine18Phase2Preparation.test.js`.
- **Source/data rights:** owner attestation of Ironbeam recording permission documented; this authorizes preparation, **not** infrastructure purchases or turning on raw capture. License-specific retention/export rules remain an operational checklist item.
