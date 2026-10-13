// src/services/core/jobs/updateSmzAll.js
// Master runner — institutional first, then shelves.
// Purpose: one-button refresh while keeping modules separate.

import updateSmzLevels from "./updateSmzLevels.js";
import updateSmzShelves from "./updateSmzShelves.js";

async function main() {
  console.log("[SMZ-ALL] Running Institutional job first…");
  await updateSmzLevels();

  console.log("[SMZ-ALL] Running Shelves job second…");
  await updateSmzShelves();

  console.log("[SMZ-ALL] Complete.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("[SMZ-ALL] FAILED:", e);
    process.exitCode = 1;
  });
}

export default main;
