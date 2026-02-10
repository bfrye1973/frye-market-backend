// services/core/jobs/replayCleanup.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listDates, replayRoot } from "../logic/replay/replayStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "..", "data");

const KEEP_DAYS = Number(process.env.REPLAY_KEEP_DAYS || 30);

function main() {
  const dates = listDates(DATA_DIR);
  if (dates.length <= KEEP_DAYS) {
    console.log(JSON.stringify({ ok: true, kept: dates.length, deleted: 0 }, null, 2));
    return;
  }

  const toDelete = dates.slice(0, Math.max(0, dates.length - KEEP_DAYS));
  const root = replayRoot(DATA_DIR);

  for (const d of toDelete) {
    const dir = path.join(root, d);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(JSON.stringify({ ok: true, kept: dates.length - toDelete.length, deleted: toDelete.length, toDelete }, null, 2));
}

main();
