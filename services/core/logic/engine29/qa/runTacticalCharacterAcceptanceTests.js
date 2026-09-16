// services/core/logic/engine29/qa/runTacticalCharacterAcceptanceTests.js
// CLI-only acceptance test for Engine 29 tactical move character.

import { ENGINE29_GROUP_STATES } from "../constants.js";
import { buildEngine29TacticalCharacter } from "../tacticalCharacter/buildTacticalCharacter.js";
import { ENGINE29_MOVE_CHARACTERS } from "../tacticalCharacter/moveCharacterConstants.js";

const STEP_MS = 30 * 60 * 1000;

function bars({ start = 100, direction = "FLAT", count = 45, impulsePct = 0.22 } = {}) {
  const out = [];
  let close = start;
  for (let i = 0; i < count; i += 1) {
    const baseMove = i % 2 === 0 ? 0.01 : -0.008;
    const pct = i >= count - 2
      ? (direction === "UP" ? impulsePct / 2 : direction === "DOWN" ? -impulsePct / 2 : baseMove)
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
      levels: { recentSupport: start * 0.995, recentResistance: start * 1.005 },
      classification: { state: "WARNING", stage: "TEST" },
    },
  };
}

function esAnchor(direction = "FLAT", { sweep = null } = {}) {
  const es = entry("ES", direction, 7600);
  es.tactical = {
    bars: bars({ start: 7600, direction: "FLAT", impulsePct: 0.06 }),
    classification: { state: "WARNING", stage: "TESTING_STRESS_LEVEL" },
  };

  if (sweep === "HIGH") {
    const v = es.fastTactical;
    v.levels.recentResistance = 7610;
    const last = v.bars.at(-1);
    last.open = 7607;
    last.high = 7614;
    last.low = 7606;
    last.close = 7609;
  } else if (sweep === "LOW") {
    const v = es.fastTactical;
    v.levels.recentSupport = 7590;
    const last = v.bars.at(-1);
    last.open = 7593;
    last.high = 7594;
    last.low = 7586;
    last.close = 7591;
  }

  return { resolvedSymbol: "ES_TEST", structure: es };
}

function groupBundle(stress = true) {
  const state = stress ? ENGINE29_GROUP_STATES.FORMING : ENGINE29_GROUP_STATES.HEALTHY;
  const g = { tactical: { state } };
  return {
    groups: {
      breadth: g,
      leadership: g,
      credit: g,
      ratesDuration: g,
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
      VIX: { ...entry("VIX", "FLAT", 18), isProxy: true },
    },
  };
}

const scenarios = [
  {
    name: "UPSIDE_SQUEEZE",
    es: esAnchor("UP"),
    structure: structure("FLAT"),
    groups: groupBundle(true),
    expected: ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE,
  },
  {
    name: "DOWNSIDE_SQUEEZE",
    es: esAnchor("DOWN"),
    structure: structure("FLAT"),
    groups: groupBundle(false),
    expected: ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE,
  },
  {
    name: "BROAD_RALLY",
    es: esAnchor("UP"),
    structure: structure("UP"),
    groups: groupBundle(false),
    expected: ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED,
  },
  {
    name: "BROAD_SELLOFF",
    es: esAnchor("DOWN"),
    structure: structure("DOWN"),
    groups: groupBundle(true),
    expected: ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED,
  },
  {
    name: "LIQUIDITY_SWEEP_HIGH",
    es: esAnchor("FLAT", { sweep: "HIGH" }),
    structure: structure("FLAT"),
    groups: groupBundle(true),
    expected: ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH,
  },
  {
    name: "LIQUIDITY_SWEEP_LOW",
    es: esAnchor("FLAT", { sweep: "LOW" }),
    structure: structure("FLAT"),
    groups: groupBundle(true),
    expected: ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW,
  },
];

let failed = 0;
for (const scenario of scenarios) {
  const result = buildEngine29TacticalCharacter(scenario.structure, scenario.groups, {
    now: Date.now(),
    esAnchor: scenario.es,
  });
  const pass = result.moveCharacter === scenario.expected;
  if (!pass) failed += 1;
  console.log(`${pass ? "PASS" : "FAIL"} ${scenario.name}: expected=${scenario.expected} actual=${result.moveCharacter}`);
}

if (failed) {
  console.error(`ENGINE29 TACTICAL CHARACTER ACCEPTANCE FAIL: ${failed}/${scenarios.length} failed`);
  process.exit(1);
}

console.log(`ENGINE29 TACTICAL CHARACTER ACCEPTANCE PASS: ${scenarios.length}/${scenarios.length}`);
