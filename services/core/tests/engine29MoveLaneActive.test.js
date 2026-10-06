import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
} from "../logic/engine29/tacticalCharacter/moveCharacterConstants.js";
import {
  deriveAdaptiveDirectionalMove,
} from "../logic/engine29/tacticalCharacter/tacticalCharacterUtils.js";
import { resolveMoveCharacter } from "../logic/engine29/tacticalCharacter/resolveMoveCharacter.js";
import { resolveDirectionalMoveParent } from "../logic/engine29/tacticalCharacter/resolveDirectionalMoveParent.js";
import { resolveEngine29FastTacticalShift } from "../logic/engine29/aggregate/resolveFastTacticalShift.js";

const STEP = 30 * 60 * 1000;

function makeView({
  background = 48,
  backgroundMoves = [0.012, -0.010],
  tailMoves = [],
  stale = false,
} = {}) {
  let close = 7600;
  const bars = [{
    time: 1_790_000_000_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    completed: true,
  }];

  const moves = [];
  for (let i = 0; i < background; i += 1) {
    moves.push(backgroundMoves[i % backgroundMoves.length]);
  }
  moves.push(...tailMoves);

  moves.forEach((pct, index) => {
    const prior = close;
    close = prior * (1 + pct / 100);
    bars.push({
      time: 1_790_000_000_000 + (index + 1) * STEP,
      open: prior,
      high: Math.max(prior, close) + 0.5,
      low: Math.min(prior, close) - 0.5,
      close,
      completed: true,
    });
  });

  return {
    bars,
    freshness: {
      stale,
      reason: stale ? "AGE_EXCEEDED" : "FRESH",
    },
  };
}

test("adaptive detector recognizes a real-like +0.093% four-bar move without a fixed 0.10% floor", () => {
  const result = deriveAdaptiveDirectionalMove(makeView({
    tailMoves: [0.023, 0.025, 0.024, 0.021],
  }));

  assert.equal(result.available, true);
  assert.equal(result.active, true);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.UP);
  assert.ok(result.returnPct > 0.09 && result.returnPct < 0.10);
  assert.ok(result.thresholdPct < Math.abs(result.returnPct));
  assert.ok(result.alignedFraction >= 0.75);
  assert.ok(result.efficiency >= 0.55);
});

test("adaptive detector does not promote ordinary chop", () => {
  const result = deriveAdaptiveDirectionalMove(makeView({
    tailMoves: [0.012, -0.011, 0.010, -0.009],
  }));

  assert.equal(result.available, true);
  assert.equal(result.active, false);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.FLAT);
});

test("adaptive detector recognizes sustained downside movement", () => {
  const result = deriveAdaptiveDirectionalMove(makeView({
    tailMoves: [-0.030, -0.028, -0.031, -0.026],
  }));

  assert.equal(result.active, true);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.DOWN);
  assert.ok(result.alignedFraction >= 0.75);
});

test("one completed counter-pullback can coexist with an intact 30m parent move", () => {
  const result = deriveAdaptiveDirectionalMove(makeView({
    tailMoves: [0.040, 0.038, 0.036, -0.012],
  }));

  assert.equal(result.active, true);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.UP);
  assert.equal(result.alignedCount, 3);
  assert.equal(result.stepCount, 4);
});

test("loss of directional persistence fails the parent-move qualification", () => {
  const result = deriveAdaptiveDirectionalMove(makeView({
    tailMoves: [0.050, 0.045, -0.050, -0.055],
  }));

  assert.equal(result.available, true);
  assert.equal(result.active, false);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.FLAT);
  assert.equal(result.persistencePass, false);
});

test("stale 30m authority fails closed instead of preserving an old active move", () => {
  const result = deriveAdaptiveDirectionalMove(makeView({
    tailMoves: [0.040, 0.040, 0.040, 0.040],
    stale: true,
  }));

  assert.equal(result.available, false);
  assert.equal(result.active, false);
  assert.equal(result.stale, true);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.FLAT);
});

test("ordinary upside 30m move is active without squeeze confirmation", () => {
  const result = resolveMoveCharacter({
    liquiditySweeps: [],
    failedMoves: [],
    squeeze: {
      squeezeLike: false,
      character: null,
      headline: {
        impulse: false,
        direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      },
    },
    broadConfirmation: {
      broadConfirmed: false,
      independentBlocksConfirmed: 1,
    },
    directionalMove: {
      active: true,
      available: true,
      direction: ENGINE29_MOVE_DIRECTIONS.UP,
      returnPct: 0.42,
      pointMove: 32.5,
    },
    directionalMoveParent: {
      active: true,
      direction: ENGINE29_MOVE_DIRECTIONS.UP,
    },
  });

  assert.equal(
    result.moveCharacter,
    ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE
  );
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.UP);
});

test("ordinary downside 30m move is active without squeeze confirmation", () => {
  const result = resolveMoveCharacter({
    liquiditySweeps: [],
    failedMoves: [],
    squeeze: {
      squeezeLike: false,
      character: null,
      headline: {
        impulse: false,
        direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      },
    },
    broadConfirmation: {
      broadConfirmed: false,
      independentBlocksConfirmed: 1,
    },
    directionalMove: {
      active: true,
      available: true,
      direction: ENGINE29_MOVE_DIRECTIONS.DOWN,
      returnPct: -0.35,
      pointMove: -27,
    },
    directionalMoveParent: {
      active: true,
      direction: ENGINE29_MOVE_DIRECTIONS.DOWN,
    },
  });

  assert.equal(
    result.moveCharacter,
    ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE
  );
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.DOWN);
});

test("liquidity event does not replace the independent move lane", () => {
  const result = resolveMoveCharacter({
    liquiditySweeps: [{
      detected: true,
      character: ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH,
    }],
    failedMoves: [],
    squeeze: {
      squeezeLike: false,
      character: null,
      headline: {
        impulse: false,
        direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      },
    },
    broadConfirmation: {
      broadConfirmed: false,
      independentBlocksConfirmed: 1,
    },
    directionalMove: {
      active: true,
      available: true,
      direction: ENGINE29_MOVE_DIRECTIONS.UP,
      returnPct: 0.30,
      pointMove: 23,
    },
    directionalMoveParent: {
      active: true,
      direction: ENGINE29_MOVE_DIRECTIONS.UP,
    },
  });

  assert.equal(
    result.moveCharacter,
    ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE
  );
  assert.equal(
    result.liquiditySweep.character,
    ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH
  );
});

test("active upside parent with mixed internals maps to stabilizing fast pressure", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    underlyingPressure: { state: "MIXED" },
  });

  assert.equal(result.state, "STABILIZING");
  assert.equal(result.parentMoveState, ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE);
});

test("active downside parent with mixed internals maps to stabilizing fast pressure", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE,
    direction: ENGINE29_MOVE_DIRECTIONS.DOWN,
    underlyingPressure: { state: "MIXED" },
  });

  assert.equal(result.state, "STABILIZING");
  assert.equal(result.parentMoveState, ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE);
});

test("active upside parent plus positive pressure maps to buying pressure increasing", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    underlyingPressure: { state: "POSITIVE" },
  });

  assert.equal(result.state, "BUYING_PRESSURE_INCREASING");
});

test("active downside parent plus negative pressure maps to selling pressure increasing", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE,
    direction: ENGINE29_MOVE_DIRECTIONS.DOWN,
    underlyingPressure: { state: "NEGATIVE" },
  });

  assert.equal(result.state, "SELLING_PRESSURE_INCREASING");
});


function parentCandidate({
  active = false,
  direction = ENGINE29_MOVE_DIRECTIONS.FLAT,
  returnPct = 0,
  thresholdPct = 0.14,
  latestClose = 7770,
  latestTime = 1_790_787_600_000,
  stale = false,
  available = true,
} = {}) {
  return {
    active,
    direction,
    rawDirection: direction,
    returnPct,
    thresholdPct,
    latestClose,
    latestTime,
    stale,
    available,
  };
}

test("qualified 30m candidate establishes an upside parent", () => {
  const parent = resolveDirectionalMoveParent({
    candidate: parentCandidate({
      active: true,
      direction: ENGINE29_MOVE_DIRECTIONS.UP,
      returnPct: 0.27,
      latestClose: 7754.5,
    }),
    priorParent: null,
    now: 1_790_787_600_000,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, ENGINE29_MOVE_DIRECTIONS.UP);
  assert.equal(parent.reason, "PARENT_ESTABLISHED_FROM_QUALIFIED_30M_MOVE");
});

test("completed 30m pause does not erase an established upside parent", () => {
  const prior = {
    active: true,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    establishedAt: "2026-09-30T12:30:00.000Z",
    establishedBarTime: 1,
    lastQualifiedAt: "2026-09-30T13:30:00.000Z",
    lastQualifiedBarTime: 2,
    activationThresholdPct: 0.1423,
    activationReturnPct: 0.2748,
    extremeClose: 7767.5,
    extremeTime: 2,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: parentCandidate({
      active: false,
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      returnPct: 0.2841,
      thresholdPct: 0.1423,
      latestClose: 7766,
      latestTime: 3,
    }),
    priorParent: prior,
    now: 4,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, ENGINE29_MOVE_DIRECTIONS.UP);
  assert.equal(parent.persistedWithoutFreshQualification, true);
  assert.equal(parent.reason, "PARENT_PERSISTED_THROUGH_COMPLETED_30M_PAUSE");
});

test("small completed 30m pullback remains below adaptive parent invalidation", () => {
  const prior = {
    active: true,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    activationThresholdPct: 0.1423,
    extremeClose: 7775.25,
    extremeTime: 10,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: parentCandidate({
      active: false,
      returnPct: 0.0193,
      thresholdPct: 0.1597,
      latestClose: 7767.5,
      latestTime: 11,
    }),
    priorParent: prior,
    now: 12,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, ENGINE29_MOVE_DIRECTIONS.UP);
  assert.ok(parent.invalidationRetracementPct < parent.invalidationThresholdPct);
});

test("completed 30m retracement beyond adaptive threshold invalidates the prior parent", () => {
  const prior = {
    active: true,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    activationThresholdPct: 0.1423,
    extremeClose: 7775.25,
    extremeTime: 10,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: parentCandidate({
      active: false,
      returnPct: -0.05,
      thresholdPct: 0.1434,
      latestClose: 7757.25,
      latestTime: 11,
    }),
    priorParent: prior,
    now: 12,
  });

  assert.equal(parent.active, false);
  assert.equal(parent.direction, ENGINE29_MOVE_DIRECTIONS.FLAT);
  assert.equal(parent.reason, "PARENT_INVALIDATED_BY_COMPLETED_30M_RETRACEMENT");
});

test("qualified opposite 30m candidate reverses the parent", () => {
  const prior = {
    active: true,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    activationThresholdPct: 0.1423,
    extremeClose: 7775.25,
    extremeTime: 10,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: parentCandidate({
      active: true,
      direction: ENGINE29_MOVE_DIRECTIONS.DOWN,
      returnPct: -0.2315,
      thresholdPct: 0.1434,
      latestClose: 7757.25,
      latestTime: 11,
    }),
    priorParent: prior,
    now: 12,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, ENGINE29_MOVE_DIRECTIONS.DOWN);
  assert.equal(parent.reason, "PARENT_REVERSED_BY_QUALIFIED_OPPOSITE_30M_MOVE");
});

test("stale 30m authority fails closed even when a parent was active", () => {
  const prior = {
    active: true,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    activationThresholdPct: 0.1423,
    extremeClose: 7775.25,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: parentCandidate({
      stale: true,
      available: false,
    }),
    priorParent: prior,
  });

  assert.equal(parent.active, false);
  assert.equal(parent.direction, ENGINE29_MOVE_DIRECTIONS.FLAT);
  assert.equal(parent.stale, true);
  assert.equal(parent.reason, "PARENT_FAILED_CLOSED_STALE_30M_AUTHORITY");
});
