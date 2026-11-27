// services/core/tests/tradeInvestigatorSession.test.js
//
// Browser session boundary: the access key never reaches the browser.
// Pairing (key, server-side) -> redeem (allowed origin) -> origin-bound bearer
// token valid only for GET /trade-investigator. In memory only; no writes.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";

import { makeTradeInvestigatorRouter } from "../routes/tradeInvestigator.js";
import { createSessionStore, SESSION_TTL_MS, PAIRING_TTL_MS } from "../logic/investigator/browserSession.js";
import { S1, nov24Scenario } from "./fixtures/tradeInvestigator/syntheticScenarios.js";

const KEY = "s".repeat(24) + crypto.randomBytes(8).toString("hex");
const ORIGIN = "https://frye-dashboard.onrender.com";
const Q = "?date=2026-11-24&time=1016&strategyId=" + encodeURIComponent(S1);

async function serve({ now } = {}) {
  const sc = nov24Scenario();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/v1", makeTradeInvestigatorRouter({
    settings: {
      TRADE_INVESTIGATOR_ENABLED: "true", TRADE_INVESTIGATOR_ACCESS_KEY: KEY,
      TRADE_INVESTIGATOR_REPLAY_ROOT: sc.config.replayRoot,
      ENGINE8_PAPER_DATA_DIR: sc.config.engine8PaperDir, TRADE_JOURNAL_DIR: sc.config.journalDir,
    },
    log: () => {}, ...(now ? { now } : {}),
  }));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = "http://127.0.0.1:" + server.address().port + "/api/v1/trade-investigator";
  return { base, sc, close: () => new Promise((r) => server.close(r)) };
}

const post = (url, { headers = {}, body } = {}) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });

async function pairAndRedeem(base, origin = ORIGIN) {
  const p = await (await post(base + "/session/pairing", { headers: { "X-Trade-Investigator-Access": KEY } })).json();
  const r = await post(base + "/session/redeem", { headers: { Origin: origin }, body: { pairingCode: p.pairingCode } });
  return { pairing: p, redeemStatus: r.status, redeem: await r.json() };
}

test("pairing requires the access key: 401 without, 403 wrong, 200 with", async () => {
  const srv = await serve();
  assert.equal((await post(srv.base + "/session/pairing")).status, 401);
  assert.equal((await post(srv.base + "/session/pairing", { headers: { "X-Trade-Investigator-Access": KEY + "x" } })).status, 403);
  const ok = await post(srv.base + "/session/pairing", { headers: { "X-Trade-Investigator-Access": KEY } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = await ok.json();
  assert.match(body.pairingCode, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(body.expiresInSeconds, PAIRING_TTL_MS / 1000);
  assert.ok(!JSON.stringify(body).includes(KEY));
  await srv.close();
});

test("redeem: allowed origin only, single use, bad code rejected; token never contains the key", async () => {
  const srv = await serve();
  const p = await (await post(srv.base + "/session/pairing", { headers: { "X-Trade-Investigator-Access": KEY } })).json();
  assert.equal((await post(srv.base + "/session/redeem", { headers: { Origin: "https://evil.example" }, body: { pairingCode: p.pairingCode } })).status, 403);
  assert.equal((await post(srv.base + "/session/redeem", { body: { pairingCode: p.pairingCode } })).status, 403);
  assert.equal((await post(srv.base + "/session/redeem", { headers: { Origin: ORIGIN }, body: { pairingCode: "x".repeat(32) } })).status, 401);
  const r1 = await post(srv.base + "/session/redeem", { headers: { Origin: ORIGIN }, body: { pairingCode: p.pairingCode } });
  assert.equal(r1.status, 200);
  const t = await r1.json();
  assert.equal(t.scope, "TRADE_INVESTIGATOR_READ_ONLY");
  assert.match(t.accessToken, /^[A-Za-z0-9_-]{40,128}$/);
  assert.notEqual(t.accessToken, KEY);
  assert.equal(r1.headers.get("access-control-allow-origin"), ORIGIN);
  const r2 = await post(srv.base + "/session/redeem", { headers: { Origin: ORIGIN }, body: { pairingCode: p.pairingCode } });
  assert.equal(r2.status, 401, "pairing code is single use");
  await srv.close();
});

test("bearer token authorizes GET from its own origin only; key path unchanged", async () => {
  const srv = await serve();
  const { redeem } = await pairAndRedeem(srv.base);
  const auth = { Authorization: "Bearer " + redeem.accessToken };
  const good = await fetch(srv.base + Q, { headers: { ...auth, Origin: ORIGIN } });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).knownAtDecision.firstBlocker.engine, "engine8");
  assert.equal((await fetch(srv.base + Q, { headers: { ...auth, Origin: "https://evil.example" } })).status, 401);
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 401, "no Origin => rejected");
  assert.equal((await fetch(srv.base + Q, { headers: { Authorization: "Bearer " + "z".repeat(43), Origin: ORIGIN } })).status, 401);
  assert.equal((await fetch(srv.base + Q, { headers: { "X-Trade-Investigator-Access": KEY } })).status, 200);
  await srv.close();
});

test("bearer token cannot issue pairing codes (key-only)", async () => {
  const srv = await serve();
  const { redeem } = await pairAndRedeem(srv.base);
  const r = await post(srv.base + "/session/pairing", { headers: { Authorization: "Bearer " + redeem.accessToken, Origin: ORIGIN } });
  assert.equal(r.status, 401);
  await srv.close();
});

test("session and pairing expiry", async () => {
  let t = 1_000_000;
  const srv = await serve({ now: () => t });
  const p = await (await post(srv.base + "/session/pairing", { headers: { "X-Trade-Investigator-Access": KEY } })).json();
  t += PAIRING_TTL_MS + 1;
  assert.equal((await post(srv.base + "/session/redeem", { headers: { Origin: ORIGIN }, body: { pairingCode: p.pairingCode } })).status, 401, "expired pairing");
  const { redeem } = await pairAndRedeem(srv.base);
  const auth = { Authorization: "Bearer " + redeem.accessToken, Origin: ORIGIN };
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 200);
  t += SESSION_TTL_MS + 1;
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 401, "expired session");
  await srv.close();
});

test("revoke ends the session", async () => {
  const srv = await serve();
  const { redeem } = await pairAndRedeem(srv.base);
  const auth = { Authorization: "Bearer " + redeem.accessToken, Origin: ORIGIN };
  assert.equal((await post(srv.base + "/session/revoke", { headers: auth })).status, 200);
  assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 401);
  await srv.close();
});

test("session endpoints: unknown action 404, GET 405", async () => {
  const srv = await serve();
  assert.equal((await post(srv.base + "/session/admin")).status, 404);
  assert.equal((await fetch(srv.base + "/session/redeem")).status, 405);
  await srv.close();
});

test("no-write proof across pairing, redeem, bearer GET and revoke", async () => {
  const srv = await serve();
  const blocked = ["writeFileSync", "writeFile", "appendFileSync", "renameSync", "mkdirSync", "rmSync", "unlinkSync", "copyFileSync", "createWriteStream", "writeSync"];
  const saved = {};
  const attempts = [];
  for (const n of blocked) { saved[n] = fs[n]; fs[n] = () => { attempts.push(n); throw new Error("WRITE_" + n); }; }
  try {
    const { redeem, redeemStatus } = await pairAndRedeem(srv.base);
    assert.equal(redeemStatus, 200);
    const auth = { Authorization: "Bearer " + redeem.accessToken, Origin: ORIGIN };
    assert.equal((await fetch(srv.base + Q, { headers: auth })).status, 200);
    assert.equal((await post(srv.base + "/session/revoke", { headers: auth })).status, 200);
  } finally {
    for (const [n, f] of Object.entries(saved)) fs[n] = f;
    await srv.close();
  }
  assert.deepEqual(attempts, []);
});

test("store caps live sessions", () => {
  const store = createSessionStore();
  const tokens = [];
  for (let i = 0; i < 25; i++) {
    const { pairingCode } = store.issuePairing();
    tokens.push(store.redeem({ pairingCode, origin: ORIGIN }).accessToken);
  }
  assert.equal(store.size(), 20);
  assert.equal(store.verify({ token: tokens[0], origin: ORIGIN }), false);
  assert.equal(store.verify({ token: tokens[24], origin: ORIGIN }), true);
});
