// services/core/tests/engine25PlainEnglishNarrator.test.js

import assert from "node:assert/strict";
import {
  buildEngine25NarratorEvidence,
  buildEngine25PlainEnglishNarrator,
} from "../logic/engine25/buildPlainEnglishNarrator.js";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function baseInput() {
  return {
    participationArtifact: {
      participation: {
        breadth: {
          score: 72,
          label: "BREADTH_PARTICIPATION_HEALTHY",
        },
        upDown: {
          intradayUp: 700,
          intradayDown: 500,
        },
        newHighsNewLows: {
          intradayTotalNh: 120,
          intradayTotalNl: 55,
          intradayNetHighsLows: 65,
        },
        sectorParticipation: {
          intraday: {
            count: 11,
            bullishCount: 7,
            neutralCount: 3,
            bearishCount: 1,
          },
        },
        stockVolume: {
          intraday: {
            advancingVolume: 12000000,
            decliningVolume: 8000000,
            volumeImbalance: -0.2,
            coveragePct: 90,
          },
          combinedVolumePressure: 25,
        },
        distributionPressure: {
          rawPressure: 30,
          label: "DISTRIBUTION_PRESSURE_LOW",
          inputs: {
            intradayBreadthPressure: 25,
          },
        },
      },
      freshness: {
        state: "FRESH",
        reason: "ACTIVE_EQUITY_SESSION_CURRENT_VALID_SOURCE",
        usableForTrapConfirmation: true,
        intraday: {
          state: "FRESH",
          reason: "ACTIVE_EQUITY_SESSION_CURRENT_VALID_SOURCE",
          sourceTimestamp: "2026-10-01T18:00:00Z",
        },
        systemOperatingSession: {
          operating: true,
          session: "ES_GLOBEX",
        },
        equityScannerSession: {
          active: true,
          session: "REGULAR_EQUITY_SESSION",
        },
      },
      sources: {
        intraday: {
          sourceTimestamp: "2026-10-01T18:00:00Z",
        },
      },
    },

    sectorBreadth: {
      combinedRead: {
        label: "SECTOR_BREADTH_EXPANDING_TACTICAL_AND_REGIME",
      },
      tactical1h: {
        classification: {
          label: "1H_SECTOR_BREADTH_EXPANDING",
        },
        groups: {
          strong: ["Information Technology", "Industrials"],
          neutral: ["Utilities"],
          weak: ["Real Estate"],
        },
      },
      regime4h: {
        classification: {
          label: "4H_SECTOR_BREADTH_EXPANDING",
        },
        groups: {
          strong: ["Information Technology", "Financials"],
          neutral: ["Utilities"],
          weak: ["Real Estate"],
        },
      },
      latest: {
        structuralEod: {
          classification: {
            label: "EOD_SECTOR_BREADTH_EXPANDING",
          },
        },
      },
    },

    intradayMacro: {
      state: "MACRO_SUPPORTIVE",
      equityImpact: "EQUITY_SUPPORTIVE",
      severity: "LOW",
      macroShock: false,
      freshness: {
        status: "FRESH",
      },
      components: {
        rates: { state: "SUPPORTIVE" },
        oil: {
          state: "NEUTRAL",
          wti: { changesPct: { session: 0.2 } },
          brent: { changesPct: { session: 0.1 } },
        },
      },
    },

    creditStressDetail: {
      displayLabel: "CREDIT_RATES_LIQUIDITY_MIXED",
      warningFlags: {
        bondsSellingOff: false,
        creditSpreadsWidening: false,
        liquidityDeteriorating: false,
      },
    },

    engine25Context: {
      marketInternals: {
        esMarketMeter: {
          available: true,
          masterScore: 78,
          masterState: "bull",
        },
        alignment: {
          overall: "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE",
        },
      },
    },
  };
}

function setBreadth(input, label, score = 50) {
  input.participationArtifact.participation.breadth = { label, score };
}

function setDistribution(input, label, rawPressure = 50, imbalance = 0) {
  input.participationArtifact.participation.distributionPressure.label = label;
  input.participationArtifact.participation.distributionPressure.rawPressure =
    rawPressure;
  input.participationArtifact.participation.stockVolume.intraday.volumeImbalance =
    imbalance;
}

function setMacro(input, state, severity = "LOW") {
  input.intradayMacro.state = state;
  input.intradayMacro.severity = severity;
  input.intradayMacro.equityImpact =
    state === "MACRO_SUPPORTIVE"
      ? "EQUITY_SUPPORTIVE"
      : state === "MACRO_HEADWIND" || state === "MACRO_SHOCK"
        ? "EQUITY_NEGATIVE"
        : "NEUTRAL";
}

function setFreshness(input, state, reason = null) {
  input.participationArtifact.freshness.state = state;
  input.participationArtifact.freshness.reason = reason;
  input.participationArtifact.freshness.intraday.state = state;
  input.participationArtifact.freshness.intraday.reason = reason;
  input.participationArtifact.freshness.usableForTrapConfirmation =
    state === "FRESH";
}

run("1 bullish agreement", () => {
  const input = baseInput();
  const result = buildEngine25PlainEnglishNarrator(input);

  assert.equal(result.narratorEvidence.participation.direction, "BULLISH");
  assert.equal(result.narratorEvidence.volumeDistribution.direction, "BULLISH");
  assert.equal(result.narratorEvidence.sectors.direction, "BULLISH");
  assert.equal(result.narratorEvidence.macro.direction, "BULLISH");
  assert.equal(result.narratorEvidence.esVsBroader.direction, "BULLISH");
  assert.equal(result.narratorEvidence.conflicts.length, 0);
  assert.equal(result.narratorEvidence.confidence, "HIGH");
  assert.ok(result.sentences.length >= 4 && result.sentences.length <= 5);
});

run("2 bearish agreement", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_WEAK", 30);
  setDistribution(input, "DISTRIBUTION_PRESSURE_HIGH", 80, 0.3);
  input.sectorBreadth.combinedRead.label =
    "SECTOR_BREADTH_WEAK_TACTICAL_AND_REGIME";
  input.sectorBreadth.tactical1h.classification.label =
    "1H_SECTOR_BREADTH_WEAK";
  input.sectorBreadth.regime4h.classification.label =
    "4H_SECTOR_BREADTH_WEAK";
  setMacro(input, "MACRO_HEADWIND", "HIGH");
  input.engine25Context.marketInternals.esMarketMeter.masterScore = 35;
  input.engine25Context.marketInternals.esMarketMeter.masterState = "bear";

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.participation.direction, "BEARISH");
  assert.equal(result.volumeDistribution.direction, "BEARISH");
  assert.equal(result.sectors.direction, "BEARISH");
  assert.equal(result.macro.direction, "BEARISH");
  assert.equal(result.esVsBroader.direction, "BEARISH");
  assert.equal(result.confidence, "HIGH");
});

run("3 mixed participation remains MIXED and says weakening", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_MIXED_WEAKENING", 48);

  const result = buildEngine25PlainEnglishNarrator(input);

  assert.equal(result.narratorEvidence.participation.direction, "MIXED");
  assert.match(result.sentences[0], /mixed but weakening/i);
});

run("4 weak breadth + strong buying volume conflict", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_WEAK", 35);
  setDistribution(input, "DISTRIBUTION_PRESSURE_LOW", 25, -0.25);

  const result = buildEngine25NarratorEvidence(input);

  assert.ok(
    result.conflicts.some(
      (c) => c.code === "WEAK_BREADTH_STRONG_BUYING_VOLUME"
    )
  );
});

run("5 strong ES + weak internals conflict", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_WEAK", 30);
  input.engine25Context.marketInternals.esMarketMeter.masterScore = 80;
  input.engine25Context.marketInternals.esMarketMeter.masterState = "bull";

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.esVsBroader.relation, "ES_STRONGER_THAN_BROADER");
  assert.ok(
    result.conflicts.some(
      (c) => c.code === "STRONG_ES_WEAK_BROADER_MARKET"
    )
  );
});

run("6 weak ES + strong internals uses sign-only broader relation", () => {
  const input = baseInput();
  input.engine25Context.marketInternals.esMarketMeter.masterScore = 40;
  input.engine25Context.marketInternals.esMarketMeter.masterState = "bear";
  input.participationArtifact.participation.breadth.score = 75;

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.esVsBroader.relation, "BROADER_STRONGER_THAN_ES");
  assert.equal(result.esVsBroader.direction, "BEARISH");
});

run("7 weak 1H + strong 4H conflict", () => {
  const input = baseInput();
  input.sectorBreadth.combinedRead.label =
    "TACTICAL_DAMAGE_WITH_REGIME_STILL_SUPPORTIVE";
  input.sectorBreadth.tactical1h.classification.label =
    "1H_SECTOR_BREADTH_WEAK";
  input.sectorBreadth.regime4h.classification.label =
    "4H_SECTOR_BREADTH_EXPANDING";

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.sectors.direction, "MIXED");
  assert.ok(result.conflicts.some((c) => c.code === "WEAK_1H_STRONG_4H"));
});

run("8 strong 1H + weak 4H conflict", () => {
  const input = baseInput();
  input.sectorBreadth.combinedRead.label =
    "TACTICAL_BOUNCE_REGIME_NOT_CONFIRMED";
  input.sectorBreadth.tactical1h.classification.label =
    "1H_SECTOR_BREADTH_EXPANDING";
  input.sectorBreadth.regime4h.classification.label =
    "4H_SECTOR_BREADTH_WEAK";

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.sectors.direction, "MIXED");
  assert.ok(result.conflicts.some((c) => c.code === "STRONG_1H_WEAK_4H"));
});

run("9 supportive macro + bearish participation conflict", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_WEAK", 30);
  setMacro(input, "MACRO_SUPPORTIVE", "LOW");

  const result = buildEngine25NarratorEvidence(input);

  assert.ok(
    result.conflicts.some(
      (c) => c.code === "BEARISH_PARTICIPATION_SUPPORTIVE_MACRO"
    )
  );
});

run("10 macro headwind + bullish participation conflict", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_HEALTHY", 75);
  setMacro(input, "MACRO_HEADWIND", "MODERATE");

  const result = buildEngine25NarratorEvidence(input);

  assert.ok(
    result.conflicts.some(
      (c) => c.code === "BULLISH_PARTICIPATION_MACRO_HEADWIND"
    )
  );
});

run("11 last-valid equity + live ES is context, not current confirmation", () => {
  const input = baseInput();
  setFreshness(input, "LAST_VALID_EQUITY_READ", "EQUITY_SESSION_CLOSED");

  const result = buildEngine25PlainEnglishNarrator(input);

  assert.equal(
    result.narratorEvidence.freshness.usableForTrapConfirmation,
    false
  );
  assert.ok(
    result.narratorEvidence.conflicts.some(
      (c) => c.code === "LAST_VALID_EQUITY_LIVE_ES" && c.contextOnly === true
    )
  );
  assert.match(result.text, /last valid cash-session reading/i);
  assert.notEqual(result.narratorEvidence.confidence, "HIGH");
});

run("12 stale equity + live ES lowers confidence", () => {
  const input = baseInput();
  setFreshness(input, "STALE_INTRADAY_SOURCE", "INTRADAY_SOURCE_OLDER_THAN_MAX_AGE");

  const result = buildEngine25PlainEnglishNarrator(input);

  assert.equal(result.narratorEvidence.confidence, "LOW");
  assert.ok(
    result.narratorEvidence.conflicts.some(
      (c) => c.code === "STALE_EQUITY_LIVE_ES"
    )
  );
  assert.match(result.text, /should be updating and is stale/i);
});

run("13 missing macro remains unavailable without invented fallback", () => {
  const input = baseInput();
  input.intradayMacro = {};

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.macro.direction, "UNAVAILABLE");
  assert.equal(result.usableFamilyCount, 4);
});

run("14 missing volume remains unavailable", () => {
  const input = baseInput();
  input.participationArtifact.participation.distributionPressure = {};
  input.participationArtifact.participation.stockVolume = {};

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.volumeDistribution.direction, "UNAVAILABLE");
});

run("15 oil shock preserves canonical macro shock wording", () => {
  const input = baseInput();
  setMacro(input, "MACRO_SHOCK", "EXTREME");
  input.intradayMacro.macroShock = true;
  input.intradayMacro.components.oil.state = "NEGATIVE";

  const result = buildEngine25PlainEnglishNarrator(input);

  assert.equal(result.narratorEvidence.macro.direction, "BEARISH");
  assert.equal(result.narratorEvidence.macro.strength, "STRONG");
  assert.match(result.text, /strong headwind/i);
  assert.doesNotMatch(result.text, /crash|collapse|will fall/i);
});

run("16 high distribution with mildly weak breadth does not invent prediction", () => {
  const input = baseInput();
  setBreadth(input, "BREADTH_PARTICIPATION_MIXED_WEAKENING", 48);
  setDistribution(input, "DISTRIBUTION_PRESSURE_HIGH", 82, 0.28);

  const result = buildEngine25PlainEnglishNarrator(input);

  assert.equal(result.narratorEvidence.participation.direction, "MIXED");
  assert.equal(result.narratorEvidence.volumeDistribution.direction, "BEARISH");
  assert.equal(result.narratorEvidence.volumeDistribution.strength, "STRONG");
  assert.doesNotMatch(
    result.text,
    /will fall|will rise|buy here|sell here|confirms a short/i
  );
});

run("17 fewer than two usable families => INSUFFICIENT DATA", () => {
  const input = baseInput();
  input.participationArtifact.participation.breadth = {};
  input.participationArtifact.participation.distributionPressure = {};
  input.participationArtifact.participation.stockVolume = {};
  input.sectorBreadth = {};
  input.intradayMacro = {};
  input.engine25Context = {};

  const result = buildEngine25NarratorEvidence(input);

  assert.equal(result.usableFamilyCount, 0);
  assert.equal(result.confidence, "INSUFFICIENT DATA");
});

run("18 repeated inputs produce deterministic evidence and sentences", () => {
  const input = baseInput();
  const a = buildEngine25PlainEnglishNarrator(input);
  const b = buildEngine25PlainEnglishNarrator(input);

  assert.deepEqual(a.narratorEvidence, b.narratorEvidence);
  assert.deepEqual(a.sentences, b.sentences);
  assert.equal(a.text, b.text);
});

run("19 narrator metadata stays read-only and non-predictive", () => {
  const result = buildEngine25PlainEnglishNarrator(baseInput());

  assert.equal(result.readOnly, true);
  assert.equal(result.predictive, false);
  assert.equal(result.createsTradingSignal, false);
});

console.log("engine25PlainEnglishNarrator.test.js PASS");
