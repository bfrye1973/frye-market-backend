// services/core/logic/engine29/groups/buildLeadershipGroup.js

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

function blockState(members) {
  const available = members.filter((m) => m?.available);
  if (!available.length) return null;
  const confirmed = available.filter((m) => isConfirmedBreak(m.state)).length;
  const breaking = available.filter((m) => isBreakingOrWorse(m.state)).length;
  const warning = available.filter((m) => isWarningOrWorse(m.state)).length;
  const recovering = available.filter((m) => isRecovering(m.state)).length;
  if (confirmed >= 1 && breaking === available.length) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (breaking >= 1) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (warning >= 1) return ENGINE29_GROUP_STATES.FORMING;
  if (recovering >= 1) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

function buildOne(symbols, timeframeKey) {
  const smh = memberSnapshot(symbols.SMH, timeframeKey);
  const sox = memberSnapshot(symbols.SOX, timeframeKey);
  const xlk = memberSnapshot(symbols.XLK, timeframeKey);
  const members = [smh, sox, xlk].filter(Boolean);
  const semiconductorState = blockState([smh, sox]);
  const technologyState = blockState([xlk]);

  let state = null;
  if (semiconductorState || technologyState) {
    const semiStress = [ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(semiconductorState);
    const techStress = [ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(technologyState);
    const techWarning = technologyState === ENGINE29_GROUP_STATES.FORMING;
    const semiWarning = semiconductorState === ENGINE29_GROUP_STATES.FORMING;
    const recovering = semiconductorState === ENGINE29_GROUP_STATES.RECOVERING || technologyState === ENGINE29_GROUP_STATES.RECOVERING;

    if (semiStress && techStress) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (semiStress && (techWarning || techStress)) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (semiStress || techStress || semiWarning || techWarning) state = ENGINE29_GROUP_STATES.FORMING;
    else if (recovering) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  if (smh?.available && isBreakingOrWorse(smh.state)) reasonCodes.push(ENGINE29_REASON_CODES.LEADERSHIP_SMH_BREAKDOWN);
  if (sox?.available && isBreakingOrWorse(sox.state)) reasonCodes.push(ENGINE29_REASON_CODES.LEADERSHIP_SOX_BREAKDOWN);
  if (xlk?.available && isBreakingOrWorse(xlk.state)) reasonCodes.push(ENGINE29_REASON_CODES.LEADERSHIP_XLK_BREAKDOWN);
  if ([ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(semiconductorState)) {
    reasonCodes.push(ENGINE29_REASON_CODES.LEADERSHIP_SEMICONDUCTOR_BLOCK_CONFIRMED);
  }
  if ([ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.LEADERSHIP_CONFIRMED);
  }

  const missing = [];
  if (!smh?.available) missing.push("SMH");
  if (!sox?.available) missing.push("SOX");
  if (!xlk?.available) missing.push("XLK");

  return groupBase({
    group: ENGINE29_GROUP_IDS.LEADERSHIP,
    timeframe: timeframeKey === "tactical" ? "1H" : "1W",
    state,
    members,
    subgroups: {
      SEMICONDUCTOR_BLOCK: { state: semiconductorState, members: [smh, sox].filter(Boolean) },
      TECHNOLOGY_BLOCK: { state: technologyState, members: [xlk].filter(Boolean) },
    },
    reasonCodes,
    missingRequiredMembers: missing,
    notes: ["SMH and SOX are treated as one semiconductor block rather than two independent confirmations."],
  });
}

export function buildLeadershipGroup(symbols = {}) {
  return { structural: buildOne(symbols, "structural"), tactical: buildOne(symbols, "tactical") };
}
