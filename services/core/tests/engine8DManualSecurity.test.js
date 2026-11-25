import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { requireEngine8Admin } from "../logic/trading/schwab/engine8AdminAuth.js";

function auth(headers = {}) {
  let status = 200;
  let response = null;
  let called = false;
  const req = { headers };
  const res = { status(code) { status = code; return this; }, json(body) { response = body; return this; } };
  requireEngine8Admin(req, res, () => { called = true; });
  return { status, response, called };
}

test("unauthenticated admin mutation request is rejected", () => {
  const previous = process.env.ENGINE8_ADMIN_SECRET;
  process.env.ENGINE8_ADMIN_SECRET = "test-only-secret";
  try {
    assert.equal(auth().called, false);
    assert.equal(auth().status, 401);
    assert.equal(auth({ "x-engine8-admin-secret": "wrong" }).status, 401);
    assert.equal(auth({ "x-engine8-admin-secret": "test-only-secret" }).called, true);
  } finally {
    if (previous === undefined) delete process.env.ENGINE8_ADMIN_SECRET;
    else process.env.ENGINE8_ADMIN_SECRET = previous;
  }
});

test("legacy execute, cancel, and Journal retry routes all require admin middleware", () => {
  const source = fs.readFileSync(path.resolve("services/core/routes/trading.js"), "utf8");
  for (const endpoint of ["/execute", "/cancel", "/paper/retry-journal"]) {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("router\\.post\\(\\s*[\"']" + escaped + "[\"']\\s*,\\s*requireEngine8Admin\\s*,");
    assert.match(source, pattern, endpoint + " must require admin");
  }
});

test("manual PAPER trading does not import or call a Schwab order gateway", () => {
  const paper = fs.readFileSync(path.resolve("services/core/logic/trading/engine8Paper.js"), "utf8");
  assert.doesNotMatch(paper, /schwab.*(placeOrder|submitOrder)|placeSchwabOrder|submitSchwabOrder/i);
  assert.match(paper, /ticket\?\.paper === false/);
  assert.match(paper, /JOURNAL_PENDING/);
  assert.match(paper, /retryPaperJournalDelivery/);
});

test("automated sizing does not accept retired Engine 7B as an active fallback", () => {
  const executor = fs.readFileSync(path.resolve("services/core/logic/trading/engine8PaperExecutor.js"), "utf8");
  const fn = executor.slice(executor.indexOf("function resolveEngine7Sizing("), executor.indexOf("function resolveEngine7Sizing(") + 1100);
  assert.doesNotMatch(fn, /engine7B/);
  assert.match(fn, /engine7PositionSizing/);
});
