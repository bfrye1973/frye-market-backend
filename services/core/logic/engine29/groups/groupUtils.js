// services/core/logic/engine29/groups/groupUtils.js

import {
  ENGINE29_CONFIDENCE,
  ENGINE29_EVIDENCE_QUALITY,
  ENGINE29_GROUP_STATES,
  ENGINE29_SYMBOL_STATES,
} from "../constants.js";

const SYMBOL_STRESS_RANK = Object.freeze({
  [ENGINE29_SYMBOL_STATES.HEALTHY]: 0,
  [ENGINE29_SYMBOL_STATES.WARNING]: 1,
  [ENGINE29_SYMBOL_STATES.BREAKING]: 2,
  [ENGINE29_SYMBOL_STATES.CONFIRMED_BREAK]: 3,
  [ENGINE29_SYMBOL_STATES.RECOVERING]: -1,
});

const CONFIDENCE_RANK = Object.freeze({
  [ENGINE29_CONFIDENCE.LOW]: 0,
  [ENGINE29_CONFIDENCE.MEDIUM]: 1,
  [ENGINE29_CONFIDENCE.HIGH]: 2,
});

export function getTimeframeView(symbolEntry, timeframeKey) {
  if (!symbolEntry) return null;
  if (timeframeKey === "tactical") return symbolEntry.tactical;
  if (timeframeKey === "fastTactical") return symbolEntry.fastTactical;
  return symbolEntry.structural;
}

export function timeframeLabel(timeframeKey) {
  if (timeframeKey === "tactical") return "1H";
  if (timeframeKey === "fastTactical") return "30m";
  return "1W";
}

export function getSymbolState(symbolEntry, timeframeKey) {
  return getTimeframeView(symbolEntry, timeframeKey)?.classification?.state ?? null;
}

export function getSymbolStage(symbolEntry, timeframeKey) {
  return getTimeframeView(symbolEntry, timeframeKey)?.classification?.stage ?? null;
}

export function symbolStressRank(state) {
  return SYMBOL_STRESS_RANK[state] ?? null;
}

export function isWarningOrWorse(state) {
  const rank = symbolStressRank(state);
  return Number.isFinite(rank) && rank >= 1;
}

export function isBreakingOrWorse(state) {
  const rank = symbolStressRank(state);
  return Number.isFinite(rank) && rank >= 2;
}

export function isConfirmedBreak(state) {
  return state === ENGINE29_SYMBOL_STATES.CONFIRMED_BREAK;
}

export function isRecovering(state) {
  return state === ENGINE29_SYMBOL_STATES.RECOVERING;
}

// A durable break is intentionally stricter than a generic BREAKING state.
// TREND_BREAKING and INTRAPERIOD_BREAK are useful warning evidence, but they
// are not enough by themselves for late-confirmation groups such as Credit.
export function isDurableBreak(member) {
  if (!member?.available) return false;
  if (isConfirmedBreak(member.state)) return true;
  return (
    member.state === ENGINE29_SYMBOL_STATES.BREAKING &&
    member.stage === "COMPLETED_CLOSE_BREAK"
  );
}

export function memberSnapshot(symbolEntry, timeframeKey) {
  if (!symbolEntry) return null;
  const view = getTimeframeView(symbolEntry, timeframeKey);
  return {
    canonicalSymbol: symbolEntry.canonicalSymbol,
    label: symbolEntry.label,
    subgroup: symbolEntry.subgroup ?? null,
    provider: symbolEntry.provider ?? null,
    sourceSymbol: symbolEntry.sourceSymbol ?? null,
    sourceSeriesId: symbolEntry.sourceSeriesId ?? null,
    isProxy: Boolean(symbolEntry.isProxy),
    proxyFor: symbolEntry.proxyFor ?? null,
    evidenceQuality: symbolEntry.evidenceQuality ?? ENGINE29_EVIDENCE_QUALITY.MISSING,
    available: Boolean(view),
    state: view?.classification?.state ?? null,
    stage: view?.classification?.stage ?? null,
    confidence: view?.classification?.confidence ?? ENGINE29_CONFIDENCE.LOW,
    latest: view?.latest ?? null,
  };
}

export function chooseBestEvidence(symbolEntries = [], timeframeKey) {
  const candidates = symbolEntries
    .filter(Boolean)
    .map((entry) => ({ entry, snap: memberSnapshot(entry, timeframeKey) }))
    .filter(({ snap }) => snap?.available);

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aDirect = a.snap.evidenceQuality === ENGINE29_EVIDENCE_QUALITY.DIRECT ? 1 : 0;
    const bDirect = b.snap.evidenceQuality === ENGINE29_EVIDENCE_QUALITY.DIRECT ? 1 : 0;
    if (aDirect !== bDirect) return bDirect - aDirect;
    const ac = CONFIDENCE_RANK[a.snap.confidence] ?? 0;
    const bc = CONFIDENCE_RANK[b.snap.confidence] ?? 0;
    if (ac !== bc) return bc - ac;
    return (symbolStressRank(b.snap.state) ?? -99) - (symbolStressRank(a.snap.state) ?? -99);
  });

  return candidates[0].snap;
}

export function stateFromIndependentMembers(states = []) {
  const active = states.filter(Boolean);
  if (!active.length) return null;

  const severeCount = active.filter(isConfirmedBreak).length;
  const breakingCount = active.filter(isBreakingOrWorse).length;
  const warningCount = active.filter(isWarningOrWorse).length;
  const recoveringCount = active.filter(isRecovering).length;

  if (severeCount === active.length && active.length >= 2) return ENGINE29_GROUP_STATES.SEVERE;
  if (breakingCount >= 2) return ENGINE29_GROUP_STATES.CONFIRMED;
  if (warningCount >= 1) return ENGINE29_GROUP_STATES.FORMING;
  if (recoveringCount >= 1) return ENGINE29_GROUP_STATES.RECOVERING;
  return ENGINE29_GROUP_STATES.HEALTHY;
}

export function deriveGroupConfidence({ members = [], dataDegraded = false, proxyInUse = false } = {}) {
  const available = members.filter((m) => m?.available);
  if (!available.length) return ENGINE29_CONFIDENCE.LOW;
  if (dataDegraded) return ENGINE29_CONFIDENCE.LOW;
  if (proxyInUse) return ENGINE29_CONFIDENCE.MEDIUM;

  const confidences = available.map((m) => CONFIDENCE_RANK[m.confidence] ?? 0);
  const min = Math.min(...confidences);
  if (min <= 0) return ENGINE29_CONFIDENCE.LOW;
  if (min === 1) return ENGINE29_CONFIDENCE.MEDIUM;
  return ENGINE29_CONFIDENCE.HIGH;
}

export function groupBase({
  group,
  timeframe,
  state,
  members = [],
  subgroups = {},
  reasonCodes = [],
  missingRequiredMembers = [],
  notes = [],
} = {}) {
  const proxyMembers = members.filter((m) => m?.available && m?.isProxy).map((m) => m.canonicalSymbol);
  const dataDegraded = missingRequiredMembers.length > 0;
  const proxyInUse = proxyMembers.length > 0;

  return {
    group,
    timeframe,
    state,
    confidence: deriveGroupConfidence({ members, dataDegraded, proxyInUse }),
    dataDegraded,
    proxyInUse,
    proxyMembers,
    missingRequiredMembers,
    members,
    subgroups,
    reasonCodes: [...new Set(reasonCodes.filter(Boolean))],
    notes,
  };
}
