// services/core/logic/engine29/groups/buildFinancialConditionsGroup.js

import { ENGINE29_CONFIDENCE, ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import { groupBase, memberSnapshot, timeframeLabel } from "./groupUtils.js";

function bool(value) {
  return value === true;
}

function buildOne(symbols, timeframeKey, context = {}) {
  const dxy = memberSnapshot(symbols.DXY, timeframeKey);
  const members = [dxy].filter(Boolean);

  const signals = {
    dxyTightening: bool(context.dxyTightening),
    nfciWorsening: bool(context.nfciWorsening),
    stlfsiWorsening: bool(context.stlfsiWorsening),
    creditSpreadWidening: bool(context.creditSpreadWidening),
    liquidityWorsening: bool(context.liquidityWorsening),
  };

  const supplied = Object.values(context).some((v) => typeof v === "boolean");
  const activeCount = Object.values(signals).filter(Boolean).length;

  let state = null;
  if (supplied) {
    if (activeCount >= 4) state = ENGINE29_GROUP_STATES.SEVERE;
    else if (activeCount >= 2) state = ENGINE29_GROUP_STATES.CONFIRMED;
    else if (activeCount === 1) state = ENGINE29_GROUP_STATES.FORMING;
    else state = ENGINE29_GROUP_STATES.HEALTHY;
  }

  const reasonCodes = [];
  if (signals.dxyTightening) reasonCodes.push(ENGINE29_REASON_CODES.DXY_FINANCIAL_CONDITIONS_TIGHTENING);
  if (signals.nfciWorsening) reasonCodes.push(ENGINE29_REASON_CODES.FINANCIAL_CONDITIONS_NFCI_WORSENING);
  if (signals.stlfsiWorsening) reasonCodes.push(ENGINE29_REASON_CODES.FINANCIAL_CONDITIONS_STLFSI_WORSENING);
  if (signals.creditSpreadWidening) reasonCodes.push(ENGINE29_REASON_CODES.FINANCIAL_CONDITIONS_CREDIT_SPREAD_WIDENING);

  const base = groupBase({
    group: ENGINE29_GROUP_IDS.FINANCIAL_CONDITIONS,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    subgroups: { CONTEXT_SIGNALS: signals },
    reasonCodes,
    missingRequiredMembers: [],
    notes: supplied
      ? ["Financial Conditions is intentionally narrow and does not re-count Rates/Duration or Energy/Inflation."]
      : ["No independent NFCI/STLFSI/credit-spread/liquidity context supplied yet; state intentionally remains null rather than assuming HEALTHY."],
  });

  if (!supplied) {
    return { ...base, confidence: ENGINE29_CONFIDENCE.LOW, assessmentAvailable: false };
  }
  return { ...base, assessmentAvailable: true };
}

export function buildFinancialConditionsGroup(
  symbols = {},
  { structuralContext = {}, tacticalContext = {}, fastTacticalContext = {} } = {},
) {
  return {
    structural: buildOne(symbols, "structural", structuralContext),
    tactical: buildOne(symbols, "tactical", tacticalContext),
    fastTactical: buildOne(symbols, "fastTactical", fastTacticalContext),
  };
}
