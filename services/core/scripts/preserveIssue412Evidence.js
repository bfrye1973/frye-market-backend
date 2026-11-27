// services/core/scripts/preserveIssue412Evidence.js
//
// #412: copy original evidence for chosen Arizona days into a private hold
// folder before the 14-day Replay retention window removes it.
//
// - Read-only on every source. Never deletes, moves or edits anything.
// - Copies Engine 12 Replay day folders (immutable snapshots) and point-in-time
//   copies of the mutable Engine 8 PAPER and Engine 10 Journal stores.
// - Writes a SHA-256 manifest. Files 0600, folders 0700.
// - Never overwrites: a file already in the hold must match byte-for-byte, or
//   the run stops. Re-running is safe.
// - Dry run unless --execute is passed. Refuses if free space is under 2x the
//   bytes to copy.
//
// The hold folder sits outside <replay>/es, so the Replay retention job never
// touches it. No trading authority; no configuration change.
//
// Usage (owner-authorized one-off on the production service):
//   node services/core/scripts/preserveIssue412Evidence.js --from 2026-11-24 --to 2026-11-27 --label issue412-nov24-27          # dry run
//   node services/core/scripts/preserveIssue412Evidence.js --from 2026-11-24 --to 2026-11-27 --label issue412-nov24-27 --execute

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LABEL = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ENGINE8_FILES = ["paper-orders.json", "paper-executions.json", "engine8-paper-execution-state.json", "paper-idempotency-ledger.json", "engine8-paper-acceptance-state.json"];
const JOURNAL_FILES = ["trade-journal.json"];
const MAX_DAYS = 31;

export function defaultPaths(env = process.env) {
  const data = String(env.REPLAY_DATA_DIR || env.DATA_DIR || "/var/data").replace(/\/+$/, "");
  return {
    replayRoot: env.TRADE_INVESTIGATOR_REPLAY_ROOT || path.join(data, "replay", "es"),
    engine8PaperDir: env.ENGINE8_PAPER_DATA_DIR || path.join(data, "replay", "engine8-paper"),
    journalDir: env.TRADE_JOURNAL_DIR || path.join(data, "replay", "journal"),
    holdRoot: env.ISSUE412_EVIDENCE_HOLD_ROOT || path.join(data, "replay", "evidence-hold"),
  };
}

export function daysBetween(from, to) {
  if (!DAY.test(from) || !DAY.test(to)) throw Error("INVALID_DAY");
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  if (!(a <= b)) throw Error("INVALID_RANGE");
  const out = [];
  for (let t = a; t <= b; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  if (out.length > MAX_DAYS) throw Error("RANGE_TOO_LONG");
  return out;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function regularFile(file) {
  try { const st = fs.lstatSync(file); return st.isFile() && !st.isSymbolicLink() ? st : null; } catch { return null; }
}

// Plan what to copy. Pure read of sources.
export function planPreservation({ from, to, label, paths }) {
  if (!LABEL.test(String(label || ""))) throw Error("INVALID_LABEL");
  const days = daysBetween(from, to);
  const items = [], missing = [];
  for (const day of days) {
    const dir = path.join(paths.replayRoot, day);
    let st = null;
    try { st = fs.lstatSync(dir); } catch { /* missing */ }
    if (!st) { missing.push({ kind: "REPLAY_DAY", day, reason: "NOT_FOUND" }); continue; }
    if (st.isSymbolicLink() || !st.isDirectory()) { missing.push({ kind: "REPLAY_DAY", day, reason: "NOT_A_REAL_DIRECTORY" }); continue; }
    for (const name of fs.readdirSync(dir).filter((n) => /^\d{4}\.json$/.test(n)).sort()) {
      const src = path.join(dir, name), s = regularFile(src);
      if (!s) { missing.push({ kind: "REPLAY_SNAPSHOT", day, name, reason: "NOT_A_REGULAR_FILE" }); continue; }
      items.push({ kind: "REPLAY_SNAPSHOT", day, src, rel: path.join("replay", day, name), bytes: s.size, mutable: false });
    }
  }
  for (const [kind, dir, files] of [["ENGINE8_PAPER_STORE", paths.engine8PaperDir, ENGINE8_FILES], ["ENGINE10_JOURNAL", paths.journalDir, JOURNAL_FILES]]) {
    for (const name of files) {
      const src = path.join(dir, name), s = regularFile(src);
      if (!s) { missing.push({ kind, name, reason: "NOT_FOUND" }); continue; }
      items.push({ kind, src, rel: path.join(kind === "ENGINE10_JOURNAL" ? "engine10-journal" : "engine8-paper", name), bytes: s.size, mutable: true });
    }
  }
  return { label, from, to, days, items, missing, totalBytes: items.reduce((n, i) => n + i.bytes, 0), dest: path.join(paths.holdRoot, label) };
}

function freeBytes(dir) {
  try { const s = fs.statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw Error("UNSAFE_HOLD_DIR:" + dir);
  fs.chmodSync(dir, 0o700);
}

// Copy with verification. Never overwrites a different file.
export function executePreservation(plan, { now = () => new Date().toISOString() } = {}) {
  ensurePrivateDir(plan.dest);
  const free = freeBytes(plan.dest);
  if (free !== null && free < plan.totalBytes * 2) throw Error("INSUFFICIENT_FREE_SPACE");
  const files = [];
  for (const item of plan.items) {
    const dest = path.join(plan.dest, item.rel);
    ensurePrivateDir(path.dirname(dest));
    const srcHash = sha256File(item.src);
    if (fs.existsSync(dest)) {
      const existing = regularFile(dest);
      if (!existing || sha256File(dest) !== srcHash) {
        if (item.mutable) {
          // A mutable store changed since an earlier run: keep both, never overwrite.
          const alt = dest + "." + now().replace(/[:.]/g, "-") + ".json";
          fs.copyFileSync(item.src, alt, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(alt, 0o600);
          files.push({ ...entry(item, path.relative(plan.dest, alt), srcHash, now), note: "STORE_CHANGED_SINCE_EARLIER_COPY" });
          continue;
        }
        throw Error("HOLD_CONFLICT:" + item.rel);
      }
      files.push({ ...entry(item, item.rel, srcHash, now), note: "ALREADY_PRESERVED" });
      continue;
    }
    fs.copyFileSync(item.src, dest, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(dest, 0o600);
    if (sha256File(dest) !== srcHash) throw Error("COPY_VERIFY_FAILED:" + item.rel);
    files.push(entry(item, item.rel, srcHash, now));
  }
  const manifest = {
    schemaVersion: "issue412.evidenceHold.v1", label: plan.label, from: plan.from, to: plan.to, createdAt: now(),
    note: "Replay snapshots are immutable originals. Engine 8 and Engine 10 files are point-in-time copies of mutable stores taken at copiedAt; they are not proof of what the stores held earlier.",
    files, missing: plan.missing,
  };
  const body = JSON.stringify(manifest, null, 2);
  const name = "manifest-" + manifest.createdAt.replace(/[:.]/g, "-") + ".json";
  fs.writeFileSync(path.join(plan.dest, name), body, { mode: 0o600, flag: "wx" });
  return { manifestFile: path.join(plan.dest, name), manifestSha256: crypto.createHash("sha256").update(body).digest("hex"), copied: files.filter((f) => !f.note).length, alreadyPreserved: files.filter((f) => f.note === "ALREADY_PRESERVED").length, files: files.length, missing: plan.missing.length };
}

function entry(item, rel, sha256, now) {
  return { kind: item.kind, day: item.day ?? null, rel, sha256, bytes: item.bytes, mutable: item.mutable, copiedAt: now() };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const plan = planPreservation({ from: arg("--from"), to: arg("--to"), label: arg("--label"), paths: defaultPaths() });
    const summary = { label: plan.label, days: plan.days, dest: plan.dest, files: plan.items.length, totalBytes: plan.totalBytes, missing: plan.missing };
    if (!process.argv.includes("--execute")) {
      console.log(JSON.stringify({ ok: true, dryRun: true, ...summary }, null, 2));
    } else {
      console.log(JSON.stringify({ ok: true, dryRun: false, ...summary, result: executePreservation(plan) }, null, 2));
    }
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    process.exit(1);
  }
}
