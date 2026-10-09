# Micro Replay Learning v1

Offline, read-only training/evaluation layer for the Micro trading copilot.

## Inputs

Canonical immutable Engine 12 ES Replay snapshots only.

The evaluator reads already-published:
- Engine 22 Micro count / wave / lifecycle / timing state
- Micro A++ negotiated-midline confluence
- Micro position-conflict context
- Engine 26 candidate/location
- Engine 3 reaction
- Engine 4 participation
- Engine 6 permission
- current price

## Event identity and deduplication

Training events are deduplicated from canonical Micro identity:
- sourceCountId
- revision
- sourceTimestamp
- A++ state
- position-conflict severity

Repeated cron builds of the same canonical observation cannot manufacture sample size.

## Forward evaluation

Initial horizons:
- +10 minutes
- +30 minutes
- +60 minutes
- end of session

For Micro-direction events:
- move in Micro direction
- MFE
- MAE

For position-conflict warnings:
- move for the existing position
- move against the existing position

## Analysis groups

- all Micro timing events
- A++ negotiated-midline events
- position-conflict events
- W2 -> W3 transition events
- W4 -> W5 transition events

## Safety / training governance

This evaluator is measurement-only.

It may surface evidence for future rule changes, but:
- cannot edit thresholds,
- cannot mutate lifecycle rules,
- cannot change Engine 26 identity,
- cannot change Engine 3/4 gates,
- cannot change Engine 6 permission,
- cannot change sizing, management, or execution.

Any future learned rule requires:
1. sufficient sample size,
2. separate training and validation windows,
3. no look-ahead leakage,
4. baseline comparison,
5. Manager review,
6. explicit version,
7. rollback target.
