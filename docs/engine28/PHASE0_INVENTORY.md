# Engine 28 — Phase 0 Inventory (read-only)

**Date:** 2026-11-27 (Arizona) · **Author:** Claude (read-only inventory, Assignment B)
**Status:** Findings for Engine 28 Manager review. No production changes, deploys or trading-rule changes were made.

Each item is marked **VERIFIED** (checked directly against code, tests or Render), **UNKNOWN** (could not be checked), or **PROPOSAL**.

---

## 1. What was checked, at which revision

| Source | Revision / time | How |
|---|---|---|
| `main` | `19ffc3c` (merge of PR #411, 2026-11-26) | git clone |
| PR #417 (Engine 8 producer) | head `09565bb` (2026-11-27 10:23 AZ) | `refs/pull/417/head` |
| PR #418 (Engine 12 consumer) | head `057d314` (2026-11-27 09:18 AZ) | `refs/pull/418/head` |
| PR #402 (Engine 8 eligibility repair) | head `018266d` (2026-11-25) | ref only, not reviewed (separately governed) |
| Render workspace "My Workspace" | 2026-11-27 ~11:30 AZ | Render API, read-only |

**Not checked:** issue/PR comment threads and CI run results (GitHub API not available to this session; only git reads). Render environment variable values.

## 2. Production status — VERIFIED

- Production backend: Render web service `frye-market-backend-1` (1 instance, plan 1c-2g, 100 GB disk at `/var/data/replay`). Live deploy = `main` @ `19ffc3c`.
- **`main` auto-deploys on every commit.** Merging a PR to `main` is a production release.
- Scheduler: Render cron `frye-market-backend`, `*/3 * * * *` (UTC, 24/7) → `POST /api/v1/run-all-engines`. Nominal 480 slots per day.
- Last hour of logs (17:30–18:28 UTC): every slot ran; each cycle took **48–55 s**; start times jitter up to ~45 s. No `ALREADY_RUNNING` skips in the last 7 days of logs.
- PRs #417 and #418 are **not** in production.
- The same service also runs `watchEngine8RealSchwabFills.js` in a loop at startup (REAL fill watcher). Noted for scope; not reviewed.

## 3. Existing Engine 28 — VERIFIED

There is **no "Engine 28" code outside 28A.** Everything lives under the 28A name.

| Module | File | What it does | Authority |
|---|---|---|---|
| Pipeline Doctor v1 | `logic/engine28a/buildPipelineDoctor.js` (1,019 lines) + `jobs/updateEngine28APipelineDoctor.js` + route `GET /engine28a/pipeline-doctor` | Reads one frozen Strategy 1 snapshot; finds first non-passing stage on chain 26A→3→4→6→26B→7→9→8→10; WAITING vs BLOCKED vs ERROR | Read-only; runs every cycle (Step 3B) |
| Auto PAPER entry bridge | `jobs/autoExecuteCanonicalPaperTrade.js` | If Engine 8 says `READY_TO_CREATE_PAPER_ORDER`, calls the existing protected Engine 8 route | **Execution-invoking** (Step 4) |
| Auto PAPER lifecycle monitor | `jobs/autoManageCanonicalPaperLifecycle.js` (1,512 lines) | Detects Engine 9 stop/target touches, calls Engine 8 lifecycle route | **Execution-invoking** (Step 0, protective exits) |
| Micro Replay Learning v1 | `logic/engine28a/buildMicroReplayLearning.js` + workflow `micro-replay-learning-v1.yml` | Offline evaluator of Replay snapshots at 10/30/60 min; dedupes cron snapshots | Research-only |
| Micro timing automation shadow | `buildMicroTimingAutomationShadow.js`, `summarizeMicroTimingShadowSnapshots.js` | "If Engine 22 Micro were authorized, which gate blocks first?" | Shadow / research-only |
| Replay window audit | `jobs/auditEngine28AReplayWindow.js` | Historical audit, runs only if `ENGINE28A_REPLAY_AUDIT_DATE` set | Read-only, optional |

Tests on `main`: `engine28A*` + `tradeInvestigator*` = **97/97 pass** (run from repo root).

**Conflict with the plan (owner decision needed):** the plan says 28A "observes, diagnoses and reports" and must never place orders. In the code, two execution-invoking jobs carry the 28A name. They invoke Engine 8 routes rather than creating orders directly, so this may be within "the existing scheduler may invoke approved execution components", but the naming makes the boundary unclear. See Decision D-3 in the master plan.

## 4. #412 PR status — VERIFIED at exact heads

| PR | Head | Tests touched by PR | Result |
|---|---|---|---|
| #417 | `09565bb` | 87 | **87/87 pass** (matches the reported 87-test checkpoint) |
| #418 | `057d314` | 70 | **70/70 pass** |

- **#418 is not stacked on #417.** Both edit the same files (`engine8PaperCoverage.js`, `engine8PrivatePaperReceipt.js`, `engine8PaperReceiptObserver.js`, `runAllEngines.js`, …) with **different contents**. Whichever merges second will conflict, and approval of either does not carry over. This breaks the one-owner-per-file rule.

## 5. Defects and risks found

| # | Finding | Status | Severity |
|---|---|---|---|
| F-1 | **Observer failure blocks PAPER execution.** In `runAllEngines.js`, Step 4 (auto PAPER execution) runs only if `step3doctor.code === 0` and the Replay archive step succeeded. The Pipeline Doctor is a diagnostic; if it throws or exits non-zero, that cycle's execution is skipped. This violates "an observer failure must not become an execution failure." Present on `main` and unchanged in #417. | VERIFIED (code) | High |
| F-2 | **The entry observer awaits receipt storage, with no timeout.** In both #417 and #418, `autoExecuteCanonicalPaperTrade.js` does `await observeCompletedPaperCycle(...)` before exiting. The scheduler awaits Step 4 before releasing its lock. Slow storage extends the cycle; once a cycle exceeds ~3 min, the next cycle (including Step 0 protective lifecycle exits) returns `ALREADY_RUNNING`. Current headroom: cycles take ~50 s, so ~2 min of slack. | VERIFIED (code) | High |
| F-3 | **Receipt store stops recording after 50,000 files.** `persistPrivateReceipt` scans the whole directory on every write and throws `RECEIPT_CAP_REACHED` at 50,000 entries, with no rotation. #417 writes ~3–4 receipts per cycle (start, end, lifecycle, executor), so roughly 1,500–1,900/day, which hits the cap in **about 4–5 weeks**. After that every receipt fails and coverage becomes UNKNOWN. Each write also gets slower as the directory grows, which makes F-2 worse. | VERIFIED (code); timing estimated | High |
| F-4 | **`ALREADY_RUNNING` skips are invisible.** The skip returns HTTP 200 `ok:true` before any receipt is written, and Render's cron sees a success. The scheduler's own records can't show a skipped slot. Coverage must treat missing receipts as UNKNOWN, never as "no trade". | VERIFIED (code) | Medium |
| F-5 | **In-memory lock.** `IS_RUNNING` lives in process memory. A deploy or restart mid-cycle drops it; a concurrent cycle is possible across a restart. Needs a restart/concurrency test (already in the 28A assignment). | VERIFIED (code) | Medium |
| F-6 | **No per-step timeout** in `runStep`. A hung child process hangs the whole cycle. | VERIFIED (code) | Medium |
| F-7 | **Pipeline Doctor substring classifier.** At Engines 6/7/9/8, any blocker text containing `MARKET`, `VOLUME`, `PARTICIPATION`, `WAIT`… is classified `WAITING_FOR_MARKET`. A code like `…MARKET_DATA_STALE` would be called "waiting" instead of an operational error. Not observed in data yet; needs a test with real reason codes. | VERIFIED (code); impact UNKNOWN | Medium |
| F-8 | **Evidence expires.** Replay retention job keeps 14 Arizona days (deletion only if `ENGINE12_RETENTION_ENABLED=true`; env value not checked). Engine 8 / Engine 10 stores have **no retention guarantee** (per the investigator README). If deletion is on, the Nov 24–27 acceptance-case snapshots are gone around Dec 7–10. | VERIFIED (code); env UNKNOWN | **Urgent** |
| F-9 | The repo is **public**. Receipts are private (directory must be mode 0700) and logs use a redacted projection. Public #412 reports must stay sanitized. | VERIFIED | Medium |

## 6. Existing continuity system — VERIFIED

The repo already has a session handbook (added 2026-11-26, PR #410):

- `CLAUDE.md`: roles, guardrails, workflow. It currently names **Claude as lead engineer** and **Engine 18D (GPT) as independent auditor**.
- `docs/engines/README.md`: one file per engine; Engine 28A listed as "file not yet written".
- `docs/HANDOFF_LOG.md`: session log.

**Conflict:** the new plan names ChatGPT as Engine 28 Manager. `CLAUDE.md` names Claude as lead engineer. Both can be true (Claude leads overall, ChatGPT manages Engine 28), but it has to be written down. See Decision D-1.

**Recommendation:** reuse this. Add `AGENTS.md` (tool-neutral, same rules), `docs/engines/ENGINE28.md` and `docs/engine28/`. Don't build a second parallel handbook.

## 7. Storage available for trading intelligence — VERIFIED

- Replay snapshots: `/var/data/replay/es/YYYY-MM-DD/HHMM.json` on the 100 GB production disk (immutable, 14-day retention policy).
- Engine 8 PAPER store, Engine 10 Journal: mutable JSON files, no retention guarantee.
- Render Postgres: none exists. Not needed yet.
- Engine 18 has its own 50 GB disk (raw recordings), separate service.

**Recommendation:** first priority is archiving Replay snapshots before they expire, not a new database.

## 8. Open UNKNOWNs (for next inventory pass)

1. Is `ENGINE12_RETENTION_ENABLED` true in production? (owner or Render env read)
2. Is `ENGINE8_PAPER_VERIFICATION_ENABLED` set anywhere? (expected: no, PRs not merged)
3. CI results and review comments on #412/#413/#417/#418 (needs GitHub API access)
4. Actual real reason codes seen at Engines 6/7/8/9, to test F-7
5. Whether the REAL Schwab fill watcher is in Engine 28's scope (expected: no)
