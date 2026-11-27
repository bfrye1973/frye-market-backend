#!/usr/bin/env bash
# Engine 8 READ-ONLY production preflight (#425), revision 2 (ChatGPT review 7227554734).
# Run in the Render Shell of frye-market-backend-1. Writes nothing. Prints only set/unset, allowlisted
# status names, counts and true/false/INVALID. Never prints setting values, ids, field values or secrets.
set -euo pipefail
node --input-type=module -e '
import fs from "node:fs"; import path from "node:path";
const out = (s) => console.log(s);
const MAX_BYTES = 50 * 1024 * 1024;
out("== Engine 8 read-only preflight r2");
out("time_utc: " + new Date().toISOString());
const sha = String(process.env.RENDER_GIT_COMMIT || "");
out("deployed_sha: " + (/^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : "UNKNOWN"));
out("LIMITATION: this reads the Shell environment and disk. The running web process environment may differ (e.g. a setting changed without a restart).");

// ---- settings: every flag is compared as exact string "1" in the code (engine8Paper cfg, canonical bridge, executor)
out("== settings (SET/unset; effective = code predicate === \"1\")");
const exact1 = ["ENGINE8_PAPER_ONLY","ENGINE8_KILL_SWITCH","ENGINE8_PAPER_OPERATOR_DISABLED","ENGINE8_CANONICAL_EXECUTOR_ENABLED","ENGINE8_AUTO_PAPER_EXECUTION_ENABLED","ENGINE8_CONTINUOUS_PAPER_EXECUTION_AUTHORIZED","ENGINE8_ALLOW_EXITS_ON_STANDDOWN","ENGINE8_LIVE_TRADING_ENABLED","ENGINE8_ALLOW_LIVE_FUTURES","ENGINE8_REAL_FILL_DELIVERY_ENABLED","REPLAY_MODE","ENGINE12_REPLAY_MODE"];
for (const n of exact1) { const v = process.env[n];
  out(n + ": " + (v === undefined ? "unset" : "SET") + ", effective=" + (v === "1")); }
const sec = process.env.ENGINE8_ADMIN_SECRET;
out("ENGINE8_ADMIN_SECRET: " + (sec === undefined ? "unset" : sec.trim() === "" ? "SET_BUT_EMPTY_OR_WHITESPACE" : "SET"));
const al = process.env.ENGINE8_ALLOWLIST;
const hasES = (s) => String(s).split(",").map(x => x.trim().toUpperCase()).includes("ES");
out("ENGINE8_ALLOWLIST: " + (al === undefined ? "unset" : "SET") +
  ", ES effective in engine8Paper (default SPY,QQQ,ES)=" + hasES(al ?? "SPY,QQQ,ES") +
  ", ES effective in Engine 26 planner (default SPY,QQQ)=" + hasES(al ?? "SPY,QQQ"));
out("ENGINE8_PAPER_DATA_DIR: " + (process.env.ENGINE8_PAPER_DATA_DIR === undefined ? "unset (default path)" : "SET"));
out("TRADE_JOURNAL_DIR: " + (process.env.TRADE_JOURNAL_DIR === undefined ? "unset (default path)" : "SET"));

// ---- safe bounded reads
const ERR = (e) => ["ENOENT","EACCES","EPERM","ELOOP","ENOTDIR","EISDIR"].includes(e?.code) ? e.code : "OTHER_ERROR";
const seen = {};
function safeRead(p) {
  let st; try { st = fs.lstatSync(p); } catch (e) { return { state: ERR(e) === "ENOENT" ? "MISSING" : "INACCESSIBLE_" + ERR(e) }; }
  if (st.isSymbolicLink()) return { state: "REJECTED_SYMLINK" };
  if (!st.isFile()) return { state: "REJECTED_NOT_REGULAR_FILE" };
  if (st.size > MAX_BYTES) return { state: "REJECTED_TOO_LARGE" };
  seen[p] = st.mtimeMs + ":" + st.size;
  let txt; try { txt = fs.readFileSync(p, "utf8"); } catch (e) { return { state: "INACCESSIBLE_" + ERR(e) }; }
  try { return { state: "PRESENT_PARSES", value: JSON.parse(txt) }; } catch { return { state: "PRESENT_DOES_NOT_PARSE" }; }
}
function safeDir(p) {
  try { const st = fs.lstatSync(p); if (st.isSymbolicLink()) return "REJECTED_SYMLINK"; return st.isDirectory() ? "OK" : "REJECTED_NOT_DIRECTORY"; }
  catch (e) { return ERR(e) === "ENOENT" ? "MISSING" : "INACCESSIBLE_" + ERR(e); }
}
const bool = (v) => v === true ? "true" : v === false ? "false" : "INVALID";

// ---- PAPER store
const dir = path.resolve(process.env.ENGINE8_PAPER_DATA_DIR || "/var/data/replay/engine8-paper");
out("== PAPER store: default_path=" + (dir === "/var/data/replay/engine8-paper") + ", dir=" + safeDir(dir));
const rd = (f) => safeRead(path.join(dir, f));
const orders = rd("paper-orders.json"), execs = rd("paper-executions.json"), ledger = rd("paper-idempotency-ledger.json");
const execState = rd("engine8-paper-execution-state.json"), acc = rd("engine8-paper-acceptance-state.json");
const arr = (r, name) => { if (r.state !== "PRESENT_PARSES") { out(name + ": " + r.state); return null; }
  if (!Array.isArray(r.value)) { out(name + ": PRESENT_PARSES, SHAPE_INVALID (expected array)"); return null; }
  out(name + ": PRESENT_PARSES, entries=" + r.value.length); return r.value; };
const ordersA = arr(orders, "paper-orders.json"), execsA = arr(execs, "paper-executions.json");
out("engine8-paper-execution-state.json: " + execState.state + (execState.state === "PRESENT_PARSES" ? ", shape=" + (execState.value && typeof execState.value === "object" && !Array.isArray(execState.value) ? "object" : "INVALID") : ""));
if (acc.state === "PRESENT_PARSES") {
  const v = acc.value, ok = v && typeof v === "object" && !Array.isArray(v);
  out("engine8-paper-acceptance-state.json: PRESENT_PARSES, shape=" + (ok ? "object" : "INVALID") +
    (ok ? ", acceptanceTradeCompleted=" + bool(v.acceptanceTradeCompleted) + ", newPaperOrdersAllowed=" + bool(v.newPaperOrdersAllowed) : ""));
} else out("engine8-paper-acceptance-state.json: " + acc.state);

// ledger: object keyed by idempotency key; journalStatus in ORDER_RESERVED | JOURNAL_PENDING | JOURNAL_COMPLETE, or a rejection record
const KNOWN_J = ["ORDER_RESERVED","JOURNAL_PENDING","JOURNAL_COMPLETE"];
let ledgerEntries = null;
if (ledger.state !== "PRESENT_PARSES") out("paper-idempotency-ledger.json: " + ledger.state);
else if (!ledger.value || typeof ledger.value !== "object" || Array.isArray(ledger.value)) out("paper-idempotency-ledger.json: PRESENT_PARSES, SHAPE_INVALID (expected object)");
else {
  ledgerEntries = Object.entries(ledger.value);
  const c = { ORDER_RESERVED: 0, JOURNAL_PENDING: 0, JOURNAL_COMPLETE: 0, REJECTED: 0, UNKNOWN: 0 };
  for (const [, e] of ledgerEntries) {
    if (e && KNOWN_J.includes(e.journalStatus)) c[e.journalStatus]++;
    else if (e && e.rejected === true) c.REJECTED++;
    else c.UNKNOWN++;
  }
  out("paper-idempotency-ledger.json: PRESENT_PARSES, entries=" + ledgerEntries.length + ", journalStatus counts=" + JSON.stringify(c));
  out("  ORDER_RESERVED = reserved but no fill recorded (crash window). JOURNAL_PENDING = fill without Engine 10 ack. Both block duplicates; neither is auto-fixed.");
}

// identity consistency (counts only, no ids printed)
if (ledgerEntries && ordersA && execsA) {
  const key = (x) => (x && typeof x.idempotencyKey === "string") ? x.idempotencyKey : null;
  const oK = new Set(ordersA.map(key).filter(Boolean)), eK = new Set(execsA.map(key).filter(Boolean));
  const filled = ledgerEntries.filter(([, e]) => e && (e.journalStatus === "JOURNAL_PENDING" || e.journalStatus === "JOURNAL_COMPLETE")).map(([k]) => k);
  const lK = new Set(ledgerEntries.map(([k]) => k));
  out("== consistency: filled ledger entries missing an order=" + filled.filter(k => !oK.has(k)).length +
    ", missing an execution=" + filled.filter(k => !eK.has(k)).length +
    ", orders with no ledger entry=" + [...oK].filter(k => !lK.has(k)).length +
    ", executions with no ledger entry=" + [...eK].filter(k => !lK.has(k)).length +
    ", orders without idempotencyKey=" + ordersA.filter(x => !key(x)).length);
} else out("== consistency: UNKNOWN (a store file is missing, unreadable or invalid)");

// instruction locks (diagnostic only; never auto-clear)
const ld = path.join(dir, ".instruction-locks"), lds = safeDir(ld);
if (lds === "MISSING") out("== instruction locks: 0 (directory not created yet)");
else if (lds !== "OK") out("== instruction locks: UNKNOWN (" + lds + ")");
else { const locks = fs.readdirSync(ld).filter(n => n.endsWith(".lock"));
  out("== instruction locks: " + locks.length + (locks.length ? " (each one blocks its instruction; reconcile, never delete)" : ""));
  for (const l of locks) { const r = safeRead(path.join(ld, l, "identity.json")); const t = r.state === "PRESENT_PARSES" ? Date.parse(r.value?.startedAt) : NaN;
    out("  lock: identity=" + r.state + ", age_hours=" + (Number.isFinite(t) ? ((Date.now() - t) / 36e5).toFixed(1) : "UNKNOWN")); } }

// Engine 10 Journal (read-only counts; full ack reconciliation against the ledger is NOT done here)
const jdir = path.resolve(process.env.TRADE_JOURNAL_DIR || "/var/data/replay/journal");
const j = safeRead(path.join(jdir, "trade-journal.json"));
if (j.state !== "PRESENT_PARSES") out("== Engine 10 Journal: " + j.state);
else if (!Array.isArray(j.value)) out("== Engine 10 Journal: PRESENT_PARSES, SHAPE_INVALID (expected array)");
else { const c = { OPEN: 0, CLOSED: 0, OTHER: 0 }; for (const t of j.value) { const s = t?.status; if (s === "OPEN" || s === "CLOSED") c[s]++; else c.OTHER++; }
  out("== Engine 10 Journal: PRESENT_PARSES, trades=" + j.value.length + ", status counts=" + JSON.stringify(c) + " (all strategies, PAPER and REAL; Strategy 1 filter and ack reconciliation: UNKNOWN)"); }

// files changed during the run?
let changed = 0; for (const [p, sig] of Object.entries(seen)) { try { const st = fs.lstatSync(p); if (st.mtimeMs + ":" + st.size !== sig) changed++; } catch { changed++; } }
out("== files changed while reading: " + changed + (changed ? " (re-run; results may be inconsistent)" : ""));
out("== done (read-only; nothing changed)");
'
