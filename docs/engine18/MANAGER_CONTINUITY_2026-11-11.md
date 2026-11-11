> **LATEST STATUS — NOV 11 2026: PHASE 5 MERGED, LIVE STILL OFF.** Claude independently APPROVED SYNTHETIC-ONLY PR #298 after verifying UTC/Arizona 86/86, old crash/clock/ordering fixes and AWS SigV4 reference signing. Manager verified exact PR head `93162b44c7e8f470db85ab6d7cd9b1ef1d02d13f`, posted approval (PR comment 6800647437), and merged into isolated Engine18 foundation with SHA **`5eb27720cacc2c02e2d6ec82f5d955fc02dc9026`**. **No production deploy, no paid provisioning, no live Ironbeam recording.** Current actionable pre-live correction work is tracked in **[Issue #300](https://github.com/bfrye1973/frye-market-backend/issues/300)**: scheduler→S3, rename/manifest race, canonical SigV4 query+MinIO CI, private R2 retention/access/restore, failed GCM-temp cleanup, trusted clock anchors, disk/burst queue sizing, actual subscription and run metadata. Owner budget ~$22/month remains CONDITIONAL. This note supersedes prior Phase5 pending-review statements below. Read first on restart.

> **LATEST STATUS UPDATE — Nov 11, 2026:** Gate1 Phase5 draft PR #298 exists at head `93162b44c7e8f470db85ab6d7cd9b1ef1d02d13f`. Exact-head CI: **86/86 PASS in UTC and America/Phoenix**, all five relevant workflows success. Manager independently inspected new concurrent sealed-hour backup, worker/IPC, receipt clock, S3-compatible encrypted mock storage and restored replay. **PR #298 is DRAFT and UNMERGED; manager review is preliminary and HOLD pending Claude's independent code review.** Detailed manager review on https://github.com/bfrye1973/frye-market-backend/pull/298#issuecomment-6798661910. No paid resources, production deployment or real market-data recording authorized. This update supersedes the earlier statement that no Phase5 PR existed. Read this note first on restart.

# Engine 18 — MANAGER CONTINUITY LOCK (2026-11-11 Arizona)

**Authoritative latest manager handoff if this ChatGPT conversation closes or a new manager/teammate takes over.** Read this document FIRST alongside `docs/engine18/START_HERE.md`, `LOCKED_RESEARCH_PRINCIPLES.md`, `GATE1_SPEC_AND_ACCEPTANCE.md`, and `RECORDER_ARCHITECTURE_DECISIONS.md`. Source-of-truth is GitHub/Render, not assumptions about remembered conversation. Updated after owner explicitly requested a permanent lock.

## Owner goal and immutable constraints

Build a rigorous **ES Liquidity Prediction Engine** which estimates: (1) chance ES price reaches a price-anchored liquidity area, (2) conditional probability of holding/rejecting after touch, and (3) reaction distance. No predictive percentages without valid chronological out-of-sample calibration. Discover liquidity **from genuine exchange order-book evidence**; never invent resting orders at price chart zones, Fib levels, candles, or strategy cards. Distinguish true L2 depth visibility from MBO individual orders; OUT_OF_COVERAGE does not imply canceled. Preserve original raw market messages and provenance exactly, deterministic replay, explicit GAP/uncertainty.

Chart/trading separation: no production trading changes, no replacement chart, no Engine11/Engine22 edits. Existing Engine2 LIVE chart later displays at most **two green BUY and two red SELL liquidity zones** only after Gate2+ shadow validation. Chart/strategy context must not influence raw recorder truth.

**Institutional + Elliott Wave requirement:** Owner says institutional ES levels capture important market action and wants current Engine22 **Micro** and **Submicro** strategy-card wave/Fibonacci targets included as read-only contextual research features to help assess where price may move. Existing ES institutional route `/api/v1/es-smz-levels?symbol=ES`; Engine22 Strategies from `/api/v1/dashboard-snapshot?symbol=ES` -> `strategies["intraday_scalp@10m"].engine22WaveStrategy.currentWavelength.degrees.{micro,submicro}` plus `.workingWaveNodes`. Full source contract: `docs/engine18/INSTITUTIONAL_MICRO_SUBMICRO_CONTEXT.md`. Do NOT recalculate Fibonacci or promote hypothetical wave counts; align approved source revisions, physical ES contract basis and as-of availability to avoid lookahead. Integrate after raw-data acceptance and later context ablations, not as exchange-liquidity source.

## Completed and verified PR lineage — isolated foundation branch

Backend repo: `bfrye1973/frye-market-backend`. Isolated target branch `engine18-liquidity-intelligence-foundation-20261109`. **None of the below merges into this branch means deployment to production.**

- PR #291: initial synthetic raw recorder, merged into isolated foundation.
- PR #292: Gate1 Phase2 synthetic frame adapter + bounded fsync/group-commit and lifecycle, Claude-reviewed and merged; merge SHA `b39b76f10d13b89a2a14da289ee408d8b284da06`.
- PR #293: Gate1 Phase3 synthetic readiness, per-socket IDs, distinct source/recorder gaps, subscriptions, run metadata, binary formats, clock quality, bounded replay; merged into isolated foundation; SHA `b4c06bddcc76a2be8d9f81fc3453f7b9478e0414`.
- **PR #295: Gate1 Phase4 synthetic reliability**: bounded crash recovery, separate child IPC, mock AES-GCM encrypted backup/restore, archive SHA256/inventory, fail-closed deployment guard. Claude independently found 3 defects (R1 rename-before-manifest; R2 lexical part-10 ordering; R3 Chrony UTC parsed as local). Engine18B corrected all at head `89020d2a645714588cb97e1f4e30d2bef655b5c8`. Manager inspected fixes and regression tests. **74/74 pass in both TZ=UTC and TZ=America/Phoenix** in GitHub Actions run `42961490573`; exact-head baseline, original Gate1, Phase2, Phase3 workflows also passed. Manager approved and **merged PR #295** into isolated foundation with merge SHA **`c5f9ea68906ad1be54633be3e8024f21147d88a3`**. No more changes to PR #295 needed.
- Issue #294 contains Phase4 assignment and conditional budget history; may remain open for operational follow-up.
- GitHub PR links: https://github.com/bfrye1973/frye-market-backend/pull/291 , /pull/292 , /pull/293 , /pull/295 ; Issue https://github.com/bfrye1973/frye-market-backend/issues/294 .

## Actual external infrastructure, verified

Render workspace `tea-d2d7147diees73fu8sog`:
- Main LIVE backend `frye-market-backend-1`, service `srv-d2ds5nodl3ps73b7i2og`. Existing **100 GB** persistent disk `dsk-d6a9f9fgi27c73affbdg`, exclusively attached and mounted `/var/data/replay`. **Do not modify, resize, share, remove, or write Engine18 data there**; already serves other engines/replay. Actual free space not established.
- Separate Engine18 research *web monitor* `frye-engine18-liquidity-research`, service `srv-dbpijnon74is73e2sprg`, starter, isolated foundation branch, **autoDeploy OFF**, no dedicated disk. Existing demo Ironbeam Level2 monitor is NOT a durable collector; don't mistake monitor connection for recording.
- Owner affirms **Ironbeam permits recording** for this internal project. Don't repeatedly ask owner for approval to develop. Material technical storage/retention/credential configuration still merits operational review.
- Owner **conditionally approved estimated incremental ~$22/month** total for a **new separate private Render worker (~$7/month), new 50 GB disk (~$12.50/month), private R2/S3 backup (~$2.10/month illustrative for 150 GB-month)**. Estimate ~$21.60, only ~$0.40 nominal headroom. **Finish technical checks and verify actual pricing/overages BEFORE provisioning**; this is NOT authority to buy/create infrastructure immediately nor to switch on real capture. If projected charges exceed envelope, obtain revised approval. No new worker/disk/object store purchased as of this document.
- Do not wire, deploy, merge to production, or change existing LIVE chart, Engine11/22, broker/trading.

## Current next assignment: Gate 1 Phase 5 — Operational Recorder Readiness

Manager already issued the full written Phase5 handoff to Engine18B in chat. **Engine18B should begin implementation now**, using a **new isolated Phase5 branch and draft PR**; no need to ask owner for repeated development authorization. **No Phase5 implementation/PR verified as complete as of this handoff**; query GitHub for newest state. Extend existing approved recorder—NO rewrite.

A. **Continuous backup while current-hour `.jsonl.open` remains active.** Upload only closed `.gz` archives + SHA256 manifests; immutable once remotely acknowledged; retries idempotent even after partial upload; actual cloud-compatible transport staged/tested without buying provider; independent sealed-hour inventory and restore parity; private backup lag/failure health. Backup errors must NOT block market-data reader, and cannot silently hide missing capture. Keep archival and active open segment separate.

B. **Parent/child IPC survival and throughput.** Child detects parent disconnect, fails closed, exits; next restart records recorder GAP and uncertainty. `child.send() === false` means IPC queue buffered, NOT automatic data loss. Implement bounded measured queue/backpressure and explicit loss/ACK semantics, preserving source callback isolation. Test orphan parent, worker SIGKILL, disk stall, queue overflow, partial writes and cash-open synthetic bursts. Distinguish durable saved frame from parent ACK lost after commit.

C. **High-quality receive timestamps and clock credibility.** Parent stamps `process.hrtime.bigint()` and sub-ms wall estimate with recorded source/precision; avoid Date.now()-only millisecond claim. Host Chrony/PTP/NTP measurements must actually exist or status UNVERIFIED; source vendor time remains separate. Preserve run metadata, per-socket generation, subscription evidence and session calendar uncertainty.

D. **Real private backup design and operational check:** S3/R2-compatible adapter and private least-privilege key handling, encryption/key ID+version, independent immutable/versioned inventory, recoverability/retention, restore drill (mock until accepted). No raw public endpoint, credentials, or bearer URL in health/logs.

E. **Measured performance:** extended 20k+ synthetic stream / burst / day-scale model, p95/p99 reader callback costs, worker throughput, CPU/RSS, 50 GB disk fill vs compressed GB/day, failover and data-integrity proof. Note simulated tests do NOT prove actual ES cash-open performance or real backup durability.

F. **Claude feed-semantics review:** Ironbeam v2 demo authenticated feed for `XCME:ES.Z26` / ESZ6, observed 10 nonzero bid + 10 ask levels in sampled 93 accepted depth frames, but NOT proof of full snapshots, zero deletion, `l`, `is`, `ioc`, vendor `t`, heartbeat `p`, conflation, timestamp or vendor sequence. Raw exact string/binary is truth; do not claim MBO from L2. Controlled trial and multiple actual ETH/RTH sessions only after operational authorization.

G. **Phase5 PR delivery:** test suite and CI under UTC + America/Phoenix, exact final commit and CI links, failure matrix, private backup mock/real readiness boundaries, deploy proposal with rollback, remaining blockers and safe launch checklist. Manager and Claude independently review. **Do not self-merge or provision/deploy any paid service until acceptance.**

## End state vs NOT DONE

**DONE:** synthetic recorder foundation, Phase4 review and merge, tests UTC/Phoenix, approximate architecture & conditional budget, source maps for future institutional/Micro/Submicro research.

**NOT DONE:** independent live-worker+real private backup service, actual secure storage provisioning, active Ironbeam raw capture, feed semantics acceptance, trusted live clock, proven open-market throughput, 5-session coverage, historical MBO, book reconstruction validation, calibrated reach/hold/reaction probabilities, context ablation, or chart Engine18 deployment.

## Current expectation and communication

Owner asked whether Phase5 will take another day. Manager estimated **about one day for development and synthetic testing if no major problems**, with Claude audit/corrections and secure operational activation possibly requiring more. This is an estimate, **not a guaranteed finish date** or ongoing background work. No autonomous background work promised.

Manager role: verify GitHub and Render directly through connected apps; don't ask owner to copy logs or transfer code when direct access exists; post actionable blocking reviews in PR; keep chart clean and existing services safe.

### New manager restart procedure
1. Open this doc and `docs/engine18/START_HERE.md` plus locked principles/spec.
2. Inspect latest GitHub Phase5 PR(s) and Render service state *fresh*, don't assume a branch was created.
3. Confirm Phase4 PR #295 is already merged into isolated foundation (never repeat its audit).
4. Audit Phase5 on independent evidence; separate synthetic approval from operational live/provisioning authorization.
5. Eventually connect read-only institutional and Engine22 Micro/Submicro Strategy data for later research; no current chart work in Gate1.
