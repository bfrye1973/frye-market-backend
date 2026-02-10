// services/core/jobs/writeReplaySnapshot.js
import path from "path";
import { fileURLToPath } from "url";

import { azDateTimeParts } from "../logic/replay/timeAz.js";
import { buildReplaySnapshot } from "../logic/replay/snapshotBuilder.js";
import { writeReplaySnapshot } from "../logic/replay/writeSnapshot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust if your data folder is elsewhere
const DATA_DIR = path.resolve(__dirname, "..", "data");

const symbol = process.env.REPLAY_SYMBOL || "SPY";

// Core API base (for smz-hierarchy + fib endpoints)
const CORE_BASE = process.env.CORE_BASE_URL || `http://localhost:${process.env.PORT}`;
const SMZ_HIER_URL =
  process.env.REPLAY_SMZ_HIER_URL ||
  `${CORE_BASE}/api/v1/smz-hierarchy`;


const FIB_URL =
  process.env.REPLAY_FIB_URL ||
  `${CORE_BASE}/api/v1/fib-levels?symbol=${symbol}&tf=1h&degree=minor&wave=W1`;

// Optional decision sources (safe if missing)
const DECISION_URL = process.env.REPLAY_DECISION_URL || null;
const PERMISSION_URL = process.env.REPLAY_PERMISSION_URL || null;

async function main() {
  const { dateYmd, timeHHMM } = azDateTimeParts(new Date());

  const snapshot = await buildReplaySnapshot({
    dataDir: DATA_DIR,
    symbol,
    smzHierarchyUrl: SMZ_HIER_URL,
    fibUrl: FIB_URL,
    decisionUrl: DECISION_URL,
    permissionUrl: PERMISSION_URL,
  });

  const result = writeReplaySnapshot({ dataDir: DATA_DIR, dateYmd, timeHHMM, snapshot });

  console.log(JSON.stringify({ ok: true, dateYmd, timeHHMM, ...result }, null, 2));
}

main().catch((e) => {
  console.error("writeReplaySnapshot failed:", e);
  process.exit(1);
});
