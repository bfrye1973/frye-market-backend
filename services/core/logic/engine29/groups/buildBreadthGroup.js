// services/core/logic/engine29/groups/buildBreadthGroup.js

import { ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import {
  chooseBestEvidence,
  groupBase,
  timeframeLabel,
  isBreakingOrWorse,
  isConfirmedBreak,
  isRecovering,
  isWarningOrWorse,
  memberSnapshot,
} from "./groupUtils.js";

function buildOne(symbols, timeframeKey) {
  const rut = memberSnapshot(symbols.RUT, timeframeKey);
  const iwm = memberSnapshot(symbols.IWM, timeframeKey);
  const mdy = memberSnapshot(symbols.MDY, timeframeKey);
  const rsp = memberSnapshot(symbols.RSP, timeframeKey);
  const rui = memberSnapshot(symbols.RUI, timeframeKey);

  const members = [rut, iwm, mdy, rsp, rui].filter(Boolean);

  // RUT/IWM represent the same small-cap market. Prefer direct RUT and use IWM
  // as confirmation/fallback rather than counting both independently.
  const smallCaps = chooseBestEvidence([symbols.RUT, symbols.IWM], timeframeKey);
  const independentBlocks = [smallCaps, mdy, rsp].filter((m) => m?.available);

  const confirmedCount = independentBlocks.filter((m) => isConfirmedBreak(m.state)).length;
  const breakingCount = independentBlocks.filter((m) => isBreakingOrWorse(m.state)).length;
  const warningCount = independentBlocks.filter((m) => isWarningOrWorse(m.state)).length;
  const recoveringCount = independentBlocks.filter((m) => isRecovering(m.state)).length;

  let state = null;
  if (independentBlocks.length) {
    if (confirmedCount === 3 && independentBlocks.length === 3) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (breakingCount >= 2) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (warningCount >= 1) state = ENGINE29_GROUP_STATES.FORMING;
    else if (recoveringCount >= 1) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];

  if (rut?.available && isBreakingOrWorse(rut.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_RUT_BREAKDOWN);
  }
  if (iwm?.available && isBreakingOrWorse(iwm.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_IWM_BREAKDOWN);
  }
  if (mdy?.available && isBreakingOrWorse(mdy.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_MDY_BREAKDOWN);
  }
  if (rsp?.available && isBreakingOrWorse(rsp.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_RSP_BREAKDOWN);
  }
  if (rui?.available && isBreakingOrWorse(rui.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_RUI_BREAKDOWN);
  }

  if (state === ENGINE29_GROUP_STATES.CONFIRMED || state === ENGINE29_GROUP_STATES.SEVERE) {
    reasonCodes.push(ENGINE29_REASON_CODES.BREADTH_CONFIRMED);
  }

  const missing = [];
  if (!smallCaps?.available) missing.push("RUT_OR_IWM");
  if (!mdy?.available) missing.push("MDY");
  if (!rsp?.available) missing.push("RSP");

  return groupBase({
    group: ENGINE29_GROUP_IDS.BREADTH,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    subgroups: {
      SMALL_CAP_BLOCK: {
        state: smallCaps?.state ?? null,
        selected: smallCaps,
        members: [rut, iwm].filter(Boolean),
      },
      MID_CAP_BLOCK: mdy,
      EQUAL_WEIGHT_BLOCK: rsp,
      LARGE_CAP_BREADTH_CONTEXT: rui,
    },
    reasonCodes,
    missingRequiredMembers: missing,
    notes: [
      "RUT and IWM are one small-cap block and are never double counted.",
      "Direct RUT is preferred when available; IWM remains ETF confirmation/fallback.",
      "RUI is retained as broader large-cap breadth context and does not create an additional independent vote.",
    ],
  });
}

export function buildBreadthGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
    fastTactical: buildOne(symbols, "fastTactical"),
  };
}
