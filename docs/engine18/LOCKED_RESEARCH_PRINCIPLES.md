# ENGINE 18 — LOCKED RESEARCH PRINCIPLES
Recorded 2026-11-10. This document records owner direction and Claude/GPT-6 design agreements, NOT validated trading performance. Changes require a reviewed revision. No automatic trading.

## Mission
Predict three distinct questions: (1) will ES reach a level within a defined horizon; (2) if touched, will it reject before breaking; (3) how far might price react and with what risk. No numerical probabilities until calibrated and independently validated.

## Locked lessons
1. **Liquidity levels come from actual market book observations, never price candles or Fibonacci levels.** Engine 11 candles are context/outcome data, not liquidity truth. Engine 22 owner-approved waves/fibs may be separately tested as contextual factors.
2. **Never move an established liquidity zone merely because ES price moves.** Use fixed absolute ES tick ranges and unique zone IDs. Track forming, active, approached, tested, depleted, broken, inactive and out-of-coverage states; do not call historical levels currently resting.
3. **Coverage is explicit.** Ironbeam v2 demo ESZ26 delivered 10 nonzero bid and 10 nonzero ask levels in each of 93 sampled accepted images. This is NOT full-depth or verified real-time. Distinguish observed nonzero, observed zero, outside coverage, invalid feed, unknown.
4. **Verify exact feed semantics first.** Current parser may misread partial updates as full books, drops zero-size rows and incompletely handles level-index and implied-count fields. Audit delta-vs-snapshot behavior, deletes, sequence, timestamps, levels, gaps and delay before trusting output.
5. **Record authorized raw quotes, depth and trades durably BEFORE processing.** Preserve original fields, event/vendor/local receipt clocks, stream generation, recovery/gap/subscribe events, source contract and schema version. Render in-memory history is not durable. Respect market-data licensing and credentials.
6. **Persistence is elapsed time and survival as ES approaches, NOT three messages.** Evaluate time-weighted depth, persistent quantities, add/pull/refill and execution, adjusted for distance from touch, session/time and volatility. Current minObservations=3 and 180-image cache are not evidence of strong liquidity.
7. **Raw resting size alone is not a trading signal.** Normalize by expected depth at comparable distance and session. Aggregate adjacent observed ticks into genuinely anchored zones. A 38-contract line is not necessarily institutional liquidity.
8. **Keep aggregated Level 2 separate from Level 3 MBO.** L2 price/size/order count cannot identify individual order cancellations or hidden stops. Reconcile trades and changing depth but preserve uncertainty. Native and synthetic iceberg evidence differ; do not claim exact detection without data.
9. **Historical MBO requires accurate vendor semantics.** Use event batching and F_LAST, Clear, snapshot, exchange sequence and gap recovery. Compare MBO-derived L2 parity only for semantically equivalent book quantities; implied depth may differ from outright MBO. Historical Databento MBO has NOT yet been bought. Rithmic live MBO is NOT connected.
10. **Contract and point-in-time integrity:** physical instrument/contract, event time, receive time and feature-availability time are distinct. Never mix continuous adjusted Engine 11 bars with an exchange book without reconciliation or train with information observed after a prediction.
11. **Research labels must be pre-registered.** Evaluate reach, rejection after contact and reaction distance separately. Triple barriers with time limits are a proposed starting point, not finalized. Use identical events for price-only and order-book models, guarding against overlap, selection bias and lookahead.
12. **Validate before showing probabilities.** Chronological walk-forward holdouts, calibration, session-block uncertainty, comparisons to random/price-only/simple-depth levels, and economics after costs. Stop if the extra book information does not improve out-of-sample performance.
13. **Reuse other engines without modifying their source of truth:** Engine 11 price; Engine 22 waves/fibs; Engine 16 research; Engine 2 chart; Engine 18 liquidity. Extra markets/ES options later, only if incremental performance is verified.
14. **Owner wants an uncluttered LIVE chart:** maximum TWO BUY and TWO SELL zones. Chart display cap must never limit research candidate evaluation. No further LIVE chart algorithm changes before Gate 2 shadow validation.
15. **Security:** no public raw licensed exchange data or secrets. Ironbeam demo credentials were previously exposed in chat; rotation status requires confirmation.

## Verified baseline
- Ironbeam v2 demo instrument XCME:ES.Z26 receives quotes/depth/trades; current detector scores depth only.
- Existing detector uses 1.5x median resting size, three image observations, max 180 recent images, bounded memory; it is research-only and not validated.
- Sample of 93 accepted images: each showed 10 bids and 10 asks (nonzero parsed levels).
- Existing LIVE chart displays max two zones per side; stabilization is cosmetic and not proof of persistence.
- Isolated Engine 18 Render monitor: https://frye-engine18-liquidity-research.onrender.com/monitor

## Agreed gated work
Gate 1: confirm feed semantics, build durable recorder, canonical MBP/MBO event contracts, exact reconstruction/gap/clock tests; Claude drafts reconstruction spec and GPT-6 reviews.
Gate 2: price-anchored zone registry, time-based persistence, normalized depth, shadow validation.
Gate 3: join executed trades and depth; classify consumption/refill/pull/uncertainty honestly.
Gate 4: define point-in-time triple-barrier and reaction labels; Claude reviews GPT-6 label spec.
Gate 5: owner-approved historical MBO sample and parity, then more data if justified; out-of-sample baseline experiments.
Gate 6: calibrated shadow predictions; live chart enhancement only after demonstrated results. No trading authority.

## Open questions — do not guess
- User typical holding period and stop size for label horizons.
- Ironbeam full-vs-incremental frames, zero deletes, level-index semantics, session coverage and demo delay.
- Durable storage retention/license/cost and key rotation status.
- Rithmic API access, historical Databento MBO pricing/availability.

Source basis: project owner's Claude design feedback and directly examined Engine 18 implementation; this file does not claim that vendor semantics or prediction accuracy have been fully verified.