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

For each nominal slot in the Arizona day (480 at `*/3`):

| Evidence found | Slot status |
|---|---|
| START + END receipts, receipt set intact, and a matching backend log line or Replay snapshot | COVERED |
| Log line says `SLOT SKIPPED ALREADY_RUNNING`, previous run covered | SKIPPED_KNOWN (no new entry decision; still not COVERED) |
| Slot overlaps a deploy or restart window | UNKNOWN |
| Any source missing, conflicting or unreadable | UNKNOWN |

Day verdict: **COMPLETE** only if every slot is COVERED or SKIPPED_KNOWN, the expected schedule was unchanged all day, and the receipt store passed integrity checks. Otherwise **INCOMPLETE** (matches the current producer, which never emits COMPLETE).

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

- Entry receipt write bounded by a hard timeout (default 2 s, `ENGINE28A_OBSERVER_TIMEOUT_MS`, clamped 0.1–10 s). The executor's output, exit code and timing are unchanged under slow, hung or failing storage. Each gap is logged as `ENGINE28A_OBSERVER_EVIDENCE_GAP` / UNKNOWN.
- Scheduler fire-and-forget writes capped (default 8 in flight, `ENGINE28A_OBSERVER_MAX_IN_FLIGHT`). Drops are logged, never queued.
- `ALREADY_RUNNING` slots now leave a log line. The response is unchanged.
- Integration tests through the real executor job: hang, slow, throw, healthy and concurrent runs.

## 5. Not changed (needs owner decision)

- Step 4 PAPER execution is gated on the Pipeline Doctor and Replay archive exit codes.
- The scheduler lock is in memory, so a restart mid-cycle can allow overlap. A durable lock would change scheduler behavior.
- There is no per-step timeout on trading steps.
