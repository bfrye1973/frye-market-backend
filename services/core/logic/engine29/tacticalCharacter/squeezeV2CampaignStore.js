// services/core/logic/engine29/tacticalCharacter/squeezeV2CampaignStore.js
// Persistence-only store for Engine 29 Squeeze v2 campaign memory.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ENGINE29_SQUEEZE_V2_CAMPAIGN_FILE =
  process.env.ENGINE29_SQUEEZE_V2_CAMPAIGN_FILE ||
  path.resolve(
    __dirname,
    "../../../data/engine29-squeeze-v2-campaign.json"
  );

export function readEngine29SqueezeV2Campaign(
  filePath = ENGINE29_SQUEEZE_V2_CAMPAIGN_FILE
) {
  if (!fs.existsSync(filePath)) return null;

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return payload?.campaign || null;
  } catch {
    return null;
  }
}

export function writeEngine29SqueezeV2Campaign(
  payload,
  filePath = ENGINE29_SQUEEZE_V2_CAMPAIGN_FILE
) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

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
  ENGINE29_SQUEEZE_V2_CAMPAIGN_FILE,
  readEngine29SqueezeV2Campaign,
  writeEngine29SqueezeV2Campaign,
};
