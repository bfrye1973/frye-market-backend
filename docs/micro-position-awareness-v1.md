# Micro Position Awareness v1

Read-only comparison between Engine 22 Micro structure and canonical Engine 10 OPEN ES/MES-family positions.

## Position truth

Engine 10 remains the durable position/journal owner.

Both PAPER and REAL OPEN trades are eligible for awareness. ES and MES are normalized to the same ES-family market exposure for Micro comparison.

The awareness layer may read:
- tradeId
- account mode
- journal account
- direction
- remaining quantity
- average entry
- open time
- futures contract code

It does not move those facts into Engine 22 ownership.

## Conflict severity

```
NONE
LOW
MODERATE
HIGH
CRITICAL
```

Default mapping for an opposite-position conflict:

```
Micro SETUP_DEVELOPING      -> LOW
Micro REVERSAL_WINDOW       -> MODERATE
Micro TRANSITION_CONFIRMING -> HIGH
Micro TIMING_READY          -> HIGH
Micro TIMING_READY
 + Engine3 aligned
 + Engine4 aligned          -> CRITICAL
```

## Guidance

At HIGH/CRITICAL conflict:
- DO_NOT_ADD against the emerging Micro impulse
- REVIEW_EXISTING_POSITION_RISK
- require Micro impulse failure before favoring a new add in the conflicting direction

This is guidance only.

## Alerts

v1 publishes `alertsPreview`; it does not send notifications yet.

The next alert-delivery phase must deduplicate by:
- tradeId
- sourceCountId
- conflict severity / lifecycle transition

Repeated snapshot builds must not create repeated alerts.

## Training

Each observation publishes training tags for:
- Micro active wave
- Micro timing state
- position conflict severity
- do-not-add state

Replay can later measure adverse/favorable movement after each warning.

## Guardrails

```
noPermissionCreated: true
noPositionMutation: true
noOrderCreated: true
noSizingMutation: true
noManagementMutation: true
noExecution: true
noJournalMutation: true
```
