# Engine 28 — Master Development Plan v1.0

**Status:** DRAFT for Engine 28 Manager review and owner approval. Not approved until the owner says so in writing (PR approval or `OWNER_DECISIONS` entry).
**Date:** 2026-11-27 · **Drafted by:** Claude · **Owner:** Brian (Frye Dashboard)
**Supersedes:** nothing. **Consolidates:** owner strategic passover (2026-11-27), Engine 28 Manager's 8 changes, Claude's 9 refinements, Manager's 3 additions, final 4 corrections and the Manager's 7 final requirements.
**Evidence base:** [`PHASE0_INVENTORY.md`](./PHASE0_INVENTORY.md).

Changes to this document go through a PR with a line in the Version history at the bottom. No owner decision is ever deleted; superseded decisions are marked superseded.

---

## 1. Purpose

Engine 28 has three missions:

1. **Operational intelligence.** Monitor the automated trading pipeline, find the first blocker, and verify whether trades happened.
2. **Trading research intelligence.** Learn from wins, losses, missed opportunities and **avoided losses**, and turn that into validated recommendations.
3. **Engineering intelligence.** Keep engineering knowledge in the repo so any agent, from any AI provider, can be replaced without the owner retraining it.

Principle: **the Frye Dashboard owns the knowledge; AI providers supply the workers.**

## 2. Authority

| Role | Who | Authority |
|---|---|---|
| Owner | Brian | Strategy, architecture approval, every merge to `main` (= production deploy), every cost, every trading-rule change |
| Engine 28 Manager | ChatGPT (verified direct GitHub access, 2026-11-27) | Assignments, review, coordination, decision queue. One accountable manager for Engine 28 |
| Developers | Codex, Claude, others as assigned | Build on isolated branches; open PRs; never merge |
| Independent reviewer | A different agent from the one that wrote the code | Reviews the exact head SHA; re-reviews after material changes |

- One accountable manager per engine. One owner per file during development.
- Development agents and Engine 28 runtime are separate systems. Development access gives no trading authority.
- Repo-wide rules in `CLAUDE.md` / `AGENTS.md` still apply (no secrets on GitHub, no raw licensed data, no new paid infrastructure without owner OK).

## 3. Non-negotiable rules

These must be recovered 100% in every agent replacement test. They are never part of an allowed knowledge gap.

1. **Verification truth rules.**
   - **YES** = a verified matching durable fill.
   - **NO** = independently proven complete evidence coverage of the interval **and** zero verified fills.
   - **UNKNOWN** = anything missing, incomplete, conflicting, corrupt, unstable or historically unavailable.
   - Coverage is **verified or UNKNOWN. Never "assumed".** Nominal scheduler counts never prove coverage. History cannot be manufactured after the fact.
2. **Observer boundary.** Monitoring never approves, places, cancels, retries or resubmits orders, never clears duplicate protection, never resets acceptance state, and never edits Journal, sizing or config. **If verification fails, trading behavior is unchanged and verification becomes UNKNOWN. An observer failure must never become an execution failure.**
3. **No automatic trading changes.** Engine 28 research never changes production trading rules. Every change goes through the 8 gates (section 8).
4. **Classification.** An upstream trading-rule rejection (e.g. Nov 27: `ENGINE4_PARTICIPATION_NOT_CONFIRMED` → `NO_APPROVAL_OBSERVED / UPSTREAM_BLOCKED`) is never reported as an execution failure. A market closure is never an executable opportunity.
5. **Public repo.** The repo is public. Public reports contain sanitized statuses and aggregate counts only: no account numbers, balances, position sizes, private execution identifiers or credentials. Detailed per-trade evidence lives on a protected read surface.
6. **Separate governance.** PR #402 (Engine 8 eligibility repair) stays a separately governed assignment. Verification never authorizes bypassing a trading safeguard.

## 4. Structure

**Three divisions with failure isolation.** A crash in one must never touch Engine 8 execution or protective order management.

| Division | Runs where | Examples |
|---|---|---|
| Operational | Scheduler cycle (observer only) | Pipeline Doctor, receipts, coverage, daily verification |
| Research | Offline, never in the execution cycle | Replay learning, hypothesis tests, counterfactual lab |
| Engineering | GitHub | Records, assignments, reviews, replacement tests |

**Modules vs. agents.** A *module* is code that runs (e.g. 28A Pipeline Doctor). An *agent* is a worker assigned to a bounded project that then finishes. Agents are created per assignment, not as standing teams. The proposed 28B–28G identifiers are **not** created; existing 28A identifiers are kept.

## 5. Permanent engineering records

Reuse the existing handbook (`CLAUDE.md`, `docs/engines/`, `docs/HANDOFF_LOG.md`). Add only:

| Record | Location | Purpose |
|---|---|---|
| `AGENTS.md` | repo root | Tool-neutral copy of the session rules for non-Claude agents; `CLAUDE.md` and `AGENTS.md` stay in sync |
| Engine file | `docs/engines/ENGINE28.md` | Purpose, modules, architecture, locked decisions |
| State + handoff | `docs/engine28/STATE.md` | One file: current status, open PRs with exact tested SHAs, defects, blockers, next actions |
| Owner decisions | `docs/engine28/OWNER_DECISIONS.md` | Dated, never deleted; superseded entries marked |
| This plan | `docs/engine28/MASTER_PLAN.md` | Strategy and phases |
| Assignments | GitHub issues, label `engine28-assignment` | ID, agent, scope, acceptance criteria, PR, tested SHA, next action |
| Hypotheses | GitHub issues, label `hypothesis` + stage labels | Research registry (section 7) |
| Decision queue | GitHub label `owner-decision` (repo-wide) | The single place the owner looks for items needing authorization. Each item: recommendation, evidence, risks, alternatives, cost of waiting |
| Audits | PR reviews, referenced from `STATE.md` | No separate audit file |

**Enforced, not promised:** a CI check fails any PR that touches Engine 28 code (`logic/engine28a/`, Engine 28 jobs/routes) without updating `docs/engine28/STATE.md`. Records are updated at every significant decision, PR, test result, audit or defect, not at the end of a conversation.

## 6. Operational: Automatic PAPER Trade Verification (#412)

**Goal:** answer from the owner's phone: for each Engine 6 approval, did it reach Engine 8, was an order created, did it fill, did Engine 10 record it, did Engine 12 verify it, and if not, which engine stopped it and why.

**Reports.**
- *Public* (daily comment on #412): sanitized counts only. Slots nominal / with receipts / missing; approvals; orders; fills; Journal acks; approved-but-blocked; overall YES / NO / UNKNOWN; coverage **VERIFIED or UNKNOWN**.
- *Protected* (authenticated read surface, e.g. the existing Trade Investigator auth): **one YES / NO / UNKNOWN per Engine 6 approval**, with the first blocker and evidence references.

**Required fixes before #417/#418 can be accepted** (from the Phase 0 inventory):

| ID | Fix | Why |
|---|---|---|
| F-1 | Step 4 execution must not depend on the Pipeline Doctor's exit code | Observer failure currently blocks execution |
| F-2 | Receipt writing must not delay the executor's exit: hard timeout or out-of-process | Slow storage can push cycles past 3 min and skip protective lifecycle runs |
| F-3 | Replace the 50,000-file cap and full-directory scan with per-day directories (no deletion) | Recording stops in ~4–5 weeks |
| F-4/F-5/F-6 | Make skipped slots visible (UNKNOWN), test restart/concurrent cycles, add per-step timeouts | Coverage truth |
| — | Restack: #418 on top of #417 (or merge shared files into one PR) with one owner per shared file | Both PRs edit the same files with different contents |

Existing trading decisions are not changed by any of these.

**Acceptance for Phase 1A:**
- #417 and #418 pass CI at their exact heads, and an independent reviewer approves those SHAs.
- Replay tests of the Nov 24, Nov 25, Nov 26 and Nov 27 cases produce the classifications recorded in the passover.
- A fault-injection test (observer throws, storage hangs) shows execution timing unchanged and verification = UNKNOWN.
- The owner authorizes the merge.

## 7. Research intelligence

**Four outcome categories, studied together:** winning trades, losing trades, missed profitable opportunities, **avoided losses**. A large move after a block is never proof the rule was wrong.

**Learning frequencies.**

| Frequency | What | Recommends changes? |
|---|---|---|
| Continuous | Operational monitoring | No |
| Daily | Collect and reconcile evidence | No |
| Weekly | Review registered hypotheses and data quality | No |
| Monthly | Validated findings to the owner | Only with sufficient evidence |

Learn every day. Recommend only when evidence supports it.

**Research registry** (GitHub issues): Observation → Hypothesis → Research → Validation → Audit → Owner review → Implementation → Monitoring. Rejected hypotheses are kept. Large datasets live in persistent storage, not GitHub.

**Counterfactual lab controls** (all required):
- Point-in-time evidence only.
- Register the hypothesis and its **success/failure criteria before looking at results**, judged on profitability, drawdown, avoided losses, false signals and risk-adjusted return together.
- Compare against the approved baseline.
- Limit and record the number of variants tested, and correct for multiple tests.
- Keep untouched holdout data.
- Use realistic commissions and slippage.
- Test across market regimes.
- Report confidence intervals.
- Get an independent audit before any recommendation.
- Engine 12 Replay coverage must be verified before the lab is built on it.

**Engine boundaries.** Engine 28 consumes Engines 3, 4, 6–12, 22, 25–27 and 29; it does not duplicate them. Engine 22 stays the Elliott Wave authority, Engine 12 the Replay authority, Engine 10 the Journal authority.

## 8. Trading-change gates

1. Research
2. Statistical validation
3. Backtest vs. baseline
4. Out-of-sample / walk-forward
5. Independent audit
6. Owner authorization
7. Controlled implementation (shadow / PAPER first)
8. Post-implementation monitoring with rollback

No agent may skip a gate.

## 9. Agent replacement experiments

| Criterion | 1st test | 2nd test | Mature |
|---|---|---|---|
| Required knowledge recovered | ≥ 90% | ≥ 95% | 100% |
| Critical safety rules + owner decisions recovered | 100% | 100% | 100% |
| Owner clarifications | ≤ 1 | 0 | 0 |
| Authorized assignment resumed | Required | Required | Required |
| Unauthorized production changes | 0 | 0 | 0 |

- **Test 1:** a new session from the same provider takes over an Engine 28 assignment using only the records.
- **Test 2 (cross-provider):** a fresh Claude agent takes over work managed by ChatGPT or developed by Codex, using only the records.
- **Scoring:** the independent reviewer writes the checklist from the verified state *before* the test.

## 10. Phases

**Committed (Phases 0–2):**

| Phase | Work | Done when |
|---|---|---|
| 0 | Inventory; minimum records (this plan, `STATE.md`, `OWNER_DECISIONS.md`, `ENGINE28.md`, `AGENTS.md`); **archive Replay evidence for the Nov 24–27 cases before retention removes it** | Inventory reviewed by Manager; records merged with owner OK |
| 1A | #412 verification with Engines 8 and 12, including fixes F-1…F-6 and the daily #412 report | Acceptance in section 6 |
| 1B (parallel) | Agent pilot foundation: assignment template, labels, STATE.md CI check, review procedure | One assignment completed end-to-end through the workflow |
| 2 | Replacement tests 1 and 2 | Targets in section 9 met |

**Direction only (not committed; re-planned after Phase 2):** 3 trading-intelligence storage · 4 daily learning cycle · 5 counterfactual lab · 6 Command Center · 7 independent acceptance audit · 8 expansion to other engines (separate owner authorization).

## 11. Baselines to measure now

Count these before Phase 1B starts, so improvement can be shown:

- Owner message relays per week.
- Owner retraining instances per agent replacement.
- Owner reminders to agents to "continue" or "document".
- Time to answer "did trade X happen?"

## 12. Owner decisions required

| ID | Decision | Recommendation |
|---|---|---|
| D-1 | Roles: `CLAUDE.md` says Claude is lead engineer and Engine 18D (GPT) is auditor; this plan makes ChatGPT the Engine 28 Manager | Keep both, written as: Claude = repo-wide lead engineer, ChatGPT = Engine 28 Manager. Record in `CLAUDE.md` / `AGENTS.md` |
| D-2 | Approve fixes F-1…F-3 as required before #417/#418 merge | Approve |
| D-3 | The auto-entry bridge and lifecycle monitor carry the 28A name but invoke execution | Keep the code as-is; document them as "scheduler execution components hosted under 28A, not monitoring". Consider renaming later, after Phase 2 |
| D-4 | Archive Replay evidence for the acceptance cases (and keep it beyond 14 days) | Approve: copy, no deletion, on the existing disk, no new cost |
| D-5 | Create labels `owner-decision`, `engine28-assignment`, `hypothesis` | Approve |
| D-6 | Approve this plan v1.0 | — |

## 13. Next actions

1. Engine 28 Manager reviews this plan and the inventory.
2. Owner decides D-1…D-6.
3. First development assignment (recommended): **28A-001, Observer non-interference.** Fixes F-1, F-2 and F-3 on a branch coordinated with the #417 owner, with fault-injection tests. Scope: no trading-decision changes.

---

## Version history

| Version | Date | Change | By |
|---|---|---|---|
| 1.0-draft | 2026-11-27 | Initial consolidation | Claude |
