# Engine 18C — Daily RAW Ironbeam ES collection readiness (PREPARATION ONLY)

**Authority:** Engine 18B Manager Issue #300 comment #6954770528. Owner has approved preparation, **NOT recording activation**.

## Current observed estate (read-only inventory)

| Item | Verified evidence | Meaning |
| --- | --- | --- |
| Private Render worker | `srv-dbqg1qtbedkc73dg9p50`, name `frye-engine18-private-recorder-standby-t6l7` | Existing worker; no extra infrastructure |
| Configured branch | `engine18c-observed-mbp10-offline-v0-20261116` | Distinct from merged isolated `engine18b-private-recorder-standby-20261111`; reconcile only via reviewed release |
| Live deployment | `dep-dbtrkth42hec73aq9510`, deployed commit `c61f8981d2ab1cc5568fe3c209366e95862b14d5` | Current Render deployment metadata; no recording activation inferred from deployment alone |
| Start command | `node services/core/logic/engine18/engine18PrivateStandby.js` | Standby/no vendor socket |
| AutoDeploy | OFF | Prevent unreviewed code activation |
| Disk | `dsk-dbqg1r5bedkc73dg9qeg`, **50 GB**, mount `/var/data/engine18-recorder` | Dedicated private disk; CURRENT free bytes still need a fresh host reading |
| Real capture | 1-minute RAW_FRAMES_ONLY, 492 ordered records / 483 vendor frames | Prior operator-run, operator-restored; 0 recorder GAP controls, clocks UNVERIFIED |
| Real archive | R2 namespace `engine18/raw-only/v1`, externally pinned `lastSeq=492`, head `c9ab599ef9cf10e14baae17ef3223e09d2be0bce53276382d0aa7eb8aa79166e` | Historical pin, not current/live independently re-read R2 state in this assignment |
| Synthetic legacy | Namespace `engine18`, externally pinned lastSeq=4 / head `d5e31aa9fe1aa2b51801dba5862e86127e2ebc36327739095cf64b095f1d5517` | Must remain untouched |
| Latest available standby log | 2026-11-17 16:24–16:30 UTC: `liveCaptureActive=false`, `ironbeamConnectionActive=false`, `backupUploadsActive=false`, `privateDiskMounted=true` | Connected Render logs, not operator interpretation |\n| Latest observed disk bytes | `diskFreeBytes=52504555520`, `diskTotalBytes=52521566208`; used ≈17,010,688 bytes (~16.2 MiB) | Recent standby log; headroom adequate at observation, not guaranteed for a future session |\n| Clock proof | `chronyc` command unavailable, `authenticatedClockQualityAvailable=false`, `meetsFiveMsAuthenticatedGate=false`, `clockQuality=UNVERIFIED` | Concrete normal-clock research and session gate NOT PASSED |\n| Recorder backup | `engine18ContinuousBackup` = 30-second `syncClosed()` ticks; `engine18Phase5S3Coordinator` full reconciliation cache guard 900000 ms (15 minutes) | Source-level optimizations verified; cannot call these measured R2 costs |
| Primary recording | Existing recorder captures individual raw Ironbeam vendor frames | One-minute chart candles are independent alignment evidence, **not** primary recorder data |

## Production design decisions / hard gates

1. **No unattended start yet:** current `engine18RawOnlyDiagnosticWorker.js` is a FIRST-TRIAL, empty-namespace, 1–5-minute ESZ26-only exception; it explicitly refuses prior records in the existing `records` directory and rejects non-empty R2 inventory. It cannot be extended with a timer switch: a separately reviewed *append-only recovery-aware session runner* is necessary. The new preparation PR intentionally does NOT create a live runner, start sockets, or manipulate checkpoint/seq.
2. **Physical contract:** individual plan for `XCME:ES.Z26` or `XCME:ES.H27` only, with approved explicit roll decision. Rollover cannot occur silently during a running session. Record raw futures contract price unchanged; never apply Engine26 chart roll adjustment to raw book frames.
3. **Session clock & calendar:** operator-supplied, vendor/CME-verified full-session UTC opening/closing instants and holiday exceptions, independently reviewed each session. Fail closed on missing/invalid calendar. Hard monotonic or wall deadline measured at or before connection; never extend on reconnect. Maximum 24h finite window; stop at approved close and at any safety fault.
4. **Clock validity:** existing ≤5 ms verified clock gate remains mandatory for any timing inference. Previous 60-second RAW_FRAMES_ONLY unverified-clock exception does NOT extend to daily recording. Any requested time-unverified raw-only study mode is a separate decision and must be explicitly bounded, labeled, and reviewed.
5. **Disk/queue/backup:** require verified dedicated 50GB mount and fresh available space; stop if free < max(25% of total, 10 GB), queue ≥3686 unacknowledged or overflow, failed closed/rejected/gaps, transport interruption or uncertain capture, remote backup >120s stale/fails. Backup 30sec work must remain non-overlapping; a failure must stop intake rather than continuing an indefinite unbacked run. Immutable R2 encrypted archive+manifest+inventory verification and independently pinned chain before resuming after restart.
6. **Storage, retention, cost:** owner to explicitly approve license permitting captured ES order-book retention/analysis, retention days, data budget and a bounded maximum remote-bytes budget before a session. **Not measured** in this assignment: true R2 request counts, egress, compressed archive bytes per minute, current disk occupancy, actual Cloudflare bill, full-session data volume, or permitted retention under the signed exchange/vendor license. Do not suggest a cost estimate as fact without measurements.
7. **Restart/reconnect:** reconnect is not an excuse to splice continuous market history. Mark gaps, stop active capture on stream uncertainty and require independent checkpoint/archive recovery and operator-reviewed resumption. First time continuing from the 492-record real capture, never reset to 1, never mix with synthetic seq 1–4. Every later session requires newly pinned remote state, not a hardcoded original seq.
8. **Operator limits:** release signoff before launch; preflight check and independent stop; test deliberate SIGTERM, backup fault, disk threshold, queue overflow, duplicate invocation lock and CME close. No automatic restart that bypasses owner mode or the last-approved deadline.

## Stage gates (not yet authorized)

- **Preparation stage (current):** code review, synthetic mocked session/roll/calendar/disk/queue/backup tests, source inspection, zero live connection, zero paid recording.
- **Supervised stage (future, explicit owner approval):** bounded trial using existing worker and verified read/append-only R2 continuation, session window/contract, vendor entitlement and budget/retention pin. Watch for source frame/quote/depth/trade counts, gap/queue health, proper hard stop, encrypted backup, independently pinned restore, and manager accept/reject.
- **Sustained stage (future, separate authorization):** only after supervised run + restore, verified clock/cost/license/session calendar, and full-session recovery tests. Never enable an indefinite cron by default.

## Independent chart basis check

Use only Engine11 LIVE chart **actual one-minute ESZ26 candles** and matching source-time periods. Determine whether each genuine Ironbeam trade falls within that exact bar H/L, and compare last trade with close **only when the streams cover the same minute completely with matching aggregation**. Recommended formal basis sample: >=100 distinct one-minute bars across >=2 sessions including cash open; require zero tick discrepancy under properly aligned source basis. If unavailable, result **PRICE_BASIS_UNVERIFIED**, no overlay into owner-approved HAND zones and no second roll.

## Evidence criteria for Engine 18B release decision

Return the existing service settings and pinned history untouched; manager approves merge only after focused CI PASS, then separately authorizes and verifies any future recovery-aware session runner, protected environment, signed license/retention, hard stop, budget and operator window. Recording remains OFF until explicit owner go-live.
