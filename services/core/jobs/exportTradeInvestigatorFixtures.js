// services/core/jobs/exportTradeInvestigatorFixtures.js
//
// Engine 12 Trade Investigator: controlled, READ-ONLY fixture export.
//
// For each selected Replay snapshot:
//   1. resolve the source; refuse symlinks and anything outside the Replay root
//   2. BEFORE: read original bytes, sha256, size, mtime, inode
//   3. optional: compare BEFORE sha256 with an independently recorded host hash
//   4. project only the investigator-read paths for one lane, redact
//   5. write the sanitized fixture (exclusive create, never overwrite)
//   6. AFTER: re-read the source, sha256, size, mtime, inode
//   7. BEFORE must equal AFTER exactly; otherwise the fixture just written is
//      removed and the result is FAILED_SOURCE_CHANGED_DURING_EXPORT
// A manifest (exclusive create) records every before/after proof.
//
// Output must resolve (realpath, symlinks followed) OUTSIDE /var/data/replay
// and outside the Replay root. Sources are never written, renamed or touched.
// Running against production requires separate owner approval.
//
// Env:
//   TRADE_INVESTIGATOR_FIXTURE_EXPORT_CONFIRM=READ_ONLY_EXPORT_APPROVED   (required)
//   TRADE_INVESTIGATOR_FIXTURE_DATE=2026-11-24
//   TRADE_INVESTIGATOR_FIXTURE_TIMES=0746,0752,1016,1025
//   TRADE_INVESTIGATOR_FIXTURE_OUT=/tmp/e12-fixtures-20261124
//   TRADE_INVESTIGATOR_FIXTURE_STRATEGY=intraday_scalp@10m                (optional)
//   TRADE_INVESTIGATOR_REPLAY_ROOT=/var/data/replay/es                    (optional)
//   TRADE_INVESTIGATOR_FIXTURE_EXPECTED_SHA256=0746=<hex>,0752=<hex>,...  (optional;
//       hashes recorded independently on the production host)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readEvidenceBytes } from "../logic/investigator/readEvidenceFile.js";
import { redactInvestigationPayload } from "../logic/investigator/redactInvestigationPayload.js";
import { ENGINE28A_PATH, getPath } from "../logic/investigator/authorityRegistry.js";

export const EXPORT_VERSION = "engine12.tradeInvestigator.fixtureExport.v2";
export const PROTECTED_ROOT = "/var/data/replay";

// Every lane path the investigator reads (canonical + shadow parents + 28A).
const LANE_PATHS = [
  "strategyId",
  "snapshotTime",
  "engine26LocationCandidate",
  "confluence.context.reaction.paperScalpReaction",
  "confluence.context.volume.engine4AuthorizedReactionParticipation",
  "confluence.context.volume.engine4V2Shadow",
  "permission.paper",
  "engine26ProposedGeometry",
  "engine7PositionSizing",
  "engine9OfficialManagementPlan",
  "engine8PaperOrder",
  "engine10Journal",
  "engine10JournalAttachment",
  "engine10Lifecycle",
  ENGINE28A_PATH,
];
const ROOT_FIELDS = ["schema", "replayContract", "immutable", "symbol", "snapshotTime", "dateYmd", "timeHHMM", "timezone", "generatedAtUtc", "currentPrice"];

function setPath(target, dotted, value) {
  const keys = dotted.split(".");
  let cursor = target;
  for (const k of keys.slice(0, -1)) cursor = cursor[k] ||= {};
  cursor[keys.at(-1)] = value;
}

/** Pure projection: only investigator-read paths for one lane. */
export function projectReplayForFixture(replay, strategyId) {
  const out = {};
  for (const f of ROOT_FIELDS) if (replay?.[f] !== undefined) out[f] = replay[f];
  const laneSrc = replay?.strategies?.[strategyId];
  if (!laneSrc) return { ...out, strategies: {} };
  const lane = {};
  for (const p of LANE_PATHS) {
    const v = getPath(laneSrc, p);
    if (v !== undefined) setPath(lane, p, v);
  }
  const reaction = getPath(laneSrc, "confluence.context.reaction") || {};
  for (const key of Object.keys(reaction)) {
    if (/^engine3V6/i.test(key)) setPath(lane, "confluence.context.reaction." + key, reaction[key]);
  }
  return { ...out, strategies: { [strategyId]: lane } };
}

export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** realpath of the deepest existing ancestor + the not-yet-existing remainder. */
export function resolveIntendedPath(p) {
  let current = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...rest);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.join(current, ...rest);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

function realOrSelf(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function assertOutputAllowed(outDir, replayRoot) {
  const protectedRoots = [path.resolve(PROTECTED_ROOT), realOrSelf(PROTECTED_ROOT), path.resolve(replayRoot), realOrSelf(replayRoot)];
  const candidates = [path.resolve(outDir), resolveIntendedPath(outDir)];
  for (const c of candidates) {
    for (const root of protectedRoots) {
      if (isInside(c, root)) throw new Error("OUTPUT_DIR_INSIDE_PROTECTED_STORAGE_REFUSED");
    }
  }
}

function sourceProof(file) {
  let st;
  try { st = fs.lstatSync(file); } catch { st = null; }
  const raw = readEvidenceBytes(file);
  if (raw.status !== "OK") return { ok: false, reason: raw.reason, raw };
  return {
    ok: true,
    raw,
    proof: {
      sha256: raw.sha256,
      byteLength: raw.byteLength,
      mtimeMs: st ? st.mtimeMs : null,
      ino: st ? String(st.ino) : null,
      readAt: raw.readAt,
    },
  };
}

function sameProof(a, b) {
  return a.sha256 === b.sha256 && a.byteLength === b.byteLength && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

export function parseExpectedHashes(text) {
  const out = {};
  for (const part of String(text || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{4})=([0-9a-f]{64})$/i.exec(part);
    if (!m) throw new Error("BAD_EXPECTED_SHA256_ENTRY");
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
}

/**
 * @param {object} p
 * @param {object} [p.expectedSha256] { HHMM: hex } recorded independently on the host
 * @param {object} [p.testHooks] { afterFixtureWrite(time, sourcePath) } tests only
 */
export function exportFixtures({
  replayRoot, date, times, strategyId, outDir, expectedSha256 = {},
  now = () => new Date().toISOString(), testHooks = {},
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("BAD_DATE");
  assertOutputAllowed(outDir, replayRoot);
  fs.mkdirSync(outDir, { recursive: true });
  // Re-check after creation: the created path must still resolve outside.
  assertOutputAllowed(fs.realpathSync(outDir), replayRoot);
  const realRoot = fs.realpathSync(replayRoot);

  const results = [];
  for (const time of times) {
    if (!/^\d{4}$/.test(time)) { results.push({ time, ok: false, status: "BAD_TIME" }); continue; }
    const source = path.join(replayRoot, date, time + ".json");
    const sourceRelativePath = date + "/" + time + ".json";

    let lst;
    try { lst = fs.lstatSync(source); } catch { results.push({ time, ok: false, status: "SOURCE_NOT_FOUND", sourceRelativePath }); continue; }
    if (lst.isSymbolicLink() || !lst.isFile()) { results.push({ time, ok: false, status: "SOURCE_PATH_POLICY_REFUSED", sourceRelativePath }); continue; }
    if (!isInside(fs.realpathSync(source), realRoot)) { results.push({ time, ok: false, status: "SOURCE_OUTSIDE_REPLAY_ROOT", sourceRelativePath }); continue; }

    const before = sourceProof(source);
    if (!before.ok) { results.push({ time, ok: false, status: "SOURCE_UNREADABLE", reason: before.reason, sourceRelativePath }); continue; }

    const expected = expectedSha256[time] ?? null;
    if (expected && expected !== before.proof.sha256) {
      results.push({
        time, ok: false, status: "SOURCE_HASH_DIFFERS_FROM_HOST_RECORD", sourceRelativePath,
        before: before.proof, expectedHostSha256: expected,
      });
      continue;
    }

    let replay;
    try { replay = JSON.parse(before.raw.bytes.toString("utf8")); } catch {
      results.push({ time, ok: false, status: "SOURCE_JSON_INVALID", sourceRelativePath, before: before.proof });
      continue;
    }

    const fixture = {
      fixtureSchema: "engine12.tradeInvestigator.sanitizedFixture.v1",
      exportVersion: EXPORT_VERSION,
      sourceRelativePath,
      sourceSha256: before.proof.sha256,
      sourceBytes: before.proof.byteLength,
      sourceSha256Scope: "ORIGINAL_REPLAY_FILE_BYTES_BEFORE_PROJECTION",
      expectedHostSha256: expected,
      projection: "INVESTIGATOR_READ_PATHS_ONLY_ONE_LANE",
      strategyId,
      extractedAt: now(),
      replay: redactInvestigationPayload(projectReplayForFixture(replay, strategyId)),
    };
    const target = path.join(outDir, date + "_" + time + ".fixture.json");
    fs.writeFileSync(target, JSON.stringify(fixture, null, 2), { flag: "wx", mode: 0o600 });

    if (typeof testHooks.afterFixtureWrite === "function") testHooks.afterFixtureWrite(time, source);

    const after = sourceProof(source);
    const unchanged = after.ok && sameProof(before.proof, after.proof);
    if (!unchanged) {
      fs.unlinkSync(target); // remove only our own just-written output
      results.push({
        time, ok: false, status: "FAILED_SOURCE_CHANGED_DURING_EXPORT", sourceRelativePath,
        before: before.proof, after: after.ok ? after.proof : { error: after.reason },
      });
      continue;
    }
    results.push({
      time, ok: true, status: "EXPORTED", sourceRelativePath,
      before: before.proof, after: after.proof, sourceUnchanged: true,
      expectedHostSha256: expected, hostHashMatch: expected ? true : null,
      fixture: path.basename(target),
    });
  }

  const manifest = {
    manifestSchema: "engine12.tradeInvestigator.fixtureExportManifest.v1",
    exportVersion: EXPORT_VERSION,
    date, strategyId, createdAt: now(),
    allSucceeded: results.every((r) => r.ok),
    results,
  };
  fs.writeFileSync(path.join(outDir, date + "_export-manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 });
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = process.env;
  if (env.TRADE_INVESTIGATOR_FIXTURE_EXPORT_CONFIRM !== "READ_ONLY_EXPORT_APPROVED") {
    console.error(JSON.stringify({ ok: false, error: "EXPORT_NOT_CONFIRMED" }));
    process.exit(1);
  }
  const date = String(env.TRADE_INVESTIGATOR_FIXTURE_DATE || "");
  const times = String(env.TRADE_INVESTIGATOR_FIXTURE_TIMES || "").split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = env.TRADE_INVESTIGATOR_FIXTURE_OUT;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !times.length || !times.every((t) => /^\d{4}$/.test(t)) || !outDir) {
    console.error(JSON.stringify({ ok: false, error: "BAD_EXPORT_PARAMETERS" }));
    process.exit(1);
  }
  const results = exportFixtures({
    replayRoot: env.TRADE_INVESTIGATOR_REPLAY_ROOT || "/var/data/replay/es",
    date, times, outDir,
    strategyId: env.TRADE_INVESTIGATOR_FIXTURE_STRATEGY || "intraday_scalp@10m",
    expectedSha256: parseExpectedHashes(env.TRADE_INVESTIGATOR_FIXTURE_EXPECTED_SHA256),
  });
  console.log(JSON.stringify({ ok: results.every((r) => r.ok), exportVersion: EXPORT_VERSION, date, results }, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 2);
}
