# Engine 16 / Engine 2 — Owner-requested Multi-Timeframe Strategy Inspector

## OWNER SCOPE CORRECTION — 2026-11-09 (supersedes earlier timeframe examples)
**Only six timeframes are in initial scope: 1m, 5m, 10m, 20m, 30m and 1h.**
Do not add 3m, 15m, 4h, daily or any additional scanner rows to this release. This is a *strategy inspector evaluation grid*; larger-degree Engine 22 and higher-timeframe Engine 29 context may still be displayed read-only without introducing more selectable scan rows. A strategy with no legitimate evaluator for a selected timeframe must show unavailable/native-only, never a fabricated signal. The existing chart does not appear to have a 20m timeframe in its current TF mapping; validate authoritative Engine 11 support and aggregation/close boundaries before enabling 20m. This correction is the controlling user decision over older references elsewhere in this file.


**Design reference:** E16-OWNER-UI-004
**Date:** 2026-11-09 America/Phoenix
**Status:** OWNER-REQUESTED CAPABILITY, design awaiting manager architecture/rule approval; no production implementation authorized.

## Product goal
On the Frye Engine 2 chart, owner can select **any registered strategy** and inspect its live/historical state on chart timeframes **up to 1 hour**. The experience should resemble a selectable multi-timeframe scanner: no need to navigate away from the chart to discover where each strategy is in its lifecycle.

User-supplied visuals: Frye Strategies degree cards, Frye Engine 2 chart, Frye Engine 29/25 contextual panels, TradingView TriggerTrades ABC scanner. The requested behavior is new Frye functionality; screenshot display values are not code/data contracts.

## Scope and distinction
- **Strategy** is a configured trading/research lane from the canonical strategy registry, not necessarily one of Engine 22's seven wave degrees.
- **Timeframe** is the *view/evaluation timeframe* and may differ from the strategy's native authoritative timeframe. NEVER fabricate a 1m signal for a strategy evaluated only natively at 1h or 4h.
- **Wave degree** is an independent Engine 22 concept. A strategy can reference parent/child degrees without being synonymous with any degree.
- **Permission** is read-only information owned by its current engine; clicking charts or inspector MUST NOT alter permission, mode, sizing or execution.
- Display and historical inspection may use 1m, 5m, 10m, 20m, 30m, 1h **only where bars and evaluator are supported**. Unsupported timeframes must be labeled NATIVE_ONLY/UNAVAILABLE or show clearly sourced higher-timeframe context. Do not fake finer signals by interpolation.
- Owner can select **one strategy or All Strategies** and optionally show all current signals on the chart.

## Desired chart UX
1. **Strategy Selector:** lists all currently registered/authorized strategies (not hardcoded from screenshot), searchable; shows title, native TF and current read-only status.
2. **TF selector/scan grid:** compact rows 1m, 5m, 10m, 20m, 30m, 1h where supported. Each strategy/timeframe cell reports state: DEVELOPING, WATCH, TRIGGER_OBSERVED, CONFIRMATION_PENDING, QUALIFIED, INVALIDATED, UNAVAILABLE, STALE or equivalent approved strategy-native states. Preserve original raw state and map to UI vocabulary separately.
3. **Click strategy:** filter chart overlays to its pattern IDs, own pivots and higher-degree context, C?/wave states, targets, invalidation, FVG/SMT/Engine29 adjuncts when available. Do not hide owner-approved Engine22 waves by destroying data; use visibility toggles.
4. **Click timeframe cell:** focus the chart time frame and select the corresponding candidate/timepoint when supported. Keep existing historical candle viewport and recent-first Engine11 performance. Do not resubscribe/download all history purely because an inspector cell was clicked.
5. **Details panel:** symbol/contract, strategyID, requestedTF, nativeTF, wave degree/parent anchor, direction, phase, confidence qualification/why, target values/anchor lineage, structural invalidation versus protective stop, latest data/closed-bar knownAt, status freshness, alternative counts, and **separately** Engine6/27 trade context if present.
6. **Timeline/history:** click prior marker to inspect exactly what was known then. Preserve as-of candidate/signal history, mark superseded interpretations, and avoid later bars/labels leaking into earlier snapshots.
7. **Cross-timeframe header:** clear distinction between strategy result, parent trend/Engine22 degree, Engine29 multi-timeframe pressure, and permission. A bullish local ABC with bearish higher-degree context must be displayed explicitly, not flattened into one green/red status.

## Backend contract (proposed): engine16.strategyInspector.v1
```json
{
  "schema": "engine16.strategyInspector.v1",
  "symbol": "ES",
  "contract": null,
  "priceBasis": null,
  "asOf": null,
  "publishedAt": null,
  "selectedStrategyId": null,
  "strategyRegistryVersion": null,
  "rows": [
    {
      "strategyId": "EXAMPLE_ONLY",
      "displayName": "Example",
      "nativeTimeframe": "10m",
      "timeframe": "10m",
      "evaluatorSupported": false,
      "status": "UNAVAILABLE",
      "nativeStatus": null,
      "sourceEngine": null,
      "stateKnownAt": null,
      "freshness": "UNKNOWN",
      "reasonCodes": [],
      "candidateIds": [],
      "parentDegreeRef": null,
      "engine22AnchorVersion": null,
      "targetModelIds": [],
      "invalidationIds": [],
      "signalEventIds": [],
      "permissionReadOnly": true
    }
  ],
  "researchOnly": true,
  "noExecution": true
}
```
Final field names/version require manager/API review. **Do not pretend all existing strategy statuses were computed by Engine16.** Engine 16 can supply structural candidate layer and a separate read-only aggregator can join strategy-native states with provenance.

## Existing repository notes (read-only verified paths)
- Frontend chart `src/pages/rows/RowChart/index.jsx`; `src/pages/rows/RowChart/Controls.jsx` already has symbol/timeframe selection and an Engine11 OHLC/stream path.
- Backend `services/core/jobs/buildStrategySnapshot.js` still contains old Engine16 MorningFib references and explicit strategy-timeframe caveat: only `intraday_scalp@10m` computed through that legacy path, higher 1h/4h placeholders. **Do not reuse legacy Engine16 slot outputs as our new detector.**
- `services/core/routes/strategyState.js` shows older Engine7 strategy toggle registry including native 10m/1h/4h rows. This may NOT be the full canonical currently active registry; verify with manager, strategy account registry and current dashboard-snapshot. Never assume “every strategy” means only those three.
- Current Engine11 chart timeframes in `RowChart/index.jsx` explicitly include 1m/5m/10m/15m/30m/1h/4h/1d. **20m is not shown in this chart's TF map**, even though the owner wants them. Need supported candle aggregation/timeframe adapter contract, not fabricated resampling or implicit frontend-only candles.

## Architecture/ownership
- Engine11 owns candles and their timeframes; must not impair 1m, 5m, 10m or 1h loading/realtime.
- Engine22 owns approved Elliott count and degree/parent labels.
- Engine16 owns automatic candidate ABC research and higher-degree interpretation.
- Existing strategy engines own their own strategy status and permission; inspector is an **aggregation/read-only visualization**, not a source of new trade decisions.
- Engine2 owns chart interaction and presentation.
- Engine25/29 and other evidence are optional, read-only and source-timestamped; cannot manufacture validity.
- No automatic Engine27/6/8 action, no trade execution.

## Proposed staged development
A. Verify canonical strategy registry and supported native/evaluation timeframes, plus exact Engine11 20m support.
B. Create read-only strategy-by-timeframe snapshot adapter (mock fixtures first, then existing native endpoint read) with support and freshness status.
C. Integrate Engine16 ABC candidates and Engine22 parent context by **stable ID/version**, not chart coordinate guesses.
D. Add frontend strategy selector, multi-TF matrix and inspector, with chart marker click-through, timepoint history and clean show/hide.
E. Tests: exact source ID, missing unsupported TF no fabricated signals, as-of isolation, cross-TF agreement vs disagreement, debounce/reconnect, identity/restart, candle-loading and Engine6/27/8 non-regression.
F. Isolated browser visual acceptance and manager review, separate owner deploy authorization.

## Required manager questions
1. What is the authoritative current strategy registry and set of **all** strategies, including ES/scalp/swing variants, and which native timeframes should each expose?
2. For the owner-locked six timeframes (1m,5m,10m,20m,30m,1h), should each be an actual evaluator, or display native strategy status against any chart timeframe with explicit provenance? Recommend support both without inventing data.
3. Can Engine11 authoritatively supply 20m, and who owns resampling/aggregation boundaries if not?
4. Should the strategy UI integrate into `RowChart`, `FullChart`, or both, and which existing overlay/interaction controller is authoritative?
5. Which current snapshot/stream endpoint is canonical for strategy statuses, and what are the knownAt, active scenario IDs and freshness policies?
6. How should we ensure larger-degree Engine22 waves remain visible when switching strategy overlays?
7. Which owner-selected strategies/timeframes should make the initial visual acceptance matrix?

**Approval requested:** product scope/design and isolated integration architecture only; no production release authorization.
