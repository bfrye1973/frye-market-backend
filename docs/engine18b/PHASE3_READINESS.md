# Engine 18B — Gate 1 Phase 3 Recording Readiness

**State:** synthetic-only development, manager/Claude review required. **No live or licensed Ironbeam raw capture, no paid resources, no deployment and no merge.**

## Phase 3 interfaces and traceability
- `services/core/logic/engine18/engine18Phase3Readiness.js`: `Engine18SyntheticReadinessSupervisor` is a deliberately isolated supervisor. It does not create real network sockets. `open()` issues an immutable ticket with a new increasing generation, unique connectionId, and process runId. Frames use their ticket, not the latest global generation, even if they are processed after reconnect.
- Every WebSocket failure is a sanitized `WS_ERROR` or `DISCONNECTED` control. The first uncertain interruption of a generation also writes `FEED_GAP`, distinct from the base recorder's unclean-process-recovery `GAP`. The FEED_GAP marks **unknown data coverage**, not proven missing source sequence. Actual source sequence gap classification requires vendor semantics.
- `subscription()` records structured `SUBSCRIPTION_ACK` with `feedType` (depths, quotes, trades), `physicalContract`, safe `streamId`, `status` (SUCCESS or FAILED) and connection ID, without recording query strings or bearer tokens. These are **local generated control records**, not vendor raw market frames. A future isolated transport must call the method on every REST success/failure; no live wiring has been performed.
- `RECORDER_START` and `RECORDER_STOP` from the existing recorder remain intact. An immediately following `RECORDER_METADATA` includes software version, Git commit, provider, API version, physical ES mapping and clock configuration. Metadata is stored as a versioned local control JSON string in the existing raw.v2 envelope, not a vendor market packet. The supervisor requires these identities explicitly; it does not invent a production Git commit.
- `getExactBinary()` handles strings, Buffer, Uint8Array, other ArrayBuffer views (including DataView), ArrayBuffer and Blob. Mutable buffers are cloned at receipt; blobs are immutable and asynchronously decoded. Raw text remains text; arbitrary bytes are stored losslessly in canonical base64.
- `engine18ClockQuality.js` reads `chronyc tracking -n` via execFile with fixed, non-shell arguments when explicitly injected as a clockSampler. It validates leap status, stratum, reference freshness, system offset, and RMS/dispersion quality. Failed/unavailable/unsynchronized chrony => **UNVERIFIED** with null offset. Periodic sampling is opt-in at 60 seconds by default, stopped at recorder shutdown. **This has not been verified against a real Render chrony/host time service**; treating a time sample as `VERIFIED` is conditional on the host daemon itself being trusted.
- `engine18BoundedReplayScan.js`: streams archive SHA-256 validation and decompressed JSONL records through a bounded consumer (max individual line 16 MiB default), checks manifest count/first/last sequence, complete global ordering and durable high-watermark. This is an OFFLINE verification utility. Legacy recorder initialization still parses some archived segments synchronously and cannot claim bounded memory for arbitrary multi-month restoration.

## Research context preserved, but not joined yet
The reviewed `docs/engine18/INSTITUTIONAL_MICRO_SUBMICRO_CONTEXT.md` explicitly keeps market-book evidence independent from institutional zones and Engine 22 Micro/Submicro strategy cards and their approved Fibonacci targets. These sources are future read-only context; **no new strategy-card calculations, inferred liquidity walls, historical availability assumptions or chart/trading integration are included in this PR**.

## Data rights and secure storage
- Manager has relayed the owner's confirmation that Ironbeam permits recording for this project. Operational terms still require checking the exact retention, replay, export/backup, credential and entitlement scope before activation. Development authorization need not be requested repeatedly.
- Direct Render inspection: main service `frye-market-backend-1` (`srv-d2ds5nodl3ps73b7i2og`) owns disk `dsk-d6a9f9fgi27c73affbdg`, **100 GB mounted at `/var/data/replay`**. Do not write, resize, mount, or move it. Isolated Engine 18 research service `srv-dbpijnon74is73e2sprg` reports **no disk** and auto-deploy OFF.
- Proposed **dedicated private background worker**, separate persistent disk initially **50 GB** (~$12.50/month at the previously reviewed Render $0.25/GB-month), separate encrypted private S3/R2 closed-archive backup, independent high-watermark/inventory, least-privilege keys and retention/restore test. Illustrative additional worker ~$7/month and 150 GB R2 ~$2.10/month yield **~$21.60/month incremental** before compute upgrades, operations, taxes and any licensing terms. **Actual cost and sustained volume not validated**. Provisioning prohibited until the owner and manager approve it.
- No public raw market-data route, unprotected diagnostics, new Render service, clock daemon installation, or record-volume purchase was created.

## Testing and explicit limits
Synthetic tests must cover per-connection generations, stale generation identity, WS_ERROR/DISCONNECTED vs FEED_GAP vs recorder GAP, subscription SUCCESS/FAILED, startup identities, all binary formats, clock verified/unverified paths, intermittent samples, deterministic two-pass bounded replay and a simulated crash's large open-file recovery with RSS measurements.
Existing Gate 1/Phase 2 CI additionally checks disk-full, partial batch writes, queue overflow, hourly streaming gzip manifests, SIGKILL restart and synthetic 20,000-message loads.

**Important pre-live gaps:**
1. No live subscription callback/stream wiring; actual Ironbeam frame semantics, timestamps and full/delta/conflation remain for Claude to validate.
2. No independent private object-store archive inventory or restore workflow; local high-watermark is not protection against loss of all local state.
3. Clock offset quality must be tested on the actual private worker's trusted source; `chronyc` is not guaranteed installed on Render.
4. No end-to-end peak-burst/latency proof using real network frames, no proven private storage sizing, no five-session capture.
5. Existing synchronous crash recovery reads entire individual archives and can use substantial memory; bounded replay scan reduces **analysis** memory only.
6. A caller must enforce WebSocket stream lifecycle, subscription ACKs, quality-aware gap suppression and capture-to-durable-transport before any production service is switched on.
7. Synthetic tests validate code paths, **not** any predictive probabilities, true exchange timestamps or L2 parity.

## CI commands
```bash
node --test services/core/tests/engine18Gate1RawRecorder.test.js services/core/tests/engine18Phase2Preparation.test.js services/core/tests/engine18Phase3Readiness.test.js
```
Published CI evidence and memory/throughput measurements are attached to PR #293. The manager reviews the **latest exact HEAD**, not earlier synthetic runs, before any decision.
