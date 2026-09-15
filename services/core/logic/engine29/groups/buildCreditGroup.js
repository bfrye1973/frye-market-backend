// services/core/logic/engine29/groups/buildCreditGroup.js

import { ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import {
  groupBase,
  isBreakingOrWorse,
  isDurableBreak,
  isRecovering,
  isWarningOrWorse,
  memberSnapshot,
} from "./groupUtils.js";

function secondaryBlock(members) {
  const available = members.filter((m) => m?.available);
  if (!available.length) return null;

  const durable = available.filter(isDurableBreak).length;
  if (durable >= 1) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (available.some((m) => isBreakingOrWorse(m.state))) return ENGINE29_GROUP_STATES.FORMING;
  if (available.some((m) => isWarningOrWorse(m.state))) return ENGINE29_GROUP_STATES.FORMING;
  if (available.some((m) => isRecovering(m.state))) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

function highYieldBlock(hyg, jnk) {
  const available = [hyg, jnk].filter((m) => m?.available);
  if (!available.length) return null;

  const hygDurable = isDurableBreak(hyg);
  const jnkDurable = isDurableBreak(jnk);
  const hygActive = hyg?.available && isWarningOrWorse(hyg.state);
  const jnkActive = jnk?.available && isWarningOrWorse(jnk.state);

  // Credit is intentionally a late confirmation gate. A live/intraperiod break,
  // EMA/trend deterioration, or one high-yield ETF weakening is FORMING only.
  // The high-yield block becomes CONFIRMED only when both HYG and JNK have a
  // completed-close or persistent confirmed break.
  if (hygDurable && jnkDurable) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (hygActive || jnkActive) return ENGINE29_GROUP_STATES.FORMING;
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
  const qualityState = secondaryBlock([lqd]);
  const bankState = secondaryBlock([xlf, kre]);

  const highYieldConfirmed = highYieldState === ENGINE29_GROUP_STATES.CONFIRMED;
  const secondaryConfirmed = [qualityState, bankState].filter(
    (s) => s === ENGINE29_GROUP_STATES.CONFIRMED,
  ).length;
  const secondaryActive = [qualityState, bankState].some(
    (s) => s === ENGINE29_GROUP_STATES.FORMING || s === ENGINE29_GROUP_STATES.CONFIRMED,
  );
  const anyRecovering = [highYieldState, qualityState, bankState].some(
    (s) => s === ENGINE29_GROUP_STATES.RECOVERING,
  );

  let state = null;
  if (highYieldState || qualityState || bankState) {
    if (highYieldConfirmed && secondaryConfirmed >= 2) {
      state = ENGINE29_GROUP_STATES.SEVERE;
    } else if (highYieldConfirmed && secondaryConfirmed >= 1) {
      state = ENGINE29_GROUP_STATES.CONFIRMED;
    } else if (
      highYieldState === ENGINE29_GROUP_STATES.FORMING ||
      secondaryActive ||
      highYieldConfirmed
    ) {
      // Even a confirmed high-yield block remains FORMING at group level until
      // an independent credit/financial block joins it. This preserves Credit
      // as a deliberate promotion gate rather than an early-warning duplicate.
      state = ENGINE29_GROUP_STATES.FORMING;
    } else if (anyRecovering) {
      state = ENGINE29_GROUP_STATES.RECOVERING;
    } else {
      state = ENGINE29_GROUP_STATES.HEALTHY;
    }
  }

  const reasonCodes = [];
  for (const m of members) {
    if (!m.available || !isDurableBreak(m)) continue;
    if (m.canonicalSymbol === "HYG") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_HYG_BREAKDOWN);
    if (m.canonicalSymbol === "JNK") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_JNK_BREAKDOWN);
    if (m.canonicalSymbol === "LQD") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_LQD_BREAKDOWN);
    if (m.canonicalSymbol === "XLF") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_XLF_BREAKDOWN);
    if (m.canonicalSymbol === "KRE") reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_KRE_BREAKDOWN);
  }
  if (highYieldConfirmed) {
    reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_HIGH_YIELD_CONFIRMED);
  }
  if ([ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.CREDIT_CONFIRMED);
  }

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
    notes: [
      "Credit is a late confirmation gate. Intraperiod/EMA trend deterioration is FORMING; durable completed/persistent breaks are required for confirmation.",
      "High-yield confirmation requires both HYG and JNK durable breaks, plus an independent secondary credit/financial confirmation before the Credit group becomes CONFIRMED.",
    ],
  });
}

export function buildCreditGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
  };
}
