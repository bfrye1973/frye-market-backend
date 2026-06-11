// services/core/logic/engine22/wave/lifecycle/downImpulseLifecycle.js
//
// Engine 22D — Down Impulse Lifecycle
//
// Purpose:
// Read-only classifier for a completed downside impulse after ABC_UP / W2-C bounce failure.
//
// This is used after the market has moved beyond "W3 down watch" and has completed
// a full 1-2-3-4-5 downside sequence.
//
// Example current teaching:
// - ABC_UP / W2-C bounce completed at 7500.
// - Downside impulse completed with Minor/Minute W5 low near 7271.
// - Current rally should be treated as corrective bounce / reclaim test,
//   not as a fresh automatic long.
//
// Safety:
// - Does not execute trades.
// - Does not create shorts.
// - Does not create longs.
// - Does not change Engine 6 permission.
// - Does not make anything tradeable.

import {
toNum,
roundToTick,
tickSizeForSymbol,
} from "./lifecycleUtils.js";

function normalizeDownImpulseMarks(marks = null) {
if (!marks || typeof marks !== "object") {
return {
w1Low: null,
w1Time: null,
w2High: null,
w2Time: null,
w3Low: null,
w3Time: null,
w4High: null,
w4Time: null,
w5Low: null,
w5Time: null,
};
}

return {
w1Low: toNum(marks.w1Low ?? marks.W1_LOW ?? marks?.w1?.low ?? marks?.w1?.price),
w1Time: marks.w1Time ?? marks.W1_TIME ?? marks?.w1?.time ?? null,

```
w2High: toNum(marks.w2High ?? marks.W2_HIGH ?? marks?.w2?.high ?? marks?.w2?.price),
w2Time: marks.w2Time ?? marks.W2_TIME ?? marks?.w2?.time ?? null,

w3Low: toNum(marks.w3Low ?? marks.W3_LOW ?? marks?.w3?.low ?? marks?.w3?.price),
w3Time: marks.w3Time ?? marks.W3_TIME ?? marks?.w3?.time ?? null,

w4High: toNum(marks.w4High ?? marks.W4_HIGH ?? marks?.w4?.high ?? marks?.w4?.price),
w4Time: marks.w4Time ?? marks.W4_TIME ?? marks?.w4?.time ?? null,

w5Low: toNum(marks.w5Low ?? marks.W5_LOW ?? marks?.w5?.low ?? marks?.w5?.price),
w5Time: marks.w5Time ?? marks.W5_TIME ?? marks?.w5?.time ?? null,
```

};
}

export function buildDownImpulseLifecycle({
symbol = "ES",
degree = "minor",
currentPrice = null,
abcUp = null,
downImpulseMarks = null,
} = {}) {
const tickSize = tickSizeForSymbol(symbol);
const price = toNum(currentPrice);

const marks = normalizeDownImpulseMarks(downImpulseMarks);

const originLow = toNum(abcUp?.originLow);
const structuralBLow = toNum(abcUp?.effectiveWaveBLow);
const waveCHigh = toNum(abcUp?.waveCHigh);

const abcUpComplete = abcUp?.state === "ABC_UP_COMPLETE";
const manualCMarked = waveCHigh !== null && waveCHigh > 0;

const w1Marked = marks.w1Low !== null && marks.w1Low > 0;
const w2Marked = marks.w2High !== null && marks.w2High > 0;
const w3Marked = marks.w3Low !== null && marks.w3Low > 0;
const w4Marked = marks.w4High !== null && marks.w4High > 0;
const w5Marked = marks.w5Low !== null && marks.w5Low > 0;

const impulseStarted = w1Marked || w2Marked || w3Marked || w4Marked || w5Marked;
const impulseComplete = w5Marked;

const reclaimedStructuralB =
price !== null &&
structuralBLow !== null &&
price >= structuralBLow;

const reclaimedOrigin =
price !== null &&
originLow !== null &&
price >= originLow;

const belowWaveCHigh =
price !== null &&
waveCHigh !== null &&
price < waveCHigh;

const reclaimedWaveCHigh =
price !== null &&
waveCHigh !== null &&
price >= waveCHigh;

const aboveW5Low =
price !== null &&
marks.w5Low !== null &&
price > marks.w5Low;

const belowOrAtW5Low =
price !== null &&
marks.w5Low !== null &&
price <= marks.w5Low;

if (!abcUpComplete || !manualCMarked) {
return {
active: false,
state: "DOWN_IMPULSE_NOT_APPLICABLE",
readOnly: true,
direction: "NONE",
tradeableOpportunityBlocked: true,
noExecution: true,

```
  degree,
  abcUpComplete,
  manualCMarked,
  impulseStarted,
  impulseComplete,

  currentPrice: price !== null ? roundToTick(price, tickSize) : null,
  originLow: originLow !== null ? roundToTick(originLow, tickSize) : null,
  structuralBLow:
    structuralBLow !== null ? roundToTick(structuralBLow, tickSize) : null,
  waveCHigh: waveCHigh !== null ? roundToTick(waveCHigh, tickSize) : null,

  marks: {
    w1Low: marks.w1Low !== null ? roundToTick(marks.w1Low, tickSize) : null,
    w1Time: marks.w1Time,
    w2High: marks.w2High !== null ? roundToTick(marks.w2High, tickSize) : null,
    w2Time: marks.w2Time,
    w3Low: marks.w3Low !== null ? roundToTick(marks.w3Low, tickSize) : null,
    w3Time: marks.w3Time,
    w4High: marks.w4High !== null ? roundToTick(marks.w4High, tickSize) : null,
    w4Time: marks.w4Time,
    w5Low: marks.w5Low !== null ? roundToTick(marks.w5Low, tickSize) : null,
    w5Time: marks.w5Time,
  },

  read:
    "Down impulse lifecycle is not applicable yet. ABC_UP must be complete with marked C high first.",
  reasonCodes: [
    "DOWN_IMPULSE_LIFECYCLE_BUILT",
    "DOWN_IMPULSE_NOT_APPLICABLE",
    abcUpComplete ? "ABC_UP_COMPLETE" : "ABC_UP_NOT_COMPLETE",
    manualCMarked ? "MANUAL_C_MARKED" : "MANUAL_C_NOT_MARKED",
    "READ_ONLY",
    "NO_EXECUTION",
    "DIRECTION_NONE",
  ],
};
```

}

if (!impulseStarted) {
return {
active: false,
state: "DOWN_IMPULSE_MARKS_UNAVAILABLE",
readOnly: true,
direction: "NONE",
tradeableOpportunityBlocked: true,
noExecution: true,

```
  degree,
  abcUpComplete,
  manualCMarked,
  impulseStarted,
  impulseComplete,

  currentPrice: price !== null ? roundToTick(price, tickSize) : null,
  originLow: originLow !== null ? roundToTick(originLow, tickSize) : null,
  structuralBLow:
    structuralBLow !== null ? roundToTick(structuralBLow, tickSize) : null,
  waveCHigh: waveCHigh !== null ? roundToTick(waveCHigh, tickSize) : null,

  marks: {
    w1Low: null,
    w1Time: null,
    w2High: null,
    w2Time: null,
    w3Low: null,
    w3Time: null,
    w4High: null,
    w4Time: null,
    w5Low: null,
    w5Time: null,
  },

  read:
    "ABC_UP is complete, but downside impulse marks are not available yet. Preserve W3_DOWN rows before classifying completed Minor 5 down.",
  reasonCodes: [
    "DOWN_IMPULSE_LIFECYCLE_BUILT",
    "DOWN_IMPULSE_MARKS_UNAVAILABLE",
    "ABC_UP_COMPLETE",
    "MANUAL_C_MARKED",
    "READ_ONLY",
    "NO_EXECUTION",
    "DIRECTION_NONE",
  ],
};
```

}

let state = "DOWN_IMPULSE_IN_PROGRESS";
let read =
"Downside impulse marks are present but W5 low is not marked yet. Treat as downside impulse in progress. Read-only only.";
let nextExpectedStructure = "WAIT_FOR_W5_LOW_OR_RECLAIM";

if (impulseComplete && reclaimedWaveCHigh) {
state = "POST_MINOR_5_BOUNCE_INVALIDATION_RISK";
read =
"Minor downside impulse completed, but price reclaimed the prior C high. Downside impulse read is at invalidation risk. Read-only only.";
nextExpectedStructure = "REVIEW_DOWNSIDE_IMPULSE_COUNT";
} else if (impulseComplete && aboveW5Low && belowWaveCHigh) {
state = "POST_MINOR_5_CORRECTIVE_BOUNCE_WATCH";
read =
"Minor downside impulse completed at the marked W5 low. Current rally is treated as corrective bounce / reclaim test, not a fresh automatic long.";
nextExpectedStructure = "WATCH_A_B_C_CORRECTIVE_BOUNCE";
} else if (impulseComplete && belowOrAtW5Low) {
state = "MINOR_DOWN_IMPULSE_COMPLETE_AT_LOW";
read =
"Minor downside impulse is marked complete at W5 low. Price is still near or below the completed impulse low. Watch for bounce attempt or extension risk.";
nextExpectedStructure = "WATCH_BOUNCE_OR_EXTENSION";
}

return {
active: false,
state,
readOnly: true,
direction: "NONE",
tradeableOpportunityBlocked: true,
noExecution: true,

```
degree,
abcUpComplete,
manualCMarked,
impulseStarted,
impulseComplete,

currentPrice: price !== null ? roundToTick(price, tickSize) : null,

originLow: originLow !== null ? roundToTick(originLow, tickSize) : null,
structuralBLow:
  structuralBLow !== null ? roundToTick(structuralBLow, tickSize) : null,
waveCHigh: waveCHigh !== null ? roundToTick(waveCHigh, tickSize) : null,
cTime: abcUp?.cTime || null,

reclaimedStructuralB,
reclaimedOrigin,
belowWaveCHigh,
reclaimedWaveCHigh,
aboveW5Low,
belowOrAtW5Low,

marks: {
  w1Low: marks.w1Low !== null ? roundToTick(marks.w1Low, tickSize) : null,
  w1Time: marks.w1Time,
  w2High: marks.w2High !== null ? roundToTick(marks.w2High, tickSize) : null,
  w2Time: marks.w2Time,
  w3Low: marks.w3Low !== null ? roundToTick(marks.w3Low, tickSize) : null,
  w3Time: marks.w3Time,
  w4High: marks.w4High !== null ? roundToTick(marks.w4High, tickSize) : null,
  w4Time: marks.w4Time,
  w5Low: marks.w5Low !== null ? roundToTick(marks.w5Low, tickSize) : null,
  w5Time: marks.w5Time,
},

completedLow:
  marks.w5Low !== null ? roundToTick(marks.w5Low, tickSize) : null,
completedTime: marks.w5Time || null,

nextExpectedStructure,
read,

reasonCodes: [
  "DOWN_IMPULSE_LIFECYCLE_BUILT",
  "ABC_UP_COMPLETE",
  "MANUAL_C_MARKED",
  impulseStarted ? "DOWN_IMPULSE_MARKS_FOUND" : null,
  impulseComplete ? "MINOR_W5_LOW_MARKED" : "MINOR_W5_LOW_PENDING",
  reclaimedStructuralB ? "PRICE_RECLAIMED_STRUCTURAL_B" : null,
  reclaimedOrigin ? "PRICE_RECLAIMED_ORIGIN" : null,
  belowWaveCHigh ? "PRICE_BELOW_C_HIGH" : null,
  reclaimedWaveCHigh ? "PRICE_RECLAIMED_C_HIGH" : null,
  aboveW5Low ? "PRICE_ABOVE_COMPLETED_W5_LOW" : null,
  belowOrAtW5Low ? "PRICE_AT_OR_BELOW_COMPLETED_W5_LOW" : null,
  state,
  "READ_ONLY",
  "NO_EXECUTION",
  "DIRECTION_NONE",
].filter(Boolean),
```

};
}
