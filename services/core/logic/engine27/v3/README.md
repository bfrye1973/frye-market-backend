# Engine 27 V3 — Micro-first read-only intelligence

Development-only on branch `engine27-v3-micro-intelligence` (draft PR #200). No production wiring, front-end changes, trade permission, order management, journal mutation, deployment, or merge.

## Implemented source-isolated modules
1. `priceActionFib/`: Engine22 owner C-down, provisional Fib ladder, completed ES 10m evidence; no fabricated confirmed objective.
2. `neighboringAlignment/`: Submicro ↔ Micro ↔ Subminute owner linkage; contrary direction ≠ structural invalidation.
3. `marketConfirmation/`: Engine25, Engine29 (Micro/Submicro only), QQQ, direct I:VIX and Engine1 ES zones; freshness and evidence qualification.
4. `positionIntelligence/`: Engine10 real account SCHWAB_6380 contract read; Engine9 plan only on durable identity join; no invented P&L.
5. `entryThesisMemory/`: immutable entry-time thesis or ENTRY_STRUCTURE_UNAVAILABLE.
6. `historicalValidation/`: Engine12/Engine28A replay input validation, no lookahead or invented confidence.

## Integrated manager
`manager/assembleMicroInputs.js` is the single source-qualification entrypoint; it requires explicit completed ES bar provenance and refuses guessed timestamp units.
`manager/buildMicroIntelligenceV3.js` produces `engine27.v3.microUnifiedIntelligence.v1`, with all six module outputs, separate strategy and position assessments, explicit unavailable states, and no trading authority.
`manager/strategyConfigurations.js` lists all seven account/degrees; only Micro is evaluated by the integrated manager at this stage.

## Test commands
`node --test services/core/logic/engine27/v3/tests/*.test.js` from repo root. CI: `.github/workflows/engine27-v3-micro-isolated.yml` also runs selected V2 regressions.

## Still required for acceptance
Capture and verify sanitized actual production ES 10m candle source/units, Engine22 Micro owner and provisional flags, Engine10 Micro open contract field names and entry-time provenance; connect immutable replay sources; test complete live-data integration. V3 remains shadow-only and NOT_PRODUCTION_ACCEPTED until Manager review and owner approval. CI fixtures alone do not prove live data.
