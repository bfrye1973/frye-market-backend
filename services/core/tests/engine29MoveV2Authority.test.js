import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
} from "../logic/engine29/tacticalCharacter/moveCharacterConstants.js";
import { resolveMoveCharacter } from "../logic/engine29/tacticalCharacter/resolveMoveCharacter.js";
import { resolveEngine29TacticalState } from "../logic/engine29/aggregate/resolveTacticalState.js";
import { resolveEngine29FastTacticalShift } from "../logic/engine29/aggregate/resolveFastTacticalShift.js";
import { detectEngine29StateTransition } from "../logic/engine29/alerts/detectStateTransition.js";
import { detectBroadConfirmation } from "../logic/engine29/tacticalCharacter/detectBroadConfirmation.js";

function parent(direction) {
  return {
    active: direction === "UP" || direction === "DOWN",
    direction,
    stale: false,
  };
}

function squeeze(direction) {
  return {
    squeezeLike: true,
    character:
      direction === "UP"
        ? ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE
        : ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE,
    headline: {
      direction,
      impulse: true,
    },
    broadConfirmationMissing: true,
  };
}

test("DOWN parent survives an UP squeeze-like impulse", () => {
  const result = resolveMoveCharacter({
    squeeze: squeeze("UP"),
    broadConfirmation: {
      targetDirection: "DOWN",
      broadConfirmed: false,
    },
    directionalMoveParent: parent("DOWN"),
  });

  assert.equal(result.moveCharacter, ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.DOWN);
  assert.equal(result.squeeze.headline.direction, "UP");
  assert.equal(result.legacyProjectionFromParent, true);
});

test("UP parent survives a DOWN squeeze-like impulse", () => {
  const result = resolveMoveCharacter({
    squeeze: squeeze("DOWN"),
    broadConfirmation: {
      targetDirection: "UP",
      broadConfirmed: false,
    },
    directionalMoveParent: parent("UP"),
  });

  assert.equal(result.moveCharacter, ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.UP);
  assert.equal(result.squeeze.headline.direction, "DOWN");
});

test("opposing broad confirmation evidence cannot overwrite DOWN parent", () => {
  const result = resolveMoveCharacter({
    squeeze: { squeezeLike: false, headline: { direction: "UP" } },
    broadConfirmation: {
      targetDirection: "DOWN",
      broadConfirmed: false,
      independentBlocksConfirmed: 0,
    },
    directionalMoveParent: parent("DOWN"),
  });

  assert.equal(result.moveCharacter, ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE);
  assert.equal(result.direction, "DOWN");
});

test("opposing broad confirmation evidence cannot overwrite UP parent", () => {
  const result = resolveMoveCharacter({
    squeeze: { squeezeLike: false, headline: { direction: "DOWN" } },
    broadConfirmation: {
      targetDirection: "UP",
      broadConfirmed: false,
      independentBlocksConfirmed: 0,
    },
    directionalMoveParent: parent("UP"),
  });

  assert.equal(result.moveCharacter, ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE);
  assert.equal(result.direction, "UP");
});

test("legacy compatibility fields are one-way projections from parent", () => {
  const down = resolveMoveCharacter({
    squeeze: squeeze("UP"),
    directionalMoveParent: parent("DOWN"),
  });

  assert.equal(down.moveCharacter, "DOWNSIDE_MOVE_ACTIVE");
  assert.equal(down.direction, "DOWN");

  const flat = resolveMoveCharacter({
    squeeze: squeeze("UP"),
    directionalMoveParent: parent("FLAT"),
  });

  assert.equal(flat.moveCharacter, "NO_ACTIVE_MOVE");
  assert.equal(flat.direction, "FLAT");
});

test("30m squeeze cannot manufacture 1H RECOVERING", () => {
  const groupBundle = {
    groups: {
      headlineIndex: { tactical: { state: "HEALTHY" } },
      breadth: { tactical: { state: "HEALTHY" } },
      leadership: { tactical: { state: "HEALTHY" } },
      credit: { tactical: { state: "HEALTHY" } },
      ratesDuration: { tactical: { state: "HEALTHY" } },
      energyInflation: { tactical: { state: "HEALTHY" } },
      volatility: { tactical: { state: "HEALTHY" } },
      financialConditions: { tactical: { state: "HEALTHY" } },
    },
  };

  const result = resolveEngine29TacticalState(groupBundle, {
    moveCharacter: "UPSIDE_MOVE_ACTIVE",
    direction: "UP",
    oneHourContext: {
      esOneHourStructureState: "WARNING",
    },
    underlyingPressure: {
      state: "NEUTRAL",
    },
    character: {
      squeeze: { active: true, direction: "UP" },
    },
  });

  assert.equal(result.state, "NORMAL");
  assert.equal(result.authority, "ONE_HOUR_TACTICAL_ONLY");
});

test("30m downside character cannot manufacture 1H STRESS_ACCELERATING", () => {
  const groupBundle = {
    groups: {
      headlineIndex: { tactical: { state: "HEALTHY" } },
      breadth: { tactical: { state: "FORMING" } },
      leadership: { tactical: { state: "HEALTHY" } },
      credit: { tactical: { state: "HEALTHY" } },
      ratesDuration: { tactical: { state: "HEALTHY" } },
      energyInflation: { tactical: { state: "HEALTHY" } },
      volatility: { tactical: { state: "HEALTHY" } },
      financialConditions: { tactical: { state: "HEALTHY" } },
    },
  };

  const result = resolveEngine29TacticalState(groupBundle, {
    moveCharacter: "DOWNSIDE_MOVE_ACTIVE",
    direction: "DOWN",
    oneHourContext: {
      esOneHourStructureState: "WARNING",
    },
    underlyingPressure: {
      state: "NEUTRAL",
    },
  });

  assert.notEqual(result.state, "STRESS_ACCELERATING");
});

test("fast tactical describes pressure without changing parent identity", () => {
  const result = resolveEngine29FastTacticalShift({
    moveCharacter: "DOWNSIDE_MOVE_ACTIVE",
    direction: "DOWN",
    underlyingPressure: {
      state: "POSITIVE",
    },
  });

  assert.equal(result.state, "RECOVERY_ATTEMPT");
  assert.equal(result.parentMoveState, "DOWNSIDE_MOVE_ACTIVE");
  assert.equal(result.parentMoveDirection, "DOWN");
  assert.equal(result.authority, "THIRTY_MINUTE_PRESSURE_ONLY");
});

test("broad confirmation exposes targetDirection semantics", () => {
  const result = detectBroadConfirmation(
    { symbols: {} },
    ENGINE29_MOVE_DIRECTIONS.DOWN
  );

  assert.equal(result.targetDirection, ENGINE29_MOVE_DIRECTIONS.DOWN);
  assert.equal(result.direction, ENGINE29_MOVE_DIRECTIONS.DOWN);
});

test("squeeze character change is not emitted as LIQUIDITY event", () => {
  const previous = {
    marketCharacter: {
      move: {
        parent: { state: "DOWNSIDE_MOVE_ACTIVE", direction: "DOWN" },
        character: { type: "ORDINARY" },
      },
      liquidity: { state: "NO_LIQUIDITY_EVENT" },
      trap: { state: "NO_ACTIVE_TRAP" },
    },
  };

  const current = {
    marketCharacter: {
      move: {
        parent: { state: "DOWNSIDE_MOVE_ACTIVE", direction: "DOWN" },
        character: { type: "POSSIBLE_SQUEEZE" },
      },
      liquidity: { state: "NO_LIQUIDITY_EVENT" },
      trap: { state: "NO_ACTIVE_TRAP" },
    },
  };

  const events = detectEngine29StateTransition(previous, current);

  assert.ok(events.some((event) => event.type === "MOVE_CHARACTER_CHANGE"));
  assert.ok(!events.some((event) => event.type === "LIQUIDITY_EVENT"));
  assert.ok(!events.some((event) => event.type === "PARENT_MOVE_CHANGE"));
});

test("actual liquidity sweep emits LIQUIDITY_EVENT independently", () => {
  const previous = {
    marketCharacter: {
      move: {
        parent: { state: "UPSIDE_MOVE_ACTIVE", direction: "UP" },
        character: { type: "ORDINARY" },
      },
      liquidity: { state: "NO_LIQUIDITY_EVENT" },
      trap: { state: "NO_ACTIVE_TRAP" },
    },
  };

  const current = {
    marketCharacter: {
      move: {
        parent: { state: "UPSIDE_MOVE_ACTIVE", direction: "UP" },
        character: { type: "ORDINARY" },
      },
      liquidity: { state: "SWEEP_HIGH" },
      trap: { state: "NO_ACTIVE_TRAP" },
    },
  };

  const events = detectEngine29StateTransition(previous, current);

  assert.ok(events.some((event) => event.type === "LIQUIDITY_EVENT"));
  assert.ok(!events.some((event) => event.type === "PARENT_MOVE_CHANGE"));
});

test("parent reversal emits PARENT_MOVE_CHANGE", () => {
  const previous = {
    marketCharacter: {
      move: {
        parent: { state: "UPSIDE_MOVE_ACTIVE", direction: "UP" },
        character: { type: "ORDINARY" },
      },
      liquidity: { state: "NO_LIQUIDITY_EVENT" },
      trap: { state: "NO_ACTIVE_TRAP" },
    },
  };

  const current = {
    marketCharacter: {
      move: {
        parent: { state: "DOWNSIDE_MOVE_ACTIVE", direction: "DOWN" },
        character: { type: "ORDINARY" },
      },
      liquidity: { state: "NO_LIQUIDITY_EVENT" },
      trap: { state: "NO_ACTIVE_TRAP" },
    },
  };

  const events = detectEngine29StateTransition(previous, current);

  const parentEvent = events.find((event) => event.type === "PARENT_MOVE_CHANGE");
  assert.ok(parentEvent);
  assert.equal(parentEvent.direction, "DOWN");
});
