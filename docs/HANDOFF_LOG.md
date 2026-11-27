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

## 2026-11-27 — Engine 8 design review (Claude)
- Done: traced three owner-flagged missed trades (Nov 25 8:01, 11:31 long; Nov 27 4:46 short) through scheduler logs. All were approved by Engine 6 and blocked by Engine 8 `DUPLICATE_ORDER_BLOCKED`. Root cause in code: the legacy one-time acceptance-trial lock. The acceptance file is missing in the new durable store, which deadlocks every order. Passover + design review: `docs/engines/ENGINE8.md`.
- Waiting on owner: PR #402 merge **and** `ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED=1`.
- Next: Engine 8 manager review of ENGINE8.md; agree on the section 6 redesign.
- Later (Nov 27, 1:08 PM AZ): owner authorized the fix. PR #402 head `018266d` merged as `f7d1bc4` (PR #426); `ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED=1` set on frye-market-backend-1; deploy live 20:08 UTC; first cycle clean. **Next:** confirm `AUTO_PAPER_EXECUTION_COMPLETED` on the next Engine 6 approval. Engine 8 work now belongs to the Claude Engine 8 teammate (#425).
