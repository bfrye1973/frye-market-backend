# Handoff log

Newest at the bottom. One short entry per work session.

## 2026-11-26 — Engine 18 (Claude)
- Done: Liquidity Map step 3 — sweep events as PROVEN, owner zones as OWNER_ZONE, broken levels marked, side-aware proof (PRs #408, #409 merged into probe branch; 54 tests). Real Nov 25 replay: 7,000 held all day; 7,100/7,150 shown FLIPPED after breaking; 7,200/7,211 SELL inside owner zones.
- Rithmic flags set back to NO.
- Handbook created (this file, `CLAUDE.md`, `docs/engines/`).
- Next: Engine 18 live worker + real-time panel v1 (offline first).
- Waiting on owner: PR #240 preview; Rithmic login extension before Nov 30; Engine 18D re-audit of PR #400.
- Handbook: added Engine 18 "Recording & history storage" section (Gate 1 recorder, PRs #291–#334, one real 1-min Ironbeam capture, standby worker, Rithmic plug-in path).

## 2026-11-26 (later)
- Owner decision: Engine 18 uses **Rithmic only**; Ironbeam retired. Old Ironbeam research service (`frye-engine18-liquidity-research`) to be suspended by owner. Recorder standby worker kept for Rithmic recording.
- Owner sent Rithmic tech support: login extension, second session, data-retention terms.
- Next: Engine 18D re-audit request for PR #400 → live Step A/B → Rithmic recorder source.

## 2026-11-27 — Engine 28 (Claude)
- Done: Phase 0 read-only inventory (`docs/engine28/PHASE0_INVENTORY.md`) and Master Development Plan v1.0 draft (`docs/engine28/MASTER_PLAN.md`). PR #417 @ 09565bb 87/87 pass; PR #418 @ 057d314 70/70 pass; main 28A tests 97/97.
- Key findings: observer exit code gates PAPER execution (F-1); executor awaits receipt storage with no timeout (F-2); receipt store stops at 50,000 files, about 4–5 weeks (F-3); #417/#418 edit the same files with different content.
- Waiting on owner: decisions D-1…D-6 in the master plan; Replay archive for Nov 24–27 cases before 14-day retention.
- Next: Manager review → assignment 28A-001 (observer non-interference).
- Later (Nov 27): owner made #412 P0. E28A acknowledged the editor agreement (#412 7225818697). Draft PR #419 (bounded observers + noninterference tests, base 09565bb, CI green). Draft PR #420 (phone view `/paper-verification.html`, CI green). Checkpoint: #412 7225971453.
- Waiting on: E8 review of #419; E12 restack + `perApproval`; E10B re-review; owner decisions on Step 4 gating, Render read secret, evidence preservation.
