// src/services/core/logic/alerts/goLedger.js
// Small JSON ledger for dedupe/rate-limit persistence

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .../src/services/core/logic/alerts -> .../src/services/core
const CORE_DIR = path.resolve(__dirname, "..", "..");
const LEDGER_PATH = path.join(CORE_DIR, "data", "pushover-go-ledger.json");

export function getLedgerPath() {
  return LEDGER_PATH;
}

export function readLedgerSafe() {
  try {
    if (!fs.existsSync(LEDGER_PATH)) {
      return {
        lastSentAtUtc: null,
        lastGoAtUtc: null,
        lastGoKey: null,
        cooldownUntilMs: 0,
      };
    }
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const json = JSON.parse(raw);
    return {
      lastSentAtUtc: json?.lastSentAtUtc ?? null,
      lastGoAtUtc: json?.lastGoAtUtc ?? null,
      lastGoKey: json?.lastGoKey ?? null,
      cooldownUntilMs: Number(json?.cooldownUntilMs ?? 0) || 0,
    };
  } catch {
    // If corrupted, fail open but don’t spam: keep “sent” time null is ok
    return {
      lastSentAtUtc: null,
      lastGoAtUtc: null,
      lastGoKey: null,
      cooldownUntilMs: 0,
    };
  }
}

export function writeLedgerSafe(next) {
  try {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(next, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
