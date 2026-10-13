// services/core/tests/redlineMarketBrief.test.js

import assert from "node:assert/strict";
import {
  buildRedlineCurrentMarketBrief,
  buildRedlineIntradayBrief,
} from "../logic/engine25/buildRedlineMarketBrief.js";

function base() {
  return {
    participationArtifact: {
      participation: {
        breadth: {
          label: "BREADTH_PARTICIPATION_WEAK",
          score: 47,
        },
        upDown: {
          intradayUp: 676,
          intradayDown: 731,
        },
        newHighsNewLows: {
          intradayTotalNh: 876,
          intradayTotalNl: 783,
          intradayNetHighsLows: 93,
        },
        sectorParticipation: {
          intraday: {
            bullishCount: 1,
            neutralCount: 7,
            bearishCount: 3,
          },
        },
        stockVolume: {
          intraday: {
            advancingVolume: 7837865,
            decliningVolume: 9597178,
            volumeImbalance: 0.101,
          },
        },
        distributionPressure: {
          label: "DISTRIBUTION_PRESSURE_HIGH",
          rawPressure: 69,
        },
      },
      freshness: {
        intraday: {
          state: "LAST_VALID_EQUITY_READ",
        },
      },
    },

    sectorBreadth: {
      tactical1h: {
        available: true,
        classification: { label: "1H_SECTOR_BREADTH_WEAK" },
        groups: {
          strong: [],
          neutral: ["Utilities", "Materials"],
          weak: ["Real Estate"],
        },
      },
      regime4h: {
        available: true,
        classification: { label: "4H_SECTOR_BREADTH_MIXED" },
        groups: {
          strong: [],
          neutral: [
            "Communication Services",
            "Consumer Discretionary",
            "Consumer Staples",
            "Energy",
            "Financials",
            "Health Care",
            "Industrials",
            "Materials",
            "Utilities",
            "Information Technology",
          ],
          weak: ["Real Estate"],
        },
      },
      latest: {
        structuralEod: {
          available: true,
          classification: { label: "EOD_SECTOR_BREADTH_WEAK" },
          groups: {
            strong: [],
            neutral: ["Utilities"],
            weak: ["Real Estate", "Financials"],
          },
        },
      },
      combinedRead: {
        label: "SECTOR_CARD_BREADTH_MIXED",
      },
    },

    narratorEvidence: {
      participation: { direction: "BEARISH" },
      volumeDistribution: { direction: "BEARISH" },
      sectors: { direction: "MIXED" },
      macro: { direction: "BEARISH" },
      esVsBroader: {
        relation: "ES_STRONGER_THAN_BROADER",
        esScore: 53.8,
        broaderScore: 47,
      },
    },

    creditStressDetail: {
      interpretation:
        "Credit, rates, and liquidity are mixed. Use the available observations without assuming direction when comparison data is unavailable.",
    },

    intradayMacro: {
      state: "MACRO_HEADWIND",
      severity: "HIGH",
      freshness: { status: "FRESH" },
      components: {
        rates: {
          slowContext: {
            tenYearYield: 5.29,
            thirtyYearYield: 5.64,
          },
        },
        oil: {
          state: "NEGATIVE",
          wti: { price: 92.91 },
          brent: { price: 102.52 },
        },
      },
      newsEvents: {
        activeMaterialEvents: [
          {
            material: true,
            eventType: "GEOPOLITICAL_ESCALATION",
            primaryEntity: "Iran",
            severity: "HIGH",
            headlineSummary: "Overnight geopolitical tensions increased.",
            observedAt: "2026-10-02T08:00:00.000Z",
            reactionState: "REACTION_HOLDING",
          },
        ],
      },
    },

    macroPressure: {
      label: "MACRO_PRESSURE_HIGH",
      inputs: {
        UUP: {
          close: 28.96,
        },
      },
    },

    newsEvents: { events: [] },

    engine25Context: {
      marketInternals: {
        esMarketMeter: {
          masterState: "neutral",
          timeframes: {
            tenMinute: { score: 51.1, state: "neutral" },
            thirtyMinute: { score: 49.0, state: "neutral" },
            oneHour: { score: 62.8, state: "neutral" },
          },
        },
      },
    },

    strategySnapshot: {
      strategies: {
        "intraday_scalp@10m": {
          engine26LocationCandidate: {
            currentPrice: 7727.75,
            directionState: "NEUTRAL_NO_DIRECTIONAL_EDGE",
            approvedNegotiatedZoneInventory: [
              { lo: 7700, hi: 7710 },
              { lo: 7740, hi: 7750 },
            ],
          },
        },
      },
    },

    engine29: {
      dataDegraded: false,
      overallState: "MIXED",
      moveCharacter: {
        moveCharacter: "NARROW_MOVE",
        direction: "UP",
        confidence: "MEDIUM",
        underlyingPressure: {
          state: "WEAK_CONFIRMATION",
        },
      },
    },
  };
}

const current = buildRedlineCurrentMarketBrief(base());

assert.equal(current.mode, "CURRENT_MARKET");
assert.equal(current.readOnly, true);
assert.equal(current.predictive, false);
assert.equal(current.createsTradingSignal, false);

const currentText = current.paragraphs.join(" ");

assert.match(
  currentText,
  /Volume is confirming the weak breadth/i
);
assert.match(
  currentText,
  /actual directional volume is also leaning toward sellers/i
);
assert.match(currentText, /Distribution Pressure is high/i);
assert.match(currentText, /4-hour sector read is mixed: 0 strong, 10 neutral, 1 weak/i);
assert.match(currentText, /WTI is 92\.91 and Brent is 102\.52/i);
assert.match(currentText, /5\.29% on the 10-year/i);
assert.match(currentText, /5\.64% on the 30-year/i);
assert.match(currentText, /U\.S\. dollar proxy UUP is 28\.96/i);
assert.match(currentText, /Overnight geopolitical tensions increased/i);
assert.match(currentText, /Iran/i);
assert.match(currentText, /ES is 7727\.75, 12\.25 points below the nearest negotiated zone at 7740\.00–7750\.00/i);
assert.match(currentText, /nearest negotiated zone below is 7700\.00–7710\.00/i);

const intraday = buildRedlineIntradayBrief(base());
const intradayText = intraday.paragraphs.join(" ");

assert.equal(intraday.mode, "INTRADAY");
assert.match(intradayText, /ES Market Meter — 10m: 51\.1/i);
assert.match(intradayText, /30m: 49\.0/i);
assert.match(intradayText, /1h: 62\.8/i);
assert.match(intradayText, /Engine29 classifies the current move as narrow move/i);
assert.match(intradayText, /move direction is up/i);
assert.match(intradayText, /Underlying cross-market pressure is weak confirmation/i);
assert.match(intradayText, /ES is holding up better than the broader market/i);

assert.doesNotMatch(
  `${currentText} ${intradayText}`,
  /buy here|sell here|will fall|will rally|confirms a short trade/i
);

const unavailable = base();
unavailable.strategySnapshot = null;
unavailable.engine29 = null;
const safe = buildRedlineIntradayBrief(unavailable);
assert.match(
  safe.paragraphs.join(" "),
  /Engine26 negotiated-zone location is currently unavailable/i
);

console.log("redlineMarketBrief.test.js PASS");
