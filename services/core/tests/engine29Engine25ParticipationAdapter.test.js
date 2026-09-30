// services/core/tests/engine29Engine25ParticipationAdapter.test.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ENGINE25_PARTICIPATION_SCHEMA,
  readEngine25Participation,
} from "../logic/engine29/participation/readEngine25Participation.js";
import { readEngine25TrapParticipation } from "../logic/engine29/trapDetection/readEngine25TrapParticipation.js";
import { resolveEngine29TrapState } from "../logic/engine29/trapDetection/resolveTrapState.js";
import {
  ENGINE29_TRAP_SIDES,
  ENGINE29_TRAP_STATES,
} from "../logic/engine29/trapDetection/trapConstants.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "e29-e25-participation-"));
}

function stockVolume({
  available = true,
  coveragePct = 88,
  volumePressure = 86,
} = {}) {
  return {
    available,
    coverage: {
      minimumRequiredPct: 70,
      intradayPct: coveragePct,
      eodPct: 91,
    },
    intraday: {
      timeFrame: "intraday",
      available,
      stocksScanned: 5470,
      stocksWithVolume: 4814,
      coveragePct,
      advancingVolume: 10,
      decliningVolume: 30,
      unchangedVolume: 60,
      directionalVolume: 40,
      advancingVolumeShare: 0.25,
      decliningVolumeShare: 0.75,
      volumeImbalance: 0.5,
      volumePressure,
      reason: available ? null : "VOLUME_COVERAGE_BELOW_70_PERCENT",
    },
    eod: {
      timeFrame: "eod",
      available: true,
      stocksScanned: 5470,
      stocksWithVolume: 5000,
      coveragePct: 91,
      advancingVolume: 20,
      decliningVolume: 40,
      unchangedVolume: 80,
      directionalVolume: 60,
      advancingVolumeShare: 1 / 3,
      decliningVolumeShare: 2 / 3,
      volumeImbalance: 1 / 3,
      volumePressure: 90,
      reason: null,
    },
    combinedVolumePressure: volumePressure,
    combination: "60PCT_INTRADAY_40PCT_EOD",
  };
}

function artifact({
  usable = true,
  state = "FRESH",
  reason = "ACTIVE_EQUITY_SESSION_CURRENT_VALID_SOURCE",
  breadthLabel = "BREADTH_PARTICIPATION_WEAK",
  breadthScore = 32,
  distributionLabel = "DISTRIBUTION_PRESSURE_HIGH",
  distributionScore = 22,
  rawPressure = 78,
  intradayVolumeAvailable = true,
  coveragePct = 88,
  eodValid = true,
} = {}) {
  const volume = stockVolume({
    available: intradayVolumeAvailable,
    coveragePct,
  });

  const breadth = {
    score: breadthScore,
    label: breadthLabel,
    inputs: {
      breadthScore: 10,
      momentumScore: 20,
      sectorParticipationScore: 30,
      netHighsLowsScore: 40,
      intraday: {
        avgBreadth: 31,
        avgMomentum: 34,
        bullishCount: 0,
        neutralCount: 2,
        bearishCount: 9,
        totalNetHighsLows: -296,
      },
      eod: {
        avgBreadth: 38,
        avgMomentum: 40,
        bullishCount: 1,
        neutralCount: 3,
        bearishCount: 7,
        totalNetHighsLows: -500,
      },
    },
  };

  const distributionPressure = {
    score: distributionScore,
    label: distributionLabel,
    rawPressure,
    inputs: {
      legacyRawPressure: 70,
      volumeEvidence: volume,
    },
    warnings: [],
  };

  return {
    ok: true,
    engine: "engine25.participation.v1",
    schema: ENGINE25_PARTICIPATION_SCHEMA,
    generatedAt: "2026-09-30T15:05:00.000Z",
    authority: {
      owner: "ENGINE25",
      scannerBreadth: "PRIMARY",
      sectorParticipation: "PRIMARY",
      stockVolume: "PRIMARY",
      distributionPressure: "PRIMARY",
      packagerRole: "PACKAGE_VALIDATE_TIMESTAMP_PERSIST_EXPOSE_ONLY",
    },
    participation: {
      breadth,
      sectorParticipation: {
        intraday: { count: 11, bullishCount: 0, neutralCount: 2, bearishCount: 9 },
        eod: { count: 11, bullishCount: 1, neutralCount: 3, bearishCount: 7 },
      },
      momentum: {
        intradayAvgMomentum: 34,
        eodAvgMomentum: 40,
      },
      newHighsNewLows: {
        intradayNetHighsLows: -296,
        eodNetHighsLows: -500,
      },
      upDown: {
        intradayUp: 400,
        intradayDown: 1000,
        eodUp: 600,
        eodDown: 1600,
      },
      distributionPressure,
      stockVolume: volume,
    },
    sources: {
      intraday: {
        ok: true,
        updatedAt: "2026-09-30T15:04:00.000Z",
        sourceTimestamp: "2026-09-30T15:04:00.000Z",
        sectorCardsCount: 11,
      },
      eod: {
        ok: true,
        updatedAt: "2026-09-29T20:05:00.000Z",
        sourceTimestamp: "2026-09-29T20:05:00.000Z",
        sessionDate: "2026-09-29",
        sectorCardsCount: 11,
      },
    },
    freshness: {
      equityScannerSession: {
        active: usable,
        timeZone: "America/New_York",
        date: "2026-09-30",
        session: usable
          ? "REGULAR_EQUITY_SESSION"
          : "OUTSIDE_EQUITY_SCANNER_SESSION",
      },
      intraday: {
        sourceTimestamp: "2026-09-30T15:04:00.000Z",
        ageMs: 60000,
        fresh: usable && state === "FRESH",
        sourceHealthy: !["MISSING_INTRADAY_SOURCE", "INVALID_INTRADAY_SOURCE"].includes(state),
        sourceCurrent: state !== "STALE_INTRADAY_SOURCE",
        volumeCoverageValid: state !== "INSUFFICIENT_VOLUME_COVERAGE",
        maxAgeMs: 900000,
        state,
        reason,
      },
      eod: {
        sourceTimestamp: "2026-09-29T20:05:00.000Z",
        sessionDate: "2026-09-29",
        expectedSessionDate: "2026-09-29",
        valid: eodValid,
        sourceHealthy: true,
        reason: eodValid
          ? "EXPECTED_COMPLETED_EQUITY_SESSION_PRESENT"
          : "EOD_SESSION_DATE_MISMATCH",
      },
      usableForTrapConfirmation: usable,
      state,
      reason,
    },
    compatibility: {
      legacyArtifact: "engine25-sector-health-test.json",
      underlyingTruthSource: "buildEngine25SectorHealth()",
      packagerRecalculatesParticipation: false,
    },
  };
}

function writeArtifact(dir, value, name = "engine25-participation.json") {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

function withArtifact(options, callback) {
  const dir = tempDir();
  try {
    const value = artifact(options);
    const filePath = writeArtifact(dir, value);
    return callback({ dir, filePath, value });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("1 valid new E25 artifact is read", () => {
  withArtifact({}, ({ filePath }) => {
    const result = readEngine25Participation({ filePath });
    assert.equal(result.contractValid, true);
    assert.equal(result.schema, ENGINE25_PARTICIPATION_SCHEMA);
  });
});

test("2 canonical Breadth is consumed unchanged", () => {
  withArtifact({}, ({ filePath, value }) => {
    const result = readEngine25Participation({ filePath });
    assert.deepEqual(
      result.participation.breadth,
      value.participation.breadth
    );
  });
});

test("3 canonical Distribution is consumed unchanged", () => {
  withArtifact({}, ({ filePath, value }) => {
    const result = readEngine25Participation({ filePath });
    assert.deepEqual(
      result.participation.distributionPressure,
      value.participation.distributionPressure
    );
  });
});

test("4 canonical stock-volume evidence is consumed unchanged", () => {
  withArtifact({}, ({ filePath, value }) => {
    const result = readEngine25Participation({ filePath });
    assert.deepEqual(
      result.participation.stockVolume,
      value.participation.stockVolume
    );
  });
});

test("5 usable=true permits SUPPORT", () => {
  withArtifact({}, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.available, true);
    assert.equal(result.breadthAlignment, "SUPPORTS_TRAP");
    assert.equal(result.volumeAlignment, "SUPPORTS_TRAP");
    assert.equal(result.primaryParticipationSupportsTrap, true);
  });
});

test("6 usable=true permits OPPOSE", () => {
  withArtifact({
    breadthLabel: "BREADTH_PARTICIPATION_HEALTHY",
    breadthScore: 82,
    distributionLabel: "DISTRIBUTION_PRESSURE_LOW",
    distributionScore: 90,
    rawPressure: 10,
  }, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.available, true);
    assert.equal(result.breadthAlignment, "OPPOSES_TRAP");
    assert.equal(result.volumeAlignment, "OPPOSES_TRAP");
    assert.equal(result.primaryParticipationOpposesTrap, true);
  });
});

test("7 usable=true permits NEUTRAL", () => {
  withArtifact({
    breadthLabel: "BREADTH_PARTICIPATION_MIXED",
    breadthScore: 62,
    distributionLabel: "DISTRIBUTION_PRESSURE_WATCH",
    distributionScore: 68,
    rawPressure: 32,
  }, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.available, true);
    assert.equal(result.breadthAlignment, "NEUTRAL");
    assert.equal(result.volumeAlignment, "NEUTRAL");
    assert.equal(result.primaryParticipationSupportsTrap, false);
    assert.equal(result.primaryParticipationOpposesTrap, false);
  });
});

test("8 usable=false forces UNAVAILABLE", () => {
  withArtifact({ usable: false }, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.available, false);
    assert.equal(result.breadthAlignment, "UNAVAILABLE");
    assert.equal(result.volumeAlignment, "UNAVAILABLE");
    assert.equal(result.primaryParticipationSupportsTrap, false);
    assert.equal(result.primaryParticipationOpposesTrap, false);
  });
});

for (const [index, state, reason] of [
  [9, "OUTSIDE_EQUITY_SCANNER_SESSION", "CURRENT_INTRADAY_CONFIRMATION_UNAVAILABLE_OUTSIDE_EQUITY_SESSION"],
  [10, "STALE_INTRADAY_SOURCE", "INTRADAY_SOURCE_OLDER_THAN_MAX_AGE"],
  [11, "MISSING_INTRADAY_SOURCE", "INTRADAY_SOURCE_OR_TIMESTAMP_MISSING"],
  [12, "INSUFFICIENT_VOLUME_COVERAGE", "VOLUME_COVERAGE_BELOW_70_PERCENT"],
]) {
  test(`${index} ${state} cannot SUPPORT or OPPOSE`, () => {
    withArtifact({
      usable: false,
      state,
      reason,
      intradayVolumeAvailable: state !== "INSUFFICIENT_VOLUME_COVERAGE",
      coveragePct: state === "INSUFFICIENT_VOLUME_COVERAGE" ? 62 : 88,
    }, ({ filePath }) => {
      const result = readEngine25TrapParticipation({
        trapSide: ENGINE29_TRAP_SIDES.BULL,
        filePath,
      });
      assert.equal(result.available, false);
      assert.equal(result.breadthAlignment, "UNAVAILABLE");
      assert.equal(result.volumeAlignment, "UNAVAILABLE");
      assert.equal(result.primaryParticipationSupportsTrap, false);
      assert.equal(result.primaryParticipationOpposesTrap, false);
      assert.equal(result.freshness.state, state);
    });
  });
}

test("13 valid EOD alone cannot override unusable intraday", () => {
  withArtifact({
    usable: false,
    state: "STALE_INTRADAY_SOURCE",
    reason: "INTRADAY_SOURCE_OLDER_THAN_MAX_AGE",
    eodValid: true,
  }, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.source.diagnostics.eod.valid, true);
    assert.equal(result.available, false);
  });
});

test("14 last-known intraday remains diagnostic only", () => {
  withArtifact({
    usable: false,
    state: "OUTSIDE_EQUITY_SCANNER_SESSION",
    reason: "CURRENT_INTRADAY_CONFIRMATION_UNAVAILABLE_OUTSIDE_EQUITY_SESSION",
  }, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(
      result.source.diagnostics.lastKnownIntraday.breadth.avgBreadth,
      31
    );
    assert.equal(
      result.source.diagnostics.lastKnownIntraday.stockVolume.coveragePct,
      88
    );
    assert.equal(result.available, false);
  });
});

test("15 missing new artifact fails closed", () => {
  const dir = tempDir();
  try {
    const filePath = path.join(dir, "engine25-participation.json");
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.available, false);
    assert.ok(
      result.reasonCodes.includes("ENGINE25_PARTICIPATION_ARTIFACT_MISSING")
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("16 malformed new artifact fails closed", () => {
  const dir = tempDir();
  try {
    const filePath = path.join(dir, "engine25-participation.json");
    fs.writeFileSync(filePath, "{bad-json", "utf8");
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });
    assert.equal(result.available, false);
    assert.ok(
      result.reasonCodes.includes("ENGINE25_PARTICIPATION_ARTIFACT_MALFORMED")
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("17 legacy artifact is not silently used for live SUPPORT or OPPOSE", () => {
  const dir = tempDir();
  try {
    writeArtifact(dir, {
      ok: true,
      breadthParticipation: {
        score: 32,
        label: "BREADTH_PARTICIPATION_WEAK",
      },
      distributionPressure: {
        score: 22,
        label: "DISTRIBUTION_PRESSURE_HIGH",
      },
    }, "engine25-sector-health-test.json");

    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath: path.join(dir, "engine25-participation.json"),
    });

    assert.equal(result.available, false);
    assert.equal(result.primaryParticipationSupportsTrap, false);
    assert.equal(result.primaryParticipationOpposesTrap, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("18 trapDetection participation primary downstream shape remains compatible", () => {
  withArtifact({}, ({ filePath }) => {
    const result = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath,
    });

    for (const key of [
      "available",
      "filePath",
      "sourceUpdatedAt",
      "sourceAgeMinutes",
      "trapSide",
      "breadth",
      "stockVolume",
      "breadthAlignment",
      "volumeAlignment",
      "primaryParticipationSupportsTrap",
      "primaryParticipationOpposesTrap",
      "reasonCodes",
    ]) {
      assert.ok(Object.hasOwn(result, key), `missing downstream key ${key}`);
    }
  });
});

test("19 MOVE ownership source is not imported or invoked by E25 adapter", () => {
  const source = fs.readFileSync(
    new URL("../logic/engine29/participation/readEngine25Participation.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /buildTacticalCharacter|resolveMoveCharacter|resolveDirectionalMoveParent/);
});

test("20 LIQUIDITY ownership source is not imported or invoked by E25 adapter", () => {
  const source = fs.readFileSync(
    new URL("../logic/engine29/participation/readEngine25Participation.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /detectLiquiditySweep|detectTrapAuctionEvent|readInstitutionalLiquidity/);
});

test("21 squeeze ownership source is not imported or invoked by E25 adapter", () => {
  const source = fs.readFileSync(
    new URL("../logic/engine29/participation/readEngine25Participation.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /detectSqueezeCharacter|detectBroadConfirmation|buildSqueezeTransitionMonitor/);
});

test("22 canonical trap event/state is identical when E25 changes SUPPORT to UNAVAILABLE at TRAP_WATCH", () => {
  const market = {
    auctionEvent: {
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      reclaimObserved: true,
      failedAcceptance: false,
      reasonCodes: [],
    },
    macroLiquidityMap: {
      locationQuality: "VERY_HIGH",
      reasonCodes: [],
    },
    momentumRepair: {
      state: "STRONG_CONFIRMATION",
      reasonCodes: [],
    },
    secondaryConfirmation: {
      secondarySupportsTrap: true,
      secondaryOpposesTrap: false,
      reasonCodes: [],
    },
  };

  const supportive = resolveEngine29TrapState({
    ...market,
    primaryParticipation: {
      available: true,
      primaryParticipationSupportsTrap: true,
      primaryParticipationOpposesTrap: false,
      reasonCodes: [],
    },
  });

  const unavailable = resolveEngine29TrapState({
    ...market,
    primaryParticipation: {
      available: false,
      primaryParticipationSupportsTrap: false,
      primaryParticipationOpposesTrap: false,
      reasonCodes: [],
    },
  });

  assert.equal(supportive.trapSide, ENGINE29_TRAP_SIDES.BULL);
  assert.equal(unavailable.trapSide, ENGINE29_TRAP_SIDES.BULL);
  assert.equal(supportive.state, ENGINE29_TRAP_STATES.TRAP_WATCH);
  assert.equal(unavailable.state, ENGINE29_TRAP_STATES.TRAP_WATCH);
  assert.equal(supportive.state, unavailable.state);
});

test("23 only E25 trap participation context changes in fresh supportive vs unavailable reader pair", () => {
  const dir = tempDir();
  try {
    const freshPath = writeArtifact(dir, artifact(), "fresh.json");
    const unavailablePath = writeArtifact(
      dir,
      artifact({
        usable: false,
        state: "OUTSIDE_EQUITY_SCANNER_SESSION",
        reason: "CURRENT_INTRADAY_CONFIRMATION_UNAVAILABLE_OUTSIDE_EQUITY_SESSION",
      }),
      "unavailable.json"
    );

    const fresh = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath: freshPath,
    });
    const unavailable = readEngine25TrapParticipation({
      trapSide: ENGINE29_TRAP_SIDES.BULL,
      filePath: unavailablePath,
    });

    assert.equal(fresh.primaryParticipationSupportsTrap, true);
    assert.equal(fresh.available, true);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.primaryParticipationSupportsTrap, false);
    assert.deepEqual(fresh.breadth.score, unavailable.breadth.score);
    assert.deepEqual(
      fresh.stockVolume.combinedVolumePressure,
      unavailable.stockVolume.combinedVolumePressure
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("24 no Engine25 refresh is triggered by adapter or trap reader", () => {
  const adapterSource = fs.readFileSync(
    new URL("../logic/engine29/participation/readEngine25Participation.js", import.meta.url),
    "utf8"
  );
  const readerSource = fs.readFileSync(
    new URL("../logic/engine29/trapDetection/readEngine25TrapParticipation.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(adapterSource + readerSource, /updateEngine25|engine25\/refresh|buildEngine25Full/);
});

test("25 no scanner or Engine25 participation calculation is triggered", () => {
  const adapterSource = fs.readFileSync(
    new URL("../logic/engine29/participation/readEngine25Participation.js", import.meta.url),
    "utf8"
  );
  const readerSource = fs.readFileSync(
    new URL("../logic/engine29/trapDetection/readEngine25TrapParticipation.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    adapterSource + readerSource,
    /buildEngine25SectorHealth|buildSectorHealth|scanUniverse|runScanner/
  );
});
