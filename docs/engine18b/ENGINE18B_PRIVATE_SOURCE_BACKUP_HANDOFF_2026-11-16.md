# Engine 18B — Private source and encrypted backup readiness (2026-11-16)

## Status and scope
Private Render standby worker `srv-dbqg1qtbedkc73dg9p50` already exists with its own 50 GB disk at `/var/data/engine18-recorder`. This is an **operator checklist**, not permission to start live capture, purchase R2, or modify the existing monitor/chart/trading backend. Standby remains the deployed entrypoint. Source and backup must remain private and wholly separated from the production 100 GB `/var/data/replay` mount.

## Hard stop on current clock
`engine18ClockQuality.js` currently accepts **verified Chrony** tracking only. The Render host reports `chronyc` unavailable. Public NTP measurements are unauthenticated, include path-delay uncertainty, and do not meet the required independently auditable 5 ms ceiling. The new `engine18NtpDiagnostic.js` produces multiple `UNVERIFIED` observations after startup and on a 30-minute schedule; it cannot authorize recording or provide clock synchronization. Never repurpose its offset readings as true receipt times.

## Remaining private Ironbeam inputs (not yet configured)
Obtain through authorized vendor/owner channel, verify entitlement and demo feed agreement for `XCME:ES.Z26`, with quotes, depths, trades, and official timestamps. Configure Render **private worker environment** rather than source files or public Blueprint:
- `IRONBEAM_USERNAME`
- `IRONBEAM_PASSWORD`
- `IRONBEAM_API_KEY`

Keep protected values out of source control, issue threads, CI output, logs and browser requests. Existing source uses the authenticated `demo.ironbeamapi.com` v2 API; use exactly the reviewed contract. Confirm token rotation and emergency revocation with owner/vendor. Do not send any authenticated URL/token into diagnostics.

## Remaining encrypted R2 inputs (private bucket, separately cost-approved)
No account, bucket, purchased capacity or credential is implied to exist. Get explicit pricing/variable-outbound approval before provisioning. After approval create a restricted non-public R2 bucket and least-privilege credentials restricted to the chosen bucket/prefix, no anonymous access:
- `ENGINE18_R2_ENDPOINT` (remote HTTPS, private S3-compatible endpoint)
- `ENGINE18_R2_BUCKET`
- `ENGINE18_R2_REGION` (typically `auto` for R2, verify with account)
- `ENGINE18_R2_ACCESS_KEY`
- `ENGINE18_R2_SECRET_KEY`
- `ENGINE18_R2_ENCRYPTION_KEY_HEX` (separate 32-byte AES-256-GCM master key encoded as 64 hex digits, safeguarded outside Render for disaster recovery)
- `ENGINE18_R2_KEY_ID` (non-secret version identifier)
- `ENGINE18_INDEPENDENT_INVENTORY_PIN` (trusted external high-watermark integer, 0 only for verified empty bucket)
- `ENGINE18_RETENTION_DAYS` (owner-approved finite retention, explicitly review legal/vendor obligations)

Set `ENGINE18_RECORDER_DISK=/var/data/engine18-recorder/records`, confirm mount from `/proc/self/mountinfo`, and keep `ENGINE18_LIVE_CAPTURE_APPROVED=NO`, `ENGINE18_MANAGER_TRIAL_ACCEPTED=NO`, `ENGINE18_CME_CALENDAR_VERIFIED=NO`, `ENGINE18_TRIAL_MINUTES=0` throughout preparation. Do not switch deployed standby entrypoint to controlled live source.

## Independently pinned restore exercise (AFTER approved remote R2 resources exist)
1. Validate empty/private inventory state and independently record the initial high-watermark/head outside the worker before any uploads. The worker is not the independent authority for its own pin.
2. Using a synthetic, non-licensed test fixture on a separate test path, generate one sealed recording hour plus its manifest with known first/last sequences and SHA-256. Never copy real broker keys or production journal records into it.
3. Encrypt and upload sealed archive + manifest with the existing `Engine18S3PrivateStore` / `Engine18S3ArchiveCoordinator` code. Confirm conditional immutable PUT, private encrypted inventory, SHA-256 of plaintext, AES-256-GCM authentication, and non-overwrite semantics.
4. Independently publish and pin the **new** high-watermark/head hash in an operator-controlled medium inaccessible to the recorder process. Destroy only the disposable local test fixture after a protected copy is secured; do not touch the dedicated worker's existing production-like directory or the main backend disk.
5. Perform restore into a **separate** scratch directory, using the independently pinned inventory. Verify full archive/manifest hash, exact record bytes/sequence/time fields, replay counts, and parity with original fixture.
6. Negative tests: wrong encryption key, dropped tail entry, inventory gap, altered ciphertext and modified manifest must fail closed; restore must reject a stale/mismatched head pin.
7. Document object key IDs, expected sequence range, SHA-256 digests, source/restore run IDs, date/time, and evidence links **without credentials or market-data payloads**. Record retention and key rotation/recovery ownership.
8. Only then request manager review; live 1–5 minute Ironbeam trial is a **separate** approval step. Before any trial, also verify licensed entitlement, CME session/calendar and trial minutes.

**Current status:** No private R2 account/bucket/credentials confirmed, no remote restore performed. Synthetic S3 adapter tests from PR #303 do not constitute a remote independent restore drill.

## ONE alternative if 5 ms verified host clock cannot be established
A distinct, separately reviewed **1–5 minute raw-frame-only diagnostic**, not the existing controlled live worker with weakened clock checks:
- Requires separate manager and owner approval, vendor entitlement, private bucket/restore verification and finite session/CME checks.
- Captures raw Ironbeam v2 frames unchanged, preserving provider timestamps plus paired host wall and monotonic receipt values; all host receipt timing marked `UNVERIFIED`, including offsets, uncertainty and clock steps.
- No latency/causality inference, quote/depth conflation, predictive analytics, chart output, engine integration, alerts, trade advice, orders or broker connections. No downstream consumption for timing decisions.
- Fail closed on missing frames/sequence gaps, backpressure, disconnected source, unverified backups, disk health failure or time-window expiry.
- Keep this alternative as **policy proposal only**. No implementation, activation flag, new worker, paid storage or real data capture authorized by this checklist.

## Gate decision
Current host: **UNVERIFIED / NO-GO** for the existing 5 ms controlled-live trial. Operational inputs to unblock: demonstrably authenticated auditable 5 ms source on this worker OR separate raw-only diagnostic policy approval; private Ironbeam entitlement/secrets; paid private R2 approval/configuration; independent real remote restore; licensed bounded-trial approval. No recorder redesign requested.
