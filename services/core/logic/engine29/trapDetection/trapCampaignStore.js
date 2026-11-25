// services/core/logic/engine29/trapDetection/trapCampaignStore.js
// Engine 29 — file persistence for trap campaign memory.
// Persistence only; no detection logic.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ENGINE29_TRAP_CAMPAIGN_FILE =
  path.resolve(
    __dirname,
    "../../../data/engine29-trap-campaign.json"
  );

export function readEngine29TrapCampaign(
  filePath = ENGINE29_TRAP_CAMPAIGN_FILE
) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const payload = JSON.parse(
      fs.readFileSync(filePath, "utf8")
    );

    const campaign = payload?.campaign || null;

    if (!campaign) return null;

    const legacyStates = new Set([
      "LIQUIDITY_TEST",
      "LIQUIDITY_SWEEP",
      "FAILED_ACCEPTANCE",
    ]);

    if (
      legacyStates.has(String(campaign?.state || "")) ||
      legacyStates.has(String(campaign?.highestState || ""))
    ) {
      return null;
    }

    return campaign;
  } catch {
    return null;
  }
}

export function writeEngine29TrapCampaign(
  payload,
  filePath = ENGINE29_TRAP_CAMPAIGN_FILE
) {
  fs.mkdirSync(path.dirname(filePath), {
    recursive: true,
  });

  const tempPath =
    filePath + ".tmp-" + process.pid + "-" + Date.now();

  fs.writeFileSync(
    tempPath,
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );

  fs.renameSync(tempPath, filePath);
  return filePath;
}

export default {
  ENGINE29_TRAP_CAMPAIGN_FILE,
  readEngine29TrapCampaign,
  writeEngine29TrapCampaign,
};
