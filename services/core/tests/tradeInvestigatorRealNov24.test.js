// services/core/tests/tradeInvestigatorRealNov24.test.js
//
// REAL Nov 24 acceptance fixtures.
// Source: /var/data/replay/es/2026-11-24/{0746,0752,1016,1025}.json on Render
// frye-market-backend-1. Host SHA256 recorded by the owner in the Render Shell
// (2026-11-24 22:19:19 UTC), copied read-only via scp, hashes re-verified on the
// copy, exported with exportTradeInvestigatorFixtures.js v2 (BEFORE/AFTER proof,
// host-hash match). Fixtures are a redacted projection of the investigator-read
// paths only; equivalence with the original files was verified at export time.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildInvestigation } from "../logic/investigator/buildInvestigation.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "tradeInvestigator", "real-2026-11-24");
const S1 = "intraday_scalp@10m";

// Recorded on the production host before the copy (Issue #364 / project record).
const HOST_SHA256 = {
  "0746": "592e1baa0d29993420ef807efbba9ad5cb31f7e164a903e9aaf3a9f0490a4a6a",
  "0752": "e1600a50352690098d06654de76800c4384146e14740d6db5ea3fb2f07eb8ec5",
  "1016": "43601e4fccd3a9f66b04f48478acc4bbe34eafc9b35884cb8f2b68185111758e",
  "1025": "0f4cc0272f957bf1ec4c15627ae90adc068933ddeb67986f2530ae3d08f02764",
};
const HOST_BYTES = { "0746": 6858716, "0752": 6663854, "1016": 7083967, "1025": 7045427 };

function scenario() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "e12-real-"));
  const root = path.join(base, "es");
  fs.mkdirSync(path.join(root, "2026-11-24"), { recursive: true });
  for (const t of Object.keys(HOST_SHA256)) {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, "2026-11-24_" + t + ".fixture.json"), "utf8"));
    fs.writeFileSync(path.join(root, "2026-11-24", t + ".json"), JSON.stringify(fx.replay));
  }
  return { replayRoot: root, engine8PaperDir: path.join(base, "none-e8"), journalDir: path.join(base, "none-j") };
}

const config = scenario();
const investigate = (time) => buildInvestigation({
  query: { date: "2026-11-24", time, strategyId: S1, candidateId: null, planId: null, tradeId: null, windowMinutes: 15, detail: "summary" },
  config,
}).body;
const row = (body, engine) => body.knownAtDecision.pipeline.find((r) => r.engine === engine);

test("fixture provenance: original-byte SHA256 and size match the production host record", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "2026-11-24_export-manifest.json"), "utf8"));
  assert.equal(manifest.allSucceeded, true);
  for (const [t, sha] of Object.entries(HOST_SHA256)) {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, "2026-11-24_" + t + ".fixture.json"), "utf8"));
    assert.equal(fx.sourceSha256, sha, t);
    assert.equal(fx.sourceBytes, HOST_BYTES[t], t);
    assert.equal(fx.expectedHostSha256, sha, t);
    const m = manifest.results.find((r) => r.time === t);
    assert.equal(m.sourceUnchanged, true, t);
    assert.equal(m.hostHashMatch, true, t);
    assert.equal(m.before.sha256, m.after.sha256, t);
  }
});

test("fixtures contain no raw bars, account identifiers or secrets", () => {
  for (const t of Object.keys(HOST_SHA256)) {
    const text = fs.readFileSync(path.join(DIR, "2026-11-24_" + t + ".fixture.json"), "utf8");
    assert.ok(!/\b(SCHWAB|TDA|IBKR|IRONBEAM)_\d{3,}/.test(text), t);
    assert.ok(!/"(accessToken|refreshToken|apiKey|password|accountNumber)"/.test(text), t);
    const bars = [];
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === "object") {
        const k = Object.keys(o);
        if (["open", "high", "low", "close"].every((x) => k.includes(x)) || ["o", "h", "l", "c"].every((x) => k.includes(x))) bars.push(o);
        Object.values(o).forEach(walk);
      }
    };
    walk(JSON.parse(text));
    assert.equal(bars.length, 0, t);
  }
});

test("REAL 07:46 — Engine 3 first blocker, ES 7206.75", () => {
  const b = investigate("0746");
  const k = b.knownAtDecision;
  assert.equal(k.price.value, 7206.75);
  assert.equal(k.firstBlocker.engine, "engine3");
  assert.equal(k.firstBlocker.rootCause, "ENGINE3_STRATEGY1_NOT_QUALIFIED");
  assert.equal(k.firstBlocker.status, "WAITING");
  assert.equal(k.firstBlocker.source, "ENGINE28A_RECORDED");
  assert.equal(k.engine28a.trusted, true);
  assert.equal(row(b, "engine26A").status, "PASS");
  assert.equal(row(b, "engine3").status, "WAITING");
  assert.equal(k.executionAtDecision.orderCreated.value, false);
});

test("REAL 07:52 — Engine 3 LONG passed, Engine 4 first blocker; v2 shadow supportive but not authority", () => {
  const b = investigate("0752");
  const k = b.knownAtDecision;
  assert.equal(k.price.value, 7223);
  assert.equal(k.direction.value, "LONG");
  assert.equal(k.firstBlocker.engine, "engine4");
  assert.equal(k.firstBlocker.rootCause, "ENGINE4_PARTICIPATION_NOT_CONFIRMED");
  assert.equal(k.engine28a.trusted, true);
  const e3 = row(b, "engine3");
  assert.equal(e3.status, "PASS");
  assert.equal(e3.statusSource, "ENGINE28A_RECORDED_UPSTREAM_OF_FIRST_BLOCKER");
  assert.equal(e3.engine28aRecordedStage, "REACTION_CONFIRMED");
  assert.equal(e3.gate, "PASSED");
  const e4 = row(b, "engine4");
  assert.equal(e4.status, "WAITING");
  assert.equal(e4.shadow[0].authority, "SHADOW");
  assert.equal(e4.shadow[0].decision.participationState, "SUPPORTIVE");
  assert.equal(e4.shadow[0].decision.confirmationState, "CONFIRMED");
});

test("REAL 10:16 — Engine 8 first blocker, LONG, 3 contracts, PAPER acceptance state unavailable, no order", () => {
  const b = investigate("1016");
  const k = b.knownAtDecision;
  assert.equal(k.firstBlocker.engine, "engine8");
  assert.equal(k.firstBlocker.rootCause, "ENGINE8_NOT_EXECUTABLE");
  assert.equal(k.firstBlocker.status, "BLOCKED");
  assert.ok(k.firstBlocker.blockers.includes("PAPER_ACCEPTANCE_STATE_UNAVAILABLE"));
  assert.equal(k.direction.value, "LONG");
  assert.equal(k.tradeGeometry.contracts.value, 3);
  assert.equal(k.executionAtDecision.orderCreated.value, false);
  assert.equal(k.executionAtDecision.orderId.status, "UNKNOWN");
  assert.equal(k.executionAtDecision.tradeId.status, "UNKNOWN");
  for (const e of ["engine26A", "engine3", "engine4", "engine6", "engine26B", "engine7", "engine9"]) {
    assert.equal(row(b, e).status, "PASS", e);
  }
  const dup = b.flags.find((f) => f.flag === "DUPLICATE_BLOCK_RECORDED");
  assert.ok(dup, "Engine 8 recorded DUPLICATE_ORDER_BLOCKED; flagged as not proving a prior order");
  assert.match(dup.detail.note, /does not prove a prior order existed/);
});

test("REAL 10:25 — later state: SHORT, Engine 4 first blocker", () => {
  const b = investigate("1025");
  const k = b.knownAtDecision;
  assert.equal(k.price.value, 7207.5);
  assert.equal(k.direction.value, "SHORT");
  assert.equal(k.firstBlocker.engine, "engine4");
  assert.equal(k.firstBlocker.rootCause, "ENGINE4_PARTICIPATION_NOT_CONFIRMED");
  assert.equal(k.engine28a.trusted, true);
});

test("REAL — unmapped raw statuses stay UNKNOWN (no name-based mapping)", () => {
  const b = investigate("0752");
  assert.equal(row(b, "engine6").rawStatus, "STRUCTURAL_FAST_WATCH");
  assert.equal(row(b, "engine6").status, "UNKNOWN");
  assert.equal(row(b, "engine7").rawStatus, "SIZING_GEOMETRY_INVALID");
  assert.equal(row(b, "engine7").status, "UNKNOWN");
});
