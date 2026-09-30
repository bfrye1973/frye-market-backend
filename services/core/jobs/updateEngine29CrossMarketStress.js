// services/core/jobs/updateEngine29CrossMarketStress.js
// Engine 29 — canonical persisted cross-market stress output
// Owns persistence only. Core Engine 29 logic remains under logic/engine29/.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildEngine29CrossMarketStress,
  buildEngine29TrapCampaign,
  readEngine29TrapCampaign,
  writeEngine29TrapCampaign,
} from "../logic/engine29/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine29-cross-market-stress.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readPriorMoveParent() {
  if (!fs.existsSync(OUTPUT_FILE)) return null;

  try {
    const prior = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
    return prior?.moveCharacter?.directionalMoveParent || null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function compactLog(output) {
  return {
    timestamp: output?.timestamp ?? null,
    overallState: output?.overallState ?? null,
    tacticalState: output?.tacticalState ?? null,
    fastTacticalState: output?.fastTacticalState ?? null,
    esResolvedSymbol: output?.dataQuality?.esResolvedSymbol ?? null,
    moveCharacter: output?.moveCharacter?.moveCharacter ?? null,
    underlyingPressure:
      output?.moveCharacter?.underlyingPressure?.state ??
      output?.display?.underTheHood?.pressure?.state ??
      null,
    dataDegraded: Boolean(output?.dataDegraded),
    missingConfirmations: output?.missingConfirmations || [],
    liquidityState:
      output?.marketCharacter?.liquidity?.state ??
      output?.trapDetection?.liquidity?.state ??
      "NO_LIQUIDITY_EVENT",
    moveLane:
      output?.marketCharacter?.move?.moveCharacter ??
      output?.moveCharacter?.moveCharacter ??
      "NO_ACTIVE_MOVE",
    trapSide:
      output?.marketCharacter?.trap?.side ??
      output?.trapDetection?.trapSide ??
      "NONE",
    trapState:
      output?.marketCharacter?.trap?.state ??
      output?.trapDetection?.state ??
      "NO_ACTIVE_TRAP",
    trapCampaignActive:
      output?.trapCampaign?.active === true,
    trapCampaignId:
      output?.trapCampaign?.active === true
        ? output?.trapCampaign?.campaign?.campaignId ?? null
        : null,
    trapCampaignSide:
      output?.trapCampaign?.active === true
        ? output?.trapCampaign?.campaign?.side ?? null
        : null,
    trapCampaignState:
      output?.trapCampaign?.active === true
        ? output?.trapCampaign?.campaign?.state ?? null
        : null,
    competingTrapSide:
      output?.trapCampaign?.active === true
        ? output?.trapCampaign?.campaign?.competingDetection?.trapSide ?? null
        : null,
    competingTrapState:
      output?.trapCampaign?.active === true
        ? output?.trapCampaign?.campaign?.competingDetection?.state ?? null
        : null,
  };
}

export async function updateEngine29CrossMarketStress({ now = Date.now() } = {}) {
  ensureDataDir();

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  console.log(`[engine29] BUILD START @ ${startedAt}`);

  const priorMoveParent = readPriorMoveParent();

  const output = await buildEngine29CrossMarketStress({
    now,
    priorMoveParent,
  });

  const priorTrapCampaign =
    readEngine29TrapCampaign();

  const trapCampaign =
    buildEngine29TrapCampaign({
      priorCampaign: priorTrapCampaign,
      trapDetection: output?.trapDetection || null,
      now,
    });

  output.trapCampaign = trapCampaign;

  if (output?.trapDetection) {
    // Canonical live pointer exposes only an active campaign.
    // Historical/inactive campaign memory remains preserved under
    // output.trapCampaign for audit and replay.
    output.trapDetection.campaign =
      trapCampaign?.active === true
        ? trapCampaign?.campaign || null
        : null;
  }

  if (!output || typeof output !== "object") {
    throw new Error("Engine 29 build returned no canonical output");
  }

  if (!output.version || !output.timestamp || !output.overallState) {
    throw new Error(
      `Engine 29 output missing required canonical fields: ${JSON.stringify({
        version: output.version ?? null,
        timestamp: output.timestamp ?? null,
        overallState: output.overallState ?? null,
      })}`
    );
  }

  writeJsonAtomic(OUTPUT_FILE, output);
  writeEngine29TrapCampaign(trapCampaign);

  const stat = fs.statSync(OUTPUT_FILE);
  const finishedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startedMs;

  const result = {
    ok: true,
    engine: "engine29.crossMarketStress.update.v1",
    startedAt,
    finishedAt,
    elapsedMs,
    outputFile: OUTPUT_FILE,
    sizeBytes: stat.size,
    summary: compactLog(output),
    data: output,
  };

  console.log(
    `[engine29] BUILD SUCCESS @ ${finishedAt} elapsedMs=${elapsedMs} ` +
      `overall=${result.summary.overallState} ` +
      `1h=${result.summary.tacticalState} ` +
      `30m=${result.summary.fastTacticalState} ` +
      `move=${result.summary.moveCharacter} ` +
      `liquidity=${result.summary.liquidityState} ` +
      `trap=${result.summary.trapSide}/${result.summary.trapState} ` +
      `campaign=${result.summary.trapCampaignSide || "NONE"}/${result.summary.trapCampaignState || "NONE"}`
  );

  return result;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  updateEngine29CrossMarketStress()
    .then((result) => {
      console.log(JSON.stringify({
        ok: result.ok,
        engine: result.engine,
        outputFile: result.outputFile,
        sizeBytes: result.sizeBytes,
        elapsedMs: result.elapsedMs,
        summary: result.summary,
      }, null, 2));
    })
    .catch((error) => {
      console.error("[engine29] BUILD FAIL");
      console.error(error?.stack || error?.message || String(error));
      process.exit(1);
    });
}
