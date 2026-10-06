// services/core/logic/engine29/qa/runOverallStateAcceptanceTests.js

import { resolveEngine29StructuralState } from "../aggregate/resolveStructuralState.js";

function group(state, { degraded = false } = {}) {
  return {
    structural: {
      state,
      confidence: "HIGH",
      dataDegraded: degraded,
      missingRequiredMembers: [],
      reasonCodes: [],
    },
  };
}

function bundle(states) {
  return {
    groups: {
      headlineIndex: group(states.headlineIndex ?? "HEALTHY"),
      breadth: group(states.breadth ?? "HEALTHY"),
      leadership: group(states.leadership ?? "HEALTHY"),
      credit: group(states.credit ?? "HEALTHY"),
      ratesDuration: group(states.ratesDuration ?? "HEALTHY"),
      energyInflation: group(states.energyInflation ?? "HEALTHY"),
      volatility: group(states.volatility ?? "HEALTHY"),
      financialConditions: group(states.financialConditions ?? "HEALTHY"),
    },
  };
}

const scenarios = [
  {
    name: "NORMAL",
    expected: "NORMAL",
    states: {},
  },
  {
    name: "EARLY_WARNING",
    expected: "EARLY_WARNING",
    states: { breadth: "FORMING", ratesDuration: "FORMING" },
  },
  {
    name: "BROAD_DETERIORATION_SEP15",
    expected: "BROAD_DETERIORATION",
    states: {
      headlineIndex: "FORMING",
      breadth: "CONFIRMED",
      leadership: "CONFIRMED",
      credit: "FORMING",
      ratesDuration: "CONFIRMED",
      energyInflation: "FORMING",
      volatility: null,
      financialConditions: null,
    },
  },
  {
    name: "RISK_OFF_CONFIRMED",
    expected: "RISK_OFF_CONFIRMED",
    states: {
      headlineIndex: "FORMING",
      breadth: "CONFIRMED",
      leadership: "CONFIRMED",
      credit: "CONFIRMED",
      ratesDuration: "CONFIRMED",
      volatility: "CONFIRMED",
    },
  },
  {
    name: "SYSTEMIC_STRESS",
    expected: "SYSTEMIC_STRESS",
    states: {
      headlineIndex: "CONFIRMED",
      breadth: "SEVERE",
      leadership: "CONFIRMED",
      credit: "SEVERE",
      ratesDuration: "SEVERE",
      energyInflation: "CONFIRMED",
      volatility: "SEVERE",
      financialConditions: "CONFIRMED",
    },
  },
];

let passed = 0;
for (const scenario of scenarios) {
  const actual = resolveEngine29StructuralState(bundle(scenario.states)).state;
  const ok = actual === scenario.expected;
  console.log(`${ok ? "PASS" : "FAIL"} ${scenario.name}: expected=${scenario.expected} actual=${actual}`);
  if (ok) passed += 1;
}

if (passed !== scenarios.length) {
  console.error(`ENGINE29 PHASE5 ACCEPTANCE FAIL: ${passed}/${scenarios.length}`);
  process.exit(1);
}

console.log(`ENGINE29 PHASE5 ACCEPTANCE PASS: ${passed}/${scenarios.length}`);
