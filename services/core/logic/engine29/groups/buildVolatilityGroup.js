// services/core/logic/engine29/groups/buildVolatilityGroup.js

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
  const vix = memberSnapshot(symbols.VIX, timeframeKey);
  const members = [vix].filter(Boolean);

  // UVXY (or any other proxy) is useful context but is not canonical VIX truth.
  // Leveraged-volatility products have decay and path-dependence, so they must
  // never be allowed to declare the Volatility group HEALTHY/CONFIRMED on behalf
  // of direct VIX structure.
  const hasDirectVix = Boolean(vix?.available && !vix.isProxy);

  let state = null;
  if (hasDirectVix) {
    if (isConfirmedBreak(vix.state)) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (isBreakingOrWorse(vix.state)) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (isWarningOrWorse(vix.state)) state = ENGINE29_GROUP_STATES.FORMING;
    else if (isRecovering(vix.state)) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  if (hasDirectVix && isWarningOrWorse(vix.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.VIX_FIRMING);
  }
  if (hasDirectVix && isBreakingOrWorse(vix.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.VIX_BREAKOUT);
  }
  if (hasDirectVix && isConfirmedBreak(vix.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.VIX_STRESS_EXPANSION);
  }

  const missingRequiredMembers = [];
  if (!vix?.available) missingRequiredMembers.push("VIX");
  else if (vix.isProxy) missingRequiredMembers.push("VIX_DIRECT");

  return groupBase({
    group: ENGINE29_GROUP_IDS.VOLATILITY,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    reasonCodes,
    missingRequiredMembers,
    notes: [
      "Volatility is a confirmation layer, not a prerequisite for recognizing breadth or leadership deterioration.",
      "A proxy such as UVXY may be retained as context, but it cannot determine canonical VIX group state. Direct VIX data is required.",
    ],
  });
}

export function buildVolatilityGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
    fastTactical: buildOne(symbols, "fastTactical"),
  };
}
