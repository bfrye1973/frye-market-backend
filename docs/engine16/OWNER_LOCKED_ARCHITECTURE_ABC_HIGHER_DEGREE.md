# Engine 16 — Owner-Locked Design Direction: ABC-First, Higher-Degree Elliott Context

**Decision ID:** E16-OWNER-ARCH-001  
**Date:** 2026-11-08 (America/Phoenix)  
**Status:** OWNER-APPROVED PRODUCT/DESIGN DIRECTION. **Not** manager-approved numerical predicates, code acceptance, production merge, or deployment authorization.  
**Owner directive:** “Detect the smaller moves automatically, but interpret them through the larger Elliott Wave structure.” Owner explicitly said “lock this down.”

## Non-negotiable design
Engine 16 is **not** an isolated 3-pivot ABC scanner and **not** a replacement for the seven-degree Elliott Wave hierarchy.

**Layer 1 — Automatic, candle-by-candle structural detection**
- Ingest authoritative Engine 11 ES bars, with physical contract, sessions, close/availability times and price-basis integrity.
- Discover pivots, developing A/B/C-style swing structures, local 1/2/3 alternatives, and provisional target levels on every new candle.
- Start with a practical causal ABC detector, then improve zigzag/flat internal subdivisions and further families as their strict predicates are approved.
- Separate provisional drawings from confirmed evidence and version interpretations; no retroactive repaint of saved as-of outputs.
- Recognizing a three-swing geometry alone does NOT confirm an orthodox 5-3-5 zigzag or 3-3-5 flat.

**Layer 2 — Higher-degree Elliott Wave interpretation**
- Read Engine 22's **approved seven-degree structure and historical anchors** without overwriting them.
- Interpret the same local swings in the parent-wave context: e.g. one pivot may represent a B low in a local ABC research model while remaining Micro Wave 2 in Engine 22's approved interpretation.
- Compare actual higher-degree wave magnitudes, parent placement, nesting, internal subdivisions, family rules, invalidation and Fibonacci proportions; never use typical ratios as unconditional proof.
- Keep competing scenarios as independently identifiable candidates, including “bullish C developing” versus “Micro Wave 3 developing.” Different labels can share a pivot without becoming the same count.
- Track which interpretation is better supported by available evidence, without forced certainty or invented probabilities. Display UNKNOWN/UNRESOLVED when the available evidence cannot discriminate.

**Layer 3 — Presentation/auxiliary evidence**
- Publish research-only candidate status, direction, phase, degree/parent reference, anchors, three-anchor targets, structural boundaries, rule results and alternatives to Engine 2.
- FVG, ES/QQQ/VIX SMT, liquidity/CISD and higher-timeframe bias may add evidence later; they must not override approved Engine 22 counts or establish orthodox internal subdivisions by themselves.
- Engine 2 chart must show the working interpretation and easily inspectable alternatives while preserving visibility of approved historical waves.
- Engine 11 candle rendering must never block on Engine 16 calculations.

## Key differentiator and acceptance example
The owner values Frye's **higher-degree wave lengths and nested context** over a standalone TriggerTrades-style ABC overlay. Use third-party screenshots for external behavior benchmarking only, not proprietary algorithm replication.

**Observed comparison:** At the owner-drawn Micro Wave 2 low (approximately ES 7,363.75 in screenshot, **price/timestamp not yet validated against Engine 11**), an external ABC overlay's B low appears to align visually. Both interpretations may project an advance but imply different subsequent structures. Engine 16 should:
1. Maintain the Engine 22 Micro W2 reference as approved, if actually confirmed in its authoritative contract.
2. Independently publish a B-low/possible C candidate and a 2-low/possible W3 candidate with shared structural pivot reference, not a forced relabel.
3. Evaluate parent-degree lengths, internal child-wave evidence and constraints over following candles.
4. Preserve both candidates and their as-of histories until an approved rule confirms, rejects or supersedes one.
5. Never infer confirmation from a target touch or the external chart alone.

## Development order
1. Causal pivot and provisional ABC research detector, including as-of/knownAt and explicit source basis.
2. Three-anchor C-from-B targets and alternative candidate identity/versioning.
3. Read-only higher-degree Engine 22 context and magnitude/nesting comparisons.
4. Manager-approved orthodox zigzag/flat child grammar and scoped invalidations; replay synthetic and authoritative Engine 11 histories.
5. Additional diagonals, triangles, combinations, FVG/SMT and multi-timeframe scanner as separately authorized.
6. Engine 2 display integration and visual owner acceptance after runtime tests.

## Ownership and authority
- Engine 11: authoritative ES candles.
- Engine 22: approved seven-degree historical wave counts and anchors.
- Engine 16: automatic research inference and scenario evidence, **never approved-count authority, trading permission, sizing or execution**.
- Engine 2: display only.
- Engine 16 Manager: resolves unapproved structural predicates, boundary/equality/confirmation semantics, contracts and test expectations.
- Owner: final authority for production release.

## Anti-regression conditions
- Do not discard the higher-degree design to implement only a simple standalone ABC model.
- Do not force an early choice between C and Wave 3; both can remain viable.
- Do not overwrite owner-approved historical counts or future-leak labels into past snapshots.
- Do not infer that an external overlay's internal logic is known from screenshots.
- No production deployment or merge without separate owner authorization.

## Reference documents and work tracking
- Prototype: PR #265 (`research/engine16-structural-tracker-v1`).
- Chapter study PRs #267–270; all rule predicates and replay requirements remain subject to manager decisions/implementation/testing.
- `docs/engine16/INDEPENDENT_THEORY_AND_ENGINE_DESIGN.md`.
- This architecture decision is owner locked. Any proposal to change its fundamental direction must return to owner for approval.
