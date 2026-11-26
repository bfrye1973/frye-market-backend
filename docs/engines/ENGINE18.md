# Engine 18 — Liquidity Intelligence

**Owner direction (locked Nov 25, 2026):** Engine 18 is an independent, confirmation-only engine. It never says buy or sell.
- **Warning:** no defense at a zone (resting buyers/sellers pulled) → stay out.
- **Confirmation:** resting orders absorbing / being bought quickly → price action seen one layer deeper.
- Later, all engines combine into one final answer; each stays independent.

Project docs (claude.ai Project): `claude/ENGINE18_LIQUIDITY_ENGINE_MASTER_PLAN.md`, `claude/ENGINE18_LIQUIDITY_MAP_STATUS.md`, `claude/ENGINE18_CASE_STUDY_001_NOV25_ES7000.md`, `claude/STRATEGY1_OWNER_TRADING_RULES.md` §6. Older Gate 1 / Ironbeam research docs: `docs/engine18/` (Nov 10–11; Ironbeam MBP-10 era).

## Architecture
```
Rithmic Paper (read-only WSS, R|Protocol)
 ├─ Step A: BBO + LastTrade probe ............ PR #399 (merged)
 ├─ Step B: full-depth DBO order book ........ PR #400 (OPEN — awaiting Engine 18D re-audit)
 └─ HISTORY_PLANT time-bar replay ............ PR #403 (merged)
      → minute bars {o,h,l,c,v,sellAtBid,buyAtAsk}
      → Flow reader (absorption / no defense / ceiling-floor / quiet zone) ... PR #405, #406 (merged)
      → Level-event detector (sweep / breakdown) .. PR #404 (open; code included via #408)
      → Liquidity Map registry (fixed-price lines) . PR #407, #408, #409 (merged)
Frontend: Volume Profile overlay ............... Frye-Dashboard PR #240 (OPEN, off by default; awaiting owner preview)
```
All merges above are into **`engine18b-rithmic-render-test-probe-20261117`**, not `main`.

## Files (`services/core/logic/engine18/` on the probe branch)
| File | Purpose | Main exports |
|---|---|---|
| `engine18RithmicPaperProbe.js` | Paper gateway discovery, login, BBO/trade Step A | `verifyPaperEnvironment`, `discoverPaperGateway`, `encodePaperLogin`, `parsePaperLogin`, `encodeMarketDataRequest`, `createStepASummary`, `evaluateStepA`, `runPaperStepA`, `SEND_ALLOWLIST` |
| `engine18RithmicPaperHistoryReplay.js` | History replay (SECOND/MINUTE bars), Case 001 analysis, map checkpoints | `verifyHistoryEnvironment`, `encodeSecondBarReplay`, `parseTimeBar`, `minuteTable`, `analyzeLevelEvent`, `runPaperHistoryReplay`, `replayLiquidityMap` |
| `engine18FlowReader.js` | Per-minute price-vs-aggressor reads | `createFlowReader`, `FLOW_DEFAULTS` |
| `engine18LevelEventDetector.js` | Armed level → APPROACHING → PENETRATED → RECLAIMED / ACCEPTED_BEYOND | `createLevelEventDetector`, `roundNumberLevels`, `DEFAULT_PARAMS` |
| `engine18LiquidityMap.js` | Level registry + producers | `createLiquidityMap`, `referenceCandidates`, `profileCandidates`, `provenCandidates`, `sweepCandidates`, `parseOwnerZones`, `ownerZoneCandidates`, `zonesContaining`, `MAP_DEFAULTS` |
| `engine18VolumeProfileCore.js` | Copy of Frye-Dashboard volumeProfileCore | `computeVolumeProfile`, `selectProfileBars`, `nearestNodeBelow/Above`, `detectShelfBreak` |
| `engine18RithmicRenderTestServer.js` | Render entrypoint; one mode per process | — |
| `engine18RithmicDboBook.js`, `engine18RithmicPaperDboProbe.js` | **PR #400 branch only** (`engine18d-rithmic-dbo-step-b-20261125`): DBO book (STRICT/OBSERVE), Step B probe | `createDboBook`, `evaluateStepB`, `runPaperDboStepB` |

Tests: `services/core/tests/engine18{RithmicPaperProbe,RithmicPaperHistoryReplay,FlowReader,LevelEventDetector,LiquidityMap}.test.js` (CI workflow `.github/workflows/engine18-rithmic-paper-step-a.yml`). 54 pass on the probe branch as of Nov 26.

## Render service
- `frye-engine18-rithmic-test-probe` — **srv-dbue1kgjo6nc739qfkq0**, tracks the probe branch. autoDeploy **off**; changing an env var triggers a deploy of the branch head.
- Mode per process: CONNECT=YES + HISTORY=YES → history replay; CONNECT=YES + DBO=YES → Step B (PR #400 branch only); CONNECT=YES alone → Step A.

### Run a history replay safely
1. Owner OK; R Trader Pro closed.
2. Set env: `RITHMIC_PAPER_HISTORY_START` / `_END` (Unix seconds, UTC), `RITHMIC_PAPER_HISTORY_BAR=MINUTE` (or SECOND; span ≤ 9,900 bars), optional `RITHMIC_PAPER_HISTORY_LEVEL` (tick price), then `RITHMIC_PAPER_HISTORY_ENABLED=YES` and `RITHMIC_PAPER_CONNECT_ENABLED=YES`.
3. Wait ~2–3 min; read logs `RITHMIC_PAPER_HISTORY_MAP`, `_SWEEPS`, `_FLOWREADS`, `_RESULT`, `_MINUTES`.
4. **Immediately set both flags back to `NO`.**
Example: Nov 25 06:30–14:00 MST = `1795613400`–`1795640400`.

## Liquidity Map rules (locked; master plan §6d)
- Fixed anchor price + persistent ID; later evidence within 2 pts attaches, never moves it.
- Drawn only with **≥ 2 distinct current source types**: BOOK, PROFILE, REFERENCE, PROVEN, OWNER_ZONE.
- Nothing within **8 pts** of price. **Max 2 BUY + 2 SELL**; zero is valid.
- Stale sources stop counting (BOOK 60 s, PROFILE 300 s / refreshed each checkpoint; others whole session).
- **Sweep and reclaim = PROVEN** (state SWEPT_AND_HELD). **Broken (accepted beyond) = `markBroken`**: never strengthens; earlier proof stops counting.
- **Side-aware proof:** support proof counts only while price is above; resistance proof only while below. Otherwise state **FLIPPED** + `flippedFrom`; must be re-proven.
- Ties: swept-and-held outranks. Owner zone **edges** are OWNER_ZONE evidence; containing zone is context only.
- Air pockets = volume-profile thin runs between price and a line.
- Why: old MBP-10 lines saw only ±2.5 pts and "followed price". Must never return.

## Case Study 001 — Nov 25, 2026, ESZ6 7,000
Broke 7,000 at 07:43:12 MST, low 6,982.50 at 07:45:10, held reclaim 07:46:24; higher lows 6,996.5 / 7,001.5 / 7,004.5; run 09:53 → 7,159 at 10:55. Delta +1,441 during penetration, −769 during reclaim (resting orders drove price). Flow reader: NO_DEFENSE 07:31–07:43; quiet accumulation 09:06–09:11 and 09:27–09:59. Map replay (Nov 26 fixes): BUY 7,000 held all day; SELL 7,200 / 7,211 inside owner zones 7165–7264 / NEG 7190.25–7234.75.

## Locked owner decisions
- Confirmation only; warning + confirmation.
- Recording **approved** (Nov 25) — starts only after PR #400 passes acceptance.
- Detect "act three" quiet absorption live; real-time Engine 18 panel (separate panel, no LIVE chart change).
- Liquidity Map design + build order (§6d) and the rules above.

## Build order / status
1. Volume profile overlay — Frye-Dashboard PR #240, awaiting owner preview.
2. Level registry — done (#407).
3. Sweep events + owner zones + side-aware proof — done (#408, #409).
4. **Next: live worker + real-time panel v1** (Rithmic trades/BBO → 1-min bars → detectors → read-only endpoint → panel with level cards). Offline tests first; live trial needs owner OK.
5. Big resting orders — after PR #400 acceptance.
6. Learning loop (+10/+30/+60 outcomes) — after recording starts.
Also pending: Engine 18D re-audit of #400 → live Step A (NYC Area, 120 s) and Step B (180 s).

## Open owner items
- **Rithmic Paper login expires Mon Nov 30, 2026, 3:29:59 pm** — extend (support email drafted).
- Contract roll ESZ6 → ESH7 around Dec 18.
- Second market-data session; Rithmic data-retention terms.
- Research range ±75 pts; break margin / stop distance for labels.
- Databento one-day Nov 25 MBO decision.

## Recording & history storage (Gate 1 recorder) — built Nov 10–17, Ironbeam era

**Purpose:** capture the raw order-book feed exactly as received, store it durably and privately, and replay it byte-for-byte later. This is the base for the learning loop. Capture comes before interpretation.

**What was built** (all on the isolated Engine 18 branches, **not main**):
- **Raw recorder** (`gate1RawRecorder.js`):
  - Append-only gzip JSONL. Schema `engine18.raw.v2` stores the exact received bytes (`raw`, utf8 or base64).
  - Envelope fields: `localSeq` (global order), `runId`, `receivedWallNs`/`receivedMonoNs`/`writtenMonoNs`, stream generation, message class and status.
  - RECORDER_START/STOP events, and a GAP event after an unclean stop. It never fabricates data.
- **Hourly files:** rotated by provider/contract/CME trade date/UTC hour. Each closed hour gets a SHA-256 manifest (counts, sequence range, times).
- **Crash safety:** crash recovery, a durable high-watermark checkpoint, and a writer lock.
- **Buffered, isolated ingest:** `engine18BufferedRecorder.js`, an IPC worker bridge, bounded queues and backpressure. The feed is never blocked by disk writes. Bounded recovery and exact replay.
- **Backup:** `engine18S3PrivateStore.js`, an S3-compatible client for a private R2 bucket.
  - AES-256-GCM encryption with a versioned key ID.
  - Immutable conditional PUTs and no-delete keys.
  - Hash-linked encrypted inventory with an externally pinned high-watermark (`engine18Phase5S3Coordinator.js`).
  - Continuous closed-hour backup (`engine18ContinuousBackup.js`).
- **Clocks:** receipt clock (`engine18ReceiptClock.js`). A ≤5 ms verified clock gate (Chrony) is required for any timing claims; otherwise clocks are labeled UNVERIFIED.
- **Live source + gates:**
  - `engine18IronbeamLiveRecorderSource.js` and `ironbeamV2RecorderAdapter.js`: read-only Ironbeam v2 quotes/depths/trades.
  - `engine18ControlledLiveWorker.js`, plus the fail-closed readiness checks `engine18ControlledTrialReadiness.js` and `engine18ControlledTrialVerifier.js` (restore + replay SHA equality).
- **Raw-only diagnostic** (`engine18RawOnlyDiagnosticWorker.js` / `...Entrypoint.js`): a manual, 1–5 minute, ESZ6-only first trial with explicit approval flags. Variable names are in `docs/engine18b/RAW_ONLY_DIAGNOSTIC_ACTIVATION_CHECKLIST_2026-11-16.md`.
- **Daily session readiness** (`engine18DailyRawSessionReadiness.js`): contract/roll, CME calendar, disk ≥ max(25%, 10 GB) free, queue and backup gates. Recording stays OFF.
- **HAND-zone history** (`engine18HandZoneR2History.js`): encrypted, immutable owner-zone history stored in the same private R2 bucket under its own prefix. No market frames are stored there.

**PRs (all merged into the isolated foundation/standby branches, not main):**

| PR | What it added |
|---|---|
| #291 | Synthetic recorder |
| #292 | Phase 2 |
| #293 | Phase 3 |
| #295 | Phase 4 bounded recovery + mock encrypted backup |
| #298 | Phase 5 S3/IPC/clocks |
| #301 | Issue #300 final acceptance (SigV4/MinIO) |
| #302 | Inventory cache, synthetic rehearsal |
| #303 | Controlled live Ironbeam source + worker |
| #320 | Raw-only diagnostic |
| #326 | Real vs synthetic R2 inventory isolation |
| #332 | HAND-zone watcher + R2 history |
| #334 | Daily raw-session readiness |

Docs: `docs/engine18/RECORDER_ARCHITECTURE_DECISIONS.md`, `GATE1_SPEC_AND_ACCEPTANCE.md`, `DAILY_RAW_ES_RECORDING_READINESS_20261117.md`, `docs/engine18b/*` (on branch `engine18b-private-recorder-standby-20261111`).

**What actually ran, vs. only built:**
- **Ran:** one operator-run real **1-minute RAW_FRAMES_ONLY** Ironbeam ES capture, around Nov 16–17 (verify the exact date).
  - 492 ordered records (483 vendor frames), 0 recorder GAPs, clocks UNVERIFIED.
  - Backed up and restored from the private R2 bucket (`engine18/raw-only/v1` prefix, pinned `lastSeq=492`).
- **Ran:** CI across every phase (synthetic data only). Separately, a synthetic backup history exists under its own prefix; leave it untouched.
- **Not run:** daily or sustained recording, five-session acceptance, verified-clock trials.
- **Standby:** private Render worker `frye-engine18-private-recorder-standby-t6l7`, running standby only (no vendor socket), with a dedicated 50 GB disk at `/var/data/engine18-recorder`. The last logs (Nov 17) showed capture, connection and uploads all inactive. Re-check before any use.
- **Never touch** the main backend's 100 GB `/var/data/replay` disk.

**Where data lives:**
- The private R2 bucket. Names and keys exist only in protected env vars and are never written here.
- The dedicated recorder disk.

**Current status:**
- Built for Ironbeam MBP-10 and **not wired to Rithmic**.
- The owner **approved Rithmic recording on Nov 25**, to start only after PR #400 (DBO book) passes acceptance and Engine 18D re-audits it.
- Still to confirm first: Rithmic retention terms, the session-limit conflict with R Trader Pro, the login expiry (Nov 30), and the cost estimate.

**Rithmic plug-in path (planned):**
1. Write a Rithmic recorder source alongside the Ironbeam source. It feeds raw R|Protocol frames (DBO 116/118/160, LastTrade 150, BBO 151), stamped before decoding, into the same buffered recorder with provider `RITHMIC`.
2. Reuse the hourly gzip + manifest, the encrypted R2 backup and inventory pin, the restore verifier and the readiness gates unchanged. Use a new R2 prefix, separate from the Ironbeam data.
3. Replay recorded sessions through the PR #400 book and the Liquidity Map for the learning loop (+10/+30/+60 outcomes).

## Known gaps
- Level detector tracks one event per level (no re-arm after an event closes) — verify before live use.
- Live worker/panel not built; nothing runs continuously yet.
