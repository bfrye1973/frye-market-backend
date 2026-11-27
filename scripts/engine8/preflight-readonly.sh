#!/usr/bin/env bash
# Engine 8 READ-ONLY production preflight (#425). Run in the Render Shell of frye-market-backend-1.
# Prints set/unset, counts and true/false only. Writes nothing, never prints values, ids or secrets.
cd /opt/render/project/src/services/core 2>/dev/null; node --input-type=module -e '
// Engine 8 read-only preflight. Reads only. Prints set/unset, counts and true/false. Never prints values, ids or secrets.
import fs from "node:fs"; import path from "node:path";
const names = ["ENGINE8_PAPER_ONLY","ENGINE8_KILL_SWITCH","ENGINE8_PAPER_OPERATOR_DISABLED","ENGINE8_CANONICAL_EXECUTOR_ENABLED","ENGINE8_AUTO_PAPER_EXECUTION_ENABLED","ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED","ENGINE8_LIVE_TRADING_ENABLED","ENGINE8_ALLOW_LIVE_FUTURES","ENGINE8_ALLOW_EXITS_ON_STANDDOWN","ENGINE8_ALLOWLIST","ENGINE8_PAPER_DATA_DIR","ENGINE8_ADMIN_SECRET","REPLAY_MODE","ENGINE12_REPLAY_MODE"];
const one = (n) => process.env[n] === "1" || String(process.env[n]).toLowerCase() === "true";
console.log("== settings (set/unset; for on/off flags also whether it equals 1/true)");
for (const n of names) { const s = process.env[n] !== undefined && process.env[n] !== "";
  const extra = ["ENGINE8_ALLOWLIST","ENGINE8_PAPER_DATA_DIR","ENGINE8_ADMIN_SECRET"].includes(n) ? "" : (s ? " isOn=" + one(n) : "");
  console.log(n + ": " + (s ? "SET" : "unset") + extra); }
console.log("ENGINE8_ALLOWLIST includes ES: " + String(process.env.ENGINE8_ALLOWLIST || "SPY,QQQ,ES").split(",").map(x=>x.trim().toUpperCase()).includes("ES"));
const dir = path.resolve(process.env.ENGINE8_PAPER_DATA_DIR || "/var/data/replay/engine8-paper");
console.log("== store at default path: " + (dir === "/var/data/replay/engine8-paper") + ", exists: " + fs.existsSync(dir));
const count = (v) => Array.isArray(v) ? v.length : (v && typeof v === "object") ? Object.keys(v).length : -1;
for (const f of ["paper-orders.json","paper-executions.json","paper-idempotency-ledger.json","engine8-paper-execution-state.json","engine8-paper-acceptance-state.json"]) {
  const p = path.join(dir, f); if (!fs.existsSync(p)) { console.log(f + ": MISSING"); continue; }
  try { const v = JSON.parse(fs.readFileSync(p, "utf8")); let line = f + ": present, parses OK, entries=" + count(v);
    if (f === "engine8-paper-acceptance-state.json") line += ", acceptanceTradeCompleted=" + v?.acceptanceTradeCompleted + ", newPaperOrdersAllowed=" + v?.newPaperOrdersAllowed;
    if (f === "paper-idempotency-ledger.json") { const e = Array.isArray(v) ? v : Object.values(v?.entries || v || {}); const st = {}; for (const x of e) { const k = String(x?.status || x?.state || "unknown"); st[k] = (st[k]||0)+1; } line += ", byStatus=" + JSON.stringify(st); }
    console.log(line);
  } catch { console.log(f + ": present, DOES NOT PARSE (corrupt)"); } }
const ld = path.join(dir, ".instruction-locks");
const locks = fs.existsSync(ld) ? fs.readdirSync(ld).filter(n => n.endsWith(".lock")) : [];
console.log("== instruction locks: " + locks.length);
for (const l of locks) { try { const id = JSON.parse(fs.readFileSync(path.join(ld, l, "identity.json"), "utf8")); console.log("  lock age hours=" + ((Date.now() - Date.parse(id.startedAt)) / 36e5).toFixed(1)); } catch { console.log("  lock with unreadable identity"); } }
console.log("== done (read-only; nothing changed)");
'
