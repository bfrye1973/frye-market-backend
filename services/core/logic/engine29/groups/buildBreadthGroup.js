// services/core/logic/engine29/groups/buildBreadthGroup.js

import { ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import {
  groupBase,
  timeframeLabel,
  isBreakingOrWorse,
  isConfirmedBreak,
  isRecovering,
  isWarningOrWorse,
  memberSnapshot,
} from "./groupUtils.js";

function buildOne(symbols, timeframeKey) {
  const names = ["IWM", "MDY", "RSP"];
  const members = names.map((s) => memberSnapshot(symbols[s], timeframeKey)).filter(Boolean);
  const available = members.filter((m) => m.available);
  const missing = names.filter((s) => !memberSnapshot(symbols[s], timeframeKey)?.available);

  const confirmedCount = available.filter((m) => isConfirmedBreak(m.state)).length;
  const breakingCount = available.filter((m) => isBreakingOrWorse(m.state)).length;
  const warningCount = available.filter((m) => isWarningOrWorse(m.state)).length;
  const recoveringCount = available.filter((m) => isRecovering(m.state)).length;

  let state = null;
  if (available.length) {
    if (confirmedCount === 3) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (breakingCount >= 2) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (warningCount >= 1) state = ENGINE29_GROUP_STATES.FORMING;
    else if (recoveringCount >= 1) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  for (const m of available) {
    if (!isBreakingOrWorse(m.state)) continue;
    if (m.canonicalSymbol === "IWM") reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_IWM_BREAKDOWN);
    if (m.canonicalSymbol === "MDY") reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_MDY_BREAKDOWN);
    if (m.canonicalSymbol === "RSP") reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_RSP_BREAKDOWN);
  }
  if (state === ENGINE29_GROUP_STATES.CONFIRMED || state === ENGINE29_GROUP_STATES.SEVERE) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_CONFIRMED);
  }

  return groupBase({
    group: ENGINE29_GROUP_IDS.BREADTH,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    reasonCodes,
    missingRequiredMembers: missing,
  });
}

export function buildBreadthGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
    fastTactical: buildOne(symbols, "fastTactical"),
  };
}
