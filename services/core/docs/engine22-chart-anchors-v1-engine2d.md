# Engine 22 Chart Anchors v1 — Engine 2D integration (DRAFT)

Transport: existing ES dashboard strategy snapshot, `strategies["intraday_scalp@10m"].engine22WaveStrategy.chartAnchors`.
Producer: `services/core/logic/engine22/wave/buildEngine22ChartAnchorsV1.js`.
Source authority: `authorizedWorkingStructure`, owner selection revision 5. This is a read-only current working selection, NOT a historical point-in-time count.

Top-level fields:
- `schema: "engine22.chartAnchors.v1"`, `authority: "ENGINE22"`, `mode: "READ_ONLY"`
- `available`, `reasonCodes[]`, `selectionRevision`, `selectionApprovalReference`
- `modelFingerprint`, `evidenceFingerprint`, `chartContractFingerprint`
- `publishedAtUtc` (nullable), `symbol`, `contractId: null`, `priceBasis: "UNVERIFIED"`
- `chartCompatibility: "WITHHELD_PENDING_VERIFICATION"`, `plotAllowed: false`, `plotReasonCodes[]`
- `degrees`, `historicalAsOfSupported: false`, `noExecution: true`

Each degree has `available`, `sourcePath`, `modelVersion`, `activeWave`, `direction`, `lifecycleStatus`, `parentDegree`, `parentWave`, `anchors[]`, `fibGroups[]`, `scenarios[]`, `reviewBoundary`, `officialInvalidation`, `missingEvidence[]`.

Anchor: `anchorId`, `waveLabel`, `price`, `localTime`, `timezone`, `marketEventTimeUtc`, `timestampStatus`, `verificationStatus`, `sourcePath`, `sourcePriceBasis`. Null event time means do not place on a candle.

Fib group: `groupId`, `sourcePath`, `levels[]`. Levels are copied, not recalculated; retain all original evidence fields.

Submicro: `scenarios[0]` and `scenarios[1]` have separate `scenarioId`, `anchors[]`, `fibGroups[]`, lifecycle and missing-evidence fields.
Subminute: `fibGroups` holds independent `WICK` and `BODY` ladders.

Current price-basis view IDs supplied by Engine 2D (these identify chart views, not Engine 22 anchor provenance):
- UNADJUSTED: `price-basis:fcbfa10815555415c8afdfddbbc28a96a4f42207db162a0db853b549546b3908`
- ADJUSTED_RESEARCH: `price-basis:94b25a5e2dc04574a59966c369243300d205a50527800b63876641a6023e9f63`
- ACTUAL_CONTRACT: `price-basis:757ed82449f97edfea282111a163ffa04681ba188242fd17034ff9cb91410623`

Engine 2D acceptance:
1. Read this packet only; do not calculate Elliott Waves or Fibonacci prices.
2. Do not plot any coordinates until `plotAllowed === true` AND price-basis/contract match is independently authenticated. This v1 publisher intentionally emits `plotAllowed:false`.
3. Do not place any anchor whose `marketEventTimeUtc` is null.
4. Never combine Submicro scenarios or Subminute Fib methods.
5. Preserve original touch evidence, candidate status and review-only boundary semantics.
6. Do not render today's selected working wave count as a historically known signal on past candles; `historicalAsOfSupported:false`.
7. On missing packet, unknown schema, or `available:false`, show explicit unavailable state and draw nothing.

No merge or deployment is authorized by this draft.
