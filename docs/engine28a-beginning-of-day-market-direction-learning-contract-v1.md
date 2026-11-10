# Engine 28A — Beginning-of-Day Market Direction Learning Contract v1

**Status:** LOCKED RESEARCH REQUIREMENT  
**Mode:** READ-ONLY / SHADOW LEARNING ONLY  
**Production authority:** NONE  
**Owner approval required before any promotion**

## Purpose

Engine 28A must learn, day by day, whether the market is more likely to move UP, DOWN, or SIDEWAYS from the information that was actually available at the beginning of the decision window.

The purpose is not to create a deterministic prediction. The purpose is to build a calibrated probability model from repeated, timestamped observations and realized ES outcomes.

## Required beginning-of-day observation

Each observation must preserve the exact values known at the observation timestamp.

### 1. ES Master

Store:

- master score
- master state
- 10m score/state
- 30m score/state
- 1H score/state
- 4H component score/state
- EOD component score/state
- source timestamps for every timeframe
- freshness status
- production formula/version identifier

### 2. Standalone Engine 25 4H

Store:

- 4H score
- state
- trend strength
- breadth
- momentum
- squeeze PSI
- EMA structure flags
- timing penalty
- timing reason codes
- source timestamp

### 3. Reconstructed EOD structural score

Store:

- reconstructed EOD score
- sector breadth/momentum inputs
- reconstruction formula version
- latest fully completed EOD date
- source timestamp
- explicit flag that the value is reconstructed/shadow, not production authority

The frozen v1 reconstruction currently uses:

- Breadth: 10-day high/low structure with short carry
- Momentum: 4-session close move versus exactly 3x 20-session Average Daily Range, current day included

No historical cell must match the legacy spreadsheet exactly. The requirement is stable, similar structural behavior.

### 4. Combined permission score

Store:

- combined score
- component scores
- component weights
- permission label

Current research weighting candidate:

- ES Master: 65%
- standalone 4H: 20%
- reconstructed EOD: 15%

This weighting remains a research candidate until validated on a larger sample.

### 5. Engine 22 Micro wavelength

Store the canonical Micro state known at the observation time:

- sourceCountId
- canonical state version / revision
- source timestamp
- active wave
- wave direction
- lifecycle
- micro timing state
- count status
- key Fibonacci levels
- invalidation level
- current price position within the active wave
- automation eligibility if present

### 6. Engine 22 Submicro wavelength

Store the canonical Submicro state known at the observation time:

- sourceCountId
- revision
- source timestamp
- active wave
- wave direction
- lifecycle
- timing state
- count status
- key Fibonacci levels
- invalidation level
- current price position within the active wave

### 7. Micro/Submicro alignment

Derive and store one alignment classification:

- ALIGNED_UP
- ALIGNED_DOWN
- CONFLICT
- ONE_UNAVAILABLE
- BOTH_UNAVAILABLE

Also preserve the raw Micro and Submicro directions so the derived label can always be audited.

## Outcome labels

For every observation, Engine 28A must later measure the realized ES outcome without changing the original observation.

Minimum horizons:

- +10 minutes
- +30 minutes
- +60 minutes
- end of session

For each horizon store:

- observed ES price
- signed move from observation price
- maximum favorable excursion
- maximum adverse excursion
- UP / DOWN / SIDEWAYS outcome label
- completeness flag

For beginning-of-day learning, also store:

- session high after observation
- session low after observation
- session close
- maximum upside excursion
- maximum downside excursion
- dominant session direction
- reversal/continuation/range classification

## Probability outputs

After sufficient clean observations exist, Engine 28A may calculate research-only calibrated probabilities such as:

- UP probability
- DOWN probability
- SIDEWAYS probability
- confidence / sample-quality indicator

Probability output must retain the contributing state, sample size, and model/version identifier.

## No-hindsight requirements

1. Every feature must have an as-known timestamp.
2. No future candle, later wave revision, later EOD value, or later ES Master value may enter the observation.
3. For intraday decisions, use the most recent source snapshot available before the decision cutoff.
4. A completed EOD value from the same session may not be used for a morning prediction.
5. Historical wave counts may not be reconstructed from later revisions and presented as if they were known earlier.
6. Missing or stale data must be recorded as unavailable/stale, never silently backfilled with future information.

## Learning safety

This contract follows the existing Engine 28A replay-learning safety model:

- read-only learning
- canonical observation deduplication
- no automatic production-rule changes
- no automatic threshold optimization
- no permission creation
- no sizing authority
- no execution authority
- manager/owner approval required before any promotion

## Required daily journal identity

Each observation must have a stable identity containing at least:

- session date
- observation timestamp
- ES Master source timestamp
- 4H source timestamp
- EOD source date/timestamp
- Micro sourceCountId + revision
- Submicro sourceCountId + revision

Repeated cron snapshots carrying the same canonical state must not manufacture additional sample size.

## Initial research question

Engine 28A should first answer:

> Given ES Master, standalone 4H, reconstructed EOD, Micro wavelength, Submicro wavelength, and Micro/Submicro alignment as known at the beginning of the decision window, what is the observed probability that ES moves UP, DOWN, or SIDEWAYS over the next 10, 30, 60 minutes and through the remainder of the session?

This requirement is locked as the next learning architecture for Engine 28A.
