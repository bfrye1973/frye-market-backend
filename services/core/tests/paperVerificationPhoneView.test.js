// #412 phone view — offline tests of services/core/public/paper-verification.html.
// The page is display-only over Engine 12's protected daily/latest API.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const FILE = path.resolve(process.cwd(), "services/core/public/paper-verification.html");
const html = fs.readFileSync(FILE, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function load() {
  const sandbox = { Intl, Date, isFinite, String, Array, Object, JSON };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return sandbox.PaperVerificationView;
}

const unknownDaily = {
  date: "2026-11-27", verdict: "UNKNOWN", evidenceReadAt: "2026-11-27T18:00:00.000Z", evidenceStability: "NO_CHANGE_OBSERVED",
  coverage: { trusted: false, reason: "COVERAGE_ATTESTATION_MISSING" },
  counts: { verifiedFills: 0, openingFills: 0, exitFills: 0, journalOpen: 0, journalClosed: 0, journalUnverified: 0, pendingJournalAck: 0 },
  issues: [], fills: [],
  reportedAttempts: { reportedApprovedCandidates: 1, reportedAttempts: 2, issues: ["RECEIPT_COVERAGE_UNPROVEN"] },
  note: "YES requires independently revalidated durable fill evidence.",
};
const skippedLatest = {
  status: "APPROVAL_REPORTED_SKIPPED", dailyVerdict: "UNKNOWN",
  reported: { firstObservedApprovalTime: "2026-11-27T15:00:00.000Z", lastObservedCycleTime: "2026-11-27T15:03:00.000Z", attemptCount: 2,
    skipReason: "PAPER_ACCEPTANCE_STATE_UNAVAILABLE", rejectReason: null, blockers: ["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"], orderCreated: false },
  independent: { approvalReplay: { status: "UNKNOWN" }, fill: null, journal: null },
};

test("UNKNOWN is shown as UNKNOWN, with coverage UNKNOWN, never as 'no trade'", () => {
  const out = load().renderAll(unknownDaily, skippedLatest);
  assert.match(out, /class="verdict v-UNKNOWN"/);
  assert.match(out, /not the same as “no trade”/);
  assert.match(out, /<b>UNKNOWN<\/b>/);
  assert.doesNotMatch(out, /VERIFIED<\/b>/);
  assert.doesNotMatch(out, /assumed/i);
});

test("Nov 24/25 style block: shows Engine 8 skipped it and the exact blocker; fill not verified", () => {
  const out = load().renderLatest(skippedLatest);
  assert.match(out, /Engine 8 skipped it/);
  assert.match(out, /PAPER_ACCEPTANCE_STATE_UNAVAILABLE/);
  assert.match(out, /not verified/);
});

test("YES only when Engine 12 says YES; the page never computes a verdict", () => {
  const V = load();
  assert.match(V.renderVerdict({ verdict: "YES", date: "d" }), /v-YES/);
  assert.match(V.renderVerdict({ verdict: "NO", date: "d" }), /v-NO/);
  for (const v of [undefined, null, "", "COMPLETE", "yes", "MAYBE"]) {
    assert.match(V.renderVerdict({ verdict: v, date: "d" }), /v-UNKNOWN/, String(v));
  }
});

test("per-approval list renders when Engine 12 provides it, and says so plainly when it does not", () => {
  const V = load();
  assert.match(V.renderPerApproval(unknownDaily), /Waiting on Engine 12/);
  const out = V.renderPerApproval({ perApproval: [
    { firstObservedApprovalTime: "2026-11-27T15:00:00.000Z", verdict: "UNKNOWN", status: "APPROVAL_REPORTED_SKIPPED", firstBlocker: "ENGINE8" },
    { firstObservedApprovalTime: "2026-11-27T16:00:00.000Z", verdict: "YES", status: "FILLED_JOURNALED" },
  ] });
  assert.equal((out.match(/class="approval"/g) || []).length, 2);
  assert.match(out, /v-YES/);
  assert.match(out, /First blocker: ENGINE8/);
});

test("all server text is escaped (no HTML injection from evidence fields)", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const out = load().renderAll(
    { ...unknownDaily, issues: [evil], coverage: { trusted: false, reason: evil } },
    { ...skippedLatest, reported: { ...skippedLatest.reported, skipReason: evil, blockers: [evil] } }
  );
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
});

test("errors are plain and specific", () => {
  const V = load();
  assert.match(V.errorText(403), /not accepted/);
  assert.match(V.errorText(503, { error: "TRADE_INVESTIGATOR_NOT_CONFIGURED" }), /not switched on/);
  assert.match(V.errorText(429), /Too many requests/);
});

test("Arizona day boundary: 06:59Z is still the previous Arizona day", () => {
  const V = load();
  assert.equal(V.arizonaToday(Date.parse("2026-11-28T06:59:00Z")), "2026-11-27");
  assert.equal(V.arizonaToday(Date.parse("2026-11-28T07:00:00Z")), "2026-11-28");
});

test("security: key only in a request header, same-origin API, no external resources, no data in the file", () => {
  assert.match(html, /"X-Trade-Investigator-Access": key/);
  assert.match(html, /var API = "\/api\/v1\/trade-investigator";/);
  assert.doesNotMatch(html, /[?&](key|access|token)=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.match(html, /credentials: "omit"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  // Display-only: no write methods anywhere.
  assert.doesNotMatch(html, /method:\s*"(POST|PUT|PATCH|DELETE)"/i);
});
