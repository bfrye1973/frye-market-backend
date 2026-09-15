// services/core/logic/engine29/groups/buildCreditGroup.js

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

function simpleBlock(members) {
  const available = members.filter((m) => m?.available);
  if (!available.length) return null;
  if (available.filter((m) => isConfirmedBreak(m.state)).length >= 1 && available.filter((m) => isBreakingOrWorse(m.state)).length >= 1) {
    return ENGINE29_GROUP_STATES.CONFIRMED;
  }
  if (available.some((m) => isBreakingOrWorse(m.state))) return ENGINE29_GROUP_STATES.FORMING;
  if (available.some((m) => isWarningOrWorse(m.state))) return ENGINE29_GROUP_STATES.FORMING;
  if (available.some((m) => isRecovering(m.state))) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

function highYieldBlock(hyg, jnk) {
  const available = [hyg, jnk].filter((m) => m?.available);
  if (!available.length) return null;
  const hygBreak = hyg?.available && isBreakingOrWorse(hyg.state);
  const hygConfirmed = hyg?.available && isConfirmedBreak(hyg.state);
  const jnkSupport = jnk?.available && isWarningOrWorse(jnk.state);
  const jnkBreak = jnk?.available && isBreakingOrWorse(jnk.state);

  if (hygConfirmed && jnkBreak) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (hygBreak && jnkSupport) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (hygBreak || jnkBreak || available.some((m) => isWarningOrWorse(m.state))) return ENGINE29_GROUP_STATES.FORMING;
  if (available.some((m) => isRecovering(m.state))) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

function buildOne(symbols, timeframeKey) {
  const hyg = memberSnapshot(symbols.HYG, timeframeKey);
  const jnk = memberSnapshot(symbols.JNK, timeframeKey);
  const lqd = memberSnapshot(symbols.LQD, timeframeKey);
  const xlf = memberSnapshot(symbols.XLF, timeframeKey);
  const kre = memberSnapshot(symbols.KRE, timeframeKey);
  const members = [hyg, jnk, lqd, xlf, kre].filter(Boolean);

  const highYieldState = highYieldBlock(hyg, jnk);
  const qualityState = simpleBlock([lqd]);
  const bankState = simpleBlock([xlf, kre]);

  const highYieldConfirmed = highYieldState === ENGINE29_GROUP_STATES.CONFIRMED;
  const secondaryConfirmed = [qualityState, bankState].filter((s) => s === ENGINE29_GROUP_STATES.CONFIRMED).length;
  const secondaryForming = [qualityState, bankState].some((s) => s === ENGINE29_GROUP_STATES.FORMING || s === ENGINE29_GROUP_STATES.CONFIRMED);
  const anyRecovering = [highYieldState, qualityState, bankState].some((s) => s === ENGINE29_GROUP_STATES.RECOVERING);

  let state = null;
  if (highYieldState || qualityState || bankState) {
    if (highYieldConfirmed && secondaryConfirmed >= 2) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (highYieldConfirmed && secondaryForming) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (highYieldState === ENGINE29_GROUP_STATES.FORMING || secondaryForming) state = ENGINE29_GROUP_STATES.FORMING;
    else if (anyRecovering) state = ENGINE29_GROUP_STATES.RECOVERING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  for (const m of members) {
    if (!m.available || !isBreakingOrWorse(m.state)) continue;
    if (m.canonicalSymbol === "HYG") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_HYG_BREAKDOWN);
    if (m.canonicalSymbol === "JNK") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_JNK_BREAKDOWN);
    if (m.canonicalSymbol === "LQD") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_LQD_BREAKDOWN);
    if (m.canonicalSymbol === "XLF") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_XLF_BREAKDOWN);
    if (m.canonicalSymbol === "KRE") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_KRE_BREAKDOWN);
  }
  if (highYieldConfirmed) reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_HIGH_YIELD_CONFIRMED);
  if ([ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state)) reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_CONFIRMED);

  const missingRequiredMembers = [];
  if (!hyg?.available) missingRequiredMembers.push("HYG");
  if (!xlf?.available) missingRequiredMembers.push("XLF");

  return groupBase({
    group: ENGINE29_GROUP_IDS.CREDIT,
    timeframe: timeframeKey === "tactical" ? "1H" : "1W",
    state,
    members,
    subgroups: {
      HIGH_YIELD_BLOCK: { state: highYieldState, members: [hyg, jnk].filter(Boolean) },
      QUALITY_CREDIT_BLOCK: { state: qualityState, members: [lqd].filter(Boolean) },
      FINANCIAL_BANK_BLOCK: { state: bankState, members: [xlf, kre].filter(Boolean) },
    },
    reasonCodes,
    missingRequiredMembers,
    notes: ["High-yield confirmation is intentionally required before the Credit group can become CONFIRMED."],
  });
}

export function buildCreditGroup(symbols = {}) {
  return { structural: buildOne(symbols, "structural"), tactical: buildOne(symbols, "tactical") };
}
