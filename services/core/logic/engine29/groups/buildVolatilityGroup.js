// services/core/logic/engine29/groups/buildVolatilityGroup.js

import { ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import { groupBase, isBreakingOrWorse, isConfirmedBreak, isRecovering, isWarningOrWorse, memberSnapshot } from "./groupUtils.js";

function buildOne(symbols, timeframeKey) {
  const vix = memberSnapshot(symbols.VIX, timeframeKey);
  const members = [vix].filter(Boolean);
  let state = null;
  if (vix?.available) {
    if (isConfirmedBreak(vix.state)) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (isBreakingOrWorse(vix.state)) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (isWarningOrWorse(vix.state)) state = ENGINE29_GROUP_STATES.FORMING;
    else if (isRecovering(vix.state)) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  if (vix?.available && isWarningOrWorse(vix.state)) reasonCodes.push(ENGINE29_REASON_CODES.VIX_FIRMING);
  if (vix?.available && isBreakingOrWorse(vix.state)) reasonCodes.push(ENGINE29_REASON_CODES.VIX_BREAKOUT);
  if (vix?.available && isConfirmedBreak(vix.state)) reasonCodes.push(ENGINE29_REASON_CODES.VIX_STRESS_EXPANSION);

  return groupBase({
    group: ENGINE29_GROUP_IDS.VOLATILITY,
    timeframe: timeframeKey === "tactical" ? "1H" : "1W",
    state,
    members,
    reasonCodes,
    missingRequiredMembers: vix?.available ? [] : ["VIX"],
    notes: ["Volatility is a confirmation layer, not a prerequisite for recognizing breadth or leadership deterioration."],
  });
}

export function buildVolatilityGroup(symbols = {}) {
  return { structural: buildOne(symbols, "structural"), tactical: buildOne(symbols, "tactical") };
}
