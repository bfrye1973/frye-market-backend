# Engine 18B — Gate 1 Final Operational Acceptance, Issue #300

**Scope:** isolated, synthetic-only engineering PR #301. **NOT live Ironbeam recording approval.** No service deployment, paid bucket, credential change, existing 100GB production disk modification, chart/Engine11/Engine22/trading change, or self-merge.

## Changes from approved Phase 5 (no recorder rebuild)

| Code | What was fixed |
| --- | --- |
| `engine18ContinuousBackup.js` | Accepts both original mock `backupClosed()` and production-shaped `Engine18S3ArchiveCoordinator.syncClosed()`, scheduling without waiting on source callbacks. Keeps private attempts, failures, lag and pending-rotation counters |
| `engine18Phase5S3Coordinator.js` | Ignores only a recent renamed gzip missing its manifest **when its original .open still exists**. Reports pending rather than false backup failure. If source vanishes, remains corrupt, or the rename remains unresolved beyond 120 sec, fail closed. Retry on subsequent scans; immutable archives are hashed/verified. Inventory staging uses `store.stagingRoot`, not OS global tmp |
| `engine18S3PrivateStore.js` | RFC3986-encoded sorted S3 query signing, including spaces, stars, duplicate query keys and continuation tokens. Cleans `<destination>.restore.tmp` after GCM/authentication or plaintext checksum failure. Supports bounded pagination sizes for a real MinIO integration test |
| `engine18ReceiptClock.js`, `engine18Phase4WorkerBridge.js`, `gate1RawRecorder.js` | Preserve raw observed host wall nanoseconds beside receipt's monotonic and sub-millisecond wall estimate, with source/precision `UNVERIFIED` metadata. No fabricated exchange time |
| `engine18BufferedRecorder.js`, `engine18Phase4SyntheticWorker.js`, `engine18Phase4WorkerBridge.js` | Expose sampled commit p99.9 latency, worker CPU/RSS, max queued depth and source callback p95/p99. Offer an explicit Little's-law-style `recommendEngine18MaxInflight` estimate; **do not automatically change the 256-message default without real peak measurements** |
| `engine18Issue300Acceptance.test.js` | Scheduled backup across rotation while .open grows; rename-window skip then retry, missing source failure, RFC3986 encoding, raw host wall observations, bad GCM restore cleanup, simulated slow-disk timing and capacity calculation |
| `engine18S3ExternalCompatibility.test.js` | Independent official Smithy SignatureV4 comparison across complex queries and local MinIO S3 PUT, GET, create-once 412, ListObjectsV2 continuation and authenticated encrypted restoration |
| `.github/workflows/engine18b-gate1-final-acceptance.yml` | UTC and `America/Phoenix` full Gate 1–5 test suites; separate temporary MinIO and AWS Smithy CI job. The historical MinIO server binary is pinned to the upstream 2025-09-07 release, fetched from GitHub releases and SHA-256 checked; **CI-only, not production server software** |

### Operational safety

Sealed hourly gzip+manifest are immutable after inventory acknowledgment. A prior gzip without manifest and with live original is a transitional artifact, not automatically bad data. A source-less or stale archive remains a safety fault. Backup lag/failures must trigger a private alert, and intake stops according to the independently reviewed health policy if backup cannot keep up. The backup scheduler and object encryption execute outside the existing market-data reader, which remains unchanged.

**A durable write may precede lost ACK.** Parent ACK counts and persisted record counts can diverge across crash windows; replay source sequence plus immutable archive/inventory receipts are the authority. Do not claim exactly-once parent delivery.

### Required real-life checks not completed here

- Confirm Ironbeam actual streamId, contract/subscription acknowledgment, depth snapshot/incremental/conflated semantics, zero-size level removal, index `l`, implied size/order counts `is`/`ioc`, source `t`, upstream heartbeat, gap windows with Claude. No individual resting-order identity claim.
- Confirm actual host NTP/Chrony and authorized exchange-clock provenance. Raw host wall observation is **not** proof of synchronization.
- Pin remote inventory lastSeq outside the same object store, configure independent read-only restore keys and no-delete upload keys, encryption key lifecycle/rotation, bucket retention/lock and deletion approval. Current `retentionDays` is metadata only, not enforceable retention.
- Real worker deployment, private disk capacity, pressure alerts, CME exceptional/holiday calendar, monitored interrupted uploads and hours-long/multi-session live soak remain separate acceptance steps.
- Load benchmarking is simulated and variable. The GH-hosted 512MiB memory comparison cannot certify peak memory on the proposed private Render worker.

## CI evidence (current implementation)

GitHub Actions reports:

- **94/94 pass in UTC; 94/94 pass in America/Phoenix** across original Gate1, Phase2, Phase3, Phase4, R1–R3, Phase5 and Issue300: https://github.com/bfrye1973/frye-market-backend/actions/runs/43067672025
- **2/2 pass in separate AWS Smithy + real local MinIO compatibility suite**, same run. MinIO test uses historical checksum-verified upstream binary in GitHub Actions only. This is an actual MinIO protocol test; **not a real paid Cloudflare R2 integration**.
- Existing isolated baseline, original Gate1, Phase2, Phase4, Phase5 workflows separately green at code commit `e7ae8d5f3a968081c896ed00515ece02565b0ad0`.

Synthetic capacity with **25ms injected disk delays**:
- UTC: commit p99.9 ≈ **44,076 µs**, worker RSS **69.8 MiB**, parent callback p95 **49.1 µs**, p99 **218.6 µs**; recommended illustrative maxInflight **882** at assumed 8,000 fps × 44.1ms × 2.5 safety.
- Arizona: commit p99.9 ≈ **36,897 µs**, worker RSS **69.2 MiB**, parent callback p95 **23.3 µs**, p99 **109.4 µs**; illustrative maxInflight **738** at the same assumed rate/factor.
- These are **sampled, synthetic** scenarios, not live market-open measurements or a safe unconditional capacity configuration.

## Render, bandwidth and the conditional $22/month budget — CRITICAL REVIEW

**Read-only Render inspection**:
- `frye-market-backend-1` service `srv-d2ds5nodl3ps73b7i2og` owns `dsk-d6a9f9fgi27c73affbdg`, 100 GB at `/var/data/replay`; unchanged.
- `frye-engine18-liquidity-research` service `srv-dbpijnon74is73e2sprg` is on isolated foundation branch, autoDeploy OFF, no disk reported. Unchanged.
- Proposed *new* private worker and 50GB disk remain unprovisioned; no paid R2 bucket/keys exist for this work.

| Incremental item | Illustrative monthly amount |
| --- | ---: |
| Render worker 0.5 CPU / 512MiB | $7.00 |
| New Render 50GB SSD at $0.25/GB | $12.50 |
| R2 Standard 150GB-month (10 free; 140 × $0.015) | $2.10 |
| **Original estimated subtotal** | **$21.60** |
| **Important missing potential line item** | Render outbound data sent to R2 |

**The owner's $22 ceiling is NOT verified or assured.** Render charges outbound traffic from its services to the public internet, including service-initiated uploads to object storage, at **$0.15/GB beyond the workspace's shared included allowance**; same-region AWS S3/GCS exclusions **do not automatically apply to Cloudflare R2**. Official Render docs show **Hobby 5GB and Pro 25GB included**, shared across all existing services. Render workspace/account plan and existing consumed bandwidth were not exposed by the available service metadata, so entitlement and remaining allocation are unknown. At **150GB of actual backup uploads/month**, if the full allowance were otherwise unused:
- Hobby (5GB): possible **$21.75** additional outbound bandwidth ⇒ illustrative **$43.35 total**.
- Pro (25GB): possible **$18.75** additional outbound bandwidth ⇒ illustrative **$40.35 total**.
- Existing traffic can reduce the allowance further. Encryption/metadata/API overhead, operations, restores, storage rounding, tax and bigger compute can increase cost.

**STOP before any paid provisioning.** The manager must inspect Render Billing for actual workspace plan and remaining shared monthly bandwidth, validate likely compressed GB/session, evaluate whether an authorized cheaper/exempt route is available, and get a **revised explicit owner budget authorization if any overage is expected**. A private Render worker alone does not make uploads to R2 free.

Current public pricing references, checked Nov 11 2026:
- https://render.com/pricing
- https://render.com/docs/outbound-bandwidth
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/api/s3/conditional-operations/

## Deployment and rollback plan — NOT EXECUTED

1. Manager and Claude audit the code, CI evidence and unknown Ironbeam semantics; approve synthetic-only merge as a distinct decision.
2. Manager confirms exact workspace plan/egress charges, data rights, R2 region, secrets/no-delete IAM, protected disk, bucket lifecycle/locking, trusted NTP and independently pinned inventory head. Confirm budget before spending.
3. After explicit separate authorization, provision *new* worker, attach *new* 50GB disk only, configure private object storage and restore-only dry run while raw capture is disabled. Do not mount/share main backend disk.
4. Verify S3 MinIO-backed compatibility against a separately approved R2 test endpoint using read/write test credentials; verify retention policy and external inventory anchor; prepare private monitors for backup lag, disk 70% warn/80% halt, IPC saturation, host clock and GAP evidence.
5. Only after manager's controlled-capture sign-off: limited ES feed recording, supervised failure recovery, Claude book semantics evaluation, five authorized sessions and actual throughput sizing.
6. **Rollback:** stop source intake, drain the isolated worker if healthy (clean STOP), else let crash/GAP evidence persist; seal and verify closed archives, last external inventory pin, and restore into a fresh empty private path. Roll back worker code only, preserve old dedicated disk/backups until byte-exact replay is proven, and never touch the main production disk/reader/chart/trading systems.

Future institutional ES zones and Engine22 Micro/Submicro owner-approved strategy/Fib targets remain **read-only research context**, per `docs/engine18/INSTITUTIONAL_MICRO_SUBMICRO_CONTEXT.md`. No strategy calculations, nodes or chart changed.

## Final Issue #300 result — Nov 11 UTC/Phoenix
- All **six relevant GitHub Actions workflows** passed at code commit `e7ae8d5f3a968081c896ed00515ece02565b0ad0`. The new acceptance CI includes 94/94 tests in each of UTC and Phoenix, plus 2/2 independent Smithy/real local MinIO protocol tests: https://github.com/bfrye1973/frye-market-backend/actions/runs/43067672025.
- The temporary MinIO executable was downloaded from the original MinIO GitHub release `RELEASE.2025-09-07T16-13-09Z`, SHA-256-verified against its published release checksum, run only on local GitHub Actions loopback, and destroyed afterward. Modern MinIO public container images have been withdrawn; this historical CI binary is **not approved production software**.
- Verified actual MinIO PUT/GET/conditional HTTP 412 and two-page ListObjectsV2; independent AWS Smithy signer comparison over spaces, stars, duplicate query names, and continuation tokens. MinIO is S3-compatible evidence, **not** actual Cloudflare R2 acceptance.
- Additional negative synthetic test: an unmanifested gzip with intact source is only temporarily skipped for 120 seconds, then triggers fail-closed recovery if still unresolved. Missing source fails immediately.
- **Operational budget gate remains RED.** The original ~$21.60 subtotal excludes Render outbound public network traffic from backup uploads to Cloudflare R2, which can materially exceed the conditional ~$22 owner budget. Require actual workspace bandwidth/remaining allowance and measured GB/session before provisioning.
