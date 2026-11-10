// Offline-only Engine 18 replay. No network, live endpoints, credentials, or trading calls.
// Example:
// node services/core/scripts/runEngine18HistoricalReplay.mjs --file /path/engine11-bars.json --contract ESZ26 --tf 5m --asof 1794240000
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { replayEngine18History } from "../logic/engine18/replayEngine18History.js";

const argv = process.argv.slice(2);
function arg(name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}
const filename = arg("--file");
const contractSymbol = arg("--contract");
const tf = arg("--tf");
const asOfUnixSec = Number(arg("--asof"));
const timeframeSeconds = tf === "5m" ? 300 : tf === "10m" ? 600 : 0;
if (!filename || !contractSymbol || !timeframeSeconds || !Number.isSafeInteger(asOfUnixSec)) {
  console.error("Usage: --file ENGINE11_EXPORT.json --contract ESZ26 --tf 5m|10m --asof UNIX_SECONDS");
  process.exitCode = 2;
} else {
  try {
    const raw = await readFile(resolve(filename), "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.bars) ? parsed.bars : null;
    if (!rows) throw Error("ENGINE18_EXPECTED_BARS_ARRAY");
    const output = replayEngine18History({rows, contractSymbol, timeframeSeconds, asOfUnixSec});
    // Never print complete raw candles or secrets; only reproducible research metrics.
    console.log(JSON.stringify({
      schema:output.schema, source:output.source, provenanceVerified:output.provenanceVerified,
      contractSymbol:output.contractSymbol, timeframeSeconds:output.timeframeSeconds,
      candles:output.candles, asOfUnixSec:output.asOfUnixSec, summary:output.summary,
      lastSignals:output.signals.slice(-10)
    },null,2));
  } catch (err) {
    console.error("ENGINE18_REPLAY_FAILED",err?.message||String(err));
    process.exitCode = 1;
  }
}
