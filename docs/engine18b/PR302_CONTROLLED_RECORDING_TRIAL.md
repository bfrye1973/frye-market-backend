# Engine 18B — PR #302 final handoff and first supervised Ironbeam trial

**Status:** Development and synthetic test preparation only. No licensed Ironbeam capture, public access, Render deployment, credential change, disk purchase, or LIVE chart/trading modification. The Engine 18 Manager owns review/merge/activation.

## Exact scope of this PR

1. **Inventory cache:** `engine18Phase5S3Coordinator.js` caches independently verified hash-linked encrypted inventory and stat-proofs for unchanged completed archives, avoids repeated remote GET/LIST, verifies each new entry separately, and performs full startup/15-minute reconciliation. Full independent high-watermark replay verification is still required on restoration.
2. **Independent read-only Ironbeam v2 rehearsal:** `engine18IronbeamV2RecorderRehearsal.js` mirrors the current separate Engine 18 v2 auth → stream/create → WebSocket OPEN → quote/depth/trade subscription sequence with injected synthetic transport and hard-blocked real provider URL. It preserves original frame data, generation tickets, subscription SUCCESS/FAILED, source GAP and original raw text/binary in the approved recorder. Failed subscription is recorded and closes the rehearsal transport. It does not alter the existing `ironbeamV2Level2Monitor.js`, dashboard or any active WebSocket.
3. **Read-only context:** `engine18ReadOnlyResearchContext.js` extracts institutional `structures_sticky` and published Engine 22 Micro/Submicro degrees/working nodes exactly as supplied; source available-at and research as-of timestamps plus ES physical-contract price-basis checks guard against hindsight. No inferred liquidity, recalculated wave, Fibonacci or trading authority.
4. **Fail-closed trial gate:** `engine18ControlledTrialReadiness.js` evaluates essential operational evidence by safe boolean keys and returns a private list of missing gates. It cannot activate capture, reveal credentials, or authorize itself.
5. `engine18Post301Readiness.test.js` and its GitHub Actions workflow run isolated UTC/Phoenix coverage and the complete prior Gate 1–5 recorder regressions.

## Prior to first controlled real-data recording (manager/operator acceptance)

1. **Independent worker:** deploy a new non-public, read-only recorder service, not the existing chart, monitor, broker or Engine11. Confirm a dedicated persistent mount and that `frye-market-backend-1`'s existing 100GB `/var/data/replay` disk stays untouched.
2. **Credentials and entitlement:** inject Ironbeam v2 credentials using private service secrets, with minimum market-data entitlements, rotation, no credentials in raw logs, object names, alerts or source repository. Confirm actual contract symbol and vendor `streamId`/subscribe ACK semantics before storing real bytes.
3. **Private storage and restore:** approved dedicated disk, encrypted S3-compatible backup, least-privilege/no-delete uploader credentials, independently pinned inventory head, retention policy and an actual test restoration into an empty private destination with byte-exact replay and SHA-256 manifest reconciliation.
4. **Host clock and session:** trusted Chrony/PTP source with measured offset/uncertainty, retained host wall and monotonic receipts, true clock-quality status, CME holidays/early closes and correct Arizona timestamps; uncertain clocks must remain explicitly UNVERIFIED.
5. **Health:** hard stop on recorder backlog/disk threshold, missing backup evidence, fatal write errors or capture-source interruption; private alerts for queue pressure, reconnects, source uncertainty, GAP, disk usage and backup lag. No exposed raw market prices.
6. **Supervised pilot:** manager authorizes a limited time window, named operator and independent stop procedure. Verify reconnect/subscriptions with `quotes`, `depths`, `trades` and physical ES; keep exact raw vendor objects, unknown/malformed frames, binary and original timestamps. After the window, seal/backup/restore and compare sequence/replay twice, including deliberate restart test.
7. **Claude's market-book review:** determine actual depth full-image vs incremental vs conflated, `sz=0`, level `l`, `is`/`ioc`, original vendor `t`, source sequence and gap scopes. Do not infer individual resting-order MBO identities from MBP depth. Begin book-derived persistence/depletion/replenishment/price-contact research only after feed semantics are validated.
8. **Separate research gate:** compare validated book-derived zones against institutional ES and Engine22 Micro/Submicro/approved Fib levels through read-only, point-in-time sources. Keep order-book liquidity independent from strategy-card levels.

## Shutdown and rollback

- Stop new source subscriptions/intake first; drain the independent recorder when safe, write clean STOP and fsync/checkpoint. If killed unexpectedly, preserve the incomplete archive and evidence for bounded recovery plus GAP on restart. Never manufacture an exchange sequence gap.
- Verify latest completed gzip/manifest and independent remote high-watermark. Restore into a separate empty private directory, hash files and compare deterministic replay before restarting the limited trial.
- Roll back only the private recorder worker. Do not touch existing LIVE chart, Engine 11, Engine 22, execution or the main backend disk.
- The owner wants engineering first. The earlier ~$22/month estimate is conditional and potentially excludes Render outbound backup bandwidth; confirm realistic charges immediately before any separately approved paid provisioning, without postponing unrelated code work.

**No real recording is enabled by this PR.** See prior `ISSUE300_FINAL_ACCEPTANCE.md` for protocol, encryption and performance evidence; PR #302 CI is the authority for final exact-head tests.
