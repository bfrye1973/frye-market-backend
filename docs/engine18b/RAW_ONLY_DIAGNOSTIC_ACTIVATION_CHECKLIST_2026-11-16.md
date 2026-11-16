# Engine 18B — Separate 1–5 minute RAW-ONLY diagnostic trial (REVIEW ONLY)

**Status: CODE PREPARATION. NO REAL CAPTURE AUTHORIZED.**
This is the manager-requested smallest separate diagnostic, not a rewrite of the accepted recorder and not a downgrade of the 5 ms verified-clock acceptance requirement.

## Exact code and isolation

- New `engine18RawOnlyDiagnosticWorker.js` reuses `Engine18BufferedRecorder`, `Engine18IronbeamLiveRecorderSource`, `createEngine18ReceiptClock`, `Engine18S3PrivateStore`, `Engine18S3ArchiveCoordinator`, and `Engine18ContinuousBackup`.
- New `engine18RawOnlyDiagnosticEntrypoint.js` is **manual use only**; it is *not* configured as the Render standby worker's start command, is not mounted in the main server, and creates no HTTP endpoints.
- Existing `engine18ControlledLiveWorker.js` retains its existing Chrony + authenticated 5 ms gate, unchanged.
- Locked vendor feed: Ironbeam demo v2 `quotes`, `depths`, and `trades` for exactly `XCME:ES.Z26`; confirm vendor entitlement and CME session/calendar before a trial.
- No chart/Engine 11/22, signal, execution, prediction, conflation or model training hooks. This mode cannot claim latency, causal ordering, source completeness, or sub-5 ms timing.
- Existing recorder preserves exact received raw vendor message bytes (UTF-8 or base64 without parsing changes), original vendor-provided time fields, paired host wall and monotonic reception values, and an explicit `clockQuality:UNVERIFIED` control envelope. These are observations, not authenticated timestamps.
- Stop: manually on SIGINT/SIGTERM, or after the 1–5 minute absolute session timer. Unexpected disconnect, any source/GAP/integrity fault, unacknowledged queue/disk threshold, or remote backup failure must fail closed with private diagnostic alerts and recovery-required evidence. Sealed recordings are encrypted-uploaded, with remote inventory checked; **a successful remote inventory is not an independent restore test**.

## Operational prerequisites, BEFORE separate owner approval for real capture

1. **Private host/storage:** Existing private standby `srv-dbqg1qtbedkc73dg9p50` and independent 50 GB mount `/var/data/engine18-recorder`. The current standby process and its `ENGINE18_PRIVATE_STANDBY=YES` are not a live recorder. Do not modify production backend, Engine 11/22, trading, or its 100 GB `/var/data/replay`. The manual diagnostic must be separately scheduled on the already accepted private worker **after review**, not deployed as an auto-start process.
2. **Vendor:** Confirm licensed/demo Ironbeam v2 read-only `XCME:ES.Z26` market depth/trade/quotes permissions and credentials `IRONBEAM_USERNAME`, `IRONBEAM_PASSWORD`, `IRONBEAM_API_KEY`; rotate and revoke keys safely. Never write values to PR, commit, issue, CI or logs.
3. **Private R2:** Obtain separate **explicit owner cost approval** before creating any Cloudflare R2 bucket/credentials or incurring variable outbound/backup cost. Set a private bucket with restricted key permissions, explicit encryption/retention/key-recovery custody and HTTPS S3 endpoint. Required secret names: `ENGINE18_R2_ENDPOINT`, `ENGINE18_R2_BUCKET`, `ENGINE18_R2_ACCESS_KEY`, `ENGINE18_R2_SECRET_KEY`, `ENGINE18_R2_ENCRYPTION_KEY_HEX` (64 hex digits, separately safeguarded AES-256-GCM key), `ENGINE18_R2_KEY_ID`; optional `ENGINE18_R2_REGION` (account-verified) and `ENGINE18_RETENTION_DAYS`.
4. **Independent restore:** Perform an actual **remote private R2** encrypted upload and independent scratch restore with a synthetic fixture, confirm original bytes, record counts, archive + manifest SHA-256, encrypted-object authentication, immutable inventory chain, and negative tests. Record the independent `ENGINE18_INDEPENDENT_INVENTORY_PIN` sequence separately from the recorder. An operator-controlled verification receipt ID must be issued. Do not claim synthetic/mock tests satisfy remote restoration.
5. **Owner/operator:** Explicit owner + manager approvals for a bounded 1, 2, 3, 4 or 5 minute raw-only capture, read-only licensing, trial cost, CME session/calendar, max loss/stop policy, authorized operator identity and post-run evidence treatment. Record authorization IDs off-worker.
6. **Cleanup and restoration:** Verify the Render worker has its dedicated disk, software revision, safe stop procedure, correct private backup prefix, storage capacity, and a protected recovery path. Do not clean any existing archive or change default live worker flags as a shortcut.

## Activation variables — NAMES ONLY, not actual approval or permission to configure

The separate raw diagnostic accepts these **only after** the above independent evidence and separate explicit trial authorization:

- `ENGINE18_RAW_DIAGNOSTIC_OWNER_APPROVED=YES`
- `ENGINE18_RAW_DIAGNOSTIC_MANAGER_APPROVED=YES`
- `ENGINE18_RAW_DIAGNOSTIC_RESTORE_VERIFIED=YES`
- `ENGINE18_RAW_DIAGNOSTIC_RESTORE_RECEIPT` (operator-created independently pinned ID)
- `ENGINE18_RAW_DIAGNOSTIC_COST_APPROVED=YES`
- `ENGINE18_IRONBEAM_ES_DEMO_ENTITLED=YES`
- `ENGINE18_CME_CALENDAR_VERIFIED=YES`
- `ENGINE18_RAW_DIAGNOSTIC_OPERATOR_START=YES` (must be an explicit **manual** operator invocation)
- `ENGINE18_RAW_DIAGNOSTIC_CONTRACT=XCME:ES.Z26`
- `ENGINE18_RAW_DIAGNOSTIC_MINUTES` integer between 1 and 5
- `ENGINE18_RECORDER_DISK=/var/data/engine18-recorder/records`
- `ENGINE18_INDEPENDENT_INVENTORY_PIN` (externally pinned integer)
- `ENGINE18_PRIVATE_STANDBY=NO` is required in that manual process, and BOTH normal controlled-live flags must remain `NO`: `ENGINE18_LIVE_CAPTURE_APPROVED` and `ENGINE18_MANAGER_TRIAL_ACCEPTED`.

**Do not set these to YES yet.** A copied environment template, green CI, a receipt string, or owner preapproval of software development cannot replace the independently reviewed evidence and explicit future real-recording authorization.

## First trial acceptance / stop evidence

- Private start/stop metadata and all raw frames retained; receipt quality unequivocally UNVERIFIED.
- Three vendor subscriptions positively acknowledged; disconnect/GAP/rejected frame/saturation events make evidence INCOMPLETE. Never silently treat connectivity as full-depth or sequence completeness.
- Recorder source must stop by the selected minute bound or operator SIGINT/SIGTERM; no auto-restart authorization.
- Archive sealed before encrypted upload and remote inventory reconciliation. Record a non-secret run ID, hashes, source feed version, stream counts, backup head, store key-version ID, disk/queue summaries, disconnect/gap count, and anomalies.
- Independently pinned restore of **actual trial** archives is required before considering any downstream raw-content research, and timing-sensitive research remains prohibited unless the separate 5 ms gate later passes.
- If backup, restore, manifest, source, clock monotonicity or integrity fails: leave data quarantined, notify manager, and do not silently mark trial successful.

## Remaining actions

1. Manager reviews the focused PR and UTC/Arizona test results. **Do not merge or redeploy capture without his review.**
2. Owner gives separate approval for R2 costs and provisions protected vendor secrets; remote restore must pass.
3. Manager returns for **one distinct, bounded owner authorization** to actually record a 1–5 minute raw-only diagnostic.
