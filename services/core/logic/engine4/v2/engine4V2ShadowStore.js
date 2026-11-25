// Isolated persistence for the Engine 4 v2 SHADOW confirmation state.
// Never shares or writes Engine 4 v1, Engine 3 or Engine 6 state.
import fs from "node:fs";
import path from "node:path";
import { ENGINE4_V2_VERSION } from "./buildEngine4V2Shadow.js";

const defaultFile = () =>
  process.env.ENGINE4_V2_SHADOW_STATE_FILE ||
  "/var/data/replay/engine4/engine4-v2-shadow-es.json";

function valid(state) {
  return state?.version === ENGINE4_V2_VERSION &&
    typeof state?.key === "string" &&
    ["UNRESOLVED", "CONFIRMED", "FADED", "ADVERSE", "NO_DIRECTION"].includes(state?.confirmationState);
}

export function loadEngine4V2ShadowState({ filePath = defaultFile() } = {}) {
  try {
    if (!fs.existsSync(filePath)) return { found: false, state: null, reasonCode: "NO_STATE" };
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return valid(parsed?.state)
      ? { found: true, state: parsed.state, reasonCode: "STATE_LOADED" }
      : { found: false, state: null, reasonCode: "STATE_INVALID" };
  } catch {
    return { found: false, state: null, reasonCode: "STATE_READ_FAILED" };
  }
}

export function saveEngine4V2ShadowState({ state, filePath = defaultFile() } = {}) {
  if (!valid(state)) return { saved: false, reasonCode: "STATE_NOT_VALID" };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ state }), "utf8");
    fs.renameSync(tmp, filePath);
    return { saved: true, reasonCode: "STATE_SAVED" };
  } catch {
    return { saved: false, reasonCode: "STATE_SAVE_FAILED" };
  }
}
