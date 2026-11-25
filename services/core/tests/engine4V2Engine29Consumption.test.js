import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildEngine4V2Shadow } from "../logic/engine4/v2/buildEngine4V2Shadow.js";
import { readEngine29ForEngine4, classifyClimaxWithEngine29 } from "../logic/engine4/v2/readEngine29ForEngine4.js";

// Shape captured from production /api/v1/engine29/cross-market-stress
// at 2026-11-23T20:21:08Z (13:21 AZ). Global dataDegraded=true from
// ratesDuration only; every lane Engine 4 uses is FRESH.
const LIVE_TS = "2026-11-23T20:21:08.390Z";
const fr = (ageMs) => ({ stale: false, ageMs, maxAgeMs: 64800000, reason: "FRESH" });
function liveContext(over = {}) {
  return {
    schema: "engine29.downstreamContext.v1",
    timestamp: LIVE_TS,
    authority: "OBSERVATION_ONLY_NO_PERMISSION_OR_EXECUTION",
    dataDegraded: true,
    degradedGroups: ["ratesDuration"],
    observationId: "obs-live",
    engine26ZoneId: null,
    lanes: {
      parentMove: { state: "NO_ACTIVE_MOVE", direction: "FLAT", dataDegraded: false, freshness: fr(1268390) },
      thirtyMinute: { state: "BUYING_PRESSURE_INCREASING", dataDegraded: false, freshness: fr(1268390) },
      liveTenMinute: { direction: "UP", state: "UPSIDE_MOMENTUM_WEAKENING", contextVsParent: "NO_ACTIVE_PARENT", persistence20m: true, dataDegraded: false, freshness: fr(68390) },
      squeeze: { campaign: { state: "NO_ACTIVE_SQUEEZE", direction: null, active: false, counterToParent: false }, observationAgeMs: 445390, dataDegraded: false },
      trap: { eligibleForEngine4: false, reason: "P0_REPAIR_AND_REGRESSION_PENDING", dataDegraded: false },
      liquidity: { eligibleForEngine4: false, reason: "P0_REPAIR_AND_REGRESSION_PENDING", dataDegraded: false },
      ratesDuration: { dataDegraded: true },
    },
    ...over,
  };
}
const EVAL = Date.parse(LIVE_TS) + 90 * 1000;
const withSqueeze = (state, direction, liveState = "UPSIDE_MOVE_ACTIVE", liveDir = "UP") => {
  const c = liveContext();
  c.lanes.squeeze.campaign = { state, direction, active: true, counterToParent: false, campaignId: "E29SQ-test" };
  c.lanes.liveTenMinute.state = liveState;
  c.lanes.liveTenMinute.direction = liveDir;
  return c;
};

test("live 13:21 shape: global ratesDuration degradation does not blank Engine 29 for Engine 4", () => {
  const r = readEngine29ForEngine4({ context: liveContext(), evaluationTimeMs: EVAL, direction: "LONG" });
  assert.equal(r.available, true);
  assert.equal(r.globalDataDegraded, true);
  assert.deepEqual(r.globalDegradedGroups, ["ratesDuration"]);
  assert.equal(r.trend, "UP");
  assert.equal(r.trendAlignment, "WITH_TREND");
  assert.equal(r.parentDirection, "FLAT");
  assert.equal(r.parentAlignment, "NEUTRAL");
  assert.equal(r.live.momentum, "WEAKENING");
  assert.equal(r.squeezeVsSetup, "NONE");
  assert.equal(r.authority, "CONTEXT_ONLY");
  assert.equal(r.receipt.observationId, "obs-live");
});

test("short against a buying 30m state is AGAINST_TREND", () => {
  const r = readEngine29ForEngine4({ context: liveContext(), evaluationTimeMs: EVAL, direction: "SHORT" });
  assert.equal(r.trendAlignment, "AGAINST_TREND");
});

test("anti-lookahead: a receipt recorded after evaluation time is rejected", () => {
  const r = readEngine29ForEngine4({ context: liveContext(), evaluationTimeMs: Date.parse(LIVE_TS) - 5 * 60 * 1000, direction: "LONG" });
  assert.equal(r.available, false);
  assert.equal(r.reason, "ENGINE29_CONTEXT_FROM_FUTURE_REJECTED");
});

test("old receipt is rejected for intraday use even though Engine 29 lanes say FRESH (18h maxAge)", () => {
  const r = readEngine29ForEngine4({ context: liveContext(), evaluationTimeMs: Date.parse(LIVE_TS) + 15 * 60 * 1000, direction: "LONG" });
  assert.equal(r.available, false);
  assert.equal(r.reason, "ENGINE29_CONTEXT_TOO_OLD");
});

test("per-lane: a degraded 30m lane removes trend only; live 10m and squeeze survive", () => {
  const c = liveContext();
  c.lanes.thirtyMinute.dataDegraded = true;
  const r = readEngine29ForEngine4({ context: c, evaluationTimeMs: EVAL, direction: "LONG" });
  assert.equal(r.available, true);
  assert.equal(r.trend, "UNAVAILABLE");
  assert.equal(r.trendAlignment, "UNAVAILABLE");
  assert.equal(r.laneHealth.thirtyMinute.health, "DEGRADED");
  assert.ok(r.live);
  assert.ok(r.squeeze);
});

test("per-lane: lane age is measured at evaluation time, not only receipt time", () => {
  const c = liveContext();
  c.lanes.liveTenMinute.freshness = fr(24 * 60 * 1000); // 24m at receipt + receipt age -> over 25m
  const r = readEngine29ForEngine4({ context: c, evaluationTimeMs: Date.parse(LIVE_TS) + 2 * 60 * 1000, direction: "LONG" });
  assert.equal(r.laneHealth.liveTenMinute.health, "TOO_OLD_FOR_INTRADAY");
  assert.equal(r.live, null);
});

test("schema mismatch and missing context are UNAVAILABLE, never guessed", () => {
  assert.equal(readEngine29ForEngine4({ context: null, evaluationTimeMs: EVAL }).reason, "ENGINE29_CONTEXT_MISSING");
  assert.equal(readEngine29ForEngine4({ context: { schema: "x" }, evaluationTimeMs: EVAL }).reason, "ENGINE29_SCHEMA_MISMATCH");
});

test("trap and liquidity lanes are NOT_ELIGIBLE per Engine 29 and are never used", () => {
  const c = liveContext();
  c.lanes.trap.auctionEvent = { side: "SWEEP_LOW" };
  const r = readEngine29ForEngine4({ context: c, evaluationTimeMs: EVAL, direction: "LONG" });
  assert.equal(r.notUsed.trap.eligibleForEngine4, false);
  assert.equal(r.notUsed.trap.used, false);
  assert.equal(r.notUsed.trap.reason, "P0_REPAIR_AND_REGRESSION_PENDING");
  assert.equal(r.notUsed.liquidity.used, false);
  assert.ok(!JSON.stringify(r).includes("SWEEP_LOW"), "trap content is not propagated");
});

test("squeeze vs setup: with, against, and ending", () => {
  const read = (ctx, d) => readEngine29ForEngine4({ context: ctx, evaluationTimeMs: EVAL, direction: d }).squeezeVsSetup;
  assert.equal(read(withSqueeze("SQUEEZE_ACTIVE", "UP"), "LONG"), "WITH_SETUP");
  assert.equal(read(withSqueeze("SQUEEZE_ACTIVE", "UP"), "SHORT"), "AGAINST_SETUP");
  assert.equal(read(withSqueeze("SQUEEZE_WEAKENING", "UP"), "LONG"), "WITH_SETUP_ENDING");
  assert.equal(read(withSqueeze("SQUEEZE_HOLDING", "DOWN"), "LONG"), "AGAINST_SETUP");
  assert.equal(read(withSqueeze("SQUEEZE_ACTIVE", "UP"), "NEUTRAL"), "NO_DIRECTION");
});

test("climax classification: squeeze fuel vs exhaustion", () => {
  const read = (ctx) => readEngine29ForEngine4({ context: ctx, evaluationTimeMs: EVAL, direction: "LONG" });
  assert.equal(classifyClimaxWithEngine29("UP", read(withSqueeze("SQUEEZE_ACCELERATING", "UP"))), "SQUEEZE_FUEL");
  // Owner's Nov 23 morning: squeeze up that lost momentum.
  assert.equal(classifyClimaxWithEngine29("UP", read(withSqueeze("SQUEEZE_ACTIVE", "UP", "UPSIDE_MOMENTUM_WEAKENING"))), "EXHAUSTION_RISK");
  assert.equal(classifyClimaxWithEngine29("UP", read(withSqueeze("SQUEEZE_FAILED", "UP"))), "EXHAUSTION_RISK");
  assert.equal(classifyClimaxWithEngine29("DOWN", read(withSqueeze("SQUEEZE_ACTIVE", "UP"))), "NO_SQUEEZE_SUPPORT");
  assert.equal(classifyClimaxWithEngine29("UP", { squeeze: null, live: null }), "UNCLASSIFIED");
});

// ---- integration with the v2 builder ----
const T0 = Math.floor((Date.parse(LIVE_TS) / 1000 - 30 * 300) / 300) * 300;
function bars(n = 24, price = 7180, vol = 10000) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const o = price + (k % 2 ? 1 : -1), c = price + (k % 2 ? -1 : 1);
    out.push({ time: T0 + k * 300, open: o, high: Math.max(o, c) + 3, low: Math.min(o, c) - 3, close: c, volume: vol });
  }
  return out;
}
const ZONE = { low: 7138, high: 7210.75, midline: 7174.375 };

test("builder: climax warning carries engine29Read; participation/confirmation unchanged by Engine 29", () => {
  const b = [...bars(), { time: T0 + 24 * 300, open: 7180, high: 7182, low: 7120, close: 7125, volume: 60000 }];
  const evalMs = (b.at(-1).time + 330) * 1000;
  const ctx = withSqueeze("SQUEEZE_ACCELERATING", "DOWN", "DOWNSIDE_MOMENTUM_ACCELERATING", "DOWN");
  ctx.timestamp = new Date(evalMs - 60000).toISOString();
  const common = { bars5m: b, evaluationTimeMs: evalMs, direction: "SHORT", zone: ZONE, zoneEligible: true, candidateId: "c", zoneId: "z" };
  const withE29 = buildEngine4V2Shadow({ ...common, engine29Downstream: ctx });
  const without = buildEngine4V2Shadow({ ...common });
  const w = withE29.warnings.find((x) => x.code === "CAPITULATION_AT_ZONE");
  assert.equal(w.engine29Read, "SQUEEZE_FUEL");
  assert.equal(withE29.engine29Context.source, "engine29.downstreamContext.v1");
  assert.equal(withE29.participationState, without.participationState);
  assert.equal(withE29.confirmationState, without.confirmationState);
  assert.deepEqual(withE29.persistedState, without.persistedState);
  assert.equal(withE29.gate, false);
});

test("builder: no downstream context falls back to legacy read and marks climax UNCLASSIFIED", () => {
  const b = [...bars(), { time: T0 + 24 * 300, open: 7180, high: 7182, low: 7120, close: 7125, volume: 60000 }];
  const r = buildEngine4V2Shadow({ bars5m: b, evaluationTimeMs: (b.at(-1).time + 330) * 1000, direction: "SHORT", zone: ZONE, zoneEligible: true });
  assert.equal(r.warnings.find((x) => x.code === "CAPITULATION_AT_ZONE").engine29Read, "UNCLASSIFIED");
  assert.equal(r.engine29Context.authority, "CONTEXT_ONLY");
});

test("snapshot builder reads canonical Engine 29 file through the Replay no-lookahead selector", () => {
  const src = fs.readFileSync(new URL("../jobs/buildStrategySnapshot.js", import.meta.url), "utf8");
  assert.ok(src.includes('import { selectEngine29ReplayContext } from "../logic/engine29/replayContextSelection.js"'));
  const i = src.indexOf("engine29Downstream: selectEngine29ReplayContext(");
  assert.ok(i > 0);
  assert.ok(src.slice(i, i + 300).includes("engine29-cross-market-stress.json"));
});
