import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
} from "../logic/engine29/tacticalCharacter/moveCharacterConstants.js";
import { resolveMoveCharacter } from "../logic/engine29/tacticalCharacter/resolveMoveCharacter.js";
import { resolveEngine29FastTacticalShift } from "../logic/engine29/aggregate/resolveFastTacticalShift.js";

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
