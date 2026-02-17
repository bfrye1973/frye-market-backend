// engine14_manual.js
// Manual Engine 14 Scalp Evaluation (read-only)

import fs from "fs";
import path from "path";

const DATE = process.argv[2]; // pass date as argument

if (!DATE) {
  console.log("Usage: node engine14_manual.js YYYY-MM-DD");
  process.exit(1);
}

const ROOT = "/var/data/replay";
const dayDir = path.join(ROOT, DATE);

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function findNearestCadenceTime(goHHMM, times) {
  const eligible = times.filter(t => t <= goHHMM);
  if (!eligible.length) return null;
  return eligible.sort().slice(-1)[0];
}

const eventsFile = path.join(dayDir, "events.json");
const events = readJson(eventsFile) || [];

const goEvents = events.filter(e => e.type === "GO_SIGNAL");

if (!goEvents.length) {
  console.log("No GO events found for", DATE);
  process.exit(0);
}

const cadenceTimes = fs.readdirSync(dayDir)
  .filter(f => f.endsWith(".json") && !f.includes("_GO"))
  .map(f => f.replace(".json", ""));

let report = {
  totalGO: goEvents.length,
  scoreBuckets: { low: 0, mid: 0, high: 0 },
  permissionCounts: {},
  reactionStages: {},
  volumeBuckets: {},
};

for (const go of goEvents) {
  const goSnap = readJson(path.join(dayDir, go.snapshotFile));
  if (!goSnap) continue;

  const score = go.engineScores?.engine5_total ?? 0;

  if (score < 40) report.scoreBuckets.low++;
  else if (score < 70) report.scoreBuckets.mid++;
  else report.scoreBuckets.high++;

  const goHHMM = go.timeHHMM;
  const nearest = findNearestCadenceTime(goHHMM, cadenceTimes);
  let permission = null;

  if (nearest) {
    const cadenceSnap = readJson(path.join(dayDir, nearest + ".json"));
    permission = cadenceSnap?.decision?.permission?.state ?? "UNKNOWN";
  }

  report.permissionCounts[permission] =
    (report.permissionCounts[permission] || 0) + 1;

  const stage = goSnap?.decision?.context?.reaction?.stage ?? "UNKNOWN";
  report.reactionStages[stage] =
    (report.reactionStages[stage] || 0) + 1;

  const volScore = goSnap?.decision?.context?.volume?.volumeScore ?? 0;
  const volBucket = volScore < 5 ? "low" : volScore < 8 ? "mid" : "high";
  report.volumeBuckets[volBucket] =
    (report.volumeBuckets[volBucket] || 0) + 1;
}

console.log("\n===== ENGINE 14 REPORT =====");
console.log("Date:", DATE);
console.log("Total GO:", report.totalGO);
console.log("Score Buckets:", report.scoreBuckets);
console.log("Permission States:", report.permissionCounts);
console.log("Reaction Stages:", report.reactionStages);
console.log("Volume Buckets:", report.volumeBuckets);
console.log("================================\n");
