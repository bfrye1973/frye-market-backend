# Engine 27 V3 — Module 27.1 Programmer Handoff
Status: ISOLATED IMPLEMENTATION; NOT PRODUCTION ACCEPTED. Manager approval not requested until complete Micro package.

## Branch and isolation
Branch: engine27-v3-micro-intelligence; base main. Only v3/ files modified. No Engine22, A-E, V2, Engine6/8/9/10, frontend, or production wiring changed.

## Files
- contracts/priceActionFib.v1.js — schema engine27.v3.priceActionFib.v1, immutable ownership metadata.
- priceActionFib/adaptEngine22Micro.js — explicit owner v1 source selector; ES symbol; 10m OHLC Unix epoch bar-start time, 10m elapsed-close check, strict order, OHLC range and staleness.
- priceActionFib/evaluatePriceActionFib.js — read-only Micro price/level touch observations; no wave-completion claim; no eligible next objective while owner levels are provisional.
- tests/priceActionFib.test.js — 13 focused source/negative tests.
- AUDIT-2026-10-25.md — production contract audit.

## Inputs
snapshot.symbol = ES; snapshot.strategies['intraday_scalp@10m'].engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroCDown (version engine22.microCDownOwnerWatch.v1); independently supplied ES 10m OHLC bars with {time: epochSecondsBarStart,open,high,low,close}; sourceSymbol ES; evaluatedAt ISO; maxAgeMs.
Caller must verify ES contract provenance before supplying ES bars; no production wiring currently exists.

## Output
schema=engine27.v3.priceActionFib.v1; state UNAVAILABLE|AWAITING_REACTION|UNCONFIRMED_TOUCH; ownerModelIdentity deterministic from owner version/anchors/ladder; nextReferenceLevel explicitly provisional; nextObjective always null; evidence with last completed-bar end and touch class. Trade permissions/management/execution absent.

## Tests
13 local Node tests passed (node --test tests/priceActionFib.test.js with local equivalent working tree). GitHub branch CI not yet verified. No production regression suite executed.

## Dependencies still unresolved
1. Verify exact canonical ES completed-candle source path and contract identity in production before feeding V3.
2. Compare live Engine22 Micro owner/touch snapshot to owner C-down v1 and qualify exact target after approved owner confirmation rule exists.
3. Add owner-confirmed hold/failure transition only when actual Engine22 authority provides a rule; never infer from a touch.
4. Confirm full Micro Journal entry structural data and official Engine9 management joining in modules 27.4/27.5.
5. Run existing V2/A-E regression suite through GitHub CI.
6. Expand all seven separate configurations after Micro accepted.

## Backward compatibility
Isolated additive files; no import in production snapshot builder and no trading engine changes. No migration or deploy approved.
