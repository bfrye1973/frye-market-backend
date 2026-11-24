// services/core/tests/tradeInvestigatorLatency.bench.js
//
// Manual latency benchmark (not a pass/fail test):
//   node services/core/tests/tradeInvestigatorLatency.bench.js
//
// Builds a SYNTHETIC Replay snapshot sized like production (~7 MB, 5 lanes,
// bulky Engine 3 v5 evidence trees), a Journal of 2,000 trades and an Engine 8
// store of 5,000 orders, then times full investigations (Replay read + sha256 +
// parse + extraction + 28A + Engine 8 join + Journal join + redaction).

import fs from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";

import { buildInvestigation } from "../logic/investigator/buildInvestigation.js";
import { redactInvestigationPayload } from "../logic/investigator/redactInvestigationPayload.js";
import {
  S1, LIFE_DATE, lifecycleReplay, paperOrder, journalTrade, makeScenario, query,
} from "./fixtures/tradeInvestigator/syntheticScenarios.js";

const TARGET_BYTES = Number(process.env.BENCH_REPLAY_BYTES || 7 * 1024 * 1024);
const RUNS = Number(process.env.BENCH_RUNS || 30);

function bulk(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: 1763650000000 + i * 60000, state: "OBSERVING", control: i % 3 ? "BUYERS" : "SELLERS", score: (i * 37) % 100, reasons: ["R" + (i % 17), "Z" + (i % 5)] });
  }
  return out;
}

function buildReplay() {
  const r = lifecycleReplay();
  const base = r.strategies[S1];
  const lanes = ["subminute_scalp@10m", "intraday_scalp@10m", "minor_swing@1h", "intermediate_long@4h", "primary_position@1d"];
  let rows = 1000;
  for (;;) {
    for (const id of lanes) {
      const l = JSON.parse(JSON.stringify(base));
      l.strategyId = id;
      l.confluence.context.reaction.engine3V5 = { evidence: { oneMinute: bulk(rows), fiveMinute: bulk(rows / 2), tenMinute: bulk(rows / 4) } };
      r.strategies[id] = l;
    }
    const size = Buffer.byteLength(JSON.stringify(r, null, 2));
    if (size >= TARGET_BYTES) return r;
    rows = Math.ceil(rows * (TARGET_BYTES / size) * 1.02);
  }
}

const replay = buildReplay();
const orders = [];
for (let i = 0; i < 5000; i++) orders.push(paperOrder({ orderId: "E8O-" + i, planId: "E9P-OLD-" + i, cand: "E26C-OLD-" + i, filledAt: "2026-11-1" + (i % 9) + "T15:00:00.000Z" }));
orders.push(paperOrder({ orderId: "E8O-A" }));
const journal = [];
for (let i = 0; i < 2000; i++) journal.push(journalTrade({ tradeId: "T-" + i, orderId: "E8O-" + i, planId: "E9P-OLD-" + i, cand: "E26C-OLD-" + i, status: "CLOSED", remainingQty: 0, realizedPnL: i % 50 }));
journal.push(journalTrade({ tradeId: "T-A", orderId: "E8O-A" }));

const sc = makeScenario({ replays: { [LIFE_DATE + "/1000"]: replay }, orders, executions: [], journal });
const replayBytes = fs.statSync(sc.config.replayRoot + "/" + LIFE_DATE + "/1000.json").size;
const ordersBytes = fs.statSync(sc.config.engine8PaperDir + "/paper-orders.json").size;
const journalBytes = fs.statSync(sc.config.journalDir + "/trade-journal.json").size;

const q = query({ date: LIFE_DATE, time: "1000" });
const times = [];
let last;
for (let i = 0; i < RUNS + 3; i++) {
  const t0 = performance.now();
  const r = buildInvestigation({ query: q, config: sc.config });
  const body = redactInvestigationPayload(r.body);
  const bytes = Buffer.byteLength(JSON.stringify(body));
  const dt = performance.now() - t0;
  if (i >= 3) times.push(dt); // discard warm-up
  last = { status: r.httpStatus, bytes, journal: body.journal.status, execution: body.execution.status };
}
times.sort((a, b) => a - b);
const pct = (p) => Math.round(times[Math.min(times.length - 1, Math.floor(p * times.length))] * 10) / 10;

console.log(JSON.stringify({
  benchmark: "engine12.tradeInvestigator.latency.v1",
  node: process.version,
  cpu: os.cpus()[0]?.model ?? null,
  runs: RUNS,
  inputs: { replayBytes, lanes: Object.keys(replay.strategies).length, ordersBytes, orderCount: orders.length, journalBytes, tradeCount: journal.length },
  ms: { p50: pct(0.5), p95: pct(0.95), max: Math.round(times.at(-1) * 10) / 10, min: Math.round(times[0] * 10) / 10 },
  lastResult: last,
  targetMs: 2000,
  withinTarget: pct(0.95) < 2000,
  note: "Synthetic inputs on the build container; production disk and CPU will differ.",
}, null, 2));
fs.rmSync(sc.base, { recursive: true, force: true });
