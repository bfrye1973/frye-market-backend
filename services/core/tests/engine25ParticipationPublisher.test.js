// services/core/tests/engine25ParticipationPublisher.test.js

import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildEngine25ParticipationArtifact,
  DEFAULT_INTRADAY_MAX_AGE_MS,
} from "../logic/engine25/buildParticipationArtifact.js";
import {
  publishEngine25Participation,
  runEngine25ParticipationPublisher,
} from "../jobs/updateEngine25Participation.js";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const ACTIVE_NOW = Date.parse("2026-09-30T15:00:00.000Z"); // 11:00 ET
const AFTER_CLOSE_NOW = Date.parse("2026-09-30T21:00:00.000Z"); // 17:00 ET
const OVERNIGHT_NOW = Date.parse("2026-10-01T02:00:00.000Z"); // 22:00 ET

function emptyCanonicalInputs() {
  return {
    routes: {
      intraday: "/live/intraday",
      hourly: "/live/hourly",
      fourHour: "/live/4h",
      eod: "/live/eod",
    },
    intraday: null,
    hourly: null,
    fourHour: null,
    eod: null,
  };
}

function timeframeVolume(overrides = {}) {
  return {
    timeframe: "intraday",
    available: true,
    stocksScanned: 5470,
    stocksWithVolume: 4736,
    coveragePct: 86.58,
    advancingVolume: 29040000,
    decliningVolume: 86090000,
    unchangedVolume: 1000000,
    directionalVolume: 115130000,
    advancingVolumeShare: 0.2522,
    decliningVolumeShare: 0.7478,
    volumeImbalance: 0.4956,
    decliningSharePressure: 100,
    advancingSharePressure: 100,
    imbalancePressure: 100,
    volumePressure: 100,
    reason: null,
    uniqueSectorCount: 11,
    ...overrides,
  };
}

function canonicalSectorHealth(overrides = {}) {
  const intradayTs = new Date(ACTIVE_NOW - 2 * 60 * 1000).toISOString();
  const eodTs = "2026-09-29T21:30:00.000Z";

  const intradayVolume = timeframeVolume();
  const eodVolume = timeframeVolume({
    timeframe: "eod",
    stocksWithVolume: 5013,
    coveragePct: 91.65,
    advancingVolumeShare: 0.2166,
    decliningVolumeShare: 0.7834,
    volumeImbalance: 0.5669,
  });

  const base = {
    ok: true,
    engine: "engine25.sectorHealth.v0.1",
    updatedAt: intradayTs,
    sources: {
      intraday: {
        ok: true,
        updatedAt: intradayTs,
        sectorCardsCount: 11,
        url: "/live/intraday",
      },
      eod: {
        ok: true,
        updatedAt: eodTs,
        sectorCardsCount: 11,
        url: "/live/eod",
      },
    },
    intradaySummary: {
      count: 11,
      bullishCount: 2,
      neutralCount: 1,
      bearishCount: 8,
      bullishRatio: 2 / 11,
      bearishRatio: 8 / 11,
      avgBreadth: 33,
      avgMomentum: 31,
      totalNetHighsLows: -200,
      totalUp: 1200,
      totalDown: 4200,
      cards: [
        { sector: "Information Technology", nh: 80, nl: 140, breadth_pct: 34, momentum_pct: 31 },
        { sector: "Health Care", nh: 47, nl: 187, breadth_pct: 38, momentum_pct: 35 },
      ],
    },
    eodSummary: {
      count: 11,
      bullishCount: 1,
      neutralCount: 1,
      bearishCount: 9,
      bullishRatio: 1 / 11,
      bearishRatio: 9 / 11,
      avgBreadth: 30,
      avgMomentum: 29,
      totalNetHighsLows: -250,
      totalUp: 1100,
      totalDown: 4300,
      cards: [
        { sector: "Information Technology", nh: 70, nl: 160, breadth_pct: 31, momentum_pct: 29 },
        { sector: "Health Care", nh: 40, nl: 200, breadth_pct: 35, momentum_pct: 32 },
      ],
    },
    breadthParticipation: {
      score: 22,
      label: "BREADTH_PARTICIPATION_WEAK",
      inputs: {
        breadthScore: 20,
        momentumScore: 18,
        sectorParticipationScore: 25,
        netHighsLowsScore: 25,
        intraday: { avgBreadth: 33 },
        eod: { avgBreadth: 30 },
      },
      warnings: ["Breadth participation is weak"],
    },
    distributionPressure: {
      score: 2,
      label: "DISTRIBUTION_PRESSURE_HIGH",
      rawPressure: 98,
      inputs: {
        legacyRawPressure: 97,
        volumeEvidence: {
          available: true,
          coverage: {
            minimumRequiredPct: 70,
            intradayPct: 86.58,
            eodPct: 91.65,
          },
          intraday: intradayVolume,
          eod: eodVolume,
          combinedVolumePressure: 100,
          combination: "60PCT_INTRADAY_40PCT_EOD",
        },
        formula: {
          legacyPressureWeight: 0.7,
          volumePressureWeight: 0.3,
        },
      },
      warnings: [],
    },
  };

  return {
    ...base,
    ...overrides,
    sources: {
      ...base.sources,
      ...(overrides.sources || {}),
    },
  };
}

run("1 packages existing Breadth without recalculation", () => {
  const source = canonicalSectorHealth();
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.deepEqual(artifact.participation.breadth, source.breadthParticipation);
});

run("2 packages existing Distribution without recalculation", () => {
  const source = canonicalSectorHealth();
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.deepEqual(
    artifact.participation.distributionPressure,
    source.distributionPressure
  );
});

run("3 packages existing stock-volume values exactly", () => {
  const source = canonicalSectorHealth();
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.deepEqual(
    artifact.participation.stockVolume,
    source.distributionPressure.inputs.volumeEvidence
  );
});

run("4 exposes existing sector cards and NH NL totals without recalculation", () => {
  const source = canonicalSectorHealth();
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });

  assert.deepEqual(
    artifact.participation.sectorParticipation.intraday.cards,
    source.intradaySummary.cards
  );
  assert.deepEqual(
    artifact.participation.sectorParticipation.eod.cards,
    source.eodSummary.cards
  );
  assert.equal(artifact.participation.newHighsNewLows.intradayTotalNh, 127);
  assert.equal(artifact.participation.newHighsNewLows.intradayTotalNl, 327);
  assert.equal(artifact.participation.newHighsNewLows.eodTotalNh, 110);
  assert.equal(artifact.participation.newHighsNewLows.eodTotalNl, 360);
});

run("5 generatedAt cannot make stale scanner evidence fresh", () => {
  const source = canonicalSectorHealth({
    sources: {
      intraday: {
        ok: true,
        updatedAt: new Date(
          ACTIVE_NOW - DEFAULT_INTRADAY_MAX_AGE_MS - 1
        ).toISOString(),
        sectorCardsCount: 11,
      },
    },
  });
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.equal(artifact.generatedAt, new Date(ACTIVE_NOW).toISOString());
  assert.equal(artifact.freshness.intraday.state, "STALE_INTRADAY_SOURCE");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("6 active equity session + current healthy source -> usable", () => {
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: canonicalSectorHealth(),
    now: ACTIVE_NOW,
  });
  assert.equal(artifact.freshness.intraday.state, "FRESH");
  assert.equal(artifact.freshness.usableForTrapConfirmation, true);
});

run("7 stale intraday source -> unusable", () => {
  const source = canonicalSectorHealth();
  source.sources.intraday.updatedAt = new Date(
    ACTIVE_NOW - DEFAULT_INTRADAY_MAX_AGE_MS - 1
  ).toISOString();
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.equal(artifact.freshness.intraday.state, "STALE_INTRADAY_SOURCE");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("8 missing intraday source -> unusable", () => {
  const source = canonicalSectorHealth();
  source.sources.intraday = null;
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.equal(artifact.freshness.intraday.state, "MISSING_INTRADAY_SOURCE");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("9 invalid intraday source -> unusable", () => {
  const source = canonicalSectorHealth();
  source.sources.intraday.ok = false;
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.equal(artifact.freshness.intraday.state, "INVALID_INTRADAY_SOURCE");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("10 below 70% volume coverage -> unusable", () => {
  const source = canonicalSectorHealth();
  source.distributionPressure.inputs.volumeEvidence.intraday.available = false;
  source.distributionPressure.inputs.volumeEvidence.intraday.coveragePct = 69.99;
  source.distributionPressure.inputs.volumeEvidence.intraday.reason =
    "VOLUME_COVERAGE_BELOW_70_PERCENT";
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });
  assert.equal(
    artifact.freshness.intraday.state,
    "INSUFFICIENT_VOLUME_COVERAGE"
  );
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("11 outside equity scanner session -> current participation unavailable", () => {
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: canonicalSectorHealth(),
    now: OVERNIGHT_NOW,
  });
  assert.equal(
    artifact.freshness.intraday.state,
    "OUTSIDE_EQUITY_SCANNER_SESSION"
  );
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("12 overnight last observation is preserved diagnostically", () => {
  const source = canonicalSectorHealth();
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: OVERNIGHT_NOW,
  });
  assert.equal(
    artifact.sources.intraday.sourceTimestamp,
    source.sources.intraday.updatedAt
  );
  assert.deepEqual(artifact.participation.breadth, source.breadthParticipation);
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("13 correct completed EOD session -> EOD valid", () => {
  const source = canonicalSectorHealth();
  source.sources.eod.updatedAt = "2026-09-30T20:30:00.000Z";
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: AFTER_CLOSE_NOW,
  });
  assert.equal(artifact.freshness.eod.sessionDate, "2026-09-30");
  assert.equal(artifact.freshness.eod.expectedSessionDate, "2026-09-30");
  assert.equal(artifact.freshness.eod.valid, true);
});

run("14 wrong EOD session -> EOD invalid", () => {
  const source = canonicalSectorHealth();
  source.sources.eod.updatedAt = "2026-09-29T20:30:00.000Z";
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: AFTER_CLOSE_NOW,
  });
  assert.equal(artifact.freshness.eod.valid, false);
  assert.equal(artifact.freshness.eod.reason, "EOD_SESSION_DATE_MISMATCH");
});

run("15 valid EOD alone cannot manufacture fresh intraday", () => {
  const source = canonicalSectorHealth();
  source.sources.eod.updatedAt = "2026-09-30T20:30:00.000Z";
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: OVERNIGHT_NOW,
  });
  assert.equal(artifact.freshness.eod.valid, true);
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("16 compatibility artifact remains available", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e25-participation-"));
  const participationFile = path.join(dir, "engine25-participation.json");
  const legacyFile = path.join(dir, "engine25-sector-health-test.json");
  publishEngine25Participation({
    sectorHealth: canonicalSectorHealth(),
    now: ACTIVE_NOW,
    participationFile,
    legacyFile,
  });
  assert.equal(fs.existsSync(participationFile), true);
  assert.equal(fs.existsSync(legacyFile), true);
});

run("17 new and legacy artifacts contain equivalent underlying truth", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e25-participation-"));
  const participationFile = path.join(dir, "engine25-participation.json");
  const legacyFile = path.join(dir, "engine25-sector-health-test.json");
  const source = canonicalSectorHealth();

  publishEngine25Participation({
    sectorHealth: source,
    now: ACTIVE_NOW,
    participationFile,
    legacyFile,
  });

  const next = JSON.parse(fs.readFileSync(participationFile, "utf8"));
  const legacy = JSON.parse(fs.readFileSync(legacyFile, "utf8"));

  assert.deepEqual(next.participation.breadth, legacy.breadthParticipation);
  assert.deepEqual(
    next.participation.distributionPressure,
    legacy.distributionPressure
  );
  assert.deepEqual(
    next.participation.stockVolume,
    legacy.distributionPressure.inputs.volumeEvidence
  );
});

await runAsync("18 no Engine29 refresh is triggered", async () => {
  let buildCount = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e25-participation-"));

  await runEngine25ParticipationPublisher({
    loadCanonicalInputs: async () => emptyCanonicalInputs(),
    buildSectorHealth: async () => {
      buildCount += 1;
      return canonicalSectorHealth();
    },
    now: ACTIVE_NOW,
    participationFile: path.join(dir, "new.json"),
    legacyFile: path.join(dir, "legacy.json"),
  });

  assert.equal(buildCount, 1);
});

await runAsync("19 no second scanner is invoked", async () => {
  let scannerDerivedBuildCount = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "e25-participation-"));

  await runEngine25ParticipationPublisher({
    loadCanonicalInputs: async () => emptyCanonicalInputs(),
    buildSectorHealth: async () => {
      scannerDerivedBuildCount += 1;
      return canonicalSectorHealth();
    },
    now: ACTIVE_NOW,
    participationFile: path.join(dir, "new.json"),
    legacyFile: path.join(dir, "legacy.json"),
  });

  assert.equal(scannerDerivedBuildCount, 1);
});

run("20 no second Distribution calculation is introduced", () => {
  const source = canonicalSectorHealth();
  const sentinel = 37.123456;
  source.distributionPressure.rawPressure = sentinel;
  source.distributionPressure.inputs.volumeEvidence.combinedVolumePressure =
    88.7654321;

  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: source,
    now: ACTIVE_NOW,
  });

  assert.equal(artifact.participation.distributionPressure.rawPressure, sentinel);
  assert.equal(
    artifact.participation.stockVolume.combinedVolumePressure,
    88.7654321
  );
});

console.log("Engine25 participation publisher acceptance tests PASS");
