# #412 — Forward coverage plan (Engine 28A, 28-002)

**Status:** proposal for Engine 8 / Engine 12 / Engine 28 Manager review. Nothing here enables anything.
**Rule:** a day is COMPLETE only when every expected slot is independently shown to have run with intact evidence. Anything else is UNKNOWN. Coverage before receipts were enabled is UNKNOWN permanently; it cannot be rebuilt.

## 1. What each source can and cannot prove

| Source | Proves | Cannot prove | Verified 2026-11-27 |
|---|---|---|---|
| Render cron config `frye-market-backend` (`*/3 * * * *`, UTC) | The **current** expected schedule | Past schedule, pauses, edits | Yes (Render API) |
| Render deploys / service events | Restarts and deploys that can interrupt or drop a cycle | That a cycle ran | Deploy list readable |
| Backend logs `REQUEST START`, `LOCK RELEASED`, `SLOT SKIPPED ALREADY_RUNNING` (new) | That a request reached the handler, and how it ended | Anything older than Render log retention (about 30 days) | Yes; 48–55 s cycles, every slot in the sampled hour |
| `SCHEDULER_START` / `SCHEDULER_END` receipts (E8) | Private durable record of each run | Slots the handler never saw (cron failed to fire, service down) | Code only (flags off) |
| `ENTRY` / `LIFECYCLE` receipts (E8) | What the executor and lifecycle reported | Fills (only durable fill evidence proves YES) | Code only |
| Engine 12 Replay `HHMM.json` | Immutable decision snapshot per cycle | Execution | Yes; 14-day retention policy |

No single source is enough. A slot counts as covered only when **two independent sources agree**.

## 2. Per-slot rule (proposed for E8 coverage / E12 consumer)

A slot that **ran** is not the same as a slot whose **evidence is complete**, and neither one proves that no fill happened (E8 review 7226064410). A slot can only count toward NO when all of these hold:

1. **Dispatch identity:** the scheduler run id in the START/END receipts matches the backend log line for that slot, and the entry and lifecycle receipts carry the same run id.
2. **Configuration:** the expected schedule (cron config) and execution flags are evidenced as unchanged for the slot, not just read today.
3. **Original approvals:** every Engine 6 approval in the slot's original Replay snapshot has its own entry receipt.
4. **Action counts:** the receipt action counts match what the executor and lifecycle reported (no missing ENTRY or LIFECYCLE action receipts).
5. **Retention and integrity:** the receipt store and the Engine 8/10 stores were readable and stable for the interval, with no gap events (`ENGINE28A_OBSERVER_EVIDENCE_GAP`) carrying that run id.
6. **Per-approval match:** Engine 12 independently matches each approval to a durable fill or to a recorded blocker.

| Evidence found | Slot status |
|---|---|
| All six hold | COVERED |
| Authoritative skip evidence (a skip receipt once E8 adds `SCHEDULER_SKIPPED`; a log line alone is supporting only) | SKIPPED: no new scheduler entry decision. It does **not** imply that no other execution path ran |
| Overlaps a deploy/restart window, any of 1–6 missing, any gap event for the run id | UNKNOWN |

Day verdict stays **INCOMPLETE / UNKNOWN** unless every slot is COVERED or SKIPPED with authoritative evidence and the per-approval matching is complete. Today's producer correctly never emits COMPLETE, and this plan does not change that.

## 3. What is needed to automate it

| Need | Option | Blocker / decision |
|---|---|---|
| Expected schedule history | Record a daily fingerprint of the cron config (schedule, suspended flag, last update time) | Needs read access to the Render API from the service, which is a **new secret**: owner decision |
| Deploy/restart windows | Same Render read, or log the process start time and instance id at boot (no secret) | Boot log line: E28A can add it (log only) |
| Skipped slots in receipts | Add `SCHEDULER_SKIPPED` to the receipt `cycleKind` enum | Schema is **E8-owned**; proposed, not edited |
| Receipt store lasting past ~4–5 weeks | Per-day folders, no full-directory scan, no deletion | Reader is **E8-owned**; proposed (F-3) |
| Replay kept long enough to cross-check | Archive or extend retention for evidence days | **Owner decision** (D-4); no deletion or config change by E28A |

Until those land, the daily report must show coverage as UNKNOWN with the specific missing source named.

## 4. What 28-002 already delivers (branch `engine28a/issue412-scheduler-safety`)

- Entry receipt write bounded by a hard timeout (default 2 s, `ENGINE28A_OBSERVER_TIMEOUT_MS`, clamped 0.1–5 s). The order request is sent before the observer runs; the timeout only bounds how long the executor process waits before exiting. The executor's output, exit code and timing are unchanged under slow, hung or failing storage. Each gap is logged as `ENGINE28A_OBSERVER_EVIDENCE_GAP` / UNKNOWN.
- Scheduler fire-and-forget writes capped (default 8, max 32 in flight, `ENGINE28A_OBSERVER_MAX_IN_FLIGHT`). Drops, failures and observers that report UNKNOWN are logged with the scheduler run id, never queued.
- `ALREADY_RUNNING` slots now leave a log line. The response is unchanged.
- Integration tests through the real executor job: hang, slow, throw, healthy and concurrent runs.
- Integrated acceptance (`engine28aSchedulerIntegration.test.js`): authorized READY snapshot + local mock PAPER endpoint; completed, rejected and request-failure paths identical to baseline, one order request each, measured latency bounds; full scheduler cycles with hung storage in every process (Step 0 lifecycle on time each cycle, concurrent skip visible, drops logged with run id); restart mid-cycle.

## 5. Not changed (needs owner decision or more evidence)

- **Bounded, not zero:** with hung storage, the executor exits up to one observer timeout later (default 2 s) after the order outcome. The tests show cycles finish within baseline + timeout + 1.5 s, and the next cycle's Step 0 still starts on time. Production headroom is about 2 minutes per cycle.
- **Not proven:** contention on shared libuv/disk resources between a hung receipt disk and other trading I/O. A real slow-disk soak on an isolated service would be needed.

- Step 4 PAPER execution is gated on the Pipeline Doctor and Replay archive exit codes.
- The scheduler lock is in memory, so a restart mid-cycle can allow overlap. A durable lock would change scheduler behavior.
- There is no per-step timeout on trading steps.
