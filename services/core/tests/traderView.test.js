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
import { buildTraderView, gearFromMasterScore } from "../logic/traderView/buildTraderView.js";
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
