#!/usr/bin/env node
// Engine 8D READ-ONLY migration inventory. Never copies, rewrites or deletes files.
// Outputs counts/checksums, never journal P&L or trading identities.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const source = process.env.NODE_ENV === "test" && process.env.ENGINE8_PAPER_TEST_LEGACY_DIR
  ? path.resolve(process.env.ENGINE8_PAPER_TEST_LEGACY_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data");
const target = path.resolve(process.env.ENGINE8_PAPER_DATA_DIR || "/var/data/replay/engine8-paper");
const names = [
  "paper-orders.json",
  "paper-executions.json",
  "paper-idempotency-ledger.json",
  "engine8-paper-execution-state.json",
  "engine8-paper-acceptance-state.json",
];

let failed = false;
for (const name of names) {
  const old = path.join(source, name);
  const durable = path.join(target, name);
  const marker = path.join(target, ".migrated-" + name + ".json");
  const report = { file: name, legacyExists: fs.existsSync(old),
    durableExists: fs.existsSync(durable), markerExists: fs.existsSync(marker) };
  for (const [label, file] of [["legacy",old],["durable",durable]]) {
    if (!fs.existsSync(file)) continue;
    try {
      const bytes=fs.readFileSync(file);
      const parsed=JSON.parse(bytes.toString("utf8"));
      report[label+"Sha256"] = crypto.createHash("sha256").update(bytes).digest("hex");
      report[label+"RecordCount"] = Array.isArray(parsed) ? parsed.length :
        parsed?.executions && typeof parsed.executions === "object" ?
          Object.keys(parsed.executions).length :
        parsed && typeof parsed === "object" ? Object.keys(parsed).length : 0;
    } catch {
      report[label+"Error"] = "UNREADABLE_OR_CORRUPT";
      failed = true;
    }
  }
  if (report.legacyExists && report.durableExists && !report.markerExists &&
      path.resolve(old) !== path.resolve(durable)) {
    report.conflict="HISTORICAL_AND_DURABLE_WITHOUT_MIGRATION_MANIFEST";
    failed=true;
  }
  if (report.markerExists) {
    try {
      const manifest=JSON.parse(fs.readFileSync(marker,"utf8"));
      if (!report.durableExists || (report.legacyExists &&
        (manifest.source !== old || manifest.checksum !== report.legacySha256))) {
        report.conflict="MIGRATION_MANIFEST_MISMATCH";
        failed=true;
      }
    } catch {
      report.conflict="INVALID_MIGRATION_MANIFEST";
      failed=true;
    }
  }
  process.stdout.write(JSON.stringify(report)+"\n");
}
process.exitCode=failed ? 1 : 0;
