// services/core/logic/engine29/groups/buildHeadlineIndexGroup.js

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
  const members = ["SPX", "SPY", "NDX", "QQQ"].map((s) => memberSnapshot(symbols[s], timeframeKey)).filter(Boolean);
  const sp500 = chooseBestEvidence([symbols.SPX, symbols.SPY], timeframeKey);
  const nasdaq = chooseBestEvidence([symbols.NDX, symbols.QQQ], timeframeKey);
  const blocks = [sp500, nasdaq].filter(Boolean);

  let state = null;
  if (blocks.length) {
    const confirmed = blocks.filter((b) => isConfirmedBreak(b.state)).length;
    const breaking = blocks.filter((b) => isBreakingOrWorse(b.state)).length;
    const warning = blocks.filter((b) => isWarningOrWorse(b.state)).length;
    const recovering = blocks.filter((b) => isRecovering(b.state)).length;

    if (confirmed === blocks.length && blocks.length === 2) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (breaking === 2) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (warning >= 1) state = ENGINE29_GROUP_STATES.FORMING;
    else if (recovering >= 1) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  const selected = [sp500, nasdaq].filter(Boolean);
  for (const m of selected) {
    if (!isBreakingOrWorse(m.state)) continue;
    if (m.canonicalSymbol === "SPY") reasonCodes.push(ENGINE29_REASON_CODES.HEADLINE_SPY_BREAKDOWN);
    if (m.canonicalSymbol === "SPX") reasonCodes.push(ENGINE29_REASON_CODES.HEADLINE_SPX_BREAKDOWN);
    if (m.canonicalSymbol === "QQQ") reasonCodes.push(ENGINE29_REASON_CODES.HEADLINE_QQQ_BREAKDOWN);
    if (m.canonicalSymbol === "NDX") reasonCodes.push(ENGINE29_REASON_CODES.HEADLINE_NDX_BREAKDOWN);
  }

  return groupBase({
    group: ENGINE29_GROUP_IDS.HEADLINE_INDEX,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    subgroups: { SP500_BLOCK: sp500, NASDAQ_BLOCK: nasdaq },
    reasonCodes,
    missingRequiredMembers: blocks.length < 2 ? ["HEADLINE_BLOCK_COVERAGE"] : [],
    notes: ["SPX/SPY and NDX/QQQ are consolidated into two independent headline blocks to prevent double counting."],
  });
}

export function buildHeadlineIndexGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
    fastTactical: buildOne(symbols, "fastTactical"),
  };
}
