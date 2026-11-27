// Engine 8: alert the owner when an Engine 6-approved trade does NOT become a PAPER order.
//
// Owner directive (#425, Nov 27, 2026): Engine 8 never fails silently. Whenever an
// Engine 6-approved Strategy 1 trade is not turned into an order (a kill switch, the
// PAPER switch, the duplicate guard, a bad upstream input, a route error), this logs one
// structured line every cycle and sends one Pushover alert per trade+reason.
//
// Observational only: it never changes the trading decision, never throws, and is
// bounded in time. Alert dedupe state lives beside the PAPER store, outside the files
// that gate orders. Uses the existing Pushover helper (no new paid service).

import fs from "node:fs";
import path from "node:path";
import { sendPushover } from "../alerts/pushover.js";
import { PAPER_DATA_DIR } from "./engine8PaperDurableStore.js";

const APPROVED_DECISIONS = new Set(["PAPER_ALLOW", "FAST_INTRADAY_PAPER_ALLOW"]);
const MAX_KEYS = 500;
const ALERT_TIMEOUT_MS = 9000;

export function engine6ApprovedTrade(engine8PaperOrder) {
  const e6 = engine8PaperOrder?.engine6;
  const direction = String(engine8PaperOrder?.direction || "").toUpperCase();
  return Boolean(
    e6 && e6.allowed === true &&
    APPROVED_DECISIONS.has(String(e6.decision || "").toUpperCase()) &&
    (direction === "LONG" || direction === "SHORT")
  );
}

function stateFile(root) {
  return path.join(root || PAPER_DATA_DIR, "alerts", "engine8-approved-not-ordered.json");
}

function readSent(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function writeSent(file, keys) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(keys.slice(-MAX_KEYS)));
    fs.renameSync(tmp, file);
  } catch { /* observational only */ }
}

export function buildApprovedNotOrderedEvent({ engine8PaperOrder, stage, reason }) {
  const o = engine8PaperOrder || {};
  const blockers = Array.isArray(o.blockers) ? o.blockers.slice(0, 12) : [];
  return {
    event: "ENGINE8_APPROVED_TRADE_NOT_ORDERED",
    stage: stage || "UNKNOWN",
    reason: reason || null,
    engine8Status: o.status ?? null,
    primaryBlocker: o.blocker ?? blockers[0] ?? null,
    blockers,
    engine6Decision: o.engine6?.decision ?? null,
    direction: o.direction ?? null,
    candidateId: o.candidateId ?? null,
    planId: o.planId ?? null,
    snapshotTime: o.snapshotTime ?? null,
  };
}

// Returns the event (or null when Engine 6 did not approve). Never throws.
export async function alertIfApprovedNotOrdered({
  engine8PaperOrder, stage, reason, root = null, send = sendPushover, log = (x) => console.error(JSON.stringify(x)),
} = {}) {
  try {
    if (!engine6ApprovedTrade(engine8PaperOrder)) return null;
    const event = buildApprovedNotOrderedEvent({ engine8PaperOrder, stage, reason });
    log(event);
    const key = [event.planId || event.candidateId || "NO_ID", event.reason, event.primaryBlocker].join("|");
    const file = stateFile(root);
    const sent = readSent(file);
    if (sent.includes(key)) return { ...event, alertSent: false, deduped: true };
    const message = [
      `Engine 6 approved ${event.direction} but Engine 8 placed NO order.`,
      `Reason: ${event.primaryBlocker || event.reason || "UNKNOWN"}`,
      event.blockers.length ? `All blockers: ${event.blockers.join(", ")}` : null,
      `Stage: ${event.stage}`,
      `Plan: ${event.planId || "?"}`,
    ].filter(Boolean).join("\n");
    const result = await Promise.race([
      Promise.resolve(send({ title: "Engine 8: approved trade NOT ordered", message })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "ALERT_TIMEOUT" }), ALERT_TIMEOUT_MS)),
    ]);
    if (result?.ok === true) writeSent(file, [...sent, key]);
    return { ...event, alertSent: result?.ok === true, alertSkipped: result?.skipped ?? null };
  } catch {
    return null;
  }
}

export default alertIfApprovedNotOrdered;
