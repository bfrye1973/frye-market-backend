// services/core/jobs/runEngine1AndShelves.js
// Runs:
// 1) Build SPY manual structures JSON from txt
// 2) Update SPY SMZ Levels
// 3) Update SPY Shelves
// 4) Build ES manual structures JSON from txt
// 5) Update ES Shelves
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
    // SPY Engine 1
    run("Build SPY Manual Structures from TXT", "./buildManualStructuresFromTxt.js");
    run("Update SPY SMZ Levels (Engine 1)", "./updateSmzLevels.js");
    run("Update SPY Shelves", "./updateSmzShelves.js");

    // ES Engine 1B
    run("Build ES Manual Structures from TXT", "./buildEsManualStructuresFromTxt.js");
    run("Update ES SMZ Shelves (Engine 1B)", "./updateEsSmzShelves.js");
    

    console.log("\n✅ [RUN] Engine 1 + Engine 1B Shelves complete.");
  } catch (err) {
    console.error("\n❌ [RUN] FAILED:", err?.message || err);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
