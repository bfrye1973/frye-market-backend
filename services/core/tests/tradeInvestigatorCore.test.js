// services/core/tests/tradeInvestigatorCore.test.js
//
// Engine 12 Trade Investigator: extraction, authority, first blocker.
// Fixtures here are SYNTHETIC edge-case shapes. Real Nov 24 acceptance:
// tradeInvestigatorRealNov24.test.js (production-hash-verified fixtures).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildInvestigation } from "../logic/investigator/buildInvestigation.js";
import { PIPELINE_ORDER } from "../logic/investigator/authorityRegistry.js";
import {
  S1, nov24Scenario, nov24_0752, nov24_1016, makeScenario, query, lane, replayRoot,
} from "./fixtures/tradeInvestigator/syntheticScenarios.js";

const clone = (v) => JSON.parse(JSON.stringify(v));
const row = (body, engine) => body.knownAtDecision.pipeline.find((r) => r.engine === engine);

function run(scenario, q) {
  return buildInvestigation({ query: query(q), config: scenario.config });
}

test("pipeline order is the real canonical chain (26A,3,4,6,26B,7,9,8,10)", () => {
  assert.deepEqual(PIPELINE_ORDER, ["engine26A", "engine3", "engine4", "engine6", "engine26B", "engine7", "engine9", "engine8", "engine10"]);
  const { body } = run(nov24Scenario(), { time: "1016" });
  assert.deepEqual(body.knownAtDecision.pipeline.map((r) => r.engine), PIPELINE_ORDER);
});

test("SYNTHETIC 07:46-shape — Engine 3 first blocker from recorded Engine 28A", () => {
  const { httpStatus, body } = run(nov24Scenario(), { time: "0746" });
  assert.equal(httpStatus, 200);
  assert.equal(body.knownAtDecision.price.value, 7206.75);
  assert.equal(body.knownAtDecision.firstBlocker.engine, "engine3");
  assert.equal(body.knownAtDecision.firstBlocker.rootCause, "ENGINE3_STRATEGY1_NOT_QUALIFIED");
  assert.equal(body.knownAtDecision.firstBlocker.status, "WAITING");
  assert.equal(body.knownAtDecision.firstBlocker.source, "ENGINE28A_RECORDED");
  assert.equal(body.knownAtDecision.engine28a.trusted, true);
  assert.equal(row(body, "engine26A").status, "PASS");
  assert.equal(row(body, "engine3").status, "WAITING");
  assert.equal(row(body, "engine4").downstreamOfFirstBlocker, true);
  assert.equal(row(body, "engine8").status, "NOT_REACHED");
  assert.equal(body.selection.selection, "EXACT");
  assert.ok(!body.flags.some((f) => f.flag === "AUTHORITY_NOT_PROVEN_FOR_DATE"));
  assert.equal(body.provenance.registryEvidenceStatus, "EVIDENCE_BACKED_DATES_ONLY");
});

test("SYNTHETIC 07:52-shape — Engine 4 first blocker; Engine 4 v2 shadow visible but not authority", () => {
  const { body } = run(nov24Scenario(), { time: "0752" });
  assert.equal(body.knownAtDecision.price.value, 7223);
  assert.equal(body.knownAtDecision.firstBlocker.engine, "engine4");
  assert.equal(body.knownAtDecision.firstBlocker.rootCause, "ENGINE4_PARTICIPATION_NOT_CONFIRMED");
  const e3 = row(body, "engine3");
  assert.equal(e3.status, "PASS");
  assert.equal(e3.decision.direction, "LONG");
  assert.equal(e3.decision.qualified, true);
  const e4 = row(body, "engine4");
  assert.equal(e4.status, "WAITING");
  assert.equal(e4.authority, "CANONICAL");
  assert.equal(e4.shadow.length, 1);
  assert.equal(e4.shadow[0].authority, "SHADOW");
  assert.equal(e4.shadow[0].version, "engine4.v2");
  assert.equal(e4.shadow[0].decision.participationState, "SUPPORTIVE");
  assert.equal(e3.shadow[0].version, "engine3.v6");
});

test("SYNTHETIC 10:16-shape — Engine 8 blocker, LONG, 3 contracts, no order created", () => {
  const { body } = run(nov24Scenario(), { time: "1016" });
  const k = body.knownAtDecision;
  assert.equal(k.firstBlocker.engine, "engine8");
  assert.equal(k.firstBlocker.rootCause, "ENGINE8_NOT_EXECUTABLE");
  assert.deepEqual(k.firstBlocker.blockers, ["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"]);
  assert.equal(k.direction.value, "LONG");
  assert.equal(k.tradeGeometry.contracts.value, 3);
  assert.equal(k.tradeGeometry.entry.value, 7230);
  assert.equal(k.tradeGeometry.entry.source, "engine9");
  assert.equal(k.tradeGeometry.target3.value, 7250);
  assert.equal(k.executionAtDecision.orderCreated.value, false);
  assert.equal(k.executionAtDecision.orderId.status, "UNKNOWN");
  assert.equal(k.executionAtDecision.tradeId.status, "UNKNOWN");
  assert.equal(k.decisionTime, "2026-11-24T17:15:58.000Z");
  assert.equal(k.decisionTimeSource, "engine8.evaluatedAt");
  for (const e of ["engine3", "engine4", "engine6", "engine26B", "engine7", "engine9"]) {
    assert.equal(row(body, e).status, "PASS", e);
  }
  assert.equal(row(body, "engine10").status, "NOT_REACHED");
});

test("SYNTHETIC 10:25-shape — later state selected exactly; a request between files uses the earlier file", () => {
  const sc = nov24Scenario();
  const exact = run(sc, { time: "1025" }).body;
  assert.equal(exact.selection.selectedTime, "1025");
  assert.equal(exact.knownAtDecision.price.value, 7231.5);
  const between = run(sc, { time: "1020" }).body;
  assert.equal(between.selection.selectedTime, "1016");
  assert.equal(between.selection.selection, "AT_OR_BEFORE");
  assert.equal(between.selection.offsetMinutes, 4);
  assert.equal(between.selection.nextArchivedTime, "1025");
});

test("snapshot older than window is refused, later snapshot never substituted", () => {
  const sc = nov24Scenario();
  const r = run(sc, { time: "0815", windowMinutes: 15 });
  assert.equal(r.httpStatus, 404);
  assert.equal(r.body.error, "NO_SNAPSHOT_WITHIN_WINDOW");
  const early = run(sc, { time: "0700" });
  assert.equal(early.httpStatus, 404);
  assert.equal(early.body.error, "NO_SNAPSHOT_AT_OR_BEFORE_REQUESTED_TIME");
  assert.equal(early.body.nextArchivedTime, "0746");
});

test("canonical/shadow: removing all shadow output does not change status or blocker", () => {
  const withShadow = run(nov24Scenario(), { time: "0752" }).body;
  const r = nov24_0752();
  delete r.strategies[S1].confluence.context.volume.engine4V2Shadow;
  delete r.strategies[S1].confluence.context.reaction.engine3V6Shadow;
  const noShadow = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752" }).body;
  assert.deepEqual(noShadow.knownAtDecision.firstBlocker, withShadow.knownAtDecision.firstBlocker);
  assert.deepEqual(
    noShadow.knownAtDecision.pipeline.map((x) => [x.engine, x.status]),
    withShadow.knownAtDecision.pipeline.map((x) => [x.engine, x.status]),
  );
});

test("canonical/shadow: contradictory shadow never becomes authority (28A and fallback paths)", () => {
  for (const drop28A of [false, true]) {
    const r = nov24_0752();
    const s = r.strategies[S1];
    s.confluence.context.volume.engine4V2Shadow = {
      version: "engine4.v2.participationShadow.v1", participationState: "CONFIRMED", confirmationState: "CONFIRMED",
      direction: "LONG", participationConfirmed: true, allowed: true,
    };
    s.confluence.context.reaction.engine3V6Shadow = { version: "engine3.v6", direction: "SHORT", allowed: true, engine3Strategy1QualifiedForEngine6: true };
    if (drop28A) delete s.engine28APipelineDoctor;
    const body = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752" }).body;
    assert.equal(body.knownAtDecision.firstBlocker.engine, "engine4", "drop28A=" + drop28A);
    assert.equal(row(body, "engine4").gate, "NOT_PASSED");
    assert.equal(row(body, "engine3").decision.direction, "LONG");
  }
});

test("payload label contradicting registry => UNKNOWN authority, excluded, flagged", () => {
  const r = nov24_0752();
  r.strategies[S1].confluence.context.reaction.paperScalpReaction.engine = "engine3.v6.someHandoff.v1";
  delete r.strategies[S1].engine28APipelineDoctor;
  const body = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752" }).body;
  assert.equal(row(body, "engine3").status, "UNKNOWN");
  assert.equal(body.knownAtDecision.firstBlocker.engine, "UNKNOWN");
  assert.ok(body.flags.some((f) => f.flag === "RECORDS_WITH_UNKNOWN_AUTHORITY_EXCLUDED"));
});

test("registry fails closed outside evidence-backed dates (before, adjacent, and after 2026-11-24)", () => {
  for (const date of ["2026-11-01", "2026-11-10", "2026-11-23", "2026-11-25", "2027-01-05"]) {
    const r = nov24_0752();
    const body = run(makeScenario({ replays: { [date + "/0752"]: r }, orders: [], journal: [] }), { date, time: "0752" }).body;
    assert.ok(body.flags.some((f) => f.flag === "RECORDS_WITH_UNKNOWN_AUTHORITY_EXCLUDED"), date);
    assert.ok(body.flags.some((f) => f.flag === "AUTHORITY_NOT_PROVEN_FOR_DATE"), date);
    assert.equal(body.knownAtDecision.engine28a.trusted, false, date);
    assert.equal(body.knownAtDecision.firstBlocker.engine, "UNKNOWN", date);
  }
});

test("registry rows are closed, evidence-labelled ranges (no open-ended future authority)", async () => {
  const { registrySummary } = await import("../logic/investigator/authorityRegistry.js");
  const sum = registrySummary();
  assert.equal(sum.evidenceStatus, "EVIDENCE_BACKED_DATES_ONLY");
  for (const r of sum.rows) {
    assert.equal(r.from, "2026-11-24", r.engine + " " + r.version);
    assert.equal(r.to, "2026-11-24", r.engine + " " + r.version);
    assert.ok(r.evidence, r.engine);
  }
});

test("28A untrusted when snapshotTime is from another cycle; fallback uses canonical gates only", () => {
  const r = nov24_0752();
  r.strategies[S1].engine28APipelineDoctor.snapshotTime = "2026-11-24T14:48:00.000Z";
  const body = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752" }).body;
  const k = body.knownAtDecision;
  assert.equal(k.engine28a.trusted, false);
  assert.ok(k.engine28a.checks.some((c) => c.check === "SAME_CYCLE_SNAPSHOT_TIME" && c.ok === false));
  assert.equal(k.firstBlocker.source, "CANONICAL_FALLBACK");
  assert.equal(k.firstBlocker.engine, "engine4");
  // WAITING_FOR_CONFIRMATION is not an exact mapped value: fallback does not guess.
  assert.equal(k.firstBlocker.status, "UNKNOWN");
  assert.equal(k.firstBlocker.rootCause, "INVESTIGATOR_FALLBACK_CANONICAL_GATE_NOT_PASSED");
});

test("28A untrusted when generated after the Replay file was written", () => {
  const r = nov24_0752();
  r.strategies[S1].engine28APipelineDoctor.generatedAt = "2026-11-24T15:30:00.000Z";
  const body = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752" }).body;
  assert.equal(body.knownAtDecision.engine28a.trusted, false);
});

test("28A disagreeing with stored canonical gates => BLOCKER_CONFLICT, blocker UNKNOWN", () => {
  const r = nov24_0752();
  Object.assign(r.strategies[S1].engine28APipelineDoctor, { firstFailingEngine: "engine8", rootCause: "ENGINE8_NOT_EXECUTABLE", pipelineStatus: "BLOCKED" });
  const body = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752" }).body;
  assert.equal(body.knownAtDecision.firstBlocker.engine, "UNKNOWN");
  const f = body.flags.find((x) => x.flag === "BLOCKER_CONFLICT");
  assert.ok(f);
  assert.ok(f.detail.conflicts.some((c) => c.engine === "engine4" && c.canonicalGate === "NOT_PASSED"));
});

test("28A is ignored for lanes it does not cover", () => {
  const r = nov24_0752();
  r.strategies["minor_swing@1h"] = { ...clone(r.strategies[S1]), strategyId: "minor_swing@1h" };
  const body = run(makeScenario({ replays: { "2026-11-24/0752": r }, orders: [], journal: [] }), { time: "0752", strategyId: "minor_swing@1h" }).body;
  assert.equal(body.knownAtDecision.engine28a.trusted, false);
  assert.ok(body.knownAtDecision.engine28a.checks.some((c) => c.check === "LANE_COVERED_BY_ENGINE28A" && c.ok === false));
  assert.notEqual(body.knownAtDecision.firstBlocker.source, "ENGINE28A_RECORDED");
});

test("fallback refuses when an upstream canonical engine is missing", () => {
  const r = nov24_1016();
  delete r.strategies[S1].engine28APipelineDoctor;
  delete r.strategies[S1].confluence.context.volume.engine4AuthorizedReactionParticipation;
  const body = run(makeScenario({ replays: { "2026-11-24/1016": r }, orders: [], journal: [] }), { time: "1016" }).body;
  assert.equal(body.knownAtDecision.firstBlocker.engine, "UNKNOWN");
  assert.ok(body.flags.some((f) => f.flag === "FALLBACK_REFUSED" && f.detail.reason === "UPSTREAM_EVIDENCE_INCOMPLETE"));
});

test("fallback refuses stale-cycle evidence", () => {
  const r = nov24_1016();
  delete r.strategies[S1].engine28APipelineDoctor;
  r.strategies[S1].engine7PositionSizing.snapshotTime = "2026-11-24T17:05:00.000Z";
  const body = run(makeScenario({ replays: { "2026-11-24/1016": r }, orders: [], journal: [] }), { time: "1016" }).body;
  assert.equal(body.knownAtDecision.firstBlocker.engine, "UNKNOWN");
  assert.ok(body.flags.some((f) => f.flag === "FALLBACK_REFUSED" && f.detail.reason === "STALE_CYCLE_EVIDENCE"));
});

test("INFERRED_PROGRESS: missing upstream record with downstream order is never PASS", () => {
  const r = nov24_1016();
  const s = r.strategies[S1];
  delete s.engine28APipelineDoctor;
  delete s.confluence.context.volume.engine4AuthorizedReactionParticipation;
  Object.assign(s.engine8PaperOrder, { orderCreated: true, orderId: "E8O-SYN", status: "PAPER_ORDER_FILLED_JOURNALED", blockers: [] });
  const body = run(makeScenario({ replays: { "2026-11-24/1016": r }, orders: [], journal: [] }), { time: "1016" }).body;
  assert.equal(row(body, "engine4").status, "INFERRED_PROGRESS");
  assert.notEqual(row(body, "engine4").status, "PASS");
});

test("missing strategy lane => 404, missing date => 404, corrupt replay => 500 with hash", () => {
  const sc = nov24Scenario();
  assert.equal(run(sc, { time: "0746", strategyId: "primary_position@1d" }).httpStatus, 404);
  assert.equal(run(sc, { date: "2026-11-23" }).httpStatus, 404);
  const bad = makeScenario({ replays: { "2026-11-24/0746": "{not json" }, orders: [], journal: [] });
  const r = run(bad, { time: "0746" });
  assert.equal(r.httpStatus, 500);
  assert.equal(r.body.error, "REPLAY_FILE_CORRUPT");
  assert.match(r.body.sha256, /^[0-9a-f]{64}$/);
});

test("query identity is checked, never substituted for snapshot identity", () => {
  const body = run(nov24Scenario(), { time: "1016", planId: "E9P-SOMETHING-ELSE" }).body;
  const f = body.flags.find((x) => x.flag === "QUERY_IDENTITY_MISMATCH");
  assert.ok(f);
  assert.equal(f.detail.snapshot, "E9P-NOV24-SYN-1016");
  assert.equal(body.knownAtDecision.identity.planId.value, "E9P-NOV24-SYN-1016");
});

test("replay sha256 is computed over the exact file bytes", async () => {
  const sc = nov24Scenario();
  const { createHash } = await import("node:crypto");
  const bytes = fs.readFileSync(path.join(sc.config.replayRoot, "2026-11-24", "1016.json"));
  const body = run(sc, { time: "1016" }).body;
  assert.equal(body.replay.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(body.replay.replayRelativePath, "2026-11-24/1016.json");
  assert.ok(!JSON.stringify(body).includes(sc.base), "no absolute filesystem path in response");
});

test("lane() helper shape matches the real Replay paths the investigator reads", () => {
  const l = lane({ e26a: { candidateId: "x" }, e3: {}, e4: {}, e6: {}, e26b: {}, e7: {}, e9: {}, e8: {} });
  assert.ok(l.confluence.context.reaction.paperScalpReaction);
  assert.ok(l.confluence.context.volume.engine4AuthorizedReactionParticipation);
  assert.ok(l.permission.paper);
  assert.ok(replayRoot({ strategies: {} }).immutable);
});
