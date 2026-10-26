# Engine 27 V3 — Module 27.3 handoff
Status: ISOLATED IMPLEMENTATION; GitHub isolated test workflow passed. NOT production accepted, not merged/deployed.

## Code and contract
- contracts/marketConfirmation.v1.js: engine27.v3.marketConfirmation.v1
- marketConfirmation/evaluateMarketConfirmation.js: pure read-only evaluator
- tests/marketConfirmation.test.js: 16 independent source, candidate/confirmation, scope, staleness and negative tests
- .github/workflows/engine27-v3-micro-isolated.yml: executes all three modules' tests plus selected existing V2 checks

## Source inputs / authorities
Engine25: passed engine25Context object (ok, regime, riskLevel, updatedAt). Engine29: persisted engine29-cross-market-stress (overallState, timestamp, dataDegraded, tactical, liquidity/trap/pressure). Engine29 is allowed ONLY for micro/submicro.
QQQ/VIX: engine27CrossMarketLevels.instruments.QQQ/VIX (available, symbol, lastCandleTime, levels) and engine27LiveCrossMarketReactions.instruments.QQQ/VIX (sourceSymbol, timeframe=1h, lastCompletedAt, events with source POLYGON_DIRECT_1h). Direct symbol I:VIX required.
ES: engine27EsInstitutionalContext (Engine1 manual SMZ zones).
Evaluate at explicit timestamp. QQQ/VIX level max age 4 days for weekend; hourly reaction max age 90 minutes, E25/E29 90 minutes. These are source-validation policy constants subject to manager approval before production; no runtime configuration changes made.

## Output
Schema engine27.v3.marketConfirmation.v1. States UNAVAILABLE|PARTIAL|CONTEXT_AVAILABLE. Source records with availability and explicit reasonCodes; confirmedEvents separated from candidateEvents. Zone-only geometry is PARTIAL; never infer verified ES reaction from a zone. Structural authority ENGINE22 and primary ES price precedence explicit. Trading permission/sizing/execution/journal write flags false.

## Tests
GitHub V3 isolated acceptance workflow succeeded after adding Module 27.3. 16 focused Module 27.3 tests; 38 cumulative isolated tests for 27.1-27.3. V2 compatibility workflow status separately checked.

## Known gaps
- No verified ES completed-candle price-zone reaction packet wired for market-confirmation layer; ES zone geometry remains partial.
- Engine25 returns regime/riskLevel context; do not re-label as verified ES-specific volume or breadth without source confirmation.
- Candidate QQQ/VIX reactions correctly not confirmed. No automatic ES directional signal from cross-market alone.
- No production wiring. Manager/owner approval remains required for migration.
