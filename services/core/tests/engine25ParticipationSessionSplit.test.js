// services/core/tests/engine25ParticipationSessionSplit.test.js

import assert from "node:assert/strict";
import {
  buildEngine25ParticipationArtifact,
  resolveSystemOperatingSession,
  resolveEquityScannerSession,
} from "../logic/engine25/buildParticipationArtifact.js";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function sectorHealth({
  sourceTimestamp,
  sourceOk = true,
  sectorCardsCount = 11,
  volumeAvailable = true,
} = {}) {
  return {
    ok: sourceOk,
    sources: {
      intraday: {
        ok: sourceOk,
        updatedAt: sourceTimestamp,
        sectorCardsCount,
      },
      eod: {
        ok: true,
        updatedAt: "2026-10-01T20:00:00Z",
        sectorCardsCount: 11,
      },
    },
    intradaySummary: {
      count: 11,
      bullishCount: 4,
      neutralCount: 4,
      bearishCount: 3,
      bullishRatio: 4 / 11,
      bearishRatio: 3 / 11,
      avgMomentum: 50,
      totalNetHighsLows: 0,
      totalUp: 100,
      totalDown: 100,
      cards: [],
    },
    eodSummary: {
      count: 11,
      bullishCount: 4,
      neutralCount: 4,
      bearishCount: 3,
      bullishRatio: 4 / 11,
      bearishRatio: 3 / 11,
      avgMomentum: 50,
      totalNetHighsLows: 0,
      totalUp: 100,
      totalDown: 100,
      cards: [],
    },
    breadthParticipation: {
      score: 50,
      label: "BREADTH_PARTICIPATION_MIXED",
    },
    distributionPressure: {
      score: 50,
      label: "DISTRIBUTION_PRESSURE_ELEVATED",
      inputs: {
        volumeEvidence: {
          intraday: {
            available: volumeAvailable,
            reason: volumeAvailable ? "OK" : "INSUFFICIENT_VOLUME_COVERAGE",
          },
          eod: {
            available: true,
          },
        },
      },
    },
  };
}

run("1 equity open + fresh source => FRESH", () => {
  const now = Date.parse("2026-09-30T18:00:00Z"); // 14:00 ET
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({
      sourceTimestamp: "2026-09-30T17:55:00Z",
    }),
    now,
  });

  assert.equal(artifact.freshness.equityScannerSession.active, true);
  assert.equal(artifact.freshness.intraday.state, "FRESH");
  assert.equal(artifact.freshness.usableForTrapConfirmation, true);
});

run("2 equity open + source older than 15m => STALE_INTRADAY_SOURCE", () => {
  const now = Date.parse("2026-09-30T18:00:00Z"); // 14:00 ET
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({
      sourceTimestamp: "2026-09-30T17:30:00Z",
    }),
    now,
  });

  assert.equal(artifact.freshness.equityScannerSession.active, true);
  assert.equal(artifact.freshness.intraday.state, "STALE_INTRADAY_SOURCE");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("3 equity closed + valid completed-session observation => LAST_VALID_EQUITY_READ", () => {
  const now = Date.parse("2026-10-01T23:00:00Z"); // 19:00 ET / 18:00 CT
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({
      sourceTimestamp: "2026-10-01T19:59:00Z", // 15:59 ET
    }),
    now,
  });

  assert.equal(artifact.freshness.equityScannerSession.active, false);
  assert.equal(artifact.freshness.intraday.state, "LAST_VALID_EQUITY_READ");
  assert.equal(artifact.freshness.intraday.reason, "EQUITY_SESSION_CLOSED");
  assert.equal(artifact.freshness.lastValidEquityRead, true);
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("4 equity closed + no usable prior observation => UNAVAILABLE", () => {
  const now = Date.parse("2026-10-01T23:00:00Z");
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({
      sourceTimestamp: null,
      sourceOk: false,
      sectorCardsCount: 0,
    }),
    now,
  });

  assert.equal(artifact.freshness.equityScannerSession.active, false);
  assert.equal(artifact.freshness.intraday.state, "UNAVAILABLE");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("5 ES Globex active while equity closed => system operational, equity context last-valid", () => {
  const now = Date.parse("2026-10-01T23:00:00Z"); // Thu 18:00 CT
  const system = resolveSystemOperatingSession(now);
  const equity = resolveEquityScannerSession(now);
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({
      sourceTimestamp: "2026-10-01T19:59:00Z",
    }),
    now,
  });

  assert.equal(system.operating, true);
  assert.equal(system.session, "ES_GLOBEX");
  assert.equal(equity.active, false);
  assert.equal(artifact.freshness.systemOperatingSession.operating, true);
  assert.equal(artifact.freshness.intraday.state, "LAST_VALID_EQUITY_READ");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("6 Globex maintenance interval => system not actively operating", () => {
  const now = Date.parse("2026-10-01T21:30:00Z"); // Thu 16:30 CT
  const system = resolveSystemOperatingSession(now);
  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({
      sourceTimestamp: "2026-10-01T19:59:00Z",
    }),
    now,
  });

  assert.equal(system.operating, false);
  assert.equal(system.session, "MAINTENANCE");
  assert.equal(artifact.freshness.systemOperatingSession.operating, false);
  assert.equal(artifact.freshness.intraday.state, "LAST_VALID_EQUITY_READ");
  assert.equal(artifact.freshness.usableForTrapConfirmation, false);
});

run("7 last-valid source timestamp is preserved while artifact generatedAt advances", () => {
  const sourceTimestamp = "2026-10-01T19:59:00Z";
  const first = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({ sourceTimestamp }),
    now: Date.parse("2026-10-01T23:00:00Z"),
  });
  const second = buildEngine25ParticipationArtifact({
    sectorHealth: sectorHealth({ sourceTimestamp }),
    now: Date.parse("2026-10-01T23:10:00Z"),
  });

  assert.equal(first.freshness.intraday.sourceTimestamp, sourceTimestamp);
  assert.equal(second.freshness.intraday.sourceTimestamp, sourceTimestamp);
  assert.notEqual(first.generatedAt, second.generatedAt);
  assert.equal(second.freshness.intraday.state, "LAST_VALID_EQUITY_READ");
});

run("8 Sunday EOD metadata recognizes Friday completed session even when published Sunday",()=>{
  const now=Date.parse("2026-11-08T19:00:00Z");
  const source=sectorHealth({sourceTimestamp:"2026-11-06T20:59:00Z"});
  source.sources.eod.updatedAt="2026-11-08T18:39:56Z";
  source.sources.eod.completedSessionDate="2026-11-06";
  const artifact=buildEngine25ParticipationArtifact({sectorHealth:source,now});
  assert.equal(artifact.freshness.eod.sessionDate,"2026-11-06");
  assert.equal(artifact.freshness.eod.valid,true);
  assert.equal(artifact.freshness.eod.expectedSessionDate,"2026-11-06");
  assert.equal(artifact.freshness.equityScannerSession.active,false);
  assert.equal(artifact.freshness.usableForTrapConfirmation,false);
});
run("9 Sunday publication without verified Friday session is not accepted",()=>{
  const now=Date.parse("2026-11-08T19:00:00Z");
  const source=sectorHealth({sourceTimestamp:"2026-11-06T20:59:00Z"});
  source.sources.eod.updatedAt="2026-11-08T18:39:56Z";
  const artifact=buildEngine25ParticipationArtifact({sectorHealth:source,now});
  assert.equal(artifact.freshness.eod.valid,false);
});
run("10 Thursday EOD remains stale on Sunday regardless of publish timestamp",()=>{
  const now=Date.parse("2026-11-08T19:00:00Z");
  const source=sectorHealth({sourceTimestamp:"2026-11-06T20:59:00Z"});
  source.sources.eod.updatedAt="2026-11-08T18:39:56Z";
  source.sources.eod.completedSessionDate="2026-11-05";
  const artifact=buildEngine25ParticipationArtifact({sectorHealth:source,now});
  assert.equal(artifact.freshness.eod.valid,false);
});
console.log("engine25ParticipationSessionSplit.test.js PASS");
