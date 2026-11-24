// services/core/tests/tradeInvestigatorRoute.test.js
//
// Engine 12 Trade Investigator route: authentication, GET-only, validation,
// path safety, CORS, no-store, response bounds, redaction, rate limit,
// and a no-write proof.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

import { makeTradeInvestigatorRouter } from "../routes/tradeInvestigator.js";
import { S1, nov24Scenario, nov24_1016, makeScenario, lifecycleReplay, paperOrder, journalTrade, LIFE_DATE } from "./fixtures/tradeInvestigator/syntheticScenarios.js";

const KEY = "k".repeat(24) + crypto.randomBytes(8).toString("hex");
const ALLOWED_ORIGIN = "https://frye-dashboard.onrender.com";

function settingsFor(sc, extra = {}) {
  return {
    TRADE_INVESTIGATOR_ENABLED: "true",
    TRADE_INVESTIGATOR_ACCESS_KEY: KEY,
    TRADE_INVESTIGATOR_REPLAY_ROOT: sc.config.replayRoot,
    ENGINE8_PAPER_DATA_DIR: sc.config.engine8PaperDir,
    TRADE_JOURNAL_DIR: sc.config.journalDir,
    ...extra,
  };
}

async function serve(settings, opts = {}) {
  const app = express();
  // Reproduce the project-wide reflective CORS middleware from server.js.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    next();
  });
  app.use("/api/v1", makeTradeInvestigatorRouter({ settings, log: () => {}, ...opts }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/v1/trade-investigator";
  return { base, close: () => new Promise((r) => server.close(r)) };
}

const Q = "?date=2026-11-24&time=1016&strategyId=" + encodeURIComponent(S1);
const auth = { "X-Trade-Investigator-Access": KEY };

test("503 when not configured (disabled or short key)", async () => {
  const sc = nov24Scenario();
  for (const s of [{}, settingsFor(sc, { TRADE_INVESTIGATOR_ENABLED: "false" }), settingsFor(sc, { TRADE_INVESTIGATOR_ACCESS_KEY: "short" })]) {
    const srv = await serve(s);
    const r = await fetch(srv.base + Q, { headers: auth });
    assert.equal(r.status, 503);
    await srv.close();
  }
});

test("401 missing credential, 403 wrong credential, Engine 8 admin header not accepted", async () => {
  const srv = await serve(settingsFor(nov24Scenario()));
  assert.equal((await fetch(srv.base + Q)).status, 401);
  assert.equal((await fetch(srv.base + Q, { headers: { "X-Trade-Investigator-Access": KEY + "x" } })).status, 403);
  assert.equal((await fetch(srv.base + Q, { headers: { "X-Engine8-Admin-Secret": KEY } })).status, 401);
  await srv.close();
});

test("405 for every non-GET method", async () => {
  const srv = await serve(settingsFor(nov24Scenario()));
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await fetch(srv.base + Q, { method, headers: auth });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get("allow"), "GET");
  }
  await srv.close();
});

test("400 for invalid, unknown, repeated, and traversal parameters", async () => {
  const srv = await serve(settingsFor(nov24Scenario()));
  const bad = [
    "?date=2026-02-30&time=1016&strategyId=" + S1,
    "?date=2026-11-24&time=2460&strategyId=" + S1,
    "?date=2026-11-24&time=1016&strategyId=unknown@1m",
    "?date=2026-11-24&time=1016&strategyId=" + S1 + "&extra=1",
    "?date=2026-11-24&date=2026-11-23&time=1016&strategyId=" + S1,
    "?date=..%2F..%2Fetc&time=1016&strategyId=" + S1,
    "?date=2026-11-24&time=..%2F1&strategyId=" + S1,
    "?date=2026-11-24&time=1016&strategyId=..%2F..%2Fjournal",
    "?date=2026-11-24&time=1016&strategyId=" + S1 + "&planId=..%2Fx",
    "?date=2026-11-24&time=1016&strategyId=" + S1 + "&windowMinutes=61",
    "?date=2026-11-24&time=1016&strategyId=" + S1 + "&detail=raw",
  ];
  for (const q of bad) {
    const r = await fetch(srv.base + q, { headers: auth });
    assert.equal(r.status, 400, q);
    const body = await r.json();
    assert.equal(body.error, "INVALID_QUERY");
  }
  await srv.close();
});

test("symlinked day directory and symlinked file escaping the root are refused", async () => {
  const sc = nov24Scenario();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "e12-outside-"));
  fs.writeFileSync(path.join(outside, "1016.json"), JSON.stringify(nov24_1016()));
  fs.symlinkSync(outside, path.join(sc.config.replayRoot, "2026-11-25"));
  fs.mkdirSync(path.join(sc.config.replayRoot, "2026-11-26"));
  fs.symlinkSync(path.join(outside, "1016.json"), path.join(sc.config.replayRoot, "2026-11-26", "1016.json"));
  const srv = await serve(settingsFor(sc));
  const a = await fetch(srv.base + "?date=2026-11-25&time=1016&strategyId=" + S1, { headers: auth });
  assert.equal(a.status, 404);
  const b = await fetch(srv.base + "?date=2026-11-26&time=1016&strategyId=" + S1, { headers: auth });
  assert.ok([403, 500].includes(b.status), "escaping symlink refused, got " + b.status);
  const body = await b.json();
  assert.ok(!JSON.stringify(body).includes(outside));
  await srv.close();
});

test("200: no-store, nosniff, credentials header removed, CORS only for allowed origin", async () => {
  const srv = await serve(settingsFor(nov24Scenario()));
  const good = await fetch(srv.base + Q, { headers: { ...auth, Origin: ALLOWED_ORIGIN } });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "no-store");
  assert.equal(good.headers.get("x-content-type-options"), "nosniff");
  assert.equal(good.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(good.headers.get("access-control-allow-credentials"), null);
  assert.ok(good.headers.get("server-timing"));
  const body = await good.json();
  assert.equal(body.knownAtDecision.firstBlocker.engine, "engine8");
  assert.equal(typeof body.timing.durationMs, "number");
  const evil = await fetch(srv.base + Q, { headers: { ...auth, Origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  await srv.close();
});

test("404 status semantics for missing evidence", async () => {
  const srv = await serve(settingsFor(nov24Scenario()));
  const r = await fetch(srv.base + "?date=2026-11-01&time=1016&strategyId=" + S1, { headers: auth });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, "REPLAY_DATE_NOT_FOUND");
  await srv.close();
});

test("response bounds: oversized detail=full => 413; summary omits raw records", async () => {
  const r = nov24_1016();
  r.strategies[S1].engine8PaperOrder.diagnosticBlob = "x".repeat(3 * 1024 * 1024);
  const sc = makeScenario({ replays: { "2026-11-24/1016": r }, orders: [], journal: [] });
  const srv = await serve(settingsFor(sc));
  const full = await fetch(srv.base + Q + "&detail=full", { headers: auth });
  assert.equal(full.status, 413);
  const summary = await fetch(srv.base + Q, { headers: auth });
  assert.equal(summary.status, 200);
  assert.ok(Number(summary.headers.get("content-length") || 0) < 512 * 1024);
  await srv.close();
});

test("redaction: secrets removed, account identifiers hashed, raw bars omitted", async () => {
  const replay = lifecycleReplay();
  const s1 = replay.strategies[S1];
  Object.assign(s1.engine8PaperOrder, { accessToken: "tok-123", accountId: "12345678", note: "routed via SCHWAB_6380" });
  s1.confluence.context.reaction.paperScalpReaction.bars = [{ o: 1 }, { o: 2 }];
  const sc = makeScenario({
    replays: { [LIFE_DATE + "/1000"]: replay },
    orders: [paperOrder({ orderId: "E8O-A" })],
    journal: [journalTrade({ tradeId: "T-A", orderId: "E8O-A" })],
  });
  const srv = await serve(settingsFor(sc));
  const res = await fetch(srv.base + "?date=" + LIFE_DATE + "&time=1000&strategyId=" + S1 + "&detail=full", { headers: auth });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("tok-123"));
  assert.ok(!text.includes("accessToken"));
  assert.ok(!text.includes("12345678"));
  assert.ok(!text.includes("6380"));
  assert.ok(text.includes("LICENSED_RAW_BARS_OMITTED"));
  await srv.close();
});

test("rate limit => 429", async () => {
  let t = 0;
  const srv = await serve(settingsFor(nov24Scenario()), { rateLimit: { limit: 2, windowMs: 60_000 }, now: () => t });
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 200);
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 200);
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 429);
  t = 61_000;
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 200);
  await srv.close();
});

function treeState(root) {
  const out = {};
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) { out[p] = "dir"; walk(p); }
      else out[p] = st.size + ":" + st.mtimeMs + ":" + crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    }
  };
  walk(root);
  return out;
}

test("no-write proof: every fs write path throws during requests; tree unchanged", async () => {
  const sc = makeScenario({
    replays: { "2026-11-24/1016": nov24_1016(), [LIFE_DATE + "/1000"]: lifecycleReplay() },
    orders: [paperOrder({ orderId: "E8O-A" })],
    executions: [],
    journal: [journalTrade({ tradeId: "T-A", orderId: "E8O-A" })],
  });
  const before = treeState(sc.base);
  const srv = await serve(settingsFor(sc));

  const blocked = [
    "writeFileSync", "writeFile", "appendFileSync", "appendFile", "renameSync", "rename",
    "mkdirSync", "mkdir", "rmSync", "rm", "rmdirSync", "unlinkSync", "unlink", "copyFileSync",
    "symlinkSync", "linkSync", "truncateSync", "ftruncateSync", "createWriteStream", "writeSync",
    "fsyncSync", "chmodSync", "utimesSync",
  ];
  const saved = {};
  const attempts = [];
  for (const name of blocked) {
    saved[name] = fs[name];
    fs[name] = (...args) => { attempts.push(name); throw new Error("WRITE_ATTEMPT_" + name); };
  }
  const savedOpen = fs.openSync;
  fs.openSync = (p, flags = "r", ...rest) => {
    if (flags !== "r" && flags !== fs.constants.O_RDONLY) { attempts.push("openSync:" + flags); throw new Error("WRITE_OPEN"); }
    return savedOpen(p, flags, ...rest);
  };
  const savedPromises = { writeFile: fs.promises.writeFile, rename: fs.promises.rename, mkdir: fs.promises.mkdir };
  for (const name of Object.keys(savedPromises)) fs.promises[name] = async () => { attempts.push("promises." + name); throw new Error("WRITE"); };

  try {
    const urls = [
      Q, Q + "&detail=full", "?date=2026-11-24&time=1020&strategyId=" + S1,
      "?date=" + LIFE_DATE + "&time=1000&strategyId=" + S1, "?date=2026-11-24&time=0001&strategyId=" + S1,
      "?date=bad&time=1&strategyId=x",
    ];
    for (const u of urls) {
      const r = await fetch(srv.base + u, { headers: auth });
      assert.notEqual(r.status, 500, u);
    }
  } finally {
    for (const [name, fn] of Object.entries(saved)) fs[name] = fn;
    fs.openSync = savedOpen;
    Object.assign(fs.promises, savedPromises);
    await srv.close();
  }
  assert.deepEqual(attempts, [], "no write API was called");
  assert.deepEqual(treeState(sc.base), before, "evidence tree unchanged (paths, sizes, mtimes, sha256)");
});

test("hash reflects current bytes on every request (no cached hash)", async () => {
  const sc = nov24Scenario();
  const file = path.join(sc.config.replayRoot, "2026-11-24", "1016.json");
  const srv = await serve(settingsFor(sc));
  const a = await (await fetch(srv.base + Q, { headers: auth })).json();
  fs.appendFileSync(file, "\n");
  const b = await (await fetch(srv.base + Q, { headers: auth })).json();
  assert.notEqual(a.replay.sha256, b.replay.sha256);
  assert.equal(b.replay.sha256, crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  await srv.close();
});
