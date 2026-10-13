// services/core/jobs/buildAllStrategySnapshots.js
// -----------------------------------------------------------------------------
// Builds strategy snapshots for all active dashboard symbols.
//
// SPY -> data/strategy-snapshot.json
// ES  -> data/strategy-snapshot-es.json
//
// This wrapper runs snapshots sequentially, not in parallel, to avoid load spikes.
// -----------------------------------------------------------------------------

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");

const SYMBOLS = ["SPY", "ES"];

function nowIso() {
  return new Date().toISOString();
}

function runSnapshot(symbol) {
  return new Promise((resolve, reject) => {
    const startedAt = nowIso();

    console.log("");
    console.log("============================================================");
    console.log(`[buildAllStrategySnapshots] START ${symbol} @ ${startedAt}`);
    console.log("============================================================");

    const child = spawn("node", ["jobs/buildStrategySnapshot.js"], {
      cwd: CORE_DIR,
      env: {
        ...process.env,
        SYMBOL: symbol,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      const endedAt = nowIso();

      if (stdout.trim()) {
        console.log(stdout.trim());
      }

      if (stderr.trim()) {
        console.error(stderr.trim());
      }

      if (code === 0) {
        console.log(`[buildAllStrategySnapshots] SUCCESS ${symbol} @ ${endedAt}`);
        resolve({
          symbol,
          ok: true,
          code,
          startedAt,
          endedAt,
        });
      } else {
        reject(
          new Error(
            `[buildAllStrategySnapshots] FAILED ${symbol} code=${code} startedAt=${startedAt} endedAt=${endedAt}`
          )
        );
      }
    });
  });
}

async function main() {
  const startedAt = nowIso();

  console.log("============================================================");
  console.log(`[buildAllStrategySnapshots] START ALL @ ${startedAt}`);
  console.log(`[buildAllStrategySnapshots] CORE_DIR=${CORE_DIR}`);
  console.log(`[buildAllStrategySnapshots] SYMBOLS=${SYMBOLS.join(", ")}`);
  console.log("============================================================");

  const results = [];

  for (const symbol of SYMBOLS) {
    const result = await runSnapshot(symbol);
    results.push(result);
  }

  const endedAt = nowIso();

  console.log("");
  console.log("============================================================");
  console.log(`[buildAllStrategySnapshots] COMPLETE ALL @ ${endedAt}`);
  console.log(JSON.stringify({ ok: true, startedAt, endedAt, results }, null, 2));
  console.log("============================================================");
}

main().catch((err) => {
  console.error("[buildAllStrategySnapshots] ERROR:", err?.stack || err);
  process.exit(1);
});
