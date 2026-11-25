// Trader View v1 — adapter + route tests (handoff task 2).
// Display-only checks: the endpoint explains engines, never decides.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { fileURLToPath } from "node:url";
import { buildTraderView, gearFromMasterScore, updateEngine3DirectionHistory, directionHistoryView } from "../logic/traderView/buildTraderView.js";
import { createTraderViewRouter } from "../routes/traderView.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, "fixtures/traderView/live-2026-11-24T0018Z.input.json");
const input = JSON.parse(fs.readFileSync(FIX, "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const NODE = "intraday_scalp@10m";

function live() {
  const i = clone(input);
  return { snapshot: i.snapshot, meter: i.meter, nowMs: i.nowMs };
}
const node = (p) => p.snapshot.strategies[NODE];
const statuses = (v) => v.pipeline.map((p) => p.status).join(",");

/* ---------------- adapter ---------------- */

test("authority flags are always true and no permission/execution field is created", () => {
  const cases = [live(), { snapshot: null, meter: null, nowMs: input.nowMs }];
  const allowed = live();
  node(allowed).permission = { permission: "ALLOW", sizeMultiplier: 1, asOf: allowed.snapshot.now };
  cases.push(allowed);
  for (const c of cases) {
    const v = buildTraderView(c);
    assert.deepEqual(v.authority, { displayOnly: true, noPermissionCreated: true, noExecution: true, finalPermission: "Engine 6" });
    assert.equal(v.verdict.source, "Engine 6");
    for (const s of Object.values(v.sections)) assert.equal(s.authority, "DISPLAY_ONLY");
    // "sections.permission" is the contract's display section for Engine 6; anything
    // else named like a grant/execution field is forbidden anywhere in the payload.
    const keys = [];
    (function walk(o, at) {
      if (o && typeof o === "object") for (const [k, val] of Object.entries(o)) { keys.push(`${at}.${k}`); walk(val, `${at}.${k}`); }
    })(v, "$");
    const forbidden = keys.filter((p) => {
      const k = p.split(".").pop();
      if (p === "$.sections.permission") return false;
      return /^(permission|permissions|paperAllowed|allowTrade|allowed|execute|execution|order|orders|ticket|placeOrder|sizeMultiplier)$/i.test(k);
    });
    assert.deepEqual(forbidden, [], `forbidden keys created: ${forbidden}`);
  }
});

test("live 2026-11-23 shape -> NO_TRADE and READY,WAITING,WAITING,BLOCKED", () => {
  const v = buildTraderView(live());
  assert.equal(v.schema, "traderView.v1");
  assert.equal(v.verdict.state, "NO_TRADE");
  assert.equal(statuses(v), "READY,WAITING,WAITING,BLOCKED");
  assert.equal(v.freshness.status, "LIVE");
  assert.equal(v.marketDirection.gear, "N");
});

test("verdict always mirrors node.permission.permission", () => {
  for (const [perm, size, expected] of [
    ["STAND_DOWN", 0, "NO_TRADE"], ["BLOCK", 0, "NO_TRADE"], ["DENY", 1, "NO_TRADE"],
    ["NO_TRADE", 1, "NO_TRADE"], ["ALLOW", 0, "NO_TRADE"], ["ALLOW", 1, "PAPER_ALLOWED"],
  ]) {
    const p = live();
    node(p).permission = { ...node(p).permission, permission: perm, sizeMultiplier: size };
    const v = buildTraderView(p);
    assert.equal(v.verdict.state, expected, `${perm}/${size}`);
  }
});

test("price inside the zone -> checklist step 2 done", () => {
  const p = live();
  node(p).engine26LocationCandidate.currentPrice = 7310;
  const v = buildTraderView(p);
  assert.equal(v.checklist[1].done, true);
  assert.equal(v.price, 7310);
});

test("price outside the zone -> checklist step 2 not done", () => {
  assert.equal(buildTraderView(live()).checklist[1].done, false);
});

test("Engine 3 LONG -> reaction READY; NEUTRAL -> WAITING", () => {
  const p = live();
  node(p).confluence.context.reaction.engine3V5.canonical.canonical.direction = "LONG";
  assert.equal(buildTraderView(p).sections.reaction.status, "READY");
  assert.equal(buildTraderView(live()).sections.reaction.status, "WAITING");
});

test("Engine 4 ADVERSE -> BLOCKED; CONFIRMED -> READY", () => {
  const p = live();
  const v1 = node(p).confluence.context.volume.engine4AuthorizedReactionParticipation.participation5m;
  v1.state = "ADVERSE";
  assert.equal(buildTraderView(p).sections.participation.status, "BLOCKED");
  v1.state = "CONFIRMED";
  assert.equal(buildTraderView(p).sections.participation.status, "READY");
});

test("Engine 6 allowed with size > 0 -> PAPER_ALLOWED; STAND_DOWN -> NO_TRADE", () => {
  const p = live();
  node(p).permission = { ...node(p).permission, permission: "ALLOW", sizeMultiplier: 1 };
  const v = buildTraderView(p);
  assert.equal(v.verdict.state, "PAPER_ALLOWED");
  assert.equal(v.sections.permission.status, "READY");
  assert.equal(buildTraderView(live()).verdict.state, "NO_TRADE");
});

test("missing engines -> UNAVAILABLE sections, no crash", () => {
  const p = live();
  p.snapshot.strategies[NODE] = {};
  delete p.snapshot.engine25Context;
  const v = buildTraderView({ ...p, meter: null });
  // Contract status stays in READY|WAITING|BLOCKED|INFO; a missing engine is state UNAVAILABLE.
  for (const k of ["location", "reaction", "participation", "permission", "structure"]) {
    assert.equal(v.sections[k].state, "UNAVAILABLE", k);
    assert.equal(v.sections[k].status, "INFO", k);
    assert.equal(v.sections[k].authority, "DISPLAY_ONLY", k);
  }
  assert.equal(v.verdict.state, "NO_TRADE");
  assert.doesNotThrow(() => buildTraderView({}));
  assert.equal(buildTraderView({}).freshness.status, "UNAVAILABLE");
});

test("snapshot older than 5 min -> STALE; exactly 5 min -> LIVE", () => {
  const p = live();
  const asOf = Date.parse(p.snapshot.now);
  assert.equal(buildTraderView({ ...p, nowMs: asOf + 5 * 60 * 1000 + 1 }).freshness.status, "STALE");
  assert.equal(buildTraderView({ ...p, nowMs: asOf + 5 * 60 * 1000 }).freshness.status, "LIVE");
});

test("gear boundaries", () => {
  const cases = { 49.9: "R", 50: "N", 61.9: "N", 62: "1", 68.9: "1", 69: "2", 89.9: "4", 90: "TURBO" };
  for (const [s, g] of Object.entries(cases)) assert.equal(gearFromMasterScore(Number(s)), g, String(s));
  assert.equal(gearFromMasterScore(null), null);
});

test("meter missing -> meterAvailable false, still a full payload", () => {
  const v = buildTraderView({ ...live(), meter: null });
  assert.equal(v.freshness.meterAvailable, false);
  assert.equal(v.marketDirection.state, "UNAVAILABLE");
  assert.equal(v.verdict.state, "NO_TRADE");
});

test("10/20 EMA flat heuristic on and off", () => {
  const on = buildTraderView(live());
  assert.equal(on.sections.marketContext.details.ema10m.flat, true);
  const p = live();
  p.snapshot.emaPosture.tenMinute.ema10 = 7230;
  assert.equal(buildTraderView(p).sections.marketContext.details.ema10m.flat, false);
});

test("Engine 22 far-level warning appears only when a level is >5% from price", () => {
  const w = buildTraderView(live()).sections.structure.details.displayWarnings || [];
  assert.ok(w.some((x) => x.code === "LEVELS_FAR_FROM_PRICE"));
  const p = live();
  const ws = node(p).engine22WaveStrategy;
  (function nearify(o) {
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number" && v > 1000) o[k] = 7270; else nearify(v);
    }
  })(ws.keyLevels || ws);
  const w2 = buildTraderView(p).sections.structure.details?.displayWarnings || [];
  assert.ok(!w2.some((x) => x.code === "LEVELS_FAR_FROM_PRICE"));
});

test("payload under 20 KB and matches the committed sample", () => {
  const v = buildTraderView(live());
  assert.ok(Buffer.byteLength(JSON.stringify(v)) < 20 * 1024);
  const sample = JSON.parse(fs.readFileSync(path.join(here, "fixtures/traderView/live-2026-11-24T0018Z.traderView.v1.json"), "utf8"));
  assert.equal(v.verdict.state, sample.verdict.state);
  assert.deepEqual(v.pipeline, sample.pipeline);
});

/* ---------------- route ---------------- */

function startApp(opts) {
  const app = express();
  app.use("/api/v1", createTraderViewRouter(opts));
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function tmpSnapshot(snapshot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trader-view-"));
  const f = path.join(dir, "strategy-snapshot-es.json");
  fs.writeFileSync(f, JSON.stringify(snapshot));
  return f;
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

test("route: 200 for ES, payload < 20 KB, snapshot file unchanged", async () => {
  const file = tmpSnapshot(input.snapshot);
  const before = sha(file);
  const { srv, base } = await startApp({ snapshotFile: file, getMeter: async () => input.meter, now: () => input.nowMs });
  try {
    const r = await fetch(`${base}/api/v1/trader-view?symbol=ES`);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(Buffer.byteLength(text) < 20 * 1024);
    const v = JSON.parse(text);
    assert.equal(v.schema, "traderView.v1");
    assert.equal(v.verdict.state, "NO_TRADE");
    assert.equal(statuses(v), "READY,WAITING,WAITING,BLOCKED");
    assert.equal(r.headers.get("cache-control"), "no-store");
    // default symbol is ES
    assert.equal((await fetch(`${base}/api/v1/trader-view`)).status, 200);
  } finally {
    srv.close();
  }
  assert.equal(sha(file), before, "route must never write the snapshot");
});

test("route: non-ES symbols -> 410", async () => {
  const { srv, base } = await startApp({ snapshotFile: tmpSnapshot(input.snapshot), getMeter: async () => input.meter });
  try {
    for (const s of ["SPY", "NQ", "qqq"]) {
      const r = await fetch(`${base}/api/v1/trader-view?symbol=${s}`);
      assert.equal(r.status, 410, s);
    }
  } finally {
    srv.close();
  }
});

test("route: meter failure still returns 200 with meterAvailable false", async () => {
  const { srv, base } = await startApp({
    snapshotFile: tmpSnapshot(input.snapshot),
    getMeter: async () => { throw new Error("boom"); },
    now: () => input.nowMs,
  });
  try {
    const r = await fetch(`${base}/api/v1/trader-view?symbol=ES`);
    assert.equal(r.status, 200);
    const v = await r.json();
    assert.equal(v.freshness.meterAvailable, false);
    assert.equal(v.verdict.state, "NO_TRADE");
  } finally {
    srv.close();
  }
});

test("route: meter is cached for 15s", async () => {
  let calls = 0;
  let t = input.nowMs;
  const { srv, base } = await startApp({
    snapshotFile: tmpSnapshot(input.snapshot),
    getMeter: async () => { calls += 1; return input.meter; },
    now: () => t,
  });
  try {
    await fetch(`${base}/api/v1/trader-view?symbol=ES`);
    t += 14_000;
    await fetch(`${base}/api/v1/trader-view?symbol=ES`);
    assert.equal(calls, 1);
    t += 2_000;
    await fetch(`${base}/api/v1/trader-view?symbol=ES`);
    assert.equal(calls, 2);
  } finally {
    srv.close();
  }
});

test("route: STALE when the snapshot is older than 5 minutes", async () => {
  const { srv, base } = await startApp({
    snapshotFile: tmpSnapshot(input.snapshot),
    getMeter: async () => input.meter,
    now: () => Date.parse(input.snapshot.now) + 6 * 60 * 1000,
  });
  try {
    const v = await (await fetch(`${base}/api/v1/trader-view?symbol=ES`)).json();
    assert.equal(v.freshness.status, "STALE");
  } finally {
    srv.close();
  }
});

test("route: missing or invalid snapshot -> 503, never a fake verdict", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trader-view-"));
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{not json");
  for (const [file, err] of [[path.join(dir, "missing.json"), "SNAPSHOT_NOT_READY"], [bad, "SNAPSHOT_INVALID_JSON"]]) {
    const { srv, base } = await startApp({ snapshotFile: file, getMeter: async () => input.meter });
    try {
      const r = await fetch(`${base}/api/v1/trader-view?symbol=ES`);
      assert.equal(r.status, 503);
      const j = await r.json();
      assert.equal(j.error, err);
      assert.equal(j.verdict, undefined);
    } finally {
      srv.close();
    }
  }
});

/* ---------------- Engine 22: authorized count vs owner research ---------------- */

const loadE22 = (f) => JSON.parse(fs.readFileSync(path.join(here, "fixtures/traderView", f), "utf8"));
const E22_V7 = loadE22("live-2026-11-24T0631Z.engine22.json");
const E22_V8 = loadE22("live-2026-11-24T0648Z.engine22-v8.json");
function withE22(fx, mut, nowIso) {
  const p = live();
  node(p).engine22WaveStrategy = clone(fx.engine22WaveStrategy);
  if (mut) mut(node(p).engine22WaveStrategy);
  p.nowMs = Date.parse(nowIso || fx.snapshotNow);
  p.snapshot.now = nowIso || fx.snapshotNow; // keep the rest of the payload LIVE
  return p;
}
const fact = (sec, label) => (sec.facts.find((f) => f.label === label) || {}).value;

test("E22 V8 live: cleared degrees, Micro W1 UP candidate, Submicro unresolved, plain English", () => {
  const s = buildTraderView(withE22(E22_V8)).sections.structure;
  assert.equal(s.status, "INFO");
  // the card reads the Micro chart first
  assert.equal(s.label, "Micro W1 UP candidate (unconfirmed); Submicro unresolved");
  assert.equal(s.details.focusDegree, "micro");
  assert.match(s.plainEnglish, /^Micro chart \(authorized, rev 8, what Engine 6 and Engine 27 read\): Micro W1 UP candidate \(unconfirmed\); Submicro unresolved\. Higher degrees: Minor, Minute and Subminute cleared \(recount pending\)\./);
  assert.equal(fact(s, "Micro"), "W1 UP candidate (unconfirmed)");
  assert.equal(fact(s, "Submicro"), "Unresolved");
  assert.equal(fact(s, "Minor / Minute / Subminute"), "Cleared (recount)");
  assert.equal(fact(s, "Primary (research)"), "W5 UP (unconfirmed)");
  assert.equal(fact(s, "Intermediate (research)"), "W1 UP candidate (unconfirmed)");

  assert.match(s.plainEnglish, /an UP candidate is not a LONG signal\. Engine 6 decides\./);
  assert.doesNotMatch(s.label + s.plainEnglish, /POSSIBLE MINOR W5/);
  // 7,313.25 stays a historical reference in details, never a fact or trigger
  assert.equal(s.details.researchWaveContext.degrees.micro.observedReferenceHigh.price, 7313.25);
  assert.equal(s.details.researchWaveContext.degrees.micro.observedReferenceHigh.verified, false);
  assert.ok(!s.facts.some((f) => String(f.value).includes("7313") || String(f.value).includes("7,313")));
  assert.equal(s.details.authorizedWaveContext.publicationRevision, 8);
  assert.equal(s.details.authorizedWaveContext.stale, false);
});

test("E22 V8: micro/submicro agree with research; the Intermediate difference is reported, not hidden", () => {
  const s = buildTraderView(withE22(E22_V8)).sections.structure;
  // authorized Intermediate (canonical degreeStates) is W3 UP; research says W1 UP candidate
  assert.equal(s.state, "RECONCILIATION_PENDING");
  assert.deepEqual(s.details.reconciliation.conflicts.map((c) => c.degree), ["intermediate"]);
  assert.match(s.plainEnglish, /Intermediate \(authorized W3 UP vs research W1 UP candidate \(unconfirmed\)\)/);
  // when they agree on every shared degree -> IN_SYNC, no false pending
  const synced = buildTraderView(withE22(E22_V8, (w) => {
    w.authorizedWorkingStructure.degrees.intermediate = { ...w.authorizedWorkingStructure.degrees.intermediate, activeWave: "W1", stage: "W1_UP_DEVELOPING_CANDIDATE" };
  })).sections.structure;
  assert.equal(synced.state, "IN_SYNC");
  assert.equal(synced.details.reconciliation.trackedIn, null);
});

test("E22 V7 (historical): old DOWN count vs research -> reconciliation pending at micro and submicro", () => {
  const s = buildTraderView(withE22(E22_V7)).sections.structure;
  assert.equal(s.state, "RECONCILIATION_PENDING");
  assert.equal(fact(s, "Micro"), "C DOWN");
  assert.equal(fact(s, "Submicro"), "W2 DOWN");
  assert.deepEqual(s.details.reconciliation.conflicts.map((c) => c.degree).sort(), ["intermediate", "micro", "submicro"]);
  assert.equal(s.details.authorizedWaveContext.publicationRevision, 7);
  assert.equal(s.details.retiredHeadline.text, E22_V7.engine22WaveStrategy.tradeContextSummary.headline);
});

test("E22 revision is read, not hardcoded", () => {
  const s = buildTraderView(withE22(E22_V8, (w) => { w.authorizedWorkingStructure.publicationRevision = 12; })).sections.structure;
  assert.match(s.plainEnglish, /rev 12,/);
});

test("E22 stale authorized count is flagged", () => {
  const later = new Date(Date.parse(E22_V8.snapshotNow) + 40 * 60 * 1000).toISOString();
  const p = withE22(E22_V8, null, later);
  const s = buildTraderView(p).sections.structure;
  assert.equal(s.details.authorizedWaveContext.stale, true);
  assert.match(s.plainEnglish, /This count is stale \(published 40 min ago\)/);
});

test("E22 research never changes the verdict, pipeline or other sections; no execution/sizing fields", () => {
  const base = buildTraderView(withE22(E22_V8));
  const up = buildTraderView(withE22(E22_V8, (w) => {
    w.currentWavelength.ownerWaveRoadmap.micro = { activeWave: "W3", direction: "UP", stage: "W3_UP_CONFIRMED", completionConfirmed: true };
    w.authorizedWorkingStructure.degrees.micro = { ...w.authorizedWorkingStructure.degrees.micro, activeWave: "W3", stage: "W3_UP_ACTIVE", completionConfirmed: true };
  }));
  assert.equal(up.verdict.state, "NO_TRADE");
  assert.deepEqual(up.verdict, base.verdict);
  assert.deepEqual(up.pipeline, base.pipeline);
  assert.deepEqual(up.checklist, base.checklist);
  for (const k of ["location", "reaction", "participation", "permission"]) assert.deepEqual(up.sections[k], base.sections[k], k);
  const txt = JSON.stringify(up.sections.structure);
  assert.doesNotMatch(txt, /"(sizeMultiplier|paperAllowed|allowTrade|execute|placeOrder|ticket)"/);
});

test("E22 authorized missing -> RECOUNT_PENDING, research never promoted", () => {
  const s = buildTraderView(withE22(E22_V8, (w) => { delete w.authorizedWorkingStructure; })).sections.structure;
  assert.equal(s.state, "RECOUNT_PENDING");
  assert.equal(fact(s, "Micro"), "Unknown");
  assert.equal(fact(s, "Submicro"), "Unknown");
  assert.match(s.label, /recount pending/i);
});

test("E22 both missing -> UNKNOWN; research missing -> no research facts", () => {
  const unk = buildTraderView(withE22(E22_V8, (w) => { delete w.authorizedWorkingStructure; delete w.currentWavelength; })).sections.structure;
  assert.equal(unk.state, "UNKNOWN");
  assert.equal(unk.label, "Wave count unknown");
  const noRes = buildTraderView(withE22(E22_V8, (w) => { delete w.currentWavelength; })).sections.structure;
  assert.equal(noRes.state, "IN_SYNC");
  assert.equal(fact(noRes, "Primary (research)"), undefined);
});

test("E22 dual context keeps the payload under 20 KB", () => {
  assert.ok(Buffer.byteLength(JSON.stringify(buildTraderView(withE22(E22_V8)))) < 20 * 1024);
});

test("a 0 price upstream (not set) becomes null, never 0", () => {
  const p = live();
  delete node(p).engine26LocationCandidate.currentPrice;
  node(p).engine22WaveStrategy.currentPrice = 0;
  p.snapshot.emaPosture.tenMinute.close = null;
  const v = buildTraderView(p);
  assert.equal(v.price, null);
  assert.equal(v.checklist[1].done, false);
  assert.deepEqual(v.sections.structure.details.displayWarnings, []);
});

/* ---------------- Engine 3 explain block (display only) ---------------- */

const E3 = loadE22("live-2026-11-24T1339Z.engine3v5.json");
function withE3(mut) {
  const p = live();
  const r = node(p).confluence.context.reaction;
  r.engine3V5 = { ...r.engine3V5, ...clone(E3.engine3V5) };
  if (mut) mut(r);
  return p;
}

test("E3 explain (live 13:39Z): real waiting reason, observed sellers vs official NEUTRAL, checks, 5m bars", () => {
  const s = buildTraderView(withE3()).sections.reaction;
  const x = s.explain;
  assert.equal(s.status, "WAITING");
  assert.equal(x.officialDirection, "NEUTRAL");
  assert.equal(x.observedControl.side, "Sellers");
  assert.equal(x.observedControl.confidence, "GOOD");
  assert.deepEqual(x.observedControl.scores, { buyers: 0, sellers: 68, mixed: 22 });
  assert.equal(x.observedControl.diagnosticOnly, true);
  assert.equal(x.whyWaiting, "Sellers are in control (sellers 68 vs buyers 0), but the reaction quality is MIXED (40). Engine 3 only sets a new direction when quality is GOOD or STRONG.");
  assert.equal(x.stillNeeds, "Quality GOOD or STRONG while sellers keep control on completed 5-minute price action.");
  // the card itself is back to its original wording; the explain data stays in the payload
  assert.equal(s.waitingFor, "A rejection or a failed break at the zone edge, confirmed on a completed 5-minute bar.");
  assert.ok(x.ruleCodes.includes("FRESH_DIRECTION_REQUIRES_GOOD_OR_STRONG_QUALITY"));
  assert.deepEqual(x.checks.map((c) => c.done), [true, true, false, false]);
  assert.deepEqual(x.lastCompleted5m && [x.lastCompleted5m.time, x.lastCompleted5m.open, x.lastCompleted5m.high, x.lastCompleted5m.low, x.lastCompleted5m.close, x.lastCompleted5m.zoneRelation],
    ["2026-11-24T13:30:00.000Z", 7163.5, 7164.75, 7153, 7157.75, "INSIDE_ZONE"]);
  assert.equal(x.lastCompleted5m.stateMachineHandoffEligible, false);
  assert.equal(x.forming5m.time, "2026-11-24T13:35:00.000Z");
  assert.equal(x.v6Shadow, null);
  assert.deepEqual(s.facts.map((f) => f.label), ["Direction", "Quality", "Readiness"]);
  assert.equal(fact(s, "Quality"), "MIXED");
});

test("E3 explain never changes status, verdict or pipeline (even strong observed sellers)", () => {
  const base = buildTraderView(live());
  const strong = buildTraderView(withE3((r) => {
    r.engine3V5.evidence.priceAction.quality = "STRONG";
    r.engine3V5.evidence.priceAction.qualityScore = 95;
  }));
  assert.equal(strong.sections.reaction.status, "WAITING");
  assert.equal(strong.sections.reaction.state, "NEUTRAL");
  assert.deepEqual(strong.verdict, base.verdict);
  assert.deepEqual(strong.pipeline, base.pipeline);
  assert.equal(strong.sections.reaction.explain.checks[2].done, true);
  assert.equal(strong.sections.reaction.explain.checks[3].done, false);
});

test("E3 explain: SHORT set -> no waiting reason; zone not eligible; contested control", () => {
  const set = buildTraderView(withE3((r) => { r.engine3V5.canonical.canonical.direction = "SHORT"; })).sections.reaction;
  assert.equal(set.explain.whyWaiting, null);
  assert.equal(set.status, "READY");
  const noZone = buildTraderView(withE3((r) => { r.engine3V5.normalizedZoneInput.eligible = false; })).sections.reaction.explain;
  assert.match(noZone.whyWaiting, /no authorized Engine 26 zone/);
  const mixed = buildTraderView(withE3((r) => {
    r.engine3V5.evidence.priceAction.controlState = "MIXED_CONTROL";
    r.engine3V5.trace.stateMachine.reasonCodes = ["ENGINE3_V5_CANONICAL_DIRECTION_NEUTRAL"];
  })).sections.reaction.explain;
  assert.equal(mixed.whyWaiting, "Buyers and sellers are contested; neither side has control yet.");
});

test("E3 v6 shadow appears only when published, with no authority", () => {
  const v = buildTraderView(withE3((r) => {
    r.engine3V6Shadow = { canonical: { canonical: { direction: "SHORT", quality: "GOOD", canonicalSource: "V6_CONVICTION_SELLERS" } } };
  }));
  const x = v.sections.reaction.explain;
  assert.deepEqual(x.v6Shadow, { sourcePath: "strategies.intraday_scalp@10m.confluence.context.reaction.engine3V6Shadow", direction: "SHORT", reason: "V6_CONVICTION_SELLERS", quality: "GOOD", authority: "SHADOW_NO_AUTHORITY" });
  assert.equal(v.sections.reaction.state, "NEUTRAL"); // v5 still decides
  assert.equal(v.verdict.state, "NO_TRADE");
});

test("E3 direction history records changes only, newest first", () => {
  const snap = (dir, at) => { const p = withE3(); node(p).confluence.context.reaction.engine3V5.canonical.canonical.direction = dir; p.snapshot.now = at; return p.snapshot; };
  let h = null;
  h = updateEngine3DirectionHistory(h, snap("NEUTRAL", "2026-11-24T13:00:00Z"), { startedAt: "2026-11-24T12:59:00Z" });
  h = updateEngine3DirectionHistory(h, snap("NEUTRAL", "2026-11-24T13:03:00Z"));
  h = updateEngine3DirectionHistory(h, snap("SHORT", "2026-11-24T13:06:00Z"));
  h = updateEngine3DirectionHistory(h, snap("SHORT", "2026-11-24T13:06:00Z"));
  h = updateEngine3DirectionHistory(h, snap("NEUTRAL", "2026-11-24T13:09:00Z"));
  assert.deepEqual(h.entries.map((e) => `${e.from}->${e.to}@${e.at}`), [
    "SHORT->NEUTRAL@2026-11-24T13:09:00Z", "NEUTRAL->SHORT@2026-11-24T13:06:00Z", "null->NEUTRAL@2026-11-24T13:00:00Z"]);
  assert.equal(h.entries[2].firstObservation, true);
  const view = directionHistoryView(h);
  assert.equal(view.since, "2026-11-24T12:59:00Z");
  assert.match(view.note, /Lost on restart/);
});

test("route: direction history flows into reaction.explain across requests", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trader-view-"));
  const file = path.join(dir, "strategy-snapshot-es.json");
  const write = (d, at) => { const p = withE3(); node(p).confluence.context.reaction.engine3V5.canonical.canonical.direction = d; p.snapshot.now = at; fs.writeFileSync(file, JSON.stringify(p.snapshot)); };
  let t = Date.parse("2026-11-24T13:10:00Z");
  const { srv, base } = await startApp({ snapshotFile: file, getMeter: async () => input.meter, now: () => t });
  try {
    write("NEUTRAL", "2026-11-24T13:09:30Z");
    await fetch(`${base}/api/v1/trader-view?symbol=ES`);
    write("SHORT", "2026-11-24T13:12:30Z"); t += 3 * 60 * 1000;
    const v = await (await fetch(`${base}/api/v1/trader-view?symbol=ES`)).json();
    const h = v.sections.reaction.explain.directionHistory;
    assert.deepEqual(h.entries.map((e) => `${e.from}->${e.to}`), ["NEUTRAL->SHORT", "null->NEUTRAL"]);
    assert.match(h.recordedBy, /Engine 3 does not publish a history/);
  } finally {
    srv.close();
  }
});

test("payload with E22 V8 + E3 explain stays under 20 KB", () => {
  const p = withE3();
  node(p).engine22WaveStrategy = clone(E22_V8.engine22WaveStrategy);
  const bytes = Buffer.byteLength(JSON.stringify(buildTraderView(p)));
  assert.ok(bytes < 20 * 1024, `payload ${bytes} bytes`);
});

test("E3 source time comes from engine3V5.canonical.snapshotTime (was blank on the card)", () => {
  const s = buildTraderView(withE3((r) => { r.engine3V5.canonical.snapshotTime = "2026-11-24T13:39:20.000Z"; })).sections.reaction;
  assert.equal(s.sourceTimestamp, "2026-11-24T13:39:20.000Z");
});

test("E3 explain: contested control wins over the quality rule (live 13:57Z bug)", () => {
  const x = buildTraderView(withE3((r) => {
    r.engine3V5.evidence.priceAction.controlState = "CONTESTED";
    r.engine3V5.evidence.priceAction.sellerScore = 15;
    r.engine3V5.evidence.priceAction.mixedScore = 78;
    r.engine3V5.evidence.priceAction.qualityScore = 11;
    r.engine3V5.trace.stateMachine.reasonCodes = ["ENGINE3_V5_DIRECTIONAL_PRICE_ACTION_CONTROL_NOT_RESOLVED", "ENGINE3_V5_FRESH_DIRECTION_QUALITY_NOT_QUALIFIED", "ENGINE3_V5_CONTROL_CONTESTED"];
  })).sections.reaction.explain;
  assert.equal(x.whyWaiting, "Buyers and sellers are contested; neither side has control yet.");
  assert.doesNotMatch(x.whyWaiting, /Mixed are in control/);
});
