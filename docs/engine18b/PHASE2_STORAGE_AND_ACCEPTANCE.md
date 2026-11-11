# Engine 18B Gate 1 Phase 2 — Recorder Preparation and Storage Proposal
**Status:** Synthetic implementation only. No licensed recording enabled, no deployment, no purchases. Updated November 10, 2026 (Arizona).

## Baseline audited directly
- Backend branch: `engine18-liquidity-intelligence-foundation-20261109`, Engine 18 research service ID `srv-dbpijnon74is73e2sprg`, paid **starter** web service in Oregon, `autoDeploy=no`, `autoDeployTrigger=off`, attached to the foundation branch, one instance.
- Startup `node services/core/logic/engine18/bootstrapServer.js`. It currently authenticates and receives quotes/depth/trades when existing demo monitor flags are enabled. **Do not change this existing behavior.**
- No durable volume configuration was surfaced in the service detail returned by the connector; **disk presence/mount/usable capacity is not independently verified**. Render's default filesystem is ephemeral; never assume it is safe to store historical raw frames.
- Ironbeam reader `ironbeamV2Level2Monitor.js` receives WebSocket `message` and parses JSON before zone scoring. The future authorized hook point is **before `JSON.parse`**, passing the unmodified event data to a separately supervised recorder tap. No hook was installed on this branch, because live raw storage rights remain unresolved.
- Subscriptions use `quotes`, `depths`, `trades`; actual depth shape inspected in `ironbeamV2Level2Zones.js` is `d:[{s:'XCME:ES.Z26',b:[{p,sz,o,t,l,is,ioc}],a:[...]}]`. Feed **full-image vs incremental vs conflated** is NOT confirmed. The current zone reader filters zero-size rows; synthetic adapter diagnostics are raw-prefilter and do NOT reproduce that filtering.

## New isolated components
- `ironbeamV2RecorderAdapter.js`: raw-first quote/depth/trade/unknown/malformed binary-safe classifier, synthetic lifecycle control codes, shape counters/histograms before any level filtering, monotonic interarrival histogram, and an explicit `authorized:false` guard. It does NOT connect a socket. `t` is unverified vendor semantics; no invented exchange timestamp.
- `engine18BufferedRecorder.js`: bounded queue, intake-time receipt stamps, groups consecutive records into an append/one-fsync/one-high-watermark-commit batch, acknowledges only AFTER durable group commit. Queue overflow -> fail closed and reject unacknowledged messages; previous run lacks STOP -> durable GAP on restart.
- Existing `gate1RawRecorder.js` enhanced with `appendBatch()` and `rotateStreaming()` while keeping legacy synchronous `append()` behavior and original v2 schema. Streaming gzip creates a temp archive, fsyncs file and directory, publishes its SHA-256 manifest, then removes the open source. **Currently rotation still reads open JSONL into memory for validation and reads resulting .gz for hashing; this is not a memory-bounded end-to-end pipeline**. It must be bounded/optimized and profiled before authorized multi-session production.
- In-process `health()` only: active, received, committed, unacknowledged, rejected, GAP count, recorded bytes, last receipt, disk total/free, and clock-offset `UNVERIFIED`. No HTTP endpoint was added. Reconnect counter is available in shape diagnostics, not yet connected into recorder health; the trusted NTP/chrony source is not configured.
- No claims of exact physical ES source identity beyond the existing configured symbol. Multiple-source-message frames or source controls need verified vendor semantics.

## Replay and timing
- Source receipt order is canonical `localSeq`; `runId` disambiguates monotonic clock restarts.
- `receivedWallNs` and `receivedMonoNs` are captured before buffering, and `writtenMonoNs` is recorded before write. UTC hour + provisional CME ETH date follow receipt, not flush time.
- `GAP` on recorder crash means an interruption in collection reliability; it does NOT automatically prove a vendor sequence-number gap or a loss of ES depth.
- Raw is stored with original UTF-8 content or exact binary bytes as canonical base64. A future live adapter must support its WebSocket implementation's exact text/Buffer/Blob behavior, and sanitize token-bearing control/status messages without silently discarding source messages. Current synthetic adapter supports strings and Buffer/Uint8Array, not Blob.

## Storage recommendation — owner approval required
Use a **separate single-writer private Render background worker** with a dedicated encrypted persistent SSD, not the existing public research monitor or chart service. The owner must first verify Ironbeam market-data historical storage/replay rights, secret rotation and policies. Attach persistent storage only to the new service, not Engine 11 or the chart. Add a distinct private S3-compatible encrypted R2 bucket for uploaded **closed** archives/manifests, with least-privilege credentials, private access, retention lifecycle, automatic checksum verification after upload, independent immutable inventory/high-watermark and restore drill. Keep licensed data private and do not expose raw payloads in public monitoring.

A persistent Render disk is single-instance; attaching one prevents zero-downtime deployment and disk size cannot be reduced. Schedule deploys around the calendar, stop and flush cleanly, record maintenance GAP and verify subsequent resynchronization.

### Pricing — indicative, not a purchase authorization
Official published prices checked November 10, 2026:
- Render SSD persistent disk: **$0.25/GB-month**; 20 GB = **$5/month**, 100 GB = **$25/month**.
- Cloudflare R2 Standard storage: first 10 GB-month free; then **$0.015/GB-month**, plus API operation charges if thresholds are exceeded.
- Render starter service listed from **$7/month**; a **new** worker may have additional compute cost depending on size and features, not included in disk pricing. Existing research starter cost is separate.
- Example one-month closed-archive retention: 1 GB/day ~30 GB -> roughly $0.30/month R2 capacity after allowance; 5 GB/day ~150 GB -> roughly $2.10; 20 GB/day ~600 GB -> roughly $8.85 (using full-month equivalence, excluding operations and overhead).
- A hypothetical **20 GB local disk + new $7/month worker + 150 GB R2 example** totals **about $14.10/month incremental**, excluding operations, monitoring, retrieval, compute upgrades, market-data licensing and taxes. 5 GB/day would fill a 20 GB local disk in ~4 days **before overhead**, so the uploader must have a verified capacity/error budget and backpressure policy.
- Storage size is NOT yet based on real Ironbeam frame statistics or market-open bursts; measure frame/sec and compressed GB/session during an authorized pilot before locking capacity or costs.

References: https://render.com/docs/disks ; https://render.com/pricing ; https://www.cloudflare.com/plans/

## Remaining Gate 1 work before any live capture
1. Owner: confirm written Ironbeam historical raw recording/replay rights, private internal redistribution rights and retention requirements, rotated credentials, storage provider choice, cost cap and deletion policy.
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
