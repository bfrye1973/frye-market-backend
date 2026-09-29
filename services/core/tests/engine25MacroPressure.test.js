// services/core/tests/engine25MacroPressure.test.js

import assert from "node:assert/strict";
import {
  buildMacroPressure,
  MACRO_PRESSURE_WEIGHTS,
} from "../logic/engine25/buildMacroPressure.js";

function macro({ dgs10 = 4.4, dgs2 = 4.4, curve = 0.1 } = {}) {
  return { DGS10: dgs10, DGS2: dgs2, T10Y2Y: curve };
}

function symbol(overrides = {}) {
  return {
    aboveEma20: false,
    aboveEma50: false,
    pctChange20d: 0,
    ...overrides,
  };
}

function market({
  uso = symbol(),
  tlt = symbol(),
  uup = symbol(),
  spy = symbol(),
  qqq = symbol(),
  iwm = symbol(),
  aiValue = false,
} = {}) {
  const names = ["NVDA","MSFT","AVGO","AMD","META","GOOGL","AMZN","TSM","ARM","PLTR"];
  return {
    macroProxies: { USO: uso, TLT: tlt, UUP: uup },
    marketTrend: { SPY: spy, QQQ: qqq, IWM: iwm },
    quickRead: {
      aiLeadership: Object.fromEntries(
        names.map((name) => [name, { aboveEma20: aiValue, aboveEma50: aiValue }])
      ),
    },
  };
}

function engine29Energy(state = "HEALTHY") {
  const layer = { state, dataDegraded: false, missingRequiredMembers: [] };
  return {
    dataQuality: { degradedGroups: [] },
    groups: {
      energyInflation: {
        structural: { ...layer },
        tactical: { ...layer },
        fastTactical: { ...layer },
      },
    },
  };
}

function score(args = {}) {
  return buildMacroPressure({
    macroData: args.macroData ?? macro(),
    marketData: args.marketData ?? market(),
    engine29Data: Object.prototype.hasOwnProperty.call(args, "engine29Data")
      ? args.engine29Data
      : engine29Energy(),
  });
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("1 DGS10 changes cannot change macroPressure.score", () => {
  assert.equal(
    score({ macroData: macro({ dgs10: 2.0 }) }).score,
    score({ macroData: macro({ dgs10: 8.0 }) }).score
  );
});

run("2 TLT changes cannot change macroPressure.score", () => {
  const weak = market({ tlt: symbol({ aboveEma20: false, aboveEma50: false, pctChange20d: -20 }) });
  const strong = market({ tlt: symbol({ aboveEma20: true, aboveEma50: true, pctChange20d: 20 }) });
  assert.equal(score({ marketData: weak }).score, score({ marketData: strong }).score);
});

run("3 SPY/QQQ/IWM changes cannot change macroPressure.score", () => {
  const weak = market({
    spy: symbol({ aboveEma20: false, pctChange20d: -20 }),
    qqq: symbol({ aboveEma20: false, pctChange20d: -20 }),
    iwm: symbol({ aboveEma20: false, aboveEma50: false, pctChange20d: -20 }),
  });
  const strong = market({
    spy: symbol({ aboveEma20: true, pctChange20d: 20 }),
    qqq: symbol({ aboveEma20: true, pctChange20d: 20 }),
    iwm: symbol({ aboveEma20: true, aboveEma50: true, pctChange20d: 20 }),
  });
  assert.equal(score({ marketData: weak }).score, score({ marketData: strong }).score);
});

run("4 AI breadth changes cannot change macroPressure.score", () => {
  assert.equal(
    score({ marketData: market({ aiValue: false }) }).score,
    score({ marketData: market({ aiValue: true }) }).score
  );
});

run("5 inflationScore is not an input and cannot change macroPressure.score", () => {
  const baseline = score().score;
  const withIgnoredInflation = buildMacroPressure({
    macroData: macro(),
    marketData: market(),
    engine29Data: engine29Energy(),
    components: { inflation: { score: 0 } },
  }).score;
  const withOppositeInflation = buildMacroPressure({
    macroData: macro(),
    marketData: market(),
    engine29Data: engine29Energy(),
    components: { inflation: { score: 100 } },
  }).score;
  assert.equal(baseline, withIgnoredInflation);
  assert.equal(baseline, withOppositeInflation);
});

run("6 DGS2 changes DO change score", () => {
  assert.notEqual(
    score({ macroData: macro({ dgs2: 3.5 }) }).score,
    score({ macroData: macro({ dgs2: 5.5 }) }).score
  );
});

run("7 T10Y2Y changes DO change score", () => {
  assert.notEqual(
    score({ macroData: macro({ curve: -0.75 }) }).score,
    score({ macroData: macro({ curve: 1.0 }) }).score
  );
});

run("8 UUP changes DO change score", () => {
  const weakDollar = market({ uup: symbol({ aboveEma20: false, pctChange20d: -2 }) });
  const strongDollar = market({ uup: symbol({ aboveEma20: true, pctChange20d: 8 }) });
  assert.notEqual(score({ marketData: weakDollar }).score, score({ marketData: strongDollar }).score);
});

run("9 Energy authority changes DO change score", () => {
  assert.notEqual(
    score({ engine29Data: engine29Energy("HEALTHY") }).score,
    score({ engine29Data: engine29Energy("SEVERE") }).score
  );
});

run("10 weights equal exactly 1.00", () => {
  const total = Object.values(MACRO_PRESSURE_WEIGHTS).reduce((sum, value) => sum + value, 0);
  assert.equal(total, 1);
  assert.deepEqual(MACRO_PRESSURE_WEIGHTS, {
    DGS2: 0.30,
    T10Y2Y: 0.20,
    UUP: 0.20,
    ENERGY: 0.30,
  });
});

run("11 Energy fallback remains delegated to buildEnergyAuthority", () => {
  const result = score({ engine29Data: null });
  assert.equal(result.inputs.energyAuthority.authority, "ENGINE25_LEGACY_USO_FALLBACK");
  assert.equal(result.inputs.energyAuthority.fallbackUsed, true);
  assert.equal(result.inputs.energyAuthority.primarySource, "ENGINE25_USO_PROXY");
});

run("12 TLT compatibility alias remains available but non-scoring", () => {
  const tlt = symbol({ aboveEma20: true, aboveEma50: true, pctChange20d: 99 });
  const result = score({ marketData: market({ tlt }) });
  assert.deepEqual(result.inputs.TLT, tlt);
  assert.equal(result.inputs.TLTScoringRole, "DIAGNOSTIC_NON_SCORING_COMPATIBILITY_ALIAS");
  assert.deepEqual(result.diagnostics.TLT, tlt);
  assert.equal(result.diagnostics.scoringRole, "NON_SCORING");
});

run("active warnings exclude DGS10/TLT/index/AI/inflation diagnostics", () => {
  const result = score({
    macroData: macro({ dgs10: 9 }),
    marketData: market({
      tlt: symbol({ aboveEma20: false, pctChange20d: -99 }),
      spy: symbol({ aboveEma20: true }),
      qqq: symbol({ aboveEma20: true }),
      iwm: symbol({ aboveEma20: false }),
      aiValue: false,
    }),
  });
  const text = result.warnings.join(" | ");
  assert.equal(text.includes("10Y"), false);
  assert.equal(text.includes("TLT"), false);
  assert.equal(text.includes("leadership"), false);
  assert.equal(text.includes("AI"), false);
  assert.equal(text.includes("Inflation"), false);
});

console.log("Engine25 Macro Pressure Phase 2 tests PASS");
