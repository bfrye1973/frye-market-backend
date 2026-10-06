import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPublishedEngine25Participation,
  fetchCanonicalParticipationInputs,
} from "../jobs/updateEngine25Participation.js";
import { buildEngine25ParticipationArtifact } from "../logic/engine25/buildParticipationArtifact.js";

const NOW = Date.parse("2026-10-02T15:15:00Z");
const SECTORS = [
  "Information Technology",
  "Communication Services",
  "Consumer Staples",
  "Utilities",
  "Real Estate",
  "Financials",
  "Health Care",
  "Industrials",
  "Energy",
  "Materials",
  "Consumer Discretionary",
];

function cards(states) {
  return states.map((state, i) => ({
    sector: SECTORS[i],
    breadth_pct: state === "STRONG" ? 60 : state === "WEAK" ? 40 : 50,
    momentum_pct: state === "STRONG" ? 60 : state === "WEAK" ? 40 : 50,
    up: state === "STRONG" ? 20 : state === "WEAK" ? 5 : 10,
    down: state === "WEAK" ? 20 : state === "STRONG" ? 5 : 10,
    advancingVolume: 1000 + i,
    decliningVolume: 900 + i,
  }));
}

function payload(states, updated_at_utc) {
  return { updated_at_utc, sectorCards: cards(states) };
}

function sectorHealth() {
  const intradayTs = "2026-10-02T15:13:00Z";
  return {
    ok: true,
    sources: {
      intraday: { ok: true, updatedAt: intradayTs, sectorCardsCount: 11, url: "/live/intraday" },
      eod: { ok: true, updatedAt: "2026-10-02T14:38:37Z", sectorCardsCount: 11, url: "/live/eod" },
    },
    intradaySummary: {
      count: 11,
      bullishCount: 0,
      neutralCount: 1,
      bearishCount: 10,
      bullishRatio: 0,
      bearishRatio: 10 / 11,
      avgMomentum: 20,
      totalNetHighsLows: -100,
      totalUp: 100,
      totalDown: 500,
      cards: [],
    },
    eodSummary: {
      count: 11,
      bullishCount: 4,
      neutralCount: 6,
      bearishCount: 1,
      bullishRatio: 4 / 11,
      bearishRatio: 1 / 11,
      avgMomentum: 50,
      totalNetHighsLows: 20,
      totalUp: 300,
      totalDown: 250,
      cards: [],
    },
    breadthParticipation: { score: 42, label: "SENTINEL_BREADTH" },
    distributionPressure: {
      score: 33,
      label: "SENTINEL_DISTRIBUTION",
      inputs: {
        volumeEvidence: {
          available: true,
          intraday: { available: true, coveragePct: 90 },
          eod: { available: true, coveragePct: 90 },
          sentinel: "UNCHANGED",
        },
      },
    },
  };
}

function canonicalInputs() {
  return {
    routes: {
      intraday: "/live/intraday",
      hourly: "/live/hourly",
      fourHour: "/live/4h",
      eod: "/live/eod",
    },
    intraday: payload([...Array(10).fill("WEAK"), "NEUTRAL"], "2026-10-02T15:15:25Z"),
    hourly: payload([...Array(8).fill("STRONG"), ...Array(3).fill("NEUTRAL")], "2026-10-02T15:09:55Z"),
    fourHour: payload(["STRONG", ...Array(10).fill("NEUTRAL")], "2026-10-02T14:37:31Z"),
    eod: payload([...Array(4).fill("STRONG"), ...Array(6).fill("NEUTRAL"), "WEAK"], "2026-10-02T14:38:37Z"),
  };
}

test("publisher preserves all existing participation fields and adds blend fields", () => {
  const source = sectorHealth();
  const before = buildEngine25ParticipationArtifact({ sectorHealth: source, now: NOW });
  const after = buildPublishedEngine25Participation({
    sectorHealth: source,
    canonicalInputs: canonicalInputs(),
    now: NOW,
  });

  for (const key of Object.keys(before)) {
    assert.deepEqual(after[key], before[key], `legacy field changed: ${key}`);
  }

  assert.ok(after.fastParticipation);
  assert.ok(after.blendedParticipation);
  assert.ok(after.sourceDiagnostics);
  assert.equal(after.blendedParticipation.state, "SHORT_TERM_DETERIORATION");
});

test("canonical loader requests exactly the four approved live routes", async () => {
  const seen = [];
  const fake = async (url) => {
    seen.push(url);
    return { updated_at_utc: "2026-10-02T15:00:00Z", sectorCards: [] };
  };

  const out = await fetchCanonicalParticipationInputs({
    backendBase: "https://example.test/",
    fetchJsonFn: fake,
  });

  assert.deepEqual(seen.sort(), [
    "https://example.test/live/4h",
    "https://example.test/live/eod",
    "https://example.test/live/hourly",
    "https://example.test/live/intraday",
  ].sort());

  assert.deepEqual(out.routes, {
    intraday: "https://example.test/live/intraday",
    hourly: "https://example.test/live/hourly",
    fourHour: "https://example.test/live/4h",
    eod: "https://example.test/live/eod",
  });
});

test("today divergence publishes exact source timestamps and approved base weights", () => {
  const out = buildPublishedEngine25Participation({
    sectorHealth: sectorHealth(),
    canonicalInputs: canonicalInputs(),
    now: NOW,
  });

  assert.equal(out.sourceDiagnostics["10m"].sourceTimestamp, "2026-10-02T15:15:25Z");
  assert.equal(out.sourceDiagnostics["1h"].sourceTimestamp, "2026-10-02T15:09:55Z");
  assert.equal(out.sourceDiagnostics["4h"].sourceTimestamp, "2026-10-02T14:37:31Z");
  assert.equal(out.sourceDiagnostics.eod.sourceTimestamp, "2026-10-02T14:38:37Z");

  assert.deepEqual(
    {
      "10m": out.sourceDiagnostics["10m"].baseWeight,
      "1h": out.sourceDiagnostics["1h"].baseWeight,
      "4h": out.sourceDiagnostics["4h"].baseWeight,
      eod: out.sourceDiagnostics.eod.baseWeight,
    },
    { "10m": 0.25, "1h": 0.35, "4h": 0.25, eod: 0.15 }
  );
});
