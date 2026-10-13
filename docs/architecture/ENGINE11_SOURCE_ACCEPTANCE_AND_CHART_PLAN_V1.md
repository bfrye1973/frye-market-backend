# Engine 11 — Shared Source Acceptance Contract and Chart Readiness Plan V1

This supplements the existing `JOINT_HISTORICAL_ES_CANDLE_CONTRACT_DRAFT.md`; it is not a competing history system. Later Manager rulings establish permanent Engine 11 candle ownership and override that draft's former pending-owner text. Engine 22 retains all structure/Fibonacci authority; Engine 2B owns rendering. No consumer, route or frontend is changed here.

## One shared source contract

Future analytical-series envelope (schema proposal, not published): root symbol, seriesId, datasetVersion, full raw contract lineage, priceBasis and its version, identity version, exchange calendar/version, timezone, interval alignment/version, close convention, completed-bar/finality policy, acquisition interval, capture provenance vector, correction/revision relationships and quality/gap states. Daily/weekly/monthly inputs identify their exact constituent sessions and completed period end. Derived series additionally pin parent identities and transformation/roll policy versions.

Every analytical interval must reference immutable raw source observations, rather than reusing raw provider clock-label identity as canonical interval identity. Overlapping contracts remain distinct. Original source and derived price bases never silently mix. No adjusted or continuous analytical series becomes execution authority. A revision creates a new immutable dataset; old cursors cannot switch versions.

Pagination contract: half-open UTC ranges; ascending deterministic compound order; authenticated/version-pinned cursors; dataset, timeframe, series, contract/basis and boundary pins; explicit hasMore/truncated/sourceUnavailable; repeatable pages. Raw observation ordering also distinguishes session label, source revision and observation ID. Provider-native paging and source V2 paging do not by themselves establish canonical candle membership.

Source acceptance requires documented complete dated trading masks, independently accepted period alignment, contract identity, quality, sufficient guard coverage, no-trade versus unavailable differentiation, completed-candle evidence, source revision/as-of guarantees, and verified retention/restore. Unresolved evidence remains typed UNKNOWN/QUARANTINED; clocks alone never prove finality. Source acceptance and Engine 22 historical-depth acceptance are separate.

Recommended alignment remains **session-open anchoring as an isolated research candidate**. A versioned policy must define restarted/multi-day sessions, truncated final intervals, early closes, daily period ends, weekly trading-week grouping and monthly trading-month grouping. Neither native UTC bucket arithmetic nor present-day CME hours resolves those decisions. The current seven inputs remain 5m/10m/1h/4h/session/weekly/monthly; no silent substitution or higher-degree dependency gating.

## Existing Engine 22 sidecar compatibility

PR #110 inspected at `df43d31a513110904fd1a33e55c6b92eae720ee3`: `services/core/logic/engine22/v3/inspectEngine11SourceIdentityShadow.js`. It accepts source V2 dataset/page identities and always returns shadowOnly/sourceIdentityOnly, structurally ineligible results. It checks dataset pinning, observation/receipt/row/source-key/revision equality, resolution, binding, basis and roll evidence. This package does not alter that file or force its flags to true.

Raw V2 pages can describe identity evidence, not completed analytical intervals. Any future analytical schema adapter and structural migration requires separate Engine 22 acceptance. Existing provisional `ES:timeframe:timestamp` node IDs cannot prove full contract/revision lineage. Approved prices, timestamps/precision, locks, count identity and Fib geometry remain exact; no snapping, automatic adjustment or anchor promotion.

## One concise Engine 22 question packet, routed through Engine 2B

1. For each independent degree, record earliest required wave origin/approved anchor, minimum completed bars, warm-up and confirmation windows. Which degrees can accept the two-year target, and which must remain unavailable?
2. Confirm accepted source price basis/contract lineage for new evidence and separately characterize existing approved manual anchors; unknown anchor basis remains unknown, with no price changes.
3. Ratify the exact session/weekly/monthly interval policies and any short final-bar treatment before structural-source approval.
4. Confirm proposed analytical-source schema/identity adapter requirements alongside #110's source-only sidecar, preserving V3 shadow boundaries and protected Engine 27 contracts.
5. Establish source-to-anchor reconciliation acceptance and protected regression requirements. Candle availability never grants count, lifecycle or Fib promotion authority.

Engine 11 proposes no structural answers on Engine 22's behalf. Lead Manager coordinates this packet; Brian need not shuttle individual technical questions.

## Separate, faster path to approved Fibonacci chart preview

The full two-year historical source does **not** need to be the initial preview source. Engine 2B may separately authorize a read-only preview using its existing chart candles and the existing approved Engine 22 Fib payload. This package supplies planning and payload-integrity tests only; no UI preview is created.

Before mounting: Engine 2B/22 confirm the exact approved payload path, approval/count identity, price basis, current chart contract and verified timestamp convention. Copy approved prices/precision/locks unchanged. If existing Fib basis is unresolved, retain that state and obtain Engine 22's decision; do not offset prices to fit the chart. Shadow/provisional Fib cannot be presented as official geometry. Date-only anchors are not assigned invented times.

Proposed isolated preview steps owned by Engine 2B: pin the existing source and approved overlay; draw read-only price lines/labels; use anchor positions only where time precision is verified; test zoom, scrolling, timeframe changes and refresh; preserve visible range and avoid timeline expansion; race-protect requests and live updates; demonstrate predictable 25,000-bar memory/eviction/re-page behavior; provide independent rollback before any wider migration.

T24–T27 remain mandatory chart acceptance tests. Version/basis pinning and raw payload preservation are tested here with explicitly synthetic approved-Fib fixtures; real UI zoom/scroll/memory/race tests have **not** been executed. The later source capacity target remains 1,000 viewers; no performance claim or latency target approval is made by these contract tests.

Requested next gate: Engine 2B may authorize this narrow current-source/approved-Fib preview independently of the historical-candle cutover, after resolving its basis/authority requirements. Chart rendering work stays Engine 2B's assignment; it is not authorized by this Engine 11 planning package.
