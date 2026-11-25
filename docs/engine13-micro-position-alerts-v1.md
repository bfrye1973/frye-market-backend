# Engine 13 Micro Position Alerts v1

## Purpose

Send progressive phone alerts when a canonical OPEN ES/MES-family position conflicts with Engine 22 Micro structure.

## Safety prerequisites

REAL-position alerts are fail-closed unless the matching Engine 8 Schwab observer account watermark is fresh.

Default maximum staleness:
```
120 seconds
```

Override:
```
ENGINE13_REAL_POSITION_MAX_STALENESS_SECONDS
```

PAPER positions do not require Schwab freshness.

## Alertable severity

```
MODERATE
HIGH
CRITICAL
```

LOW is dashboard/training context only.

## Progressive behavior

A durable Engine 13 ledger is keyed by:
```
tradeId + sourceCountId
```

The alert signature also includes:
- severity
- active wave
- Micro timing state
- remaining quantity
- position direction
- Micro direction

Repeated identical snapshots do not resend the same notice.

Severity upgrades may bypass the normal Pushover minimum interval.

The system may also emit:
```
CONFLICT_EASING
CONFLICT_RESOLVED
```

## Delivery

Engine 13 consumes the completed ES Strategy 1 snapshot after snapshot construction.

Notification delivery is non-authoritative. A Pushover failure cannot block the engine refresh pipeline.

## Ownership

Engine 22 = Micro structure truth.
Engine 10 = position truth.
Engine 8 Schwab observer = REAL broker-observation freshness.
Engine 13 = notification delivery only.

No alert may:
- mutate a position,
- create permission,
- change sizing,
- invoke management,
- create/cancel an order,
- mutate journal state.
