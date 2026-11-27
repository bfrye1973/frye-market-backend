import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { planPreservation, executePreservation, daysBetween } from "../scripts/preserveIssue412Evidence.js";

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e412-hold-"));
  const paths = { replayRoot: path.join(root, "replay/es"), engine8PaperDir: path.join(root, "replay/engine8-paper"), journalDir: path.join(root, "replay/journal"), holdRoot: path.join(root, "replay/evidence-hold") };
  for (const d of ["2026-11-24", "2026-11-25", "2026-11-27"]) {
    fs.mkdirSync(path.join(paths.replayRoot, d), { recursive: true });
    fs.writeFileSync(path.join(paths.replayRoot, d, "1016.json"), JSON.stringify({ d, t: "1016" }));
    fs.writeFileSync(path.join(paths.replayRoot, d, "1019.json"), JSON.stringify({ d, t: "1019" }));
  }
  fs.mkdirSync(paths.engine8PaperDir, { recursive: true });
  fs.mkdirSync(paths.journalDir, { recursive: true });
  fs.writeFileSync(path.join(paths.engine8PaperDir, "paper-orders.json"), "[]");
  fs.writeFileSync(path.join(paths.journalDir, "trade-journal.json"), "[]");
  return { root, paths };
}
const snapshotState = (dir) => fs.readdirSync(dir, { recursive: true }).sort().map((f) => [f, fs.statSync(path.join(dir, f)).isFile() ? fs.readFileSync(path.join(dir, f), "utf8") : "dir"]);

test("plan lists Replay snapshots and store copies; missing days are reported, not invented", () => {
  const { root, paths } = tree();
  try {
    const p = planPreservation({ from: "2026-11-24", to: "2026-11-27", label: "issue412-nov24-27", paths });
    assert.deepEqual(p.days, ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
    assert.equal(p.items.filter((i) => i.kind === "REPLAY_SNAPSHOT").length, 6);
    assert.ok(p.missing.some((m) => m.day === "2026-11-26" && m.reason === "NOT_FOUND"));
    assert.ok(p.missing.some((m) => m.name === "paper-executions.json"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("execute copies with matching hashes, private modes, never touches sources, and re-runs safely", () => {
  const { root, paths } = tree();
  try {
    const before = snapshotState(path.join(root, "replay/es"));
    const plan = planPreservation({ from: "2026-11-24", to: "2026-11-27", label: "issue412-nov24-27", paths });
    const r1 = executePreservation(plan);
    assert.equal(r1.copied, 8);
    const dest = plan.dest;
    assert.equal(fs.statSync(dest).mode & 0o777, 0o700);
    const copy = path.join(dest, "replay/2026-11-24/1016.json");
    assert.equal(fs.statSync(copy).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(copy, "utf8"), fs.readFileSync(path.join(paths.replayRoot, "2026-11-24/1016.json"), "utf8"));
    assert.deepEqual(snapshotState(path.join(root, "replay/es")), before, "sources must be unchanged");
    const manifest = JSON.parse(fs.readFileSync(r1.manifestFile, "utf8"));
    assert.equal(manifest.files.length, 8);
    assert.ok(manifest.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256)));
    // Re-run: nothing re-copied, nothing overwritten.
    const r2 = executePreservation(planPreservation({ from: "2026-11-24", to: "2026-11-27", label: "issue412-nov24-27", paths }), { now: () => "2026-11-28T01:00:00.000Z" });
    assert.equal(r2.copied, 0);
    assert.equal(r2.alreadyPreserved, 8);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a changed immutable snapshot is a conflict (stop); a changed mutable store is kept alongside, never overwritten", () => {
  const { root, paths } = tree();
  try {
    const plan = () => planPreservation({ from: "2026-11-24", to: "2026-11-24", label: "issue412-test", paths });
    executePreservation(plan());
    fs.writeFileSync(path.join(paths.engine8PaperDir, "paper-orders.json"), '[{"changed":true}]');
    const r = executePreservation(plan(), { now: () => "2026-11-28T02:00:00.000Z" });
    const held = fs.readdirSync(path.join(plan().dest, "engine8-paper"));
    assert.equal(held.length, 2, "original copy kept plus a new dated copy");
    assert.equal(fs.readFileSync(path.join(plan().dest, "engine8-paper/paper-orders.json"), "utf8"), "[]");
    assert.ok(r.files >= 1);
    fs.writeFileSync(path.join(plan().dest, "replay/2026-11-24/1016.json"), "tampered");
    assert.throws(() => executePreservation(plan()), /HOLD_CONFLICT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("guards: bad label, bad range, too long, symlinked day folder", () => {
  const { root, paths } = tree();
  try {
    assert.throws(() => planPreservation({ from: "2026-11-24", to: "2026-11-27", label: "../x", paths }), /INVALID_LABEL/);
    assert.throws(() => daysBetween("2026-11-27", "2026-11-24"), /INVALID_RANGE/);
    assert.throws(() => daysBetween("2026-01-01", "2026-03-01"), /RANGE_TOO_LONG/);
    fs.symlinkSync(path.join(paths.replayRoot, "2026-11-24"), path.join(paths.replayRoot, "2026-11-23"));
    const p = planPreservation({ from: "2026-11-23", to: "2026-11-23", label: "issue412-sym", paths });
    assert.equal(p.items.filter((i) => i.kind === "REPLAY_SNAPSHOT").length, 0);
    assert.equal(p.missing[0].reason, "NOT_A_REAL_DIRECTORY");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("CLI defaults to a dry run that writes nothing", () => {
  const { root, paths } = tree();
  try {
    const r = spawnSync(process.execPath, [path.resolve("services/core/scripts/preserveIssue412Evidence.js"), "--from", "2026-11-24", "--to", "2026-11-27", "--label", "issue412-nov24-27"], {
      env: { ...process.env, TRADE_INVESTIGATOR_REPLAY_ROOT: paths.replayRoot, ENGINE8_PAPER_DATA_DIR: paths.engine8PaperDir, TRADE_JOURNAL_DIR: paths.journalDir, ISSUE412_EVIDENCE_HOLD_ROOT: paths.holdRoot }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.dryRun, true);
    assert.equal(out.files, 8);
    assert.equal(fs.existsSync(paths.holdRoot), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
