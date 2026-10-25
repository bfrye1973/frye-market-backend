# Engine27 V3 — Module 27.4 Open Position Intelligence handoff
Status: ISOLATED read-only implementation, NOT production approved or connected to runtime.

## Files
- contracts/positionIntelligence.v1.js — schema engine27.v3.positionIntelligence.v1; Micro account SCHWAB_6380.
- positionIntelligence/evaluatePositionIntelligence.js — strict real Engine10 journal contract view.
- tests/positionIntelligence.test.js — eleven missing/account-isolation/plan-identity/closed/invalid/PnL negative tests.
- .github/workflows/engine27-v3-micro-isolated.yml — checks Modules 27.1-27.4 plus existing V2 smoke regressions.

## Input/output
Input: Engine10 listTrades({accountMode:'REAL'}) result {ok,trades}; optional Engine9 officialPlans[] are never automatically selected by strategy name. Real trades must match brokerAccountLabel SCHWAB_6380, accountMode REAL and OPEN contract identity from realBroker.contracts[]. Only OPEN contracts with contractId and valid entryPrice are displayed. Missing/invalid ledger fails closed. Position-level unrealizedPnL remains null until verified broker mark source is connected. Contracts are individual one-unit identities (no synthesized aggregation).
Output: engine27.v3.positionIntelligence.v1 with unavailable/no-open/open-unmanaged/open-matched-official statuses. Exact matching planId,candidateId,strategyId and direction required for optional official plan attachment; managementReady and official must be true. No plan matched => no official stop/targets displayed. No entry thesis claims: entryThesisStatus NOT_YET_VALIDATED_BY_MODULE_27_5.

## Authority
Engine10 alone owns position and contract history; Engine9 owns any official plan, Engine27 is strictly a reader with no order modification, no permission, no execution and no journal write.

## Test status
11 focused position tests; V3 combined CI run reported success after position integration. Last harmless tightening of entryThesisStatus is being CI revalidated. Prior Module 27.1-27.3 tests remain in same workflow.

## Unresolved
- Confirm production Engine10 real journal field schema and all existing account 6380 contracts against actual read-only rows before wiring V3.
- Broker realized/unrealized marks must not be inferred from dashboard ES last price; require verified broker valuation timestamp and multiplier.
- Live Engine9 plans for REAL Schwab positions have not been proven to share durable identity; no opportunistic attachments.
- Module 27.5 must validate immutable structuralContextAtEntry, not today's count.
- Main, production, legacy V2, Engine22, trading gates and frontend unchanged.
