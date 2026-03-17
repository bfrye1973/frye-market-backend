// services/core/jobs/runEngine1AndShelves.js
// Runs:
// 1) Build manual structures JSON from txt (easy input)
// 2) Update SMZ Levels (Engine 1 job)
// 3) Update Shelves (Engine 2 shelves job)
//
// Usage:
// node jobs/runEngine1AndShelves.js

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function run(label, relPath) {
  const scriptPath = path.resolve(__dirname, relPath);

  console.log(`\n[RUN] ${label}`);
  const r = spawnSync("node", [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (r.status !== 0) {
    throw new Error(`${label} failed with exit code ${r.status}`);
  }
}

async function main() {
  try {
    run("Build Manual Structures from TXT", "./buildManualStructuresFromTxt.js");
    run("Update SMZ Levels (Engine 1)", "./updateSmzLevels.js");
    run("Update Shelves", "./updateSmzShelves.js");

    console.log("\n✅ [RUN] Engine 1 + Shelves complete.");
  } catch (err) {
    console.error("\n❌ [RUN] FAILED:", err?.message || err);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
