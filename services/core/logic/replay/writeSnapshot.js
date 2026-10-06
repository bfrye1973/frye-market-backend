// services/core/logic/replay/writeSnapshot.js
import {
  ensureDir,
  dayDir,
  snapshotPath,
  eventsPath,
  readJson,
  writeJsonAtomic,
  listTimes,
} from "./replayStore.js";
import { diffToEvents } from "./eventDiff.js";

export function writeReplaySnapshot({ dataDir, dateYmd, timeHHMM, snapshot }) {
  const dir = dayDir(dataDir, dateYmd);
  ensureDir(dir);

  // Write snapshot
  const snapFile = snapshotPath(dataDir, dateYmd, timeHHMM);
  writeJsonAtomic(snapFile, snapshot);

  // Diff against previous time snapshot (if exists)
  const times = listTimes(dataDir, dateYmd);
  const prevTime = times
    .filter((t) => t < timeHHMM)
    .slice(-1)[0];

  const prevSnap = prevTime ? readJson(snapshotPath(dataDir, dateYmd, prevTime)) : null;

  const newEvents = diffToEvents(prevSnap, snapshot);
  if (newEvents.length) {
    const evFile = eventsPath(dataDir, dateYmd);
    const existing = readJson(evFile);
    const base = Array.isArray(existing) ? existing : [];
    writeJsonAtomic(evFile, [...base, ...newEvents]);
  }

  return { ok: true, file: snapFile, eventsAdded: newEvents.length };
}
