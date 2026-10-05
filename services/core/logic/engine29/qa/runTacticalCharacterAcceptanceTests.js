// services/core/logic/engine29/qa/runTacticalCharacterAcceptanceTests.js
// CLI-only acceptance test for Engine 29 MOVE v2 tactical character separation.

import { ENGINE29_GROUP_STATES } from "../constants.js";
import { buildEngine29TacticalCharacter } from "../tacticalCharacter/buildTacticalCharacter.js";
import { ENGINE29_MOVE_CHARACTERS } from "../tacticalCharacter/moveCharacterConstants.js";

const STEP_MS = 30 * 60 * 1000;

function bars({ start = 100, direction = "FLAT", count = 45, impulsePct = 0.22 } = {}) {
  const out = [];
  let close = start;

  for (let i = 0; i < count; i += 1) {
    const baseMove = i % 2 === 0 ? 0.01 : -0.008;
    const pct =
      i >= count - 2
        ? direction === "UP"
          ? impulsePct / 2
          : direction === "DOWN"
            ? -impulsePct / 2
            : baseMove
        : baseMove;

    const prior = close;
    close = prior * (1 + pct / 100);

    out.push({
      time: 1_780_000_000_000 + i * STEP_MS,
      open: prior,
      high: Math.max(prior, close) * 1.00015,
      low: Math.min(prior, close) * 0.99985,
      close,
      completed: true,
    });
  }

  return out;
}

function entry(symbol, direction = "FLAT", start = 100) {
  return {
    canonicalSymbol: symbol,
    fastTactical: {
      bars: bars({ start, direction }),
      levels: {
        recentSupport: start * 0.995,
        recentResistance: start * 1.005,
      },
      classification: {
        state: "WARNING",
        stage: "TEST",
      },
      freshness: {
        stale: false,
        reason: "FRESH",
      },
    },
  };
}

function esAnchor(direction = "FLAT", { sweep = null } = {}) {
  const es = entry("ES", direction, 7600);

  es.tactical = {
    bars: bars({
      start: 7600,
      direction: "FLAT",
      impulsePct: 0.06,
    }),
    classification: {
      state: "WARNING",
      stage: "TESTING_STRESS_LEVEL",
    },
    freshness: {
      stale: false,
      reason: "FRESH",
    },
  };

  if (sweep === "HIGH") {
    const view = es.fastTactical;
    view.levels.recentResistance = 7610;
    const last = view.bars.at(-1);
    last.open = 7607;
    last.high = 7614;
    last.low = 7606;
    last.close = 7609;
  } else if (sweep === "LOW") {
    const view = es.fastTactical;
    view.levels.recentSupport = 7590;
    const last = view.bars.at(-1);
    last.open = 7593;
    last.high = 7594;
    last.low = 7586;
    last.close = 7591;
  }

  return {
    resolvedSymbol: "ES_TEST",
    structure: es,
  };
}

function groupBundle(stress = true) {
  const state = stress
    ? ENGINE29_GROUP_STATES.FORMING
    : ENGINE29_GROUP_STATES.HEALTHY;

  const group = {
    tactical: { state },
  };

  return {
    groups: {
      breadth: group,
      leadership: group,
      credit: group,
      ratesDuration: group,
    },
  };
}

function structure(internalDirection = "FLAT") {
  return {
    dataDegraded: false,
    symbols: {
      SPY: entry("SPY", internalDirection, 750),
      QQQ: entry("QQQ", internalDirection, 700),
      IWM: entry("IWM", internalDirection, 285),
      MDY: entry("MDY", internalDirection, 670),
      RSP: entry("RSP", internalDirection, 214),
      SMH: entry("SMH", internalDirection, 540),
      XLK: entry("XLK", internalDirection, 184),
      HYG: entry("HYG", internalDirection, 78),
      JNK: entry("JNK", internalDirection, 94),
      LQD: entry("LQD", internalDirection, 104),
      XLF: entry("XLF", internalDirection, 57),
      KRE: entry("KRE", internalDirection, 74),
      VIX: {
        ...entry("VIX", "FLAT", 18),
        isProxy: true,
      },
    },
  };
}

const scenarios = [
  {
    name: "UPSIDE_SQUEEZE_IS_CHARACTER_ONLY",
    es: esAnchor("UP"),
    structure: structure("FLAT"),
    groups: groupBundle(true),
    assert(result) {
      return (
        result.character?.squeeze?.active === true &&
        result.character?.squeeze?.direction === "UP" &&
        result.moveCharacter !== ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE
      );
    },
  },
  {
    name: "DOWNSIDE_SQUEEZE_IS_CHARACTER_ONLY",
    es: esAnchor("DOWN"),
    structure: structure("FLAT"),
    groups: groupBundle(false),
    assert(result) {
      return (
        result.character?.squeeze?.active === true &&
        result.character?.squeeze?.direction === "DOWN" &&
        result.moveCharacter !== ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE
      );
    },
  },
  {
    name: "BROAD_CONFIRMATION_TARGETS_PARENT_DIRECTION",
    es: esAnchor("FLAT"),
    structure: structure("DOWN"),
    groups: groupBundle(true),
    priorMoveParent: {
      active: true,
      direction: "DOWN",
      activationThresholdPct: 1.0,
      extremeClose: 7600,
      latestClose: 7600,
    },
    assert(result) {
      return (
        result.moveCharacter === ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE &&
        result.broadConfirmation?.targetDirection === "DOWN"
      );
    },
  },
  {
    name: "LIQUIDITY_SWEEP_HIGH_IS_INDEPENDENT",
    es: esAnchor("FLAT", { sweep: "HIGH" }),
    structure: structure("FLAT"),
    groups: groupBundle(true),
    assert(result) {
      const liquidity =
        result.liquiditySweeps?.find((entry) => entry?.detected)?.character ??
        null;

      return (
        liquidity === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH &&
        result.moveCharacter !== ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH
      );
    },
  },
  {
    name: "LIQUIDITY_SWEEP_LOW_IS_INDEPENDENT",
    es: esAnchor("FLAT", { sweep: "LOW" }),
    structure: structure("FLAT"),
    groups: groupBundle(true),
    assert(result) {
      const liquidity =
        result.liquiditySweeps?.find((entry) => entry?.detected)?.character ??
        null;

      return (
        liquidity === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW &&
        result.moveCharacter !== ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW
      );
    },
  },
];

let failed = 0;

for (const scenario of scenarios) {
  const result = buildEngine29TacticalCharacter(
    scenario.structure,
    scenario.groups,
    {
      now: Date.now(),
      esAnchor: scenario.es,
      priorMoveParent: scenario.priorMoveParent || null,
    }
  );

  const pass = scenario.assert(result);

  if (!pass) failed += 1;

  console.log(
    `${pass ? "PASS" : "FAIL"} ${scenario.name}: parent=${result.moveCharacter} direction=${result.direction} character=${result.character?.type || "NONE"}`
  );
}

if (failed) {
  console.error(
    `ENGINE29 MOVE V2 TACTICAL ACCEPTANCE FAIL: ${failed}/${scenarios.length} failed`
  );
  process.exit(1);
}

console.log(
  `ENGINE29 MOVE V2 TACTICAL ACCEPTANCE PASS: ${scenarios.length}/${scenarios.length}`
);
