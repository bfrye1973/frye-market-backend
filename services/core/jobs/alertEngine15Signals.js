// services/core/jobs/alertEngine15Signals.js

import fs from "fs";
import path from "path";
import { sendPushover } from "../logic/alerts/pushover.js";

// same path used in buildStrategySnapshot.js
const SNAPSHOT_FILE = "/opt/render/project/src/services/core/data/strategy-snapshot.json";

// simple ledger file (dedupe)
const LEDGER_FILE = "/opt/render/project/src/services/core/data/engine15-alert-ledger.json";

function nowUtc() {
  return new Date().toISOString();
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonSafe(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch {}
}

function makeKey(decision) {
  const dir = decision?.direction || "NA";
  const type = decision?.strategyType || "NA";
  const time = decision?.signalEvent?.signalTime || "NA";
  return `SPY|${type}|${dir}|${time}`;
}

export async function runEngine15AlertCheck() {
  const snapshot = readJsonSafe(SNAPSHOT_FILE);
  if (!snapshot) {
    return { ok: false, reason: "NO_SNAPSHOT" };
  }

  const decision =
    snapshot?.strategies?.["intraday_scalp@10m"]?.engine15Decision;

  if (!decision) {
    return { ok: false, reason: "NO_ENGINE15" };
  }

  // ✅ ONLY FIRE ON REAL ENTRY
  if (
    decision.readinessLabel !== "CONFIRMED" ||
    decision.action !== "ENTER_OK"
  ) {
    return { ok: true, skipped: "NOT_CONFIRMED" };
  }

  const ledger = readJsonSafe(LEDGER_FILE) || {};
  const key = makeKey(decision);

  if (ledger.lastKey === key) {
    return { ok: true, skipped: "DUPLICATE" };
  }

  // extract fields
  const type = decision.strategyType || "UNKNOWN";
  const direction = decision.direction || "UNKNOWN";

  const signalTime = decision?.signalEvent?.signalTime || "NA";
  const signalPrice = decision?.signalEvent?.signalPrice || "NA";

  // temporary contract mapping
  const action = direction === "LONG" ? "BUY CALL" : "BUY PUT";

  const message = `
🚨 TRADE SIGNAL

Type: ${type}
Direction: ${direction}
Time: ${signalTime}
Price: ${signalPrice}

Action: ${action}
Strike: ATM
Expiry: 0DTE
Contracts: 3
`.trim();

  const result = await sendPushover({
    title: "SPY TRADE SIGNAL",
    message,
    url: "https://frye-dashboard.onrender.com/",
  });

  if (result.ok) {
    writeJsonSafe(LEDGER_FILE, {
      lastKey: key,
      lastSentAt: nowUtc(),
    });
  }

  return {
    ok: true,
    sent: result.ok,
    key,
  };
}
