// services/core/tests/engine25BreadthAuthority.test.js

import assert from "node:assert/strict";
import { buildBreadthAuthority } from "../logic/engine25/engine29/buildBreadthAuthority.js";

function scanner({
  score = 60,
  label = "BREADTH_PARTICIPATION_MIXED",
  ok = true,
  intradayOk = true,
  eodOk = true,
  warnings = ["scanner-warning"],
} = {}) {
  return {
    ok,
    sources: {
      intraday: { ok: intradayOk },
      eod: { ok: eodOk },
    },
    breadthParticipation: {
      score,
      label,
      inputs: { source: "scanner" },
      warnings,
    },
  };
}

function engine29({
  structural = "HEALTHY",
  tactical = "HEALTHY",
  fast = "HEALTHY",
  degradedGroups = [],
  layerDegraded = false,
  missingRequiredMembers = [],
} = {}) {
  const layer = (state) => ({
    state,
    dataDegraded: layerDegraded,
    missingRequiredMembers,
  });

  return {
    dataQuality: { degradedGroups },
    groups: {
      breadth: {
        structural: layer(structural),
        tactical: layer(tactical),
        fastTactical: layer(fast),
      },
    },
  };
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

run("1 valid scanner + valid Engine29 -> scanner primary", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 61 }),
    engine29Data: engine29(),
  });
  assert.equal(result.score, 61);
  assert.equal(result.authority, "ENGINE25_SCANNER_BREADTH_PRIMARY");
  assert.equal(result.primarySource, "ENGINE25_SECTOR_BREADTH");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.scannerBreadthAvailable, true);
  assert.equal(result.engine29Confirmation.available, true);
  assert.deepEqual(result.warnings, ["scanner-warning"]);
});

run("2 valid scanner + degraded Engine29 -> scanner remains primary", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 58 }),
    engine29Data: engine29({ degradedGroups: ["breadth"] }),
  });
  assert.equal(result.score, 58);
  assert.equal(result.authority, "ENGINE25_SCANNER_BREADTH_PRIMARY");
  assert.equal(result.engine29Confirmation.available, false);
});

run("3 valid scanner + missing Engine29 -> scanner remains primary", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 57 }),
    engine29Data: null,
  });
  assert.equal(result.score, 57);
  assert.equal(result.authority, "ENGINE25_SCANNER_BREADTH_PRIMARY");
  assert.equal(result.engine29Confirmation.available, false);
});

run("4 missing scanner + valid Engine29 -> explicit Engine29 fallback", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: null,
    engine29Data: engine29({ structural: "CONFIRMED", tactical: "FORMING", fast: "FORMING" }),
  });
  assert.equal(result.authority, "ENGINE29_BREADTH_FALLBACK");
  assert.equal(result.primarySource, "ENGINE29_GROUPS_BREADTH");
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.scannerBreadthAvailable, false);
  assert.equal(result.score, 51);
});

run("5 invalid scanner + degraded Engine29 -> UNKNOWN fail-safe", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ ok: false }),
    engine29Data: engine29({ layerDegraded: true }),
  });
  assert.equal(result.score, 50);
  assert.equal(result.label, "BREADTH_PARTICIPATION_UNKNOWN");
  assert.equal(result.authority, "BREADTH_AUTHORITY_UNAVAILABLE");
  assert.equal(result.engine29Confirmation.available, false);
});

run("6 scanner and Engine29 disagreement -> diagnostic divergence only", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 70 }),
    engine29Data: engine29({ structural: "CONFIRMED", tactical: "CONFIRMED", fast: "CONFIRMED" }),
  });
  assert.equal(result.score, 70);
  assert.equal(result.engine29Confirmation.score, 35);
  assert.equal(result.engine29Confirmation.scannerBand, "SUPPORTIVE");
  assert.equal(result.engine29Confirmation.engine29Band, "WEAK");
  assert.equal(result.engine29Confirmation.comparison, "DIVERGENT");
});

run("7 Engine29 confirmation never modifies scanner score", () => {
  for (const states of [
    ["HEALTHY", "HEALTHY", "HEALTHY"],
    ["SEVERE", "SEVERE", "SEVERE"],
    ["CONFIRMED", "FORMING", "RECOVERING"],
  ]) {
    const result = buildBreadthAuthority({
      sectorHealthData: scanner({ score: 63 }),
      engine29Data: engine29({
        structural: states[0],
        tactical: states[1],
        fast: states[2],
      }),
    });
    assert.equal(result.score, 63);
    assert.equal(result.authority, "ENGINE25_SCANNER_BREADTH_PRIMARY");
  }
});

run("8 old Engine29 primary authority can never be returned", () => {
  const cases = [
    buildBreadthAuthority({ sectorHealthData: scanner(), engine29Data: engine29() }),
    buildBreadthAuthority({ sectorHealthData: null, engine29Data: engine29() }),
    buildBreadthAuthority({ sectorHealthData: null, engine29Data: null }),
  ];
  for (const result of cases) {
    assert.notEqual(result.authority, "ENGINE29_GROUPS_BREADTH_PRIMARY");
  }
});

run("9 finite scanner score but intraday unavailable -> Engine29 fallback", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 64, intradayOk: false }),
    engine29Data: engine29(),
  });
  assert.equal(result.authority, "ENGINE29_BREADTH_FALLBACK");
  assert.equal(result.scannerBreadthAvailable, false);
  assert.ok(result.scannerInvalidReasons.includes("SCANNER_INTRADAY_SOURCE_UNAVAILABLE"));
});

run("10 finite scanner score but EOD unavailable -> Engine29 fallback", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 64, eodOk: false }),
    engine29Data: engine29(),
  });
  assert.equal(result.authority, "ENGINE29_BREADTH_FALLBACK");
  assert.equal(result.scannerBreadthAvailable, false);
  assert.ok(result.scannerInvalidReasons.includes("SCANNER_EOD_SOURCE_UNAVAILABLE"));
});

run("approved 20/40/40 Engine29 diagnostic scoring and bands", () => {
  const result = buildBreadthAuthority({
    sectorHealthData: scanner({ score: 50 }),
    engine29Data: engine29({ structural: "CONFIRMED", tactical: "FORMING", fast: "FORMING" }),
  });
  assert.equal(result.engine29Confirmation.score, 51);
  assert.equal(result.engine29Confirmation.scannerBand, "WEAK");
  assert.equal(result.engine29Confirmation.engine29Band, "WEAK");
  assert.equal(result.engine29Confirmation.comparison, "ALIGNED");
});

console.log("Engine25 breadth authority tests PASS");
