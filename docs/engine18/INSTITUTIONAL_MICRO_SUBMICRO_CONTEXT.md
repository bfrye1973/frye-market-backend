# Engine 18 — Read-only Institutional / Micro / Submicro Context Integration
Owner request Nov 10, 2026. STATUS: Contract and source audit ONLY, NOT live-wired or validated prediction. No chart changes during Gate 1.

## Purpose
Engine18 must independently discover actual resting ES liquidity from CME/Ironbeam data. Existing institutional zones and Engine22 Micro/Submicro strategy cards are optional price-context/confluence features; they must NEVER fabricate order-book liquidity or trade authority.

## Existing verified source A: ES institutional zones
- Backend: GET https://frye-market-backend-1.onrender.com/api/v1/es-smz-levels?symbol=ES ; source services/core/routes/esSmzLevels.js (Engine 1B).
- Handler reads services/core/data/es-smz-manual-structures.json (runtime generated file; absent from repository main at audit). Converts structures[] to structures_sticky[] with symbol ES, type institutional, priceRange/displayPriceRange [high,low], strength 100, isNegotiated, locked, status, details.id. Missing file => empty result. Do not invent missing runtime records.
- LIVE frontend src/pages/rows/RowChart/overlays/SMZLevelsOverlay.jsx uses this ES-specific route and structures_sticky. DO NOT substitute SPY SMZ API.
- Generic smz-hierarchy filters to +/-40 points from current price for chart rendering; this is not a complete unfiltered historical feature universe.

## Existing verified source B: Engine22 Strategy cards
- Backend: GET https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES
- Same source used in Strategies UI: snapshot.strategies["intraday_scalp@10m"].engine22WaveStrategy
- Micro and Submicro currently published under engine22WaveStrategy.currentWavelength.degrees.micro and .degrees.submicro, with possible research alternatives and WATCH Fibonacci levels. Wave nodes also via engine22WaveStrategy.workingWaveNodes (schema engine22.workingWaveNodes.v1).
- Source schema, fingerprints, source revisions, owner Arizona times, scenario selection and approval status must be preserved exactly. See backend buildEngine22WorkingWaveNodesV1.js and frontend RowStrategies/index.jsx.
- No new wave calculations, no owner-approval changes, no overwrite of Engine22; price touch/research projection NOT trade permission.
- API snapshot retrieval time is NOT automatically the historical availability timestamp of a revised strategy model. Historical training requires actual point-in-time source/revision evidence, never hindsight backfills.

## Proposed read-only Engine18 context packet (not implemented)
- schema engine18.context.v1, symbol ES, physical contract and priceBasisStatus, source observed/available times, source IDs and immutable fingerprints.
- institutionalZones[]: stable source id, exact ES tick low/high, strength/tier/manual provenance, isNegotiated, source status, revision time.
- micro and submicro: degree, selected modelVersion/scenario and revision, owner anchor times/prices, approved/research classification, Fibonacci WATCH targets and ratio exactly as published.
- Missing/stale/version-conflicted/continuous-vs-physical contract mismatch => NULL/UNAVAILABLE, not fabricated zero/confluence.

## Research use and strict gates
- Score book-derived anchored liquidity separately; later test zone overlap/distance to institutionals and owner-approved Micro/Submicro Fib targets, plus directional context if supported by source.
- Compare liquidity-only, institutional-only, strategy-only, and combined features on the SAME pre-registered ES touch events; use chronological out-of-sample ablation and no lookahead. Owner belief that most action occurs near institutional zones is a hypothesis, not validated evidence.
- Ensure ESZ26 price basis reconciles with institutional levels and Engine22 targets before any confluence numeric feature; no chart-visible WATCH target may manufacture a liquidity wall.
- Research all eligible levels, not the two green/two red chart presentation cap.
- Gate1 focuses raw feed/clock/replay correctness; Gate2 price-anchored registry; Gate3 trade evidence; Gate4 contact labels; Gate5 evaluated context features; Gate6 validated chart presentation.
- No LIVE chart, Engine11 candle or Engine22 strategy modification in this contract.

## Proposed implementation task after manager gate
Create isolated, read-only source adapters + synthetic tests for both APIs: schema check, integer tick validation, stale revisions, price-basis mismatch, owner scenario alternatives, no institutional file, overlap/nonoverlap. Do not wire into LIVE trading or chart until Gate1 data and later research gates are accepted.