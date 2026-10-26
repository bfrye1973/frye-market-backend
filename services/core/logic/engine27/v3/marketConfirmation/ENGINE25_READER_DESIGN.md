# Engine 27 V3 — Engine 25 Reader Design (Micro First)

**Status:** Proposed design; approved timeframe hierarchy, not implemented as live reader.
**Scope:** Engine 25 only. No Engine 29, Engine 10, Engine 6 or order changes.
**Engine ownership:** Engine 25 produces and qualifies all readings; Engine 27 reads, validates, preserves provenance, and interprets alignment with Engine 22. No new scanners, recalculations, or overriding owner freshness.

## User-approved timeframe hierarchy

1. **1H PRIMARY — market participation:** advancing/declining stocks, directional stock volume, sector participation, breadth and market participation state. This is the primary Engine 25 timeframe for Micro's market backdrop.
2. **4H STRUCTURAL — bigger picture:** structural selling/distribution pressure, participation regime/persistence, and contradictions with 1H. A 4H backdrop is context, not an automatic Micro veto.
3. **30m TRANSITION — developing confirmation:** improvement/deterioration and confirmation transitions. May qualify an early-warning statement, not independently override 1H.
4. **10m SUPPORT — acceleration/diagnostics only:** preserve owner-published fast participation and pressure warning without creating Micro direction, entry or invalidation authority.
5. **EOD CONTEXT ONLY:** retain existing owner blending, market health, and last valid completed equities reading when closed; do not promote EOD or blended values to live 1H confirmation.
6. **Live ES prices:** separate direct individual ES futures trades. Do **not** read 10-minute bars as V3 live price input.

This hierarchy governs **Engine 27 interpretation** only. Engine 25's own canonical blended model, weighting, sessions, and calculations remain unchanged.

## Authoritative read-only transport

- Production GET `/api/v1/engine25/full-dashboard` publishes `participationArtifact`, `fastParticipation`, `blendedParticipation`, `sourceDiagnostics`, `engine25Context`, and `marketInternals`.
- Persisted canonical participation: `services/core/data/engine25-participation.json` with `schema=engine25.participation@1`, `authority.owner=ENGINE25`; builder `services/core/jobs/updateEngine25Participation.js`.
- Canonical wider context: `services/core/data/engine25-context.json`; separate ES overlay `engine25-es-overlay.json` and market health `engine25-market-health.json`. Preserve distinction between ES regime and equity participation.
- Only perform GET; use bounded timeout and polling on the shadow. No POST refresh, no running Engine 25 jobs, and no reading another service's filesystem.
- Do not depend on Engine 29 data embedded in the full-dashboard response.

## Required Engine 27 output shape — proposed version engine27.v3.engine25Reader.v1

```text
source = ENGINE25_CANONICAL_READ_ONLY
sourcePresent, contractValid, retrievedAt
ownerGeneratedAt, originalSourceTimestamps
participation:
  oneHour:  { state, score, advancingStocks, decliningStocks,
              advancingVolume, decliningVolume, sectorCounts, sourceTimestamp,
              freshnessState, sourceUsable, reasonCodes }
  fourHour: { state, score, sourceTimestamp, freshnessState, sourceUsable, reasonCodes }
  thirtyMinute: { state, sourceTimestamp, freshnessState, sourceUsable, reasonCodes }
  tenMinute: { state, sourceTimestamp, freshnessState, sourceUsable, reasonCodes }
  eod: { state, sourceTimestamp, freshnessState, sourceUsable, reasonCodes }
  blended: { state, blendedScore, higherTimeframeScore,
             usableEffectiveWeight, agreementState, reasonCodes }
distribution:
  structural4h, tactical1h, confirmation30m, acceleration10m,
  integratedState, sourceFreshness
breadth: { ownerPublishedSummary, intraday, eod }
stockVolume: { intraday, eod, coveragePct, coverageQualified }
sectors: { intraday, eod, sectorCards }
leadership: { newHighsNewLows, upDown }
context: { marketHealth, esRegime }
qualification:
  equityScannerSession, systemOperatingSession, ownerFreshnessState,
  ownerFreshnessReason, ownerUsableForTrapConfirmation,
  contextAvailable, liveEquityQualified
reasonCodes
noExecution=true, noPermissionCreated=true
```

Unknown, absent or stale attributes must remain `null`/UNAVAILABLE rather than inferred. Provenance must include *actual observation timestamps*, not just publication time.

## Verified producer contract mapping

- `participationArtifact.participation.breadth`: Engine 25 breadth owner; `breadth.inputs.intraday` / `inputs.eod` where supplied.
- `participationArtifact.participation.sectorParticipation.intraday.{bullishCount,neutralCount,bearishCount,cards}`; same `eod` structure. Never use fictitious `intraday.bullish` fields.
- `participationArtifact.participation.stockVolume`: owner volume evidence with intraday/eod and coverage.
- `participationArtifact.participation.{newHighsNewLows,upDown,momentum}`: optional context.
- `participationArtifact.fastParticipation`: **10m supporting only**, sourceTimestamp and freshnessState included.
- `participationArtifact.sourceDiagnostics["1h"|"4h"|"10m"|"eod"]`: actual published per-timeframe state/score, sourceTimestamp, freshnessState and evidence. **30m is NOT in this blended sourceDiagnostics mapping**; do not manufacture 30m participation from 10m.
- `participationArtifact.blendedParticipation`: owner-published blended state, agreement, scores, reasons; not independent Micro entry authority.
- `participationArtifact.participation.distributionPressure` schema `engine25.distributionPressure.v2`:
  `structural4h`, `tactical1h`, `confirmation30m`, `acceleration10m`, `integratedState`; the producer's own authority declares these roles.
- `participationArtifact.freshness.{state,reason,usableForTrapConfirmation,equityScannerSession,systemOperatingSession,intraday,eod}`: authoritative live-participation gate.
- `engine25Context` and `marketInternals`: ES health/regime / timeframe market-meter context, not a replacement for participation freshness.

**Needs schema verification before implementation:** nested numeric keys inside `sourceDiagnostics["1h"]`, `["4h"]`, and actual `distributionPressure.*` observation fields and whether 30m direct participation exists in an officially published contract. Implement only exact confirmed keys. Direct full production examples can be projected privately into a schema-only fixture without logging raw market internals.

## Interpretation rules (Engine 27 ONLY)

- Source existence, numerical evidence availability, timeframe freshness, and **qualified confirmation** are separate statuses.
- Market context can be PRESENT while `freshness.state=UNAVAILABLE`, `LAST_VALID_EQUITY_READ` or volume coverage fails the minimum. Do not label these as current live equity confirmation.
- No new fixed freshness thresholds: preserve published `freshnessState`, `sourceTimestamp`, `maxAgeMs`, `available`, `coverageValid` and owner `usableForTrapConfirmation`.
- 1H direction/participation is first; 4H may reinforce or contextualize; 30m flags emerging transitions; 10m warns without causing flip-flop.
- Opposing 1H/4H/30m readings become `MIXED_OR_CONFLICTING_CONTEXT` with both facts retained; do not invent a new weighted score, reverse an Elliott wave, or hard-block a valid correction.
- Data with missing qualified freshness is displayed as context-only and cannot be counted as live confirmation.
- None of these Engine 25 fields authorizes entries/exits, replaces Engine 22 Elliott owner, overrides Engine 3/4, or grants Engine 6 permission.

## Acceptance before wiring

1. Validate actual Engine 25 artifact schema and source ownership; reject malformed contract but keep independent ES regime context when valid.
2. Exact 1H and 4H source diagnostics copied, not recomputed; 30m from official distribution `confirmation30m` only if available.
3. Sector fields match official count names; null does not turn into zero.
4. Premarket 44.52% coverage (below owner 70%) displays numeric evidence, `liveEquityQualified=false`.
5. Closed equity session with last valid completed observation becomes context-only.
6. Separate ES live futures T-trade path remains untouched.
7. Missing/old 1H yields not qualified even with FRESH 10m; strong 4H never upgrades stale 1H.
8. Unit fixtures for 1H/4H/30m/10m conflicting signals, publication-vs-source timestamps, missing 30m participation, closed-session and coverage failure.
9. Shadow CI + V2 regression tests pass. Owner review BEFORE wiring canonical reader into running V3 Micro manager or propagating to other six strategies.

## Deferred

Engine 29 source and tactical intelligence: discuss separately after Engine 25 reader approved. Engine 10/Schwab contracts and official Engine 9 matching remain frozen by owner direction.
