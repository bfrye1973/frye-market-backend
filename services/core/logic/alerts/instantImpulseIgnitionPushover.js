// services/core/logic/alerts/instantImpulseIgnitionPushover.js
// Engine 13 — Pushover helper for Engine 3 impulseIgnition alerts
//
// Safe behavior:
// - Never throws to caller
// - Sends only when impulseIgnition.active === true and score >= 80
// - Dedupes by symbol/tf/direction/state/lastCandleTime
// - Works for ES and SPY

import fs from "fs";
import path from "path";
import { sendPushover } from "./pushover.js";

const CORE_DIR = process.cwd();
const LEDGER_FILE = path.join(
  CORE_DIR,
  "data",
  "impulse-ignition-alert-ledger.json"
);

function ensureDataDir() {
  const dir = path.dirname(LEDGER_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8"));
  } catch {
    return { sent: {} };
  }
}

function writeLedger(ledger) {
  try {
    ensureDataDir();
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
  } catch {
    // never throw
  }
}

function normalizeTime(value) {
  if (!value) return "UNKNOWN_TIME";

  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString();

  return String(value);
}

function buildTitle({ symbol, direction }) {
  const dirLabel = direction === "SHORT" ? "Bearish" : "Bullish";
  return `🚀 ${symbol} ${dirLabel} Impulse Ignition`;
}

function buildMessage({ symbol, tf, price, impulseIgnition }) {
  const direction = impulseIgnition?.direction || "LONG";
  const isShort = direction === "SHORT";

  const setupLine = isShort
    ? "Possible impulse leg started to the downside."
    : "Possible impulse leg started.";

  const nextLine = isShort
    ? "Watch for Wave 2 bounce / Wave 4 hold → Wave 3/W5 short setup."
    : "Watch for Wave 2 pullback / Wave 4 hold → Wave 3/W5 long setup.";

  return [
    setupLine,
    nextLine,
    "",
    `Symbol: ${symbol}`,
    `Price: ${Number.isFinite(Number(price)) ? Number(price).toFixed(symbol === "ES" ? 2 : 2) : "n/a"}`,
    `Score: ${impulseIgnition?.score ?? "n/a"}`,
    `TF: ${tf}`,
    `Candles: ${impulseIgnition?.candlesInSequence ?? "n/a"}`,
    `Reason: ${impulseIgnition?.reason || "Impulse ignition detected."}`,
  ].join("\n");
}

export async function maybeSendImpulseIgnitionAlert({
  symbol,
  tf,
  price,
  lastCandleTime,
  impulseIgnition,
  url,
} = {}) {
  try {
    const sym = String(symbol || "UNKNOWN").toUpperCase();
    const timeframe = String(tf || "unknown");
    const direction = String(impulseIgnition?.direction || "").toUpperCase();
    const state = String(impulseIgnition?.state || "UNKNOWN_STATE");
    const score = Number(impulseIgnition?.score ?? 0);

    if (!impulseIgnition?.active) {
      return { ok: true, skipped: "inactive" };
    }

    if (!Number.isFinite(score) || score < 80) {
      return { ok: true, skipped: "score_below_80", score };
    }

    const candleTime = normalizeTime(lastCandleTime);
    const alertKey = `${sym}|${timeframe}|${direction}|${state}|${candleTime}`;

    const ledger = readLedger();
    ledger.sent = ledger.sent || {};

    if (ledger.sent[alertKey]) {
      return { ok: true, skipped: "duplicate", alertKey };
    }

    const title = buildTitle({ symbol: sym, direction });
    const message = buildMessage({
      symbol: sym,
      tf: timeframe,
      price,
      impulseIgnition,
    });

    const sent = await sendPushover({ title, message, url });

    ledger.sent[alertKey] = {
      sentAt: new Date().toISOString(),
      symbol: sym,
      tf: timeframe,
      price,
      direction,
      state,
      score,
      pushover: sent,
    };

    // keep ledger from growing forever
    const entries = Object.entries(ledger.sent);
    if (entries.length > 500) {
      ledger.sent = Object.fromEntries(entries.slice(entries.length - 500));
    }

    writeLedger(ledger);

    return {
      ok: true,
      alertKey,
      pushover: sent,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
    };
  }
}
