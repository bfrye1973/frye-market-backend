// services/core/logic/engine29/aggregate/resolveStructuralState.js

import {
  ENGINE29_BACKDROP_STATES,
  ENGINE29_CONFIDENCE,
  ENGINE29_GROUP_STATES,
  ENGINE29_OVERALL_STATES,
} from "../constants.js";
import { ENGINE29_PHASE5_REASON_CODES } from "./overallStateConstants.js";

const GROUP_KEYS = Object.freeze([
  "headlineIndex",
  "breadth",
  "leadership",
  "credit",
  "ratesDuration",
  "energyInflation",
  "volatility",
  "financialConditions",
]);

const INDEPENDENT_NON_CREDIT = Object.freeze([
  "headlineIndex",
  "breadth",
  "leadership",
  "ratesDuration",
  "energyInflation",
  "financialConditions",
]);

function stateOf(groupBundle, key) {
  return groupBundle?.groups?.[key]?.structural?.state ?? null;
}

function confidenceOf(groupBundle, key) {
  return groupBundle?.groups?.[key]?.structural?.confidence ?? ENGINE29_CONFIDENCE.LOW;
}

function isActive(state) {
  return [ENGINE29_GROUP_STATES.FORMING, ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state);
}

function isConfirmed(state) {
  return [ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state);
}

function isSevere(state) {
  return state === ENGINE29_GROUP_STATES.SEVERE;
}

function backdropFromOverall(state) {
  if (state === ENGINE29_OVERALL_STATES.SYSTEMIC_STRESS) return ENGINE29_BACKDROP_STATES.SEVERELY_NEGATIVE;
  if (state === ENGINE29_OVERALL_STATES.RISK_OFF_CONFIRMED) return ENGINE29_BACKDROP_STATES.SEVERELY_NEGATIVE;
  if (state === ENGINE29_OVERALL_STATES.BROAD_DETERIORATION) return ENGINE29_BACKDROP_STATES.NEGATIVE;
  if (state === ENGINE29_OVERALL_STATES.EARLY_WARNING) return ENGINE29_BACKDROP_STATES.NEGATIVE;
  return ENGINE29_BACKDROP_STATES.NEUTRAL;
}

function deriveConfidence(groupBundle, state) {
  const structural = GROUP_KEYS
    .map((key) => groupBundle?.groups?.[key]?.structural)
    .filter((x) => x?.state);

  if (!structural.length) return ENGINE29_CONFIDENCE.LOW;
  const degraded = structural.filter((x) => x.dataDegraded).length;
  const high = structural.filter((x) => x.confidence === ENGINE29_CONFIDENCE.HIGH).length;

  if (state === ENGINE29_OVERALL_STATES.RISK_OFF_CONFIRMED || state === ENGINE29_OVERALL_STATES.SYSTEMIC_STRESS) {
    return degraded === 0 && high >= 4 ? ENGINE29_CONFIDENCE.HIGH : ENGINE29_CONFIDENCE.MEDIUM;
  }
  if (high >= 3) return ENGINE29_CONFIDENCE.HIGH;
  if (structural.length >= 3) return ENGINE29_CONFIDENCE.MEDIUM;
  return ENGINE29_CONFIDENCE.LOW;
}

export function resolveEngine29StructuralState(groupBundle) {
  const states = Object.fromEntries(GROUP_KEYS.map((key) => [key, stateOf(groupBundle, key)]));
  const usableCount = Object.values(states).filter(Boolean).length;
  const activeGroups = GROUP_KEYS.filter((key) => isActive(states[key]));
  const confirmedGroups = GROUP_KEYS.filter((key) => isConfirmed(states[key]));
  const severeGroups = GROUP_KEYS.filter((key) => isSevere(states[key]));
  const independentConfirmed = INDEPENDENT_NON_CREDIT.filter((key) => isConfirmed(states[key]));
  const independentActive = INDEPENDENT_NON_CREDIT.filter((key) => isActive(states[key]));

  const internalsConfirmed = isConfirmed(states.breadth) || isConfirmed(states.leadership);
  const creditConfirmed = isConfirmed(states.credit);
  const volatilityConfirmed = isConfirmed(states.volatility);
  const headlineConfirmed = isConfirmed(states.headlineIndex);
  const financialConditionsConfirmed = isConfirmed(states.financialConditions);

  const reasonCodes = [];
  let state = null;

  if (usableCount >= 3) {
    const systemic =
      creditConfirmed &&
      volatilityConfirmed &&
      headlineConfirmed &&
      internalsConfirmed &&
      (financialConditionsConfirmed || severeGroups.length >= 3) &&
      confirmedGroups.length >= 5;

    const riskOff =
      !systemic &&
      creditConfirmed &&
      volatilityConfirmed &&
      internalsConfirmed &&
      confirmedGroups.length >= 4;

    const broad =
      !systemic &&
      !riskOff &&
      internalsConfirmed &&
      (
        independentConfirmed.length >= 3 ||
        (independentConfirmed.length >= 2 && independentActive.length >= 4)
      );

    if (systemic) {
      state = ENGINE29_OVERALL_STATES.SYSTEMIC_STRESS;
      reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.STRUCTURAL_SYSTEMIC_STRESS);
    } else if (riskOff) {
      state = ENGINE29_OVERALL_STATES.RISK_OFF_CONFIRMED;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.STRUCTURAL_RISK_OFF_CONFIRMED,
        ENGINE29_PHASE5_REASON_CODES.CREDIT_PROMOTION_GATE_MET,
        ENGINE29_PHASE5_REASON_CODES.VOLATILITY_CONFIRMATION_MET,
      );
    } else if (broad) {
      state = ENGINE29_OVERALL_STATES.BROAD_DETERIORATION;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.STRUCTURAL_BROAD_DETERIORATION,
        ENGINE29_PHASE5_REASON_CODES.INTERNALS_CONFIRMED,
        ENGINE29_PHASE5_REASON_CODES.MULTIPLE_INDEPENDENT_GROUPS_CONFIRMED,
      );
      if (!creditConfirmed) reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.CREDIT_PROMOTION_GATE_MISSING);
      if (!volatilityConfirmed) reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.VOLATILITY_CONFIRMATION_MISSING);
    } else if (activeGroups.length >= 1) {
      state = ENGINE29_OVERALL_STATES.EARLY_WARNING;
      reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.STRUCTURAL_EARLY_WARNING);
    } else {
      state = ENGINE29_OVERALL_STATES.NORMAL;
      reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.STRUCTURAL_NORMAL);
    }
  }

  if (headlineConfirmed) reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.HEADLINE_BREAK_CONFIRMED);
  if (!financialConditionsConfirmed) reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FINANCIAL_CONDITIONS_CONFIRMATION_MISSING);

  return {
    state,
    backdrop: backdropFromOverall(state),
    confidence: deriveConfidence(groupBundle, state),
    states,
    usableGroupCount: usableCount,
    activeGroups,
    confirmedGroups,
    severeGroups,
    independentConfirmed,
    independentActive,
    gates: {
      internalsConfirmed,
      creditConfirmed,
      volatilityConfirmed,
      headlineConfirmed,
      financialConditionsConfirmed,
    },
    reasonCodes: [...new Set(reasonCodes)],
  };
}
