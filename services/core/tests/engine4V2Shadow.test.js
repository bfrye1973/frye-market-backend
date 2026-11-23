import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEngine4V2Shadow } from "../logic/engine4/v2/buildEngine4V2Shadow.js";
import { loadEngine4V2ShadowState, saveEngine4V2ShadowState } from "../logic/engine4/v2/engine4V2ShadowStore.js";

const T0 = 1795430000 - (1795430000 % 300); // 5m-aligned seconds
const ZONE = { low: 7138, high: 7210.75, midline: 7174.375 };

// 24 quiet completed bars around 7100 (baseline volume ~10k), then custom bars.
function history(n = 24, price = 7100, vol = 10000) {
  const bars = [];
  for (let k = 0; k < n; k++) {
    const o = price + (k % 2 ? 1 : -1);
    const c = price + (k % 2 ? -1 : 1);
    bars.push({ time: T0 + k * 300, open: o, high: Math.max(o, c) + 3, low: Math.min(o, c) - 3, close: c, volume: vol });
  }
  return bars;
}
const add = (bars, o, h, l, c, v) => [...bars, { time: bars.at(-1).time + 300, open: o, high: h, low: l, close: c, volume: v }];
const evalAfter = (bars, secondsIntoNext = 30) => (bars.at(-1).time + 300 + secondsIntoNext) * 1000;
const run = (bars, extra = {}) => buildEngine4V2Shadow({
  bars5m: bars, evaluationTimeMs: extra.evalMs ?? evalAfter(bars), direction: "LONG", zone: ZONE, zoneEligible: true,
  candidateId: "E26C-test", zoneId: "E26Z-test", ...extra,
});

test("authority flags: shadow only, never a gate", () => {
  const r = run(add(history(), 7100, 7130, 7099, 7128, 12000));
  assert.equal(r.shadowOnly, true);
  assert.equal(r.gate, false);
  assert.equal(r.noPermissionCreated, true);
  assert.equal(r.noExecution, true);
  assert.equal(r.directionAuthority, false);
  assert.equal(r.canonicalEngine4Unchanged, true);
});

test("insufficient completed history -> UNAVAILABLE, no confirmation", () => {
  const r = run(history(10));
  assert.equal(r.available, false);
  assert.equal(r.confirmationState, "UNAVAILABLE");
});

test("Nov 23 07:03 case: forming bar is ignored; last completed pair decides", () => {
  // Completed impulse bar (huge volume) then a young forming bar with partial volume.
  let bars = add(history(), 7100, 7200, 7095, 7198, 44681);
  const formingStart = bars.at(-1).time + 300;
  bars = [...bars, { time: formingStart, open: 7198, high: 7230, low: 7196, close: 7226, volume: 24620 }];
  const evalMs = (formingStart + 210) * 1000; // 3.5 minutes into the forming bar
  const r = run(bars, { evalMs });
  assert.equal(r.evidence.completedBarTime, formingStart - 300, "evaluates the completed impulse bar, not the forming bar");
  assert.equal(r.participationState, "SUPPORTIVE");
  assert.equal(r.confirmationState, "CONFIRMED");
  assert.equal(r.forming5m.authority, "DIAGNOSTIC_ONLY");
  assert.ok(r.forming5m.pacedRelVol > 1, "forming bar is pace-normalized, not read as weak");
});

test("reversal after a selling flush is not 'weak' just because the prior bar was huge", () => {
  let bars = add(history(), 7100, 7101, 7060, 7062, 50000); // selling flush
  bars = add(bars, 7062, 7090, 7055, 7088, 30000);           // reversal bar: 0.6x prior, 3x baseline
  const r = run(bars);
  assert.ok(r.evidence.legacyBarToBarRatio < 0.9, "legacy ratio would call it weak");
  assert.ok(r.evidence.relVol >= 0.9);
  assert.equal(r.participationState, "SUPPORTIVE");
});

test("climactic selling into the zone -> CAPITULATION_AT_ZONE warning (no gate)", () => {
  const bars = add(history(24, 7180), 7180, 7182, 7120, 7125, 60000);
  const r = run(bars, { direction: "SHORT" });
  const w = r.warnings.find((x) => x.code === "CAPITULATION_AT_ZONE");
  assert.ok(w, "capitulation warning present");
  assert.equal(w.side, "SELLING");
  assert.equal(r.gate, false);
});

test("absorption at zone edge: heavy volume wick below, close back inside", () => {
  const bars = add(history(24, 7160), 7158, 7166, 7120, 7162, 25000);
  const r = run(bars);
  assert.ok(r.warnings.some((x) => x.code === "ABSORPTION_AT_ZONE" && x.side === "SELLERS_ABSORBED"));
});

test("defended edge is not ADVERSE for the defended direction", () => {
  // Down bar on heavy volume but long lower wick closing back in zone while LONG.
  let bars = add(history(24, 7165), 7166, 7168, 7135, 7160, 26000);
  const r = run(bars);
  assert.notEqual(r.participationState, "ADVERSE");
});

test("effort without result warning", () => {
  const bars = add(history(), 7100, 7108, 7092, 7100.5, 20000);
  const r = run(bars);
  assert.ok(r.warnings.some((x) => x.code === "EFFORT_WITHOUT_RESULT"));
});

test("genuine adverse completed volume -> ADVERSE", () => {
  const bars = add(history(), 7101, 7102, 7070, 7072, 16000); // strong down bar vs LONG, no defense
  const r = run(bars);
  assert.equal(r.participationState, "ADVERSE");
  assert.equal(r.confirmationState, "ADVERSE");
});

test("confirmation persists through ordinary cooling, fades after 2 quiet completed bars, counts each bar once", () => {
  let bars = add(history(), 7100, 7130, 7099, 7128, 15000);
  let r = run(bars);
  assert.equal(r.confirmationState, "CONFIRMED");
  // same completed bar re-evaluated a minute later: no double counting
  let r2 = run(bars, { priorState: r.persistedState, evalMs: evalAfter(bars, 90) });
  assert.equal(r2.persistedState.fadeCount, 0);
  // quiet bar 1 (low volume, no progress)
  bars = add(bars, 7128, 7130, 7124, 7126, 4000);
  r = run(bars, { priorState: r2.persistedState });
  assert.equal(r.confirmationState, "CONFIRMED", "one quiet bar does not erase confirmation");
  r2 = run(bars, { priorState: r.persistedState, evalMs: evalAfter(bars, 120) });
  assert.equal(r2.persistedState.fadeCount, 1, "same bar counted once");
  // quiet bar 2
  bars = add(bars, 7126, 7128, 7122, 7124, 4000);
  r = run(bars, { priorState: r2.persistedState });
  assert.equal(r.confirmationState, "FADED");
});

test("new candidate/zone/direction resets persisted confirmation", () => {
  const bars = add(history(), 7100, 7130, 7099, 7128, 15000);
  const r = run(bars);
  const r2 = run(add(bars, 7128, 7129, 7120, 7122, 9000), { priorState: r.persistedState, candidateId: "E26C-other" });
  assert.notEqual(r2.confirmationState, "CONFIRMED");
  assert.ok(r2.reasonCodes.includes("ENGINE4_V2_NEW_SETUP_KEY_RESET"));
});

test("Engine 29 trend is context only", () => {
  const bars = add(history(), 7100, 7130, 7099, 7128, 15000);
  const withT = run(bars, { engine29: { fastTacticalState: "BUYING_PRESSURE_INCREASING", timestamp: new Date(evalAfter(bars)).toISOString(), dataDegraded: false } });
  const against = run(bars, { engine29: { fastTacticalState: "SELLING_PRESSURE_INCREASING", timestamp: new Date(evalAfter(bars)).toISOString(), dataDegraded: false } });
  assert.equal(withT.engine29Context.trendAlignment, "WITH_TREND");
  assert.equal(against.engine29Context.trendAlignment, "AGAINST_TREND");
  assert.equal(withT.confirmationState, against.confirmationState, "trend never changes the participation decision");
  assert.equal(run(bars).engine29Context.trendAlignment, "UNAVAILABLE");
});

test("shadow store round-trips and rejects invalid state", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e4v2-")), "state.json");
  const r = run(add(history(), 7100, 7130, 7099, 7128, 15000));
  assert.equal(saveEngine4V2ShadowState({ state: r.persistedState, filePath: file }).saved, true);
  const back = loadEngine4V2ShadowState({ filePath: file });
  assert.equal(back.found, true);
  assert.equal(back.state.confirmationState, "CONFIRMED");
  assert.equal(saveEngine4V2ShadowState({ state: { bogus: true }, filePath: file }).saved, false);
});

test("snapshot wiring publishes engine4V2Shadow beside unchanged v1", () => {
  const src = fs.readFileSync(new URL("../jobs/buildStrategySnapshot.js", import.meta.url), "utf8");
  assert.ok(src.includes("patchedConfluence.context.volume.engine4V2Shadow = engine4V2Shadow"));
  assert.ok(src.includes("attachEngine4AuthorizedReactionParticipation({"));
  const v2Block = src.slice(src.indexOf("Engine 4 v2 SHADOW (issue #365)"), src.indexOf("[E4 V2 SHADOW ERROR]"));
  assert.ok(!/permission|engine6|allowed\s*=/.test(v2Block.replace(/noPermissionCreated/g, "")), "v2 block must not touch permission");
});


test("stale and degraded Engine29 cannot alter participation, confirmation or persisted state", () => {
  const bars = add(history(), 7100, 7130, 7099, 7128, 15000);
  const clean = run(bars, { engine29: { fastTacticalState: "BUYING_PRESSURE_INCREASING", timestamp: new Date(evalAfter(bars)).toISOString(), dataDegraded: false } });
  for (const engine29 of [
    { fastTacticalState: "SELLING_PRESSURE_INCREASING", timestamp: new Date(evalAfter(bars) - 3600000).toISOString() },
    { fastTacticalState: "SELLING_PRESSURE_INCREASING", timestamp: new Date(evalAfter(bars)).toISOString(), dataDegraded: true },
    { fastTacticalState: "SELLING_PRESSURE_INCREASING" },
  ]) {
    const result = run(bars, { engine29 });
    assert.equal(result.engine29Context.trendAlignment, "UNAVAILABLE");
    assert.equal(result.participationState, clean.participationState);
    assert.equal(result.confirmationState, clean.confirmationState);
    assert.deepEqual(result.persistedState, clean.persistedState);
  }
});

test("warning language never issues trading or runner management instructions", () => {
  const bars = add(history(24, 7180), 7180, 7182, 7120, 7125, 60000);
  const result = run(bars, { direction: "SHORT" });
  assert.ok(result.warnings.length);
  for (const warning of result.warnings) assert.doesNotMatch(warning.meaning, /stop new entries|tighten runners|exit runners/i);
});

test("zone and direction changes each reset persistent confirmation independently", () => {
  const bars = add(history(), 7100, 7130, 7099, 7128, 15000);
  const first = run(bars);
  const cooling = add(bars, 7128, 7129, 7120, 7122, 9000);
  for (const change of [{zoneId:"E26Z-other"}, {direction:"SHORT"}]) {
    const result = run(cooling, { priorState:first.persistedState, ...change });
    assert.ok(result.reasonCodes.includes("ENGINE4_V2_NEW_SETUP_KEY_RESET"));
    assert.notEqual(result.persistedState.key, first.persistedState.key);
  }
});
