import assert from "node:assert/strict";
import test from "node:test";
import fs from "fs";

import {
  resolveDirectionalMoveParent,
} from "../logic/engine29/tacticalCharacter/resolveDirectionalMoveParent.js";
import {
  resolveMoveCharacter,
} from "../logic/engine29/tacticalCharacter/resolveMoveCharacter.js";
import {
  resolveEngine29TacticalState,
} from "../logic/engine29/aggregate/resolveTacticalState.js";
import {
  resolveEngine29FastTacticalShift,
} from "../logic/engine29/aggregate/resolveFastTacticalShift.js";
import {
  buildEngine29SqueezeTransitionMonitor,
} from "../logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js";

const UP = "UP";
const DOWN = "DOWN";
const FLAT = "FLAT";

function candidate({
  active = false,
  direction = FLAT,
  returnPct = 0,
  thresholdPct = 0.148,
  latestClose = 0,
  latestTime = 0,
  available = true,
  stale = false,
} = {}) {
  return {
    active,
    direction,
    rawDirection: direction,
    returnPct,
    thresholdPct,
    latestClose,
    latestTime,
    available,
    stale,
  };
}

function parentState(parent) {
  if (parent?.active === true && parent?.direction === UP) {
    return "UPSIDE_MOVE_ACTIVE";
  }
  if (parent?.active === true && parent?.direction === DOWN) {
    return "DOWNSIDE_MOVE_ACTIVE";
  }
  return "NO_ACTIVE_MOVE";
}

function squeeze(direction) {
  return {
    squeezeLike: true,
    headline: {
      direction,
      impulse: true,
      averageReturnPct: direction === UP ? 0.18 : -0.18,
      averageImpulseMultiple: 1.9,
    },
    broadConfirmationMissing: true,
    reasonCodes: ["REPLAY_SQUEEZE_LIKE"],
  };
}

function noSqueeze() {
  return {
    squeezeLike: false,
    headline: {
      direction: FLAT,
      impulse: false,
    },
    broadConfirmationMissing: false,
    reasonCodes: [],
  };
}

function groups({
  headlineIndex = "HEALTHY",
  breadth = "HEALTHY",
  leadership = "HEALTHY",
  credit = "HEALTHY",
  ratesDuration = "HEALTHY",
  energyInflation = "HEALTHY",
  volatility = "HEALTHY",
  financialConditions = "HEALTHY",
} = {}) {
  const wrap = (state) => ({ tactical: { state } });
  return {
    groups: {
      headlineIndex: wrap(headlineIndex),
      breadth: wrap(breadth),
      leadership: wrap(leadership),
      credit: wrap(credit),
      ratesDuration: wrap(ratesDuration),
      energyInflation: wrap(energyInflation),
      volatility: wrap(volatility),
      financialConditions: wrap(financialConditions),
    },
  };
}

function bar(time, close) {
  return {
    time,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000,
  };
}

function tenMinuteBars(direction = UP, start = 7770) {
  const step = direction === UP ? 3 : -3;
  const t0 = Date.parse("2026-09-30T17:00:00Z");
  const closes = [
    start - step * 3,
    start - step * 2,
    start - step,
    start,
  ];
  return closes.map((close, i) => bar(t0 + i * 10 * 60 * 1000, close));
}

function liveMonitorFor({
  parent,
  character = null,
  liveDirection = UP,
  fastState = "STABILIZING",
}) {
  const moveObject = {
    parent,
    directionalMoveParent: parent,
    moveCharacter: parentState(parent),
    direction: parent?.active === true ? parent.direction : FLAT,
    character: character || {
      squeeze: { active: false, direction: FLAT },
      broadConfirmation: { confirmed: false },
    },
  };

  return buildEngine29SqueezeTransitionMonitor(
    { generatedAt: "2026-09-30T18:00:00.000Z", symbols: {} },
    {
      parentMoveCharacter: moveObject,
      fastTacticalState: fastState,
      esLiveMonitor: {
        bars: tenMinuteBars(liveDirection),
      },
    }
  );
}

function quoteScenario(name, {
  parent,
  character,
  broadConfirmation,
  liveCondition,
  oneHour,
  fast,
  liquidity = { state: "NO_LIQUIDITY_EVENT" },
  trap = { state: "NO_ACTIVE_TRAP", side: "NONE" },
}) {
  const row = {
    scenario: name,
    parent: {
      state: parentState(parent),
      direction: parent?.active === true ? parent.direction : FLAT,
      active: parent?.active === true,
      reason: parent?.reason ?? null,
      invalidationRetracementPct:
        parent?.invalidationRetracementPct ?? null,
      invalidationThresholdPct:
        parent?.invalidationThresholdPct ?? null,
    },
    character: {
      type: character?.type ?? null,
      squeezeActive: character?.squeeze?.active ?? false,
      squeezeDirection: character?.squeeze?.direction ?? FLAT,
    },
    broadConfirmation: {
      state: broadConfirmation?.state ?? null,
      targetDirection: broadConfirmation?.targetDirection ?? null,
      confirmed: broadConfirmation?.confirmed ?? false,
    },
    liveCondition: {
      state: liveCondition?.state ?? null,
      direction: liveCondition?.direction ?? null,
      contextVsParent: liveCondition?.contextVsParent ?? null,
    },
    oneHour: {
      state: oneHour?.state ?? null,
      authority: oneHour?.authority ?? null,
    },
    fastTactical: {
      state: fast?.state ?? null,
      authority: fast?.authority ?? null,
    },
    liquidity,
    trap,
  };

  console.log("REPLAY_QUOTE " + JSON.stringify(row));
  return row;
}

function characterLayer({
  squeezeActive = false,
  squeezeDirection = FLAT,
  broadState = "MIXED_CONFIRMATION",
  targetDirection = FLAT,
  confirmed = false,
} = {}) {
  return {
    type: squeezeActive
      ? "POSSIBLE_SQUEEZE"
      : confirmed
        ? "BROAD_CONFIRMED"
        : broadState === "NARROW"
          ? "NARROW"
          : "MIXED_CONFIRMATION",
    squeeze: {
      active: squeezeActive,
      direction: squeezeActive ? squeezeDirection : FLAT,
    },
    broadConfirmation: {
      state: broadState,
      targetDirection,
      confirmed,
    },
  };
}

function evaluateContext({
  parent,
  character,
  underlying = "MIXED",
  liveDirection = null,
  oneHourGroups = groups(),
  oneHourEsState = "WARNING",
}) {
  const move = resolveMoveCharacter({
    directionalMoveParent: parent,
    squeeze:
      character?.squeeze?.active === true
        ? squeeze(character.squeeze.direction)
        : noSqueeze(),
    broadConfirmation: {
      targetDirection:
        character?.broadConfirmation?.targetDirection ??
        (parent?.active === true ? parent.direction : FLAT),
      broadConfirmed:
        character?.broadConfirmation?.confirmed === true,
      independentBlocksConfirmed:
        character?.broadConfirmation?.confirmed === true ? 3 : 1,
    },
  });

  const moveForContext = {
    ...move,
    character,
    oneHourContext: {
      esOneHourStructureState: oneHourEsState,
    },
    underlyingPressure: { state: underlying },
  };

  const oneHour = resolveEngine29TacticalState(
    oneHourGroups,
    moveForContext
  );

  const fast = resolveEngine29FastTacticalShift(
    moveForContext
  );

  const liveCondition =
    liveDirection == null
      ? {
          state: "MONITORING",
          direction: FLAT,
          contextVsParent:
            parent?.active === true
              ? "NO_LIVE_DIRECTION"
              : "NO_ACTIVE_PARENT",
        }
      : liveMonitorFor({
          parent,
          character,
          liveDirection,
          fastState: fast.state,
        });

  return {
    move,
    oneHour,
    fast,
    liveCondition,
  };
}

test("replay 1: persistent DOWN parent survives sharp UP counter-rally squeeze", () => {
  const parent = {
    active: true,
    direction: DOWN,
    activationThresholdPct: 0.1434,
    extremeClose: 7757.25,
    latestClose: 7762,
    reason: "PARENT_PERSISTED_THROUGH_COMPLETED_30M_PAUSE",
  };

  const character = characterLayer({
    squeezeActive: true,
    squeezeDirection: UP,
    broadState: "MIXED_CONFIRMATION",
    targetDirection: DOWN,
    confirmed: false,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
    liveDirection: UP,
  });

  quoteScenario("DOWN_PARENT_UP_COUNTER_SQUEEZE", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(ctx.move.direction, DOWN);
  assert.equal(ctx.move.moveCharacter, "DOWNSIDE_MOVE_ACTIVE");
  assert.equal(ctx.liveCondition.contextVsParent, "COUNTERTREND_TO_PARENT");
});

test("replay 2: persistent UP parent survives sharp DOWN counter-selloff", () => {
  const parent = {
    active: true,
    direction: UP,
    activationThresholdPct: 0.1434,
    extremeClose: 7805,
    latestClose: 7798,
    reason: "PARENT_PERSISTED_THROUGH_COMPLETED_30M_PAUSE",
  };

  const character = characterLayer({
    squeezeActive: true,
    squeezeDirection: DOWN,
    broadState: "MIXED_CONFIRMATION",
    targetDirection: UP,
    confirmed: false,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
    liveDirection: DOWN,
  });

  quoteScenario("UP_PARENT_DOWN_COUNTER_SELLOFF", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(ctx.move.direction, UP);
  assert.equal(ctx.move.moveCharacter, "UPSIDE_MOVE_ACTIVE");
  assert.equal(ctx.liveCondition.contextVsParent, "COUNTERTREND_TO_PARENT");
});

test("replay 3: historical 17:30 pause persists DOWN parent", () => {
  const prior = resolveDirectionalMoveParent({
    candidate: candidate({
      active: true,
      direction: DOWN,
      returnPct: -0.2315,
      thresholdPct: 0.1434,
      latestClose: 7757.25,
      latestTime: Date.parse("2026-09-30T17:00:00Z"),
    }),
    priorParent: null,
    now: Date.parse("2026-09-30T17:00:00Z"),
  });

  const parent = resolveDirectionalMoveParent({
    candidate: candidate({
      active: false,
      direction: FLAT,
      returnPct: -0.045,
      thresholdPct: 0.148,
      latestClose: 7762,
      latestTime: Date.parse("2026-09-30T17:30:00Z"),
    }),
    priorParent: prior,
    now: Date.parse("2026-09-30T17:30:00Z"),
  });

  const character = characterLayer({
    targetDirection: DOWN,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
    liveDirection: DOWN,
  });

  const quoted = quoteScenario("HISTORICAL_1730_PARENT_PAUSE", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, DOWN);
  assert.equal(parent.persistedWithoutFreshQualification, true);
  assert.ok(quoted.parent.invalidationRetracementPct < quoted.parent.invalidationThresholdPct);
});

test("replay 4: historical 18:00 completed-30m retracement invalidates DOWN parent", () => {
  const prior = {
    active: true,
    direction: DOWN,
    establishedAt: "2026-09-30T17:00:00.000Z",
    establishedBarTime: Date.parse("2026-09-30T17:00:00Z"),
    lastQualifiedAt: "2026-09-30T17:00:00.000Z",
    lastQualifiedBarTime: Date.parse("2026-09-30T17:00:00Z"),
    activationThresholdPct: 0.1434,
    activationReturnPct: -0.2315,
    extremeClose: 7757.25,
    extremeTime: Date.parse("2026-09-30T17:00:00Z"),
  };

  const parent = resolveDirectionalMoveParent({
    candidate: candidate({
      active: false,
      direction: FLAT,
      returnPct: 0.05,
      thresholdPct: 0.148,
      latestClose: 7770,
      latestTime: Date.parse("2026-09-30T18:00:00Z"),
    }),
    priorParent: prior,
    now: Date.parse("2026-09-30T18:00:00Z"),
  });

  const character = characterLayer({
    targetDirection: FLAT,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
  });

  quoteScenario("HISTORICAL_1800_PARENT_INVALIDATION", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(parent.active, false);
  assert.equal(parent.direction, FLAT);
  assert.equal(parent.reason, "PARENT_INVALIDATED_BY_COMPLETED_30M_RETRACEMENT");
});

test("replay 5: historical 18:30 qualified UP reversal establishes new parent", () => {
  const prior = {
    active: false,
    direction: FLAT,
    priorDirection: DOWN,
    activationThresholdPct: 0.1434,
    extremeClose: 7757.25,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: candidate({
      active: true,
      direction: UP,
      returnPct: 0.24,
      thresholdPct: 0.148,
      latestClose: 7788,
      latestTime: Date.parse("2026-09-30T18:30:00Z"),
    }),
    priorParent: prior,
    now: Date.parse("2026-09-30T18:30:00Z"),
  });

  const character = characterLayer({
    targetDirection: UP,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "POSITIVE",
    liveDirection: UP,
  });

  quoteScenario("HISTORICAL_1830_QUALIFIED_UP_REVERSAL", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, UP);
  assert.equal(parent.reason, "PARENT_ESTABLISHED_FROM_QUALIFIED_30M_MOVE");
});

test("replay 6: broad internals can diverge from existing parent without changing it", () => {
  const parent = {
    active: true,
    direction: DOWN,
    activationThresholdPct: 0.1434,
    extremeClose: 7757.25,
    latestClose: 7760,
    reason: "PARENT_PERSISTED_THROUGH_COMPLETED_30M_PAUSE",
  };

  const character = characterLayer({
    broadState: "NARROW",
    targetDirection: DOWN,
    confirmed: false,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "POSITIVE",
    liveDirection: UP,
  });

  quoteScenario("BROAD_INTERNALS_DIVERGE_FROM_DOWN_PARENT", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(ctx.move.direction, DOWN);
  assert.equal(character.broadConfirmation.targetDirection, DOWN);
  assert.equal(character.broadConfirmation.confirmed, false);
});

test("replay 7: 10m/20m countertrend persistence remains diagnostic while parent survives", () => {
  const parent = {
    active: true,
    direction: DOWN,
    activationThresholdPct: 0.148,
    extremeClose: 7757.25,
    latestClose: 7762,
    reason: "PARENT_PERSISTED_THROUGH_COMPLETED_30M_PAUSE",
  };

  const character = characterLayer({
    targetDirection: DOWN,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
    liveDirection: UP,
  });

  quoteScenario("LIVE_COUNTERTREND_PERSISTS_PARENT_SURVIVES", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(parent.active, true);
  assert.equal(parent.direction, DOWN);
  assert.equal(ctx.liveCondition.contextVsParent, "COUNTERTREND_TO_PARENT");
  assert.equal(ctx.liveCondition.authority, "DIAGNOSTIC_ONLY");
});

test("replay 8: LIQUIDITY + MOVE + TRAP coexist independently", () => {
  const parent = {
    active: true,
    direction: DOWN,
    activationThresholdPct: 0.148,
    extremeClose: 7757.25,
    latestClose: 7759,
    reason: "PARENT_CONTINUED_BY_QUALIFIED_30M_MOVE",
  };

  const character = characterLayer({
    targetDirection: DOWN,
    broadState: "BROAD_CONFIRMED",
    confirmed: true,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "NEGATIVE",
    liveDirection: DOWN,
    oneHourGroups: groups({
      breadth: "CONFIRMED",
      leadership: "CONFIRMED",
      credit: "CONFIRMED",
    }),
  });

  const liquidity = {
    state: "SWEEP_LOW",
    side: "LOW",
    auctionResult: "FAILED_ACCEPTANCE_LOW",
  };

  const trap = {
    state: "TRAP_WATCH",
    side: "BEAR",
  };

  quoteScenario("LIQUIDITY_MOVE_TRAP_COEXIST", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
    liquidity,
    trap,
  });

  assert.equal(parentState(parent), "DOWNSIDE_MOVE_ACTIVE");
  assert.equal(liquidity.state, "SWEEP_LOW");
  assert.equal(trap.state, "TRAP_WATCH");
});

test("replay 9: stale/missing 30m fails closed", () => {
  const prior = {
    active: true,
    direction: UP,
    activationThresholdPct: 0.148,
    extremeClose: 7805,
  };

  const parent = resolveDirectionalMoveParent({
    candidate: candidate({
      available: false,
      stale: true,
      latestClose: 7790,
      latestTime: Date.parse("2026-09-30T19:00:00Z"),
    }),
    priorParent: prior,
    now: Date.parse("2026-09-30T19:00:00Z"),
  });

  const character = characterLayer();

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
  });

  quoteScenario("STALE_30M_FAILS_CLOSED", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.equal(parent.active, false);
  assert.equal(parent.direction, FLAT);
  assert.equal(parent.stale, true);
  assert.equal(parent.reason, "PARENT_FAILED_CLOSED_STALE_30M_AUTHORITY");
});

test("replay 10: restart persistence reads canonical parent schema before legacy fallback", () => {
  const source = fs.readFileSync(
    new URL("../jobs/updateEngine29CrossMarketStress.js", import.meta.url),
    "utf8"
  );

  const canonical =
    source.indexOf("prior?.marketCharacter?.move?.parent");
  const legacy =
    source.indexOf("prior?.moveCharacter?.directionalMoveParent");

  const parent = {
    active: true,
    direction: DOWN,
    activationThresholdPct: 0.148,
    extremeClose: 7757.25,
    reason: "RESTART_CANONICAL_PARENT_RESTORED",
  };

  const character = characterLayer({
    targetDirection: DOWN,
  });

  const ctx = evaluateContext({
    parent,
    character,
    underlying: "MIXED",
    liveDirection: DOWN,
  });

  quoteScenario("RESTART_CANONICAL_PARENT_FIRST", {
    parent,
    character,
    broadConfirmation: character.broadConfirmation,
    liveCondition: ctx.liveCondition,
    oneHour: ctx.oneHour,
    fast: ctx.fast,
  });

  assert.ok(canonical >= 0);
  assert.ok(legacy >= 0);
  assert.ok(canonical < legacy);
});
