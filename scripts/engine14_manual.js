// scripts/engine14_manual.js
// Manual Engine 14 Scalp Evaluation (read-only)
// - Reads /var/data/replay/YYYY-MM-DD/events.json
// - For each GO_SIGNAL, loads its GO snapshot file *_GO.json
// - Attaches Engine 6 permission from nearest cadence snapshot HHMM.json (<= GO timeHHMM)
// - Prints summary + detailed GO list

import fs from "fs";
import path from "path";

const DATE = process.argv[2];

if (!DATE) {
  console.log("Usage: node scripts/engine14_manual.js YYYY-MM-DD");
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

function isHHMMFilename(file) {
  // cadence snapshots: "0940.json"
  return /^\d{4}\.json$/.test(file);
}

function findNearestCadenceTime(goHHMM, times) {
  const eligible = times.filter((t) => t <= goHHMM);
  if (!eligible.length) return null;
  eligible.sort();
  return eligible[eligible.length - 1];
}

function bucketScore(total) {
  if (total == null) return "missing";
  if (total < 40) return "low";
  if (total < 70) return "mid";
  return "high";
}

function bucketVolume(v) {
  if (v == null) return "missing";
  if (v < 5) return "low";
  if (v < 8) return "mid";
  return "high";
}

// -------- Load events --------
const eventsFile = path.join(dayDir, "events.json");
const events = readJson(eventsFile) || [];

const goEvents = events.filter((e) => e && e.type === "GO_SIGNAL");

if (!goEvents.length) {
  console.log("No GO events found for", DATE);
  process.exit(0);
}

// -------- Load cadence times (HHMM only) --------
let cadenceTimes = [];
try {
  cadenceTimes = fs
    .readdirSync(dayDir)
    .filter((f) => isHHMMFilename(f))
    .map((f) => f.replace(".json", "")); // "0940"
} catch {
  cadenceTimes = [];
}

// -------- Report aggregates --------
const report = {
  totalGO: goEvents.length,
  scoreBuckets: { low: 0, mid: 0, high: 0, missing: 0 },
  permissionCounts: {},
  reactionStages: {},
  volumeBuckets: { low: 0, mid: 0, high: 0, missing: 0 },
  unreadableGoSnapshots: 0,
};

// -------- GO detail rows --------
const rows = [];

for (const go of goEvents) {
  const tsUtc = go.tsUtc || null;
  const triggerType = go.triggerType || null;
  const timeHHMM = go.timeHHMM || null;
  const snapshotFile = go.snapshotFile || null;

  const engine5Total =
    go.engineScores && typeof go.engineScores.engine5_total === "number"
      ? go.engineScores.engine5_total
      : null;

  // Load GO snapshot
  let goSnap = null;
  let goSnapPath = null;

  if (snapshotFile) {
    goSnapPath = path.join(dayDir, snapshotFile);
    goSnap = readJson(goSnapPath);
  }

  if (!goSnap) report.unreadableGoSnapshots++;

  // Reaction + volume from GO snapshot (if present)
  const stage =
    goSnap?.decision?.context?.reaction?.stage ?? "UNKNOWN";

  const volScore =
    typeof goSnap?.decision?.context?.volume?.volumeScore === "number"
      ? goSnap.decision.context.volume.volumeScore
      : null;

  // Attach Engine 6 permission from nearest cadence snapshot
  let nearestCadence = null;
  let permissionState = "UNKNOWN";

  if (timeHHMM && cadenceTimes.length) {
    nearestCadence = findNearestCadenceTime(timeHHMM, cadenceTimes);

    if (nearestCadence) {
      const cadenceSnap = readJson(path.join(dayDir, nearestCadence + ".json"));
      permissionState =
        cadenceSnap?.decision?.permission?.state ?? "UNKNOWN";
    }
  }

  // Update aggregates
  const sb = bucketScore(engine5Total);
  if (sb in report.scoreBuckets) report.scoreBuckets[sb]++;

  report.permissionCounts[permissionState] =
    (report.permissionCounts[permissionState] || 0) + 1;

  report.reactionStages[stage] =
    (report.reactionStages[stage] || 0) + 1;

  const vb = bucketVolume(volScore);
  if (vb in report.volumeBuckets) report.volumeBuckets[vb]++;

  // Detail row
  rows.push({
    tsUtc,
    triggerType,
    timeHHMM,
    snapshotFile,
    engine5_total: engine5Total,
    scoreBucket: sb,
    nearestCadence,
    permission: permissionState,
    reactionStage: stage,
    volumeScore: volScore,
    volumeBucket: vb,
    goSnapReadable: Boolean(goSnap),
  });
}

// -------- Print report --------
console.log("\n===== ENGINE 14 REPORT =====");
console.log("Date:", DATE);
console.log("Total GO:", report.totalGO);
console.log("Unreadable GO snapshots:", report.unreadableGoSnapshots);
console.log("Score Buckets:", report.scoreBuckets);
console.log("Permission States:", report.permissionCounts);
console.log("Reaction Stages:", report.reactionStages);
console.log("Volume Buckets:", report.volumeBuckets);
console.log("----- GO DETAILS -----");
console.table(rows);
console.log("================================\n");
