# Engine 22C — Phase B source evidence and qualification gate (2026-10-15)

Status: **DRAFT, READ-ONLY EVIDENCE**. Do not merge/deploy without Engine 2B acceptance.

## Authoritative source distinctions

- Runtime five-degree publisher: `wave/buildDegreeStates.js` (Subminute, Minute, Minor, Intermediate, Primary).
- Separate V3 canonical/shadow: `v3/canonicalStructure.js`, `v3/buildOwnerBootstrap.js`, `v3/buildShadowSnapshot.js` (including INTRADAY_SUBMICRO and MICRO). Presence of a V3 baseline count is NOT an approved Fibonacci model.
- Owner archival registry lives **only on separate draft backend PR #131**, branch `engine22-node-registry-phase1-evidence-20261013`, at `services/core/data/engine22/node-registry/`; it is **not in PR #139 or production main**. Do not import the registry from production snapshot jobs without a separately approved integration.
- PR #131 original evidence SHA-256: `6fb824cc5e8469bc66db004b903fbf3caf537d624ad18fcbc24a20815f9f40a8`. The owner-provided workbook `Engine22_Seven_Degree_Wave_Nodes_and_Fibs(4).xlsx` in this handoff has SHA-256 `79302f51eea0536a5ad9902a519ce93e952077a3ba9e5bf4076ec12ef98e4e6a`. They are **not byte-identical**; do not represent them as the same immutable evidence artifact.
- The uploaded workbook's `All Nodes` sheet contains newer Subminute W1-low 7616.25, W1-high 7847.00 and W2-low 7673.25. The manager separately locked these prices/timestamps. The workbook's older degree sheets and V3 approximate ~7700 W2 are not alternate authorized canonical anchors.
- Both the new workbook and PR #131 registry describe missing timezone, original continuous-futures adjustment/contract provenance and unverified raw ES contract equivalence.

## Exact known blockers

| Degree | Structural source | Outstanding evidence before official touched state |
|---|---|---|
| SUBMICRO | V3 `INTRADAY_SUBMICRO` baseline | Owner A/B vs workbook conflict; C unconfirmed; baseline Fib is provisional and uses assumed Micro A start; approval, original contract/basis/timezone absent |
| MICRO | V3 `MICRO` baseline | W1 low/high differ from workbook; V3 W1 high timestamp unknown; Fibonacci approval and source basis absent |
| SUBMINUTE | five-degree publisher, corrected wavelength owner anchors | Explicit canonical model approval/count ID/contract/basis/origin absent; do not inherit legacy Micro |
| MINUTE | five-degree publisher + V3 contextual read | Older W2-down manual vs new W3-up context conflict; model identity/approval/basis absent |
| MINOR | five-degree publisher | Owner/manual W1 and other prices conflict; model approval/basis absent |
| INTERMEDIATE | five-degree publisher | Owner/manual differences; model approval/basis absent |
| PRIMARY | five-degree publisher | Owner/manual differences; model approval/basis absent |

## Additional Engine 11 source-boundary finding

The draft `buildStrategySnapshot.js` currently labels ten-minute ES data `RAW_UNADJUSTED_CONTRACT` when `r.json.resolvedSymbol` exists, without receiving a distinct explicit `priceBasis` field from the OHLC response. The underlying `services/core/routes/futuresOhlc.js` fetches Polygon aggregates for a resolved individual ticker, but the mere existence of the symbol does not independently establish the historical workbook's price-basis or roll-adjustment equivalence. This is a **verification gap**, not permission to add a synthetic offset or certify historical touches. Source and contract lineage must be demonstrated before a model may qualify.

## Source-specific safety rules

1. Never set `approved:true` from the presence of chart coordinates, workbook Fib cells, or V3 shadow baseline IDs.
2. Use `engine22TouchResolvedContract` and `engine22TouchPriceBasis` supplied from the existing Engine 11 ten-minute ES response, never synthesize ESZ6 or roll adjustments.
3. Touch evidence must use completed, eligible bars of matching resolved contract and `RAW_UNADJUSTED_CONTRACT`.
4. Preserve model-keyed first touch persistence. A previous model's green status cannot follow a recount.
5. Keep C-low candidate separate from structurally confirmed Submicro C.
6. A degree lacking approval must remain unavailable/WATCH; eligible degrees can proceed independently.

## Changes in this PR

- `research/buildCanonicalSevenDegreeTouchSourcesV1.js`: opt-in seven-degree source adapter. V3 count/baseline cannot create Fib approval; five-degree Subminute's legacy Micro fallback cannot create canonical touch identity.
- `wave/buildEngine22WaveStrategy.js`: selector receives that adapter's isolated degree map; published legacy degree states remain untouched.
- `tests/engine22CanonicalSevenDegreeTouchSourcesV1.test.js`: blocks cross-degree inheritance and unapproved V3 promotion.
- `engine22-seven-degree-fib-touch-research.yml`: regression added to CI.

## Release evidence still outstanding

1. Formal Engine 22-approved model IDs and source-specific contract/basis for each degree (registry alone is insufficient).
2. Eligible real ES model → completed candle → persisted first touch → snapshot → seven frontend cards.
3. Production disk restart test; branch test does not prove live persistence.
4. Full backend/frontend/Engine27/execution safety regressions and Engine 2B final acceptance.

No changes to trading permission, broker routing, sizing, accounts, Engine 27, Journal or immutable Replay.
