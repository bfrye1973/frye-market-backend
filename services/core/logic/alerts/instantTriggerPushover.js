// services/core/logic/alerts/instantTriggerPushover.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");
const LEDGER_FILE = path.resolve(DATA_DIR, "trigger-alert-ledger.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function envFirst(...names) {
  for (const name of names) {
    const v = String(process.env[name] ?? "").trim();
    if (v) return v;
  }
  return "";
}

function toPriceString(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "N/A";
}

function buildBody({
  symbol,
  signalFamily,
  direction,
  triggerTime,
  triggerPrice,
  mode,
  actionText,
}) {
  return [
    `🔥 ${signalFamily} ${direction} — ${symbol}`,
    `Price: ${toPriceString(triggerPrice)}`,
    `Time: ${triggerTime}`,
    `Action: ${actionText}`,
    `Mode: ${mode}`,
  ].join("\n");
}

async function sendPushoverMessage({ title, message, log = console.log }) {
  const token = envFirst(
    "PUSHOVER_TOKEN",
    "PUSHOVER_APP_TOKEN",
    "ENGINE13_PUSHOVER_TOKEN"
  );
  const user = envFirst(
    "PUSHOVER_USER",
    "PUSHOVER_USER_KEY",
    "ENGINE13_PUSHOVER_USER",
    "ENGINE13_PUSHOVER_USER_KEY"
  );
  const device = envFirst("PUSHOVER_DEVICE", "ENGINE13_PUSHOVER_DEVICE");

  if (!token || !user) {
    log("[engine13-trigger] missing pushover env, skipping phone alert");
    return {
      ok: false,
      skipped: true,
      reason: "MISSING_PUSHOVER_ENV",
    };
  }

  const body = new URLSearchParams({
    token,
    user,
    title,
    message,
  });

  if (device) body.set("device", device);

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body,
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    return {
      ok: false,
      rejected: true,
      reason: "PUSHOVER_HTTP_ERROR",
      status: res.status,
      response: json,
    };
  }

  if (json?.status !== 1) {
    return {
      ok: false,
      rejected: true,
      reason: "PUSHOVER_API_ERROR",
      response: json,
    };
  }

  return {
    ok: true,
    provider: "pushover",
    response: json,
  };
}

export async function maybeSendInstantTriggerAlert({
  symbol,
  signalFamily,
  direction,
  triggerTime,
  triggerPrice,
  mode,
  dedupeKey,
  actionText,
  log = console.log,
}) {
  const safeSymbol = String(symbol || "").trim().toUpperCase();
  const safeFamily = String(signalFamily || "").trim().toUpperCase();
  const safeDirection = String(direction || "").trim().toUpperCase();
  const safeTime = String(triggerTime || "").trim();
  const safeMode = String(mode || "").trim().toUpperCase();
  const safeAction = String(actionText || "").trim();

  if (
    !safeSymbol ||
    !safeFamily ||
    !safeDirection ||
    !safeTime ||
    !safeMode ||
    !dedupeKey
  ) {
    return {
      ok: false,
      rejected: true,
      reason: "MISSING_ALERT_FIELDS",
    };
  }

  const ledger = readJson(LEDGER_FILE, {});
  if (ledger[dedupeKey]) {
    return {
      ok: true,
      duplicate: true,
      dedupeKey,
      result: ledger[dedupeKey],
    };
  }

  const title = `${safeFamily} ${safeDirection} — ${safeSymbol}`;
  const message = buildBody({
    symbol: safeSymbol,
    signalFamily: safeFamily,
    direction: safeDirection,
    triggerTime: safeTime,
    triggerPrice,
    mode: safeMode,
    actionText: safeAction,
  });

  const sendResult = await sendPushoverMessage({
    title,
    message,
    log,
  });

  if (!sendResult?.ok) {
    log("[engine13-trigger] alert failed", sendResult);
    return sendResult;
  }

  const result = {
    ok: true,
    dedupeKey,
    sentAt: nowIso(),
    symbol: safeSymbol,
    signalFamily: safeFamily,
    direction: safeDirection,
    triggerTime: safeTime,
    triggerPrice: Number.isFinite(Number(triggerPrice))
      ? Number(triggerPrice)
      : null,
    mode: safeMode,
    actionText: safeAction,
  };

  ledger[dedupeKey] = result;
  writeJson(LEDGER_FILE, ledger);

  return result;
}
