# Engine 22 Micro Lifecycle V2 — Locked Architecture Contract

Status: **Manager-approved architecture baseline**

Implementation sequence:
1. Canonical durable Micro state schema
2. Generalized W1–W5 lifecycle reducer
3. Append-only transition history
4. Recount / invalidation / new-count rules
5. Intrabar Fib-touch stream separate from completed-5m confirmation evidence
6. `microExecutionContext` machine projection
7. Align `currentWavelength` and `engine22Display` to the same canonical count
8. Replay/live equivalence
9. Engine 26 read-only timing integration
10. Paper automation acceptance

## Frozen ownership

```
Engine 22 Micro = canonical Elliott timing / lifecycle only
Engine 26       = Strategy 1 setup identity + location
Engine 3        = reaction confirmation
Engine 4        = participation confirmation
Engine 6        = final permission
Engine 7        = sizing
Engine 9        = management
Engine 8        = execution
Engine 10       = journal
```

Engine 22 Micro must never create permission, sizing, execution, management, or journal authority.

## One authoritative Micro state

There is exactly one canonical durable Micro state per active count.

```
canonical durable Micro state
        +
new valid observations
        ↓
deterministic Engine 22 projection builders
        ↓
degreeStates
currentWavelength
microExecutionContext
engine22Display
```

The projections must not independently decide structure.

## Canonical identity

Every active Micro count must carry:

- `countId`
- `sequenceId`
- `canonicalStateVersion`
- `revision`
- `degree: MICRO`
- `sequenceDirection`
- parent degree/wave/direction
- canonical origin
- source timestamp
- count status

Locked anchors are immutable inside the same `countId`.

A legitimate recount creates a new `countId`; prior locked anchors move to history and cannot contaminate the new count.

## Generalized W1–W5 lifecycle

Every wave uses the same lifecycle:

```
DEVELOPING
→ COMPLETION_CANDIDATE
→ CONFIRMED
→ LOCKED
```

Activation chain:

```
W1 LOCKED → W2 active
W2 LOCKED → W3 active
W3 LOCKED → W4 active
W4 LOCKED → W5 active
W5 LOCKED → MICRO_SEQUENCE_COMPLETED / parent review
```

W5 completion publishes a parent review event only. It does not automatically promote or complete the parent degree.

## Evidence separation

```
Fib touch
= raw intrabar high/low may mark TOUCHED

Wave lifecycle transition
= completed 5m structural evidence only
```

Fib touch must never prove wave completion.

No missing, stale, duplicate, or out-of-order observation may advance lifecycle state.

## Timing projection

Future machine contract:

```
engine22WaveStrategy.microExecutionContext
```

This is an additive machine-facing projection only. It must expose `sourceCountId`, `canonicalStateVersion`, and `sourceTimestamp` so downstream consumers can reject mixed-state snapshots.

Approved timing states:

```
OBSERVE
SETUP_DEVELOPING
REVERSAL_WINDOW
TRANSITION_CONFIRMING
TIMING_READY
INVALIDATED
RECOUNT_REQUIRED
```

`TIMING_READY` means only that Engine 22 has confirmed structurally valid Micro timing for downstream validation. It never means trade permission.

## Acceptance gates before Strategy 1 automation may consume Micro

1. W1–W5 use one deterministic lifecycle implementation.
2. Locked anchors cannot repaint or regress within one `countId`.
3. Authorized recounts cannot inherit old locked state.
4. Intrabar Fib touches stay separate from completed-5m lifecycle confirmation.
5. Replay and live processing produce equivalent transitions from equivalent observations.
6. All projections agree on the same `countId`.
7. Duplicate, missing, stale, and out-of-order observations fail closed.
8. No Engine 22 timing state changes permission, sizing, management, execution, or journal behavior.

## Migration rule

Existing production contracts remain additive and compatible during migration:

- `degreeStates` remains published.
- `currentWavelength` remains published.
- `engine22Display` remains published.
- existing downstream semantics are not silently renamed or repurposed.
- emergency restore/reset environment variables are migration-only and must not remain normal production authority.

No Engine 26 consumer may use V2 timing until all acceptance gates pass.


## Phase 3/4 durable count + recount contract

Canonical persistence is separated from lifecycle calculation.

Durable store layout:
- active canonical count snapshot
- immutable per-count snapshots
- append-only transition JSONL
- append-only recount JSONL

Normal lifecycle persistence may never cross a count boundary.

Only an explicitly authorized recount may:
1. close the prior count as HISTORICAL,
2. preserve its locked anchors and audit history,
3. create a distinct new countId/sequenceId,
4. start the new count clean at W1 DEVELOPING,
5. record the recount reason and provenance.

Approved recount reason codes:
- COMPLETED_CLOSE_INVALIDATION
- PARENT_DEGREE_INVALIDATION
- MICRO_W5_PARENT_HANDOFF
- DETERMINISTIC_RECOUNT_RULE
- MANAGER_AUTHORIZED_RECOUNT
- CORRUPT_OR_MISSING_STATE_RECOVERY

For non-manager/non-recovery recounts, the current count must already be INVALIDATED, RECOUNT_REQUIRED, or COMPLETE_PENDING_PARENT_HANDOFF.

A recount never inherits locked anchors from the prior count.
