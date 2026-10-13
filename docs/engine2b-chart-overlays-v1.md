# Engine 2B chart overlay v1 (draft; not deployed)

## Ownership
Engine 22 is the only price/wave authority. Engine 27 is interpretive only and is not a source for any v1 structural price. Engine 2B is read-only. No Engine 3/4/6/7/8/9/10 output controls Fib visibility, confirmation or execution.

## Endpoint
`GET /api/v1/engine2/chart-overlays/v1?symbol=ES`

Responds with `schemaVersion: "engine2.chartOverlays.v1"`, `symbol: "ES"`, `priceBasis: "ES_INDEX_POINTS"`, `snapshot`, `degrees` and `diagnostics`. No other symbols are supported in v1. `If-None-Match` matches the SHA256 response ETag for a 304; otherwise returns a full immutable-by-value JSON response. Runtime converts a malformed source snapshot to a 503, not an invented Fib map.

## Degree source rules
- Primary / Intermediate / Minor / Minute: `snapshot.strategies["intraday_scalp@10m"].engine22WaveStrategy.degreeStates[degree]`.
- Active Fib levels require `activeFibModel.active === true`; read `activeFibModel.levels` and display source fields. `targetModel` and `correctionModel` are not silently promoted to current levels.
- Micro: `engine22WaveStrategy.currentWavelength.degrees.micro`, never `degreeStates.subminute`.
- Micro prior `microSequence.projectedW1` and `projectedW2` may be displayed only as `kind: FIB_CONTEXT`, `referenceOnly: true`, prefixed `PRIOR W1` or `PRIOR W2`, when no Micro current levels are published. These remain contextual levels, not current W3 targets.
- Micro V2 `microCanonicalRef` is retained separately as `shadowMicroCanonicalRef`, not claimed as the active count identity.
- All degree outputs are drawn from the same intraday composite, never a fallback to the unrelated swing strategy.

## Degree object
Each `degrees[degree]` contains `degree`, `sourceDegree`, `parentDegree`, `drawable`, `reason`, `severity`, `reasonCodes`, `wave`, `marks[]`, `lines[]`, `zones[]`, `componentAvailability`, `model` and `provenance`.

- A line: `id`, `key`, numeric ES `price`, `kind`, `label`, `status`, `sourcePath`; prior reference lines additionally include `referenceOnly: true`.
- A mark: `id`, `label`, numeric ES `price`, integer Unix `time`, `status`, `sourcePath`.
- A non-drawable degree returns empty lines/marks and an explicit blocking reason. A degree with marks but no active Fibs can be drawable with `componentAvailability.fibLevels === false`.
- `TOUCHED` never changes wave confirmation. Confirmed/candidate/locked maturity is copied, not inferred. Date-only anchors are not assigned fabricated intraday times.
- `canonicalWaveStateConflict` is reported explicitly; no automatic resolution.

## Current acceptance limitations
A live ES snapshot parity check is automated in `services/core/tests/engine2LiveSnapshotParity.mjs` and verifies exact Engine 22 source prices. On the observed October 11, 2026 snapshot, canonical active level arrays were populated for Intermediate but absent for Primary, Minor, Minute and Micro W3 Watch. Micro's previous W1/W2 published projections were available as 12 context references. These observations may change with market state; absence of an active model cannot be fixed by guessing in the chart layer.

No production merge/deployment; browser screenshot of the isolated renderer is not equivalent to real-chart approval. See frontend draft PR #37, backend draft PR #89, and upstream source-publication review issue #90.

## Release gates
Runtime live parity, five-degree rendering tests, no stale canvases after toggle/resize/symbol/timeframe, full React chart browser smoke, explicit Engine 22 source review for missing current levels, Engine 2 Manager approval, and rollback confirmation. Representative 1,000-user load testing was deferred by the user and must be reconciled with the Manager's prior release criterion.
