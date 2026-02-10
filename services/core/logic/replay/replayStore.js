// services/core/logic/replay/replayStore.js
import fs from "fs";
import path from "path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function replayRoot(dataDir) {
  return path.join(dataDir, "replay");
}

export function dayDir(dataDir, dateYmd) {
  return path.join(replayRoot(dataDir), dateYmd);
}

export function snapshotPath(dataDir, dateYmd, timeHHMM) {
  return path.join(dayDir(dataDir, dateYmd), `${timeHHMM}.json`);
}

export function eventsPath(dataDir, dateYmd) {
  return path.join(dayDir(dataDir, dateYmd), `events.json`);
}

export function listDates(dataDir) {
  const root = replayRoot(dataDir);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
}

export function listTimes(dataDir, dateYmd) {
  const dir = dayDir(dataDir, dateYmd);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => f.name)
    .filter((n) => /^\d{4}\.json$/.test(n)) // HHMM.json
    .map((n) => n.replace(".json", ""))
    .sort();
}

export function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function writeJsonAtomic(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}
