// services/core/logic/engine29/groups/buildEnergyInflationGroup.js

import { ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import {
  groupBase,
  isBreakingOrWorse,
  isConfirmedBreak,
  isRecovering,
  isWarningOrWorse,
  memberSnapshot,
} from "./groupUtils.js";

function buildOne(symbols, timeframeKey) {
  const wti = memberSnapshot(symbols.WTI, timeframeKey);
  const brent = memberSnapshot(symbols.BRENT, timeframeKey);
  const members = [wti, brent].filter(Boolean);
  const available = members.filter((m) => m.available);

  let state = null;
  if (available.length) {
    const breaking = available.filter((m) => isBreakingOrWorse(m.state)).length;
    const confirmed = available.filter((m) => isConfirmedBreak(m.state)).length;
    const warning = available.filter((m) => isWarningOrWorse(m.state)).length;
    if (available.length === 2 && confirmed === 2) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (available.length === 2 && breaking === 2) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (breaking >= 1 || warning >= 1) state = ENGINE29_GROUP_STATES.FORMING;
    else if (available.some((m) => isRecovering(m.state))) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  if (wti?.available && isBreakingOrWorse(wti.state)) reasonCodes.push(ENGINE29_REASON_CODES.WTI_BREAKOUT);
  if (brent?.available && isBreakingOrWorse(brent.state)) reasonCodes.push(ENGINE29_REASON_CODES.BRENT_BREAKOUT);
  if ([ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state)) reasonCodes.push(ENGINE29_REASON_CODES.ENERGY_OIL_COMPLEX_CONFIRMED);

  const missingRequiredMembers = [];
  if (!wti?.available) missingRequiredMembers.push("WTI");
  if (!brent?.available) missingRequiredMembers.push("BRENT");

  return groupBase({
    group: ENGINE29_GROUP_IDS.ENERGY_INFLATION,
    timeframe: timeframeKey === "tactical" ? "1H" : "1W",
    state,
    members,
    subgroups: { OIL_COMPLEX: { state, members } },
    reasonCodes,
    missingRequiredMembers,
    notes: ["WTI and Brent are treated as one correlated oil complex; one leg alone cannot produce CONFIRMED oil-complex stress."],
  });
}

export function buildEnergyInflationGroup(symbols = {}) {
  return { structural: buildOne(symbols, "structural"), tactical: buildOne(symbols, "tactical") };
}
