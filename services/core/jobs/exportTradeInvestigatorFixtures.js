// services/core/jobs/exportTradeInvestigatorFixtures.js
//
// Engine 12 Trade Investigator: controlled, READ-ONLY fixture export.
//
// Reads selected canonical Replay snapshots, hashes the ORIGINAL bytes,
// projects only the paths the investigator reads for one lane, redacts, and
// writes sanitized fixtures to an output directory OUTSIDE /var/data/replay.
//
// Running this against production requires separate owner approval.
// It never writes under the Replay root, never overwrites an output file,
// and never modifies a source file.
//
// Env:
//   TRADE_INVESTIGATOR_FIXTURE_EXPORT_CONFIRM=READ_ONLY_EXPORT_APPROVED   (required)
//   TRADE_INVESTIGATOR_FIXTURE_DATE=2026-11-24
//   TRADE_INVESTIGATOR_FIXTURE_TIMES=0746,0752,1016,1025
//   TRADE_INVESTIGATOR_FIXTURE_OUT=/tmp/e12-fixtures-20261124
//   TRADE_INVESTIGATOR_FIXTURE_STRATEGY=intraday_scalp@10m                (optional)
//   TRADE_INVESTIGATOR_REPLAY_ROOT=/var/data/replay/es                    (optional)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readEvidenceBytes } from "../logic/investigator/readEvidenceFile.js";
import { redactInvestigationPayload } from "../logic/investigator/redactInvestigationPayload.js";
import { ENGINE28A_PATH, getPath } from "../logic/investigator/authorityRegistry.js";

export const EXPORT_VERSION = "engine12.tradeInvestigator.fixtureExport.v1";
const PROTECTED_ROOT = "/var/data/replay";

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

export function exportFixtures({ replayRoot, date, times, strategyId, outDir, now = () => new Date().toISOString() }) {
  if (isInside(outDir, PROTECTED_ROOT) || isInside(outDir, replayRoot)) {
    throw new Error("OUTPUT_DIR_INSIDE_PROTECTED_STORAGE_REFUSED");
  }
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const time of times) {
    const source = path.join(replayRoot, date, time + ".json");
    const raw = readEvidenceBytes(source);
    if (raw.status !== "OK") {
      results.push({ time, ok: false, reason: raw.reason });
      continue;
    }
    const replay = JSON.parse(raw.bytes.toString("utf8"));
    const fixture = {
      fixtureSchema: "engine12.tradeInvestigator.sanitizedFixture.v1",
      exportVersion: EXPORT_VERSION,
      sourceRelativePath: date + "/" + time + ".json",
      sourceSha256: raw.sha256,
      sourceBytes: raw.byteLength,
      sourceSha256Scope: "ORIGINAL_REPLAY_FILE_BYTES_BEFORE_PROJECTION",
      projection: "INVESTIGATOR_READ_PATHS_ONLY_ONE_LANE",
      strategyId,
      extractedAt: now(),
      replay: redactInvestigationPayload(projectReplayForFixture(replay, strategyId)),
    };
    const target = path.join(outDir, date + "_" + time + ".fixture.json");
    fs.writeFileSync(target, JSON.stringify(fixture, null, 2), { flag: "wx", mode: 0o600 });
    results.push({ time, ok: true, sourceSha256: raw.sha256, sourceBytes: raw.byteLength, fixture: path.basename(target) });
  }
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
  });
  console.log(JSON.stringify({ ok: true, exportVersion: EXPORT_VERSION, date, results }, null, 2));
}
