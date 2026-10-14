# Engine 11 — chart-coordinate compatibility proposal V1

Research design only, under Issue #130. No frontend or runtime consumer is connected. Existing source observations, registry and official Engine 22 geometry remain immutable.

## Separate records

**originalOwnerCoordinate** preserves registry SHA, workbook SHA, source row/cells, degree/wave label, raw Excel date/time/price, source precision, reported-versus-confirmed timezone and basis, structural status and actual approval history. Unknown count and approval identifiers stay null. This is the preserved Engine 22 source object, not a new registry.

**verifiedChartCoordinate** is nullable. When unavailable, the chart receives explicit noDrawReasons. When verified, it records display price and exact UTC instant plus the certificate below. A chart coordinate certificate does not itself approve an Elliott count or official Fibonacci geometry.

Required certificate fields:

| Field group | Required evidence |
|---|---|
| Source preservation | sourceCoordinateHash; registry/workbook SHA; original count identity and approval record where known |
| Candle | seriesIdentity, datasetVersion, sourceObservationId, sourceReceiptId, contractLineageVersion; authentic row/body digests; exact interval and completed-candle proof |
| Basis | priceBasisVersion, rollVersion, terminal contract, reference-close convention, every dated coefficient and receipt; raw/adjusted separation |
| Time | calendarVersion, timestampPolicyVersion, original timezone/precision, bar-label versus event interpretation, exact timestampUtc |
| TradingView | tradingViewEvidenceHash, chartConfigurationHash, dataVintage; actual ETH/B-ADJ/SET/timeframe and switch evidence |
| Conversion | conversionVersion, derivation direction, evidence establishing originalBasisPrice equals the preserved coordinate; target price derived against the verified target basis |
| Acceptance | sourceAccepted, intervalVerified, finalityVerified, contractVerified, settingsVerified, conversionVerified; separately structuralApprovalVerified and engine22ApprovalRecord for official plotting |

The isolated coordinateCertificate helper validates presence/consistency of a **previously reviewed** certificate and fails closed. It does not independently authenticate arbitrary strings or acceptance booleans. Certificate production, signature/issuer validation, persistence and consumer implementation are outside this stage; Manager-approved evidence must establish every flag before use.

## Reversible mapping rule

Only after actual reference evidence establishes an additive relationship on a specified contract segment:

`displayPrice = originalPrice - originalBasisOffset(segment, originalVintage) + targetBasisOffset(segment, targetDataset)`

The offsets must be independently evidenced, not fitted to the owner price. Unknown offsets produce null, not zero. A verified raw segment legitimately has zero offset. Crossing a switch can change both selected underlying contract and accumulated offsets; the same instantaneous U/Z spread is not necessarily a historical adjustment coefficient. A ratio or other unsupported adjustment is unavailable until separately researched and approved.

A calendar/timeframe change is not a price offset. Daily/session and weekly bar labels must not be mapped by treating their provider window_start as an authentic event time. An approximate original timestamp cannot be upgraded to exact precision. Preserve the literal original coordinate even if an approved transformation later yields a different display position.

For a fixed bar/source contract/vintage, an additive mapping preserves price differences. The March30 6511/6496 difference remains 15 under one mapping; do not reconcile them into one low. Different frames, original vintages, distinct events or different bases require their own evidence and Engine 22 decision.

## Chart handoff and next gate

Engine 2B pins series/dataset/basis/calendar/roll versions across candles and overlays. Switching timeframe or dataset invalidates stale overlay requests; requests return matching identities or visible no-draw. Retain T24–T27 chart tests: zoom/scroll without unexpected expansion, deterministic pinned pagination, stale-request/live-update protection, predictable 25,000-bar memory and compatible historical/live price basis. No chart tests were executed in this research stage because chart modification is not authorized.

Next recommended gate: Engine 2B accepts the targeted packet, obtains the small TradingView evidence set, Engine 11 independently reproduces a single candle/coordinate conversion, then Engine 22 confirms relevant count/anchor authority. Seek separate isolated frontend preview authorization. A comparison preview could label preserved workbook marks as nonofficial source evidence; official Fibonacci plotting requires explicit Engine 22 geometry/basis approval. Do not infer that a verified node conversion alone verifies every Fibonacci reference.

Historical adjusted prices never become execution prices. Active execution contract selection and raw live prices remain independent. At rollover, version updates require fresh basis certificates; do not add a new roll gap to a terminal contract segment. Preview rollback is removal of the isolated preview only, with no production consumer migration in scope.
