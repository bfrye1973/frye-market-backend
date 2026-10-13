// services/core/logic/engine29/groups/buildRatesDurationGroup.js

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

function yieldBlock(a, b) {
  const available = [a, b].filter((m) => m?.available);
  if (!available.length) return null;
  const confirmed = available.filter((m) => isConfirmedBreak(m.state)).length;
  const breaking = available.filter((m) => isBreakingOrWorse(m.state)).length;
  const warning = available.filter((m) => isWarningOrWorse(m.state)).length;
  if (available.length === 2 && confirmed === 2) return ENGINE29_GROUP_STATES.SEVERE;
  if (available.length === 2 && breaking === 2) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (breaking >= 1 || warning >= 1) return ENGINE29_GROUP_STATES.FORMING;
  if (available.some((m) => isRecovering(m.state))) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

function durationBlock(tlt) {
  if (!tlt?.available) return null;
  if (isConfirmedBreak(tlt.state)) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (isBreakingOrWorse(tlt.state)) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (isWarningOrWorse(tlt.state)) return ENGINE29_GROUP_STATES.FORMING;
  if (isRecovering(tlt.state)) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

function buildOne(symbols, timeframeKey) {
  const y10 = memberSnapshot(symbols.US10Y, timeframeKey);
  const y30 = memberSnapshot(symbols.US30Y, timeframeKey);
  const tlt = memberSnapshot(symbols.TLT, timeframeKey);
  const members = [y10, y30, tlt].filter(Boolean);

  const yieldState = yieldBlock(y10, y30);
  const durationState = durationBlock(tlt);
  const yieldStress = [ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(yieldState);
  const durationStress = durationState === ENGINE29_GROUP_STATES.CONFIRMED;

  let state = null;
  if (yieldState || durationState) {
    if (yieldState === ENGINE29_GROUP_STATES.SEVERE && durationStress && isConfirmedBreak(tlt?.state)) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (yieldStress && durationStress) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if ([yieldState, durationState].some((s) => s === ENGINE29_GROUP_STATES.FORMING || s === ENGINE29_GROUP_STATES.CONFIRMED || s === ENGINE29_GROUP_STATES.SEVERE)) state = ENGINE29_GROUP_STATES.FORMING;
    else if ([yieldState, durationState].some((s) => s === ENGINE29_GROUP_STATES.RECOVERING)) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  if (y10?.available && isBreakingOrWorse(y10.state)) reasonCodes.push(ENGINE29_REASON_CODES.RATES_10Y_BREAKOUT);
  if (y30?.available && isBreakingOrWorse(y30.state)) reasonCodes.push(ENGINE29_REASON_CODES.RATES_30Y_BREAKOUT);
  if (tlt?.available && isBreakingOrWorse(tlt.state)) reasonCodes.push(ENGINE29_REASON_CODES.TLT_DURATION_BREAKDOWN);
  if ([ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state)) reasonCodes.push(ENGINE29_REASON_CODES.RATES_DURATION_CONFIRMED);

  const missingRequiredMembers = [];
  if (!y10?.available) missingRequiredMembers.push("US10Y");
  if (!y30?.available) missingRequiredMembers.push("US30Y");
  if (!tlt?.available) missingRequiredMembers.push("TLT");

  return groupBase({
    group: ENGINE29_GROUP_IDS.RATES_DURATION,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    subgroups: {
      YIELD_BLOCK: { state: yieldState, members: [y10, y30].filter(Boolean) },
      DURATION_BLOCK: { state: durationState, members: [tlt].filter(Boolean) },
    },
    reasonCodes,
    missingRequiredMembers,
    notes: ["tactical", "fastTactical"].includes(timeframeKey) && (!y10?.available || !y30?.available)
      ? ["Tactical rates confirmation is intentionally capped because FRED yields are daily and no verified 1H yield feed is wired yet."]
      : [],
  });
}

export function buildRatesDurationGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
    fastTactical: buildOne(symbols, "fastTactical"),
  };
}
