#!/usr/bin/env node
// Phase A exploratory harness runner (Node 18+). Research only.
//   BASE=https://frye-market-backend-1.onrender.com node scripts/research/phaseA/runPhaseA.mjs \
//     --snapshots scripts/research/phaseA/data/snapshot_ids.json \
//     --bars /path/to/bars_5m.csv            (optional; otherwise fetched live from /api/v1/futures/ohlc — note 7-day window)
//     --out /tmp/phaseA_result.json
// Bars CSV format: time,open,high,low,close,volume (ascending; time = bar start, epoch seconds).
// Bars are NOT committed to the repo (licensing hold); compare your copy against data/bars_manifest.json sha256.
import fs from "node:fs";
import crypto from "node:crypto";
import { pullReplayRows, scorePhaseA } from "./phaseAHarness.core.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const BASE = process.env.BASE || "https://frye-market-backend-1.onrender.com";
const fetchJson = async (p) => { const r = await fetch(BASE + p, { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error(`${r.status} ${p}`); return r.json(); };

const ids = JSON.parse(fs.readFileSync(args.snapshots, "utf8"));
const timesByDay = ids.timesByDay;
const rows = await pullReplayRows(fetchJson, Object.keys(timesByDay), { timesByDay, onProgress: (m) => process.stderr.write(`\r${m}   `) });

let barsTxt;
if (args.bars) barsTxt = fs.readFileSync(args.bars, "utf8").trim();
else {
  const raw = await fetchJson("/api/v1/futures/ohlc?symbol=ES&timeframe=5m&limit=5000");
  const arr = (Array.isArray(raw) ? raw : raw.bars || []).map((b) => [b.time, +b.open, +b.high, +b.low, +b.close, +b.volume]).sort((a, b) => a[0] - b[0]);
  const cutoff = ids.barsCutoffEpoch ?? Infinity;
  barsTxt = arr.filter((b) => b[0] <= cutoff).map((b) => b.join(",")).join("\n");
}
const sha256 = crypto.createHash("sha256").update(barsTxt).digest("hex");
const bars = barsTxt.split("\n").map((l) => { const [t, o, h, lo, c, v] = l.split(",").map(Number); return { t, o, h, l: lo, c, v }; });
const result = scorePhaseA(rows, bars);
result.inputs = { base: BASE, snapshotIdsFile: args.snapshots, barsSha256: sha256, barsSource: args.bars ? "file" : "live-route", generatedAt: new Date().toISOString() };
fs.writeFileSync(args.out || "phaseA_result.json", JSON.stringify(result, null, 2));
process.stderr.write(`\nbars sha256 ${sha256}\n`);
console.log(JSON.stringify(result.summary, null, 2));
