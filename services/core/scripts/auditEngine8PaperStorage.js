#!/usr/bin/env node
// Engine 8D: READ-ONLY inventory of the NEW PAPER store only.
// No legacy storage reads, migrations, writes, broker calls or restart.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const target = path.resolve(process.env.ENGINE8_PAPER_DATA_DIR || "/var/data/replay/engine8-paper");
const names = [
  "paper-orders.json",
  "paper-executions.json",
  "paper-idempotency-ledger.json",
  "engine8-paper-execution-state.json",
  "engine8-paper-acceptance-state.json",
];
const report = {target, exists:fs.existsSync(target), files:[], unexpectedEntries:[], readyForFreshUse:false};
let unsafe = false;
if (report.exists) {
  let entries;
  try { entries = fs.readdirSync(target); }
  catch { entries=null; unsafe=true; }
  if (entries) {
    report.unexpectedEntries = entries.filter(name=>!names.includes(name));
    if (report.unexpectedEntries.length) unsafe=true;
  }
}
for (const name of names) {
  const full = path.join(target,name);
  const status = {file:name,exists:fs.existsSync(full)};
  if (status.exists) {
    unsafe=true; // This preflight is for NEW empty PAPER accounts only.
    try {
      const bytes=fs.readFileSync(full);
      const parsed=JSON.parse(bytes.toString("utf8"));
      status.sha256=crypto.createHash("sha256").update(bytes).digest("hex");
      status.recordCount=Array.isArray(parsed) ? parsed.length :
        parsed?.executions && typeof parsed.executions==="object"
          ? Object.keys(parsed.executions).length :
        parsed && typeof parsed==="object" ? Object.keys(parsed).length : 0;
    } catch { status.error="UNREADABLE_OR_CORRUPT"; }
  }
  report.files.push(status);
}
report.readyForFreshUse=!unsafe;
process.stdout.write(JSON.stringify(report,null,2)+"\n");
if (unsafe) process.exitCode=2; // STOP: Manager review, never clear records.
