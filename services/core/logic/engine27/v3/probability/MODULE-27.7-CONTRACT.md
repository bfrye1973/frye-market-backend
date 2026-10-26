# Engine 27 V3 — Module 27.7 ES Probability Intelligence
Status: DEVELOPMENT / SHADOW ONLY — October 26, 2026

## Locked objective
Predict ES UP, DOWN, or SIDEWAYS over 10 minutes initially; extend to 30 and 60 minutes only after the first horizon is validated. Evidence comes read-only from canonical Engine 22, Engine 25, Engine 29, verified ES price action and QQQ/VIX alignment. Engine 3/4 and Engine 10/12 may contribute only after provenance and historical point-in-time availability are verified.

## Strict separation
The initial equal-weight evidenceScore ranges from -100 to +100 and is **not** a probability, success rate, or calibrated confidence. UP/DOWN/SIDEWAYS probabilities remain null until sufficient point-in-time historical data, outcome labeling, walk-forward holdouts and calibration tests pass. Never derive a percentage from the score. Missing/stale inputs reduce coverage; no backfilling invented data.

## Calibration prerequisites
1. Define exact 10-minute ES outcome: predetermined positive/negative point threshold; otherwise SIDEWAYS. Record continuous contract/roll conventions.
2. Freeze evidence snapshot with observedAt <= prediction asOf and source freshness per owner contract.
3. Persist immutable prediction ID, evidence identity and timestamp before future ES outcome is known.
4. Label only with later verified ES prices, with no lookahead or revision of predictions.
5. Split chronological train/validation/test windows, avoid overlap leakage, report confusion matrix, Brier score, calibration curves, sample counts, regime slices and baseline comparisons.
6. Require minimum coverage and sufficient samples per class before exposing calibrated percentages; mark UNAVAILABLE otherwise.
7. Preserve Engine 22 count ownership, Engine 25/29 context, Engine 10 Journal and Engine 6/8 trade permissions.

## Current code
evaluateEsDirectionalProbability.js implements the fail-closed, uncalibrated baseline with explicit coverage and null probabilities. It is not yet wired into the live dashboard, has not been trained and does not generate alerts or orders. Do not merge or deploy as production intelligence without separate acceptance.
