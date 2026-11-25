// services/core/logic/alerts/squeezeLedger.js
// Dedicated Engine 13 ledger for Engine 29 Squeeze v2 phone alerts.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..", "..");
const PERSISTENT_DIR = "/var/data/replay";

export const SQUEEZE_LEDGER_PATH =
  process.env.ENGINE13_SQUEEZE_LEDGER_FILE ||
  (fs.existsSync(PERSISTENT_DIR)
    ? path.join(PERSISTENT_DIR, "engine13-squeeze-alert-ledger.json")
    : path.join(CORE_DIR, "data", "engine13-squeeze-alert-ledger.json"));

export function readSqueezeLedgerSafe(filePath = SQUEEZE_LEDGER_PATH) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        lastSentAtUtc: null,
        lastWatchKey: null,
        lastActiveKey: null,
      };
    }

    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      lastSentAtUtc: json?.lastSentAtUtc ?? null,
      lastWatchKey: json?.lastWatchKey ?? null,
      lastActiveKey: json?.lastActiveKey ?? null,
    };
  } catch {
    return {
      lastSentAtUtc: null,
      lastWatchKey: null,
      lastActiveKey: null,
    };
  }
}

export function writeSqueezeLedgerSafe(
  next,
  filePath = SQUEEZE_LEDGER_PATH
) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath =
      filePath + ".tmp-" + process.pid + "-" + Date.now();

    fs.writeFileSync(
      tempPath,
      JSON.stringify(next, null, 2) + "\n",
      "utf8"
    );

    fs.renameSync(tempPath, filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

export default {
  SQUEEZE_LEDGER_PATH,
  readSqueezeLedgerSafe,
  writeSqueezeLedgerSafe,
};
