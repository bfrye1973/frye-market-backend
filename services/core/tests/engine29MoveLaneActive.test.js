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

test("active upside move maps to buying pressure fast state", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE,
    direction: ENGINE29_MOVE_DIRECTIONS.UP,
    underlyingPressure: { state: "MIXED" },
  });

  assert.equal(result.state, "BUYING_PRESSURE_INCREASING");
});

test("active downside move maps to selling pressure fast state", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE,
    direction: ENGINE29_MOVE_DIRECTIONS.DOWN,
    underlyingPressure: { state: "MIXED" },
  });

  assert.equal(result.state, "SELLING_PRESSURE_INCREASING");
});
