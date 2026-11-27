# Engine 8 — PAPER execution (passover + design review)

**Written:** 2026-11-27 by Claude, from a direct read of `main` @ `19ffc3c` (the version running in production) and Render scheduler logs. For the Engine 8 manager (Claude) and reviewer (ChatGPT Engine 8). Read `CLAUDE.md`, then this file, then the open items in section 7.

**One-line summary:** Engine 6 *is* approving trades; Engine 8 refused every one because it was still locked in the original "one acceptance test trade" mode. **Fix released Nov 27** (PR #402 code + Render setting); it needs confirming on the next approved trade.

---

## 1. What Engine 8 is for

Engine 8 turns an approved Strategy 1 decision into a PAPER order. It does not decide whether to trade (Engine 6 does) or how to manage the trade (Engine 9's plan does). It never places REAL orders.

**Strategy 1 (as stated by the owner):**
- `intraday_scalp@10m`, ES zone-to-zone, PAPER only
- Trades only when price is inside a negotiated institutional zone, targeting the next zone
- Size is 3 contracts (MES, $5/point)

## 2. How an approved trade reaches an order today

Every 3 minutes, Render cron `frye-market-backend` calls `POST /api/v1/run-all-engines` on `frye-market-backend-1`:

| Step | File | Engine 8's part |
|---|---|---|
| 0 | `jobs/autoManageCanonicalPaperLifecycle.js` | Protective exits: checks the frozen Engine 9 stop and targets against 1-minute ES bars, then calls the Engine 8 lifecycle route |
| 3A | `jobs/buildStrategySnapshot.js` → `logic/trading/engine8CanonicalPaperAdapter.js` | Builds `engine8PaperOrder` in the snapshot: **all the eligibility checks run here**. Calls `getEngine8DuplicateState()` (`engine8DuplicateState.js`) |
| 3B | `jobs/updateEngine28APipelineDoctor.js` | Engine 28A names the first blocking engine (diagnostic only) |
| 4 | `jobs/autoExecuteCanonicalPaperTrade.js` | Only if the adapter says `READY_TO_CREATE_PAPER_ORDER`, it POSTs `/api/trading/paper/execute-canonical` → `runEngine8PaperExecution.js` / `engine8PaperExecutor.js`, which **re-checks** and places the PAPER order |

**Adapter check order** (`buildEngine8CanonicalPaperAdapter`): live-safety → Engine 6 permission/direction/decision (`PAPER_ALLOW`, `FAST_INTRADAY_PAPER_ALLOW`) → Engine 9 plan → Engine 7 final size → identity match (candidate/plan) → geometry match (entry, stop, stop distance) → **duplicate and acceptance-lock gate** → `ENGINE8_PAPER_ONLY` → READY.

## 3. Why approved trades are not filled (root cause)

**Evidence: three trades the owner flagged.** Source: the scheduler's own logged output for each cycle.

| Date (AZ) | Engine 6 | Engine 8 status | Order sent? |
|---|---|---|---|
| Nov 25, 8:01 AM | Approved LONG, plan `E9P-3d31…` | `DUPLICATE_ORDER_BLOCKED` (underlying `PAPER_ACCEPTANCE_STATE_UNAVAILABLE`, confirmed earlier from Replay) | No |
| Nov 25, 11:31 AM | Approved LONG, new candidate and plan `E9P-279e…` | `DUPLICATE_ORDER_BLOCKED` | No |
| Nov 27, 4:46 AM | Approved SHORT at ~7307, plan `E9P-1e0d…` | `DUPLICATE_ORDER_BLOCKED` | No |

In all three, the step 4 reason was `ENGINE8_ADAPTER_NOT_READY_ENVIRONMENT_ARMED`. That reason only appears after the PAPER-only, executor-enabled, kill-switch and admin-secret checks have passed. **Production settings are armed; the adapter's duplicate/acceptance gate is the only blocker.**

**The mechanism (code on `main`):**
1. `engine8PaperAcceptanceEligibility.js` requires `engine8-paper-acceptance-state.json` to exist in the durable PAPER store (`ENGINE8_PAPER_DATA_DIR`, default `/var/data/replay/engine8-paper`). If it is missing, the result is `PAPER_ACCEPTANCE_STATE_UNAVAILABLE`.
2. `engine8PaperDurableStore.js` started that store **empty on purpose** ("no migration, no copying").
3. The file is only written by `markEngine8AcceptanceTradeCompleted` when a trade **closes**. No trade can open without it. **That is a deadlock.**
4. Even if the file is created with new orders allowed, the first completed trade rewrites it to `acceptanceTradeCompleted: true, newPaperOrdersAllowed: false`, the original one-time-trial lock. After that, new candidates pass only when `ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED=1`.
5. The adapter reports all of this under one label, `DUPLICATE_ORDER_BLOCKED`. So the problem looked like a duplicate-order issue.

**Not yet confirmed:** that the Nov 25 11:31 and Nov 27 4:46 approvals had the same underlying blocker. Their labels match, but confirming needs the Replay snapshots `2026-11-25/1131.json` and `2026-11-27/0446.json`, kept until about Dec 9–10.

## 4. The fix: RELEASED Nov 27, 2026 (owner-authorized)

**Status (1:08 PM AZ, Nov 27):**
- **Code:** PR #402's exact reviewed head `018266d` was merged to `main` as `f7d1bc4` through PR #426 (#402 was a draft and couldn't be un-drafted over REST; #402 is closed as superseded).
- **Setting:** `ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED=1` was set on Render service `frye-market-backend-1` (merged into the existing settings, nothing else changed).
- **Deploy:** `dep-dc4u5ulvbd1s73burjc0` went live at 20:08:39 UTC. The first cycle afterwards (20:09 UTC) ran cleanly in 37 s.
- **Not yet proven:** the market was closed (holiday session), so no Engine 6 approval has occurred since the release. **Proof = the next approved trade's step 4 output shows `AUTO_PAPER_EXECUTION_COMPLETED`.** If it shows `DUPLICATE_ORDER_BLOCKED` again, read that snapshot's `engine8PaperOrder.blockers` before changing anything.

### Background (what the fix does)

**PR #402** (head `018266d`, released via #426): when the acceptance file is genuinely missing **and** `ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED=1`, eligibility is allowed (`CONTINUOUS_PAPER_AUTHORIZED_NO_LEGACY_TRIAL`). A present but corrupt file still fails closed. Engine 8's manager passed it on Nov 25 (29/29 tests; full simulated campaigns; duplicate, kill-switch, operator-disable and stranded-lock safeguards kept). The code only allows orders while the setting is on; turning the setting off restores the old blocking behavior.

## 5. Design problems (why this stayed hidden)

| # | Problem | Effect | Proposed fix |
|---|---|---|---|
| D1 | Built as a **one-time acceptance test** and never converted to continuous trading | Every trade after the first needs a compatibility flag | Retire the trial concept; one explicit `ENGINE8_PAPER_TRADING_ENABLED` operator switch plus the existing kill switch |
| D2 | **One label for nine reasons**: `DUPLICATE_ORDER_BLOCKED` covers idempotency, open trade, active trade, plan already ordered, Journal pending and the acceptance lock | Days of wrong-direction diagnosis | One specific status per reason, e.g. `ACCEPTANCE_LOCK`, `OPEN_TRADE_EXISTS`, `PLAN_ALREADY_ORDERED`, `JOURNAL_ACK_PENDING` |
| D3 | `PAPER_ORDER_REJECTED` is used when Engine 6 has no direction or no executable decision | Looks like a broker rejection when no order existed | `WAITING_FOR_ENGINE6_DIRECTION` / `ENGINE6_NOT_ALLOWED` |
| D4 | **The blocker list isn't logged**: cycle output prints the status label only | Root cause needs Replay access | Print `blockers[]` in step 4 output every cycle |
| D5 | **Fails silently**: correct to refuse when unsure, but no alarm | Months without a trade | Alert when an Engine 6 approval is blocked by Engine 8 (the #412 verification `perApproval` already detects it) |
| D6 | Stranded instruction locks never expire (`withPaperInstructionLock`) | Another permanent silent stop after a crash | Keep fail-closed, but detect stranded locks each cycle, reconcile against the durable order/fill stores, and alert |
| D7 | The same checks run in **three places**: snapshot adapter, auto-executor, execution route | Drift between layers | One shared, pure eligibility function used by all three |
| D8 | **Fixes don't ship**: #402 passed and stayed unmerged | Known fixes don't reach production | One owner per change, and a clear ship/reject decision after review |

## 6. Proposed Engine 8 for Strategy 1 (for review with the ChatGPT Engine 8 manager)

This is **proposed**, not approved; it needs owner approval. It keeps every real safety rule and removes the legacy trial gate.

**One pure function** `decideStrategy1PaperEntry(snapshotLane, durableState, settings)` returns exactly one outcome with one reason code. The snapshot adapter, auto-executor and route all call it.

| Order | Check | Pass condition | Fail reason (one each) |
|---|---|---|---|
| 1 | Safety | PAPER only, no live flags, kill switch off, operator switch on | `LIVE_FLAGS_PRESENT`, `KILL_SWITCH_ON`, `PAPER_TRADING_DISABLED` |
| 2 | Approval | Engine 6 `PAPER_ALLOW` / `FAST_INTRADAY_PAPER_ALLOW`, direction LONG/SHORT, from this cycle's snapshot | `ENGINE6_NOT_ALLOWED`, `ENGINE6_DIRECTION_MISSING`, `APPROVAL_STALE` |
| 3 | Candidate identity | Engine 26 zone candidate present and matching the Engine 9 plan. The zone-to-zone decision itself stays in Engines 26/6; Engine 8 does not re-decide it | `CANDIDATE_IDENTITY_MISMATCH` |
| 4 | Plan + size | Engine 9 plan ready; Engine 7 final size present (3 for Strategy 1, taken from Engine 7, never hard-coded); entry/stop/stop distance match | `PLAN_NOT_READY`, `SIZE_NOT_READY`, `GEOMETRY_MISMATCH` |
| 5 | Position | No open Strategy 1 trade in the Engine 10 Journal; no pending Journal ack | `OPEN_TRADE_EXISTS`, `JOURNAL_ACK_PENDING` |
| 6 | Idempotency | This plan has never been ordered (durable ledger) | `PLAN_ALREADY_ORDERED` |
| 7 | Execute | Place the PAPER order once, under the instruction lock | `ORDER_REJECTED_BY_PAPER_BROKER` (with the broker reason) |

- **Lifecycle (unchanged in principle):** Step 0 runs first every cycle; protective exits follow the frozen Engine 9 stop/targets (REDUCE/EXIT); ambiguous same-bar stop/target stays fail-closed for review.
- **Observability:** every cycle logs the outcome and reason code. An approved-but-blocked trade raises an alert (no new paid service).
- **Tests that must pass:** the three cases in section 3 must produce an order with the fix and the right reason without it; duplicate of the same plan → `PLAN_ALREADY_ORDERED`; open trade → `OPEN_TRADE_EXISTS`; kill switch → blocked; corrupt store → fail closed.

## 7. Open items

**Roles (owner decision, Nov 27):** Claude is the Engine 8 manager (management and programming). ChatGPT Engine 8 does the independent engineering review, at an exact SHA with CI green. Engine 28A owns scheduler and observer safety, Engine 12 independent trade verification, Engine 10B Journal accuracy. The owner authorizes production.

- [x] Owner authorized; PR #402 code merged (`f7d1bc4` via #426) and setting on (Nov 27, section 4)
- [ ] **P0, before the next approval: read-only production preflight.** ChatGPT's #402 release gate required it, and it was **not done before release** (#425 answers 1–4). Run `scripts/engine8/preflight-readonly.sh` in the Render Shell of `frye-market-backend-1`. It prints settings as set/unset only, store file presence/parse/counts, acceptance booleans, ledger status counts and instruction-lock count/age. Report as PASS/FAIL/UNKNOWN on #425, never values. Never reset, unlock or retry anything because of it.
- [ ] **Verify on the next Engine 6 approval** that an order is created (section 4)
- [ ] Preserve original Nov 24–27 evidence and confirm the underlying blocker for Nov 25 11:31 and Nov 27 4:46 from Replay before about Dec 9–10 (preservation script: PR #423). Do not conflate with other windows.
- [ ] First redesign PR = **D2+D3+D4 diagnostics only** (specific reason codes, all blockers logged every cycle, UNKNOWN/not-evaluated distinguished). No trading change; keep status compatibility for Engine 28A/12 consumers; golden before/after tests. ChatGPT agreed (#425 answer 20).
- [ ] Then D1/D5/D6/D7 per ChatGPT's conditions (#425 answer 18): keep historical trial audit and operator disable; never auto-unlock; the pure evaluator plus a fresh authoritative recheck inside the lock; step 7 is effectful and outside the pure function; one primary reason plus all blockers.
- [ ] Close stale PRs after checking nothing unique is lost (#425 answer 9): #388, #401, #398 (Ironbeam retired), #311, #327, #333; compare #309; Engine 7 to confirm #307; Engine 10B to confirm #308. #160/#162/#165 (REAL Schwab) stay on HOLD pending owner/Engine 10.
- [ ] REAL-path audit: the production start command also runs `watchEngine8RealSchwabFills.js` (broker GET-only per source). Confirm no REAL order path is reachable (#425 answer 10).
- [x] Shared file `jobs/autoExecuteCanonicalPaperTrade.js`: Engine 8 owns the trading path, Engine 28 owns only the observer code (#419/#422). Agreed on #425 (answer 22).

## 8. Answered by ChatGPT Engine 8 (#425, Nov 27): key points

- **Unknown, not absent:** current settings, durable store contents, stranded locks, pending Journal acks, and whether production has ever placed a PAPER fill. ChatGPT's Render tools can't read settings or disk. Four post-release cycles exited cleanly; that proves process completion only.
- **Store started empty** for isolation from legacy state (no migration). Whether an old completed-trial record exists is unknown; do not fabricate or migrate one.
- **After the first close**, the second trade needs the continuous flag, and every other guard still applies (operator/kill, identity, corrupt receipt, same plan, open position, pending Journal, duplicate ledger, instruction lock, route guards).
- **PAPER fills are internal** (`executeTradeTicket`, no broker). Futures fill at `futuresEntryPrice`; lifecycle exits fill at the stop or target price; no slippage is applied. Review this before the redesign.
- **Same-bar stop+target** → `AUTO_PAPER_LIFECYCLE_ATTENTION_REQUIRED`, logged but not alerted; reconciled from ordered data, never guessed.
- **Journal ack pending** = durable fill without a confirmed Engine 10 ack. It blocks duplicates. Fix it by reconciling the same fill, never by placing another order.
- **Size** comes from Engine 7 as a positive integer; no hard-coded execution fallback seen in the executor (adapter/route audit still open).
- **Non-negotiable safety (answer 17):** explicit PAPER authorization; no REAL/replay execution; authenticated route; operator/kill; current E6 approval; exact E26/E9/E7 identity/geometry/quantity; no stale snapshot; durable cross-process lock and idempotency; corrupt/unavailable state fails closed; no open-position overlap; unresolved fill/ack blocks duplicates; immutable event IDs; exits never exceed remaining qty or reverse; same-bar ambiguity not guessed; observers never change trading; independent acceptance and owner release. No resets or blind retries.
- **Keep these checks in any refactor (answer 19):** missing vs corrupt receipt, explicit authorization, completed-candidate replay, operator-disable independent of the trial, duplicate key/active plan/open Journal/ack, lock hard-crash semantics, route admin and replay/live gates, frozen geometry, quantity integrity, separate lifecycle event IDs, no order retry after a fill.

## Key files

`logic/trading/engine8CanonicalPaperAdapter.js` (eligibility, 1,149 lines) · `engine8DuplicateState.js` (duplicate + acceptance state, 1,397) · `engine8PaperAcceptanceEligibility.js` (trial lock, 96) · `engine8PaperDurableStore.js` (store + locks) · `engine8PaperExecutor.js` (1,860) · `runEngine8PaperExecution.js` (681) · `runEngine8PaperLifecycleExecution.js` (2,343) · `jobs/autoExecuteCanonicalPaperTrade.js` · `jobs/autoManageCanonicalPaperLifecycle.js`
