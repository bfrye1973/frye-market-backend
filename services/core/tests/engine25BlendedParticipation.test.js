import test from "node:test";
import assert from "node:assert/strict";
import {
  BLENDED_PARTICIPATION_CONFIG,
  buildEngine25BlendedParticipation,
  computeLinearFreshnessMultiplier,
} from "../logic/engine25/buildBlendedParticipation.js";

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

const NOW = Date.parse("2026-10-02T15:15:00Z");

function isoAgo(minutes) {
  return new Date(NOW - minutes * 60 * 1000).toISOString();
}

function card(sector, state, i = 0) {
  const values = {
    STRONG: [60, 60],
    NEUTRAL: [50, 50],
    WEAK: [40, 40],
  }[state];
  return {
    sector,
    breadth_pct: values[0],
    momentum_pct: values[1],
    up: state === "STRONG" ? 20 : state === "WEAK" ? 5 : 10,
    down: state === "WEAK" ? 20 : state === "STRONG" ? 5 : 10,
    advancingVolume: 1000 + i,
    decliningVolume: 800 + i,
  };
}

function payload(states, timestamp = isoAgo(5)) {
  assert.equal(states.length, 11);
  return {
    updated_at_utc: timestamp,
    sectorCards: states.map((s, i) => card(SECTORS[i], s, i)),
  };
}

function all(state) {
  return Array(11).fill(state);
}

function build({
  ten = all("NEUTRAL"),
  one = all("NEUTRAL"),
  four = all("NEUTRAL"),
  daily = all("NEUTRAL"),
  tenAge = 5,
  oneAge = 5,
  fourAge = 5,
  eodTimestamp = "2026-10-02T14:38:37Z",
} = {}) {
  return buildEngine25BlendedParticipation({
    intraday: payload(ten, isoAgo(tenAge)),
    hourly: payload(one, isoAgo(oneAge)),
    fourHour: payload(four, isoAgo(fourAge)),
    eod: payload(daily, eodTimestamp),
    now: NOW,
  });
}

test("all four strong resolves STRONG", () => {
  const out = build({
    ten: all("STRONG"),
    one: all("STRONG"),
    four: all("STRONG"),
    daily: all("STRONG"),
  });
  assert.equal(out.blendedParticipation.state, "STRONG");
  assert.equal(out.blendedParticipation.blendedScore, 1);
});

test("all four weak resolves BROAD_WEAKNESS", () => {
  const out = build({
    ten: all("WEAK"),
    one: all("WEAK"),
    four: all("WEAK"),
    daily: all("WEAK"),
  });
  assert.equal(out.blendedParticipation.state, "BROAD_WEAKNESS");
  assert.equal(out.blendedParticipation.blendedScore, -1);
});

test("10m weak with higher timeframes healthy resolves SHORT_TERM_DETERIORATION", () => {
  const out = build({
    ten: [...Array(10).fill("WEAK"), "NEUTRAL"],
    one: [...Array(8).fill("STRONG"), ...Array(3).fill("NEUTRAL")],
    four: ["STRONG", ...Array(10).fill("NEUTRAL")],
    daily: [...Array(4).fill("STRONG"), ...Array(6).fill("NEUTRAL"), "WEAK"],
  });
  assert.equal(out.sourceDiagnostics["10m"].timeframeScore, -0.909091);
  assert.equal(out.blendedParticipation.state, "SHORT_TERM_DETERIORATION");
  assert.ok(
    out.blendedParticipation.reasonCodes.includes("FAST_WEAK_HIGHER_TF_HEALTHY")
  );
});

test("10m strong with higher timeframes weak resolves RECOVERING", () => {
  const out = build({
    ten: all("STRONG"),
    one: all("WEAK"),
    four: all("WEAK"),
    daily: all("WEAK"),
  });
  assert.equal(out.blendedParticipation.state, "RECOVERING");
  assert.ok(
    out.blendedParticipation.reasonCodes.includes("FAST_RECOVERY_BROADER_WEAK")
  );
});

test("10m neutral recovery from broader weakness resolves RECOVERING", () => {
  const out = build({
    ten: all("NEUTRAL"),
    one: all("WEAK"),
    four: all("WEAK"),
    daily: all("WEAK"),
  });
  assert.equal(out.blendedParticipation.state, "RECOVERING");
});

test("stale 10m loses all influence after 15 minutes", () => {
  const out = build({
    ten: all("WEAK"),
    one: all("STRONG"),
    four: all("STRONG"),
    daily: all("STRONG"),
    tenAge: 16,
  });
  assert.equal(out.sourceDiagnostics["10m"].freshnessMultiplier, 0);
  assert.equal(out.sourceDiagnostics["10m"].effectiveWeight, 0);
  assert.equal(out.blendedParticipation.normalizedWeights["10m"], 0);
  assert.ok(out.blendedParticipation.reasonCodes.includes("SOURCE_10M_STALE"));
});

test("stale 1H loses all influence after 90 minutes", () => {
  const out = build({ oneAge: 91 });
  assert.equal(out.sourceDiagnostics["1h"].effectiveWeight, 0);
  assert.ok(out.blendedParticipation.reasonCodes.includes("SOURCE_1H_STALE"));
});

test("stale 4H loses all influence after 300 minutes", () => {
  const out = build({ fourAge: 301 });
  assert.equal(out.sourceDiagnostics["4h"].effectiveWeight, 0);
  assert.ok(out.blendedParticipation.reasonCodes.includes("SOURCE_4H_STALE"));
});

test("invalid EOD session date has zero weight", () => {
  const out = build({ eodTimestamp: "2026-09-30T20:00:00Z" });
  assert.equal(out.sourceDiagnostics.eod.effectiveWeight, 0);
  assert.ok(out.blendedParticipation.reasonCodes.includes("SOURCE_EOD_STALE"));
});

test("one missing timeframe renormalizes remaining weights", () => {
  const out = buildEngine25BlendedParticipation({
    intraday: payload(all("STRONG"), isoAgo(5)),
    hourly: payload(all("STRONG"), isoAgo(5)),
    fourHour: null,
    eod: payload(all("STRONG"), "2026-10-02T14:38:37Z"),
    now: NOW,
  });
  assert.equal(out.blendedParticipation.state, "STRONG");
  assert.equal(out.sourceDiagnostics["4h"].effectiveWeight, 0);
  assert.equal(out.blendedParticipation.usableEffectiveWeight, 0.75);
  assert.equal(
    Number(
      Object.values(out.blendedParticipation.normalizedWeights)
        .reduce((a, b) => a + b, 0)
        .toFixed(6)
    ),
    1
  );
});

test("multiple missing timeframes fail minimum evidence gate", () => {
  const out = buildEngine25BlendedParticipation({
    intraday: payload(all("STRONG"), isoAgo(5)),
    hourly: null,
    fourHour: null,
    eod: payload(all("STRONG"), "2026-10-02T14:38:37Z"),
    now: NOW,
  });
  assert.equal(out.blendedParticipation.usableEffectiveWeight, 0.4);
  assert.equal(out.blendedParticipation.state, "INSUFFICIENT_DATA");
  assert.equal(out.ok, false);
});

test("missing source is not manufactured as neutral", () => {
  const out = buildEngine25BlendedParticipation({
    intraday: payload(all("WEAK"), isoAgo(5)),
    hourly: payload(all("WEAK"), isoAgo(5)),
    fourHour: null,
    eod: payload(all("WEAK"), "2026-10-02T14:38:37Z"),
    now: NOW,
  });
  assert.equal(out.sourceDiagnostics["4h"].timeframeScore, null);
  assert.equal(out.sourceDiagnostics["4h"].timeframeState, "UNAVAILABLE");
  assert.equal(out.sourceDiagnostics["4h"].effectiveWeight, 0);
});

test("incomplete canonical sector set is unusable, not divided by observed count", () => {
  const incomplete = payload(all("STRONG"), isoAgo(5));
  incomplete.sectorCards = incomplete.sectorCards.slice(0, 8);

  const out = buildEngine25BlendedParticipation({
    intraday: incomplete,
    hourly: payload(all("STRONG"), isoAgo(5)),
    fourHour: payload(all("STRONG"), isoAgo(5)),
    eod: payload(all("STRONG"), "2026-10-02T14:38:37Z"),
    now: NOW,
  });

  assert.equal(out.sourceDiagnostics["10m"].timeframeScore, null);
  assert.equal(out.sourceDiagnostics["10m"].effectiveWeight, 0);
  assert.equal(out.sourceDiagnostics["10m"].completeCanonicalSet, false);
});

test("freshness decay boundaries are exact", () => {
  assert.equal(
    computeLinearFreshnessMultiplier(
      10 * 60_000,
      10 * 60_000,
      15 * 60_000
    ),
    1
  );
  assert.equal(
    computeLinearFreshnessMultiplier(
      12.5 * 60_000,
      10 * 60_000,
      15 * 60_000
    ),
    0.5
  );
  assert.equal(
    computeLinearFreshnessMultiplier(
      15 * 60_000,
      10 * 60_000,
      15 * 60_000
    ),
    0
  );
  assert.equal(
    computeLinearFreshnessMultiplier(
      60 * 60_000,
      60 * 60_000,
      90 * 60_000
    ),
    1
  );
  assert.equal(
    computeLinearFreshnessMultiplier(
      75 * 60_000,
      60 * 60_000,
      90 * 60_000
    ),
    0.5
  );
  assert.equal(
    computeLinearFreshnessMultiplier(
      90 * 60_000,
      60 * 60_000,
      90 * 60_000
    ),
    0
  );
  assert.equal(
    computeLinearFreshnessMultiplier(
      180 * 60_000,
      60 * 60_000,
      300 * 60_000
    ),
    0.5
  );
});

test("base weights remain manager-approved 25/35/25/15", () => {
  assert.deepEqual(BLENDED_PARTICIPATION_CONFIG.baseWeights, {
    "10m": 0.25,
    "1h": 0.35,
    "4h": 0.25,
    eod: 0.15,
  });
});

test("today's exact divergence acceptance case resolves SHORT_TERM_DETERIORATION", () => {
  const out = build({
    ten: [...Array(10).fill("WEAK"), "NEUTRAL"],
    one: [...Array(8).fill("STRONG"), ...Array(3).fill("NEUTRAL")],
    four: ["STRONG", ...Array(10).fill("NEUTRAL")],
    daily: [...Array(4).fill("STRONG"), ...Array(6).fill("NEUTRAL"), "WEAK"],
  });

  assert.deepEqual(
    ["10m", "1h", "4h", "eod"].map((tf) => [
      tf,
      out.sourceDiagnostics[tf].strongCount,
      out.sourceDiagnostics[tf].neutralCount,
      out.sourceDiagnostics[tf].weakCount,
    ]),
    [
      ["10m", 0, 1, 10],
      ["1h", 8, 3, 0],
      ["4h", 1, 10, 0],
      ["eod", 4, 6, 1],
    ]
  );
  assert.equal(out.blendedParticipation.state, "SHORT_TERM_DETERIORATION");
});
