// Engine 13 — durable Micro position-conflict alert ledger.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..", "..");
const PERSISTENT_DIR = "/var/data/replay";

export const MICRO_POSITION_LEDGER_PATH =
  process.env.ENGINE13_MICRO_POSITION_LEDGER_FILE ||
  (
    fs.existsSync(PERSISTENT_DIR)
      ? path.join(
          PERSISTENT_DIR,
          "engine13-micro-position-alert-ledger.json"
        )
      : path.join(
          CORE_DIR,
          "data",
          "engine13-micro-position-alert-ledger.json"
        )
  );

function emptyLedger() {
  return {
    version:
      "engine13.microPositionAlertLedger.v1",
    entries: {},
    updatedAt: null,
  };
}

export function readMicroPositionLedgerSafe(
  filePath = MICRO_POSITION_LEDGER_PATH
) {
  try {
    if (!fs.existsSync(filePath)) {
      return emptyLedger();
    }

    const parsed =
      JSON.parse(
        fs.readFileSync(
          filePath,
          "utf8"
        )
      );

    return {
      version:
        "engine13.microPositionAlertLedger.v1",
      entries:
        parsed?.entries &&
        typeof parsed.entries === "object"
          ? parsed.entries
          : {},
      updatedAt:
        parsed?.updatedAt ?? null,
    };
  } catch {
    return emptyLedger();
  }
}

export function writeMicroPositionLedgerSafe(
  ledger,
  filePath = MICRO_POSITION_LEDGER_PATH
) {
  try {
    fs.mkdirSync(
      path.dirname(filePath),
      { recursive: true }
    );

    const next = {
      version:
        "engine13.microPositionAlertLedger.v1",
      entries:
        ledger?.entries &&
        typeof ledger.entries === "object"
          ? ledger.entries
          : {},
      updatedAt:
        new Date().toISOString(),
    };

    const temp =
      `${filePath}.tmp-${process.pid}-${Date.now()}`;

    fs.writeFileSync(
      temp,
      JSON.stringify(
        next,
        null,
        2
      ) + "\n",
      "utf8"
    );

    fs.renameSync(
      temp,
      filePath
    );

    return {
      ok: true,
      ledger: next,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        String(
          error?.message || error
        ),
    };
  }
}

export default {
  MICRO_POSITION_LEDGER_PATH,
  readMicroPositionLedgerSafe,
  writeMicroPositionLedgerSafe,
};
