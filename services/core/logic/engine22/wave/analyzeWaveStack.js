// services/core/logic/engine22/wave/analyzeWaveStack.js
// Engine 22G — Generic Wave/Fib State Engine
// File 4: analyzeWaveStack.js
//
// Purpose:
// Run analyzeWaveDegree() across primary, intermediate, minor, minute, and micro.
// Then summarize the total wave/fib stack.
// This is read-only intelligence. It does not create trades.
//
// Engine 22 Learning / Wave Mark Maturity addition:
// - Reads active-wave-state metadata.
// - Builds runtime markMaturity.
// - Does NOT mutate active JSON.
// - Does NOT create execution permission.
// - Exposes markMaturity inside waveFibState so lifecycle/resolver can use it.

import { analyzeWaveDegree } from "./analyzeWaveDegree.js";
import { analyzeMicroW4AbcRisk } from "./analyzeMicroW4AbcRisk.js";
import { analyzeWaveDuration } from "./analyzeWaveDuration.js";
import { analyzeAbcCorrection } from "./analyzeAbcCorrection.js";
import { buildTradeContextSummary } from "./buildTradeContextSummary.js";
import { buildW4Levels } from "./buildW4Levels.js";
import { classifyWaveLifecycle } from "./classifyWaveLifecycle.js";
import { getActiveWaveStateMeta } from "./manualMarks/readManualWaveMarks.js";
import { validateWaveMarkMaturity } from "./revision/validateWaveMarkMaturity.js";
import { attachTargetModelsToActiveStructures } from "./targets/buildWaveTargetModel.js";
import { attachCorrectionModelsToActiveStructures } from "./corrections/buildCorrectionModels.js";


const DEGREE_ORDER = ["primary", "intermediate", "minor", "minute", "micro"];

const PARENT_BY_DEGREE = {
  primary: null,
  intermediate: "primary",
  minor: "intermediate",
  minute: "minor",
  micro: "minute",
};

function normalizeDegreeKey(degree) {
  return String(degree || "").trim().toLowerCase();
}

function isDegreeActiveByMeta(activeDegreeKeys, degree) {
  if (!Array.isArray(activeDegreeKeys)) return true;

  return activeDegreeKeys.includes(normalizeDegreeKey(degree));
}

function buildInactiveDegreeState(degree, existing = null) {
  return {
    ...(existing || {}),
    ok: true,
    active: false,
    degree,
    phase: "UNKNOWN",
    confirmedPhase: "UNKNOWN",
    phaseReason: "DEGREE_NOT_IN_ACTIVE_WAVE_STATE",
    lastMark: null,
    nextMark: null,
    marksPresent: [],
    fibProjection: null,
    fibPressure: null,
    extensionProgress: null,
    w4Levels: null,
    abcUpMarks: null,
    downImpulseMarks: null,
    postW5BounceMarks: null,
    possibleW5UpMarks: null,
    inactiveDegree: true,
    lifecycleBlockedAsCurrent: true,
    reasonCodes: [
      ...(Array.isArray(existing?.reasonCodes) ? existing.reasonCodes : []),
      "DEGREE_NOT_IN_ACTIVE_WAVE_STATE",
      "HISTORICAL_DEGREE_BLOCKED_AS_CURRENT",
    ],
  };
}

function applyActiveDegreeFilter({ degrees = {}, activeDegreeKeys = null } = {}) {
  if (!Array.isArray(activeDegreeKeys)) return degrees;

  const out = { ...(degrees || {}) };

  for (const degree of DEGREE_ORDER) {
    if (isDegreeActiveByMeta(activeDegreeKeys, degree)) continue;

    out[degree] = buildInactiveDegreeState(degree, out?.[degree] || null);
  }

  return out;
}

function getActiveStructuresFromMeta(activeStructuresSource = null) {
  if (!activeStructuresSource || typeof activeStructuresSource !== "object") {
    return {};
  }

  if (
    activeStructuresSource.activeStructures &&
    typeof activeStructuresSource.activeStructures === "object"
  ) {
    return activeStructuresSource.activeStructures;
  }

  if (
    activeStructuresSource.raw?.activeStructures &&
    typeof activeStructuresSource.raw.activeStructures === "object"
  ) {
    return activeStructuresSource.raw.activeStructures;
  }

  if (
    activeStructuresSource.state?.activeStructures &&
    typeof activeStructuresSource.state.activeStructures === "object"
  ) {
    return activeStructuresSource.state.activeStructures;
  }

  return {};
}

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(x) {
  return String(x || "").trim().toUpperCase();
}


function parseTimeSec(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  const text = String(value).trim();
  if (!text) return null;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric > 10_000_000_000
      ? Math.floor(numeric / 1000)
      : Math.floor(numeric);
  }

  const parsed = Date.parse(text.includes("T") ? text : text.replace(" ", "T"));
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);

  const utcParsed = Date.parse(`${text.includes("T") ? text : text.replace(" ", "T")}Z`);
  return Number.isFinite(utcParsed) ? Math.floor(utcParsed / 1000) : null;
}

function normalizeTenMinuteBar(bar) {
  if (!bar || typeof bar !== "object") return null;

  const timeSec = parseTimeSec(
    bar.timeSec ?? bar.tSec ?? bar.timestampSec ?? bar.timestamp ?? bar.time ?? bar.t
  );
  const high = toNum(bar.high ?? bar.h);
  const low = toNum(bar.low ?? bar.l);
  const close = toNum(bar.close ?? bar.c);

  if (timeSec === null || high === null || low === null || close === null) {
    return null;
  }

  return { timeSec, high, low, close, raw: bar };
}

function resolveNowSec({ snapshotNow = null, currentTimeSec = null } = {}) {
  const explicit = parseTimeSec(currentTimeSec);
  if (explicit !== null) return explicit;

  const snapshot = parseTimeSec(snapshotNow);
  if (snapshot !== null) return snapshot;

  return Math.floor(Date.now() / 1000);
}

function completedTenMinuteBars({ bars = [], nowSec = null } = {}) {
  const normalized = Array.isArray(bars)
    ? bars.map(normalizeTenMinuteBar).filter(Boolean).sort((a, b) => a.timeSec - b.timeSec)
    : [];

  if (!normalized.length) return [];

  const now = parseTimeSec(nowSec);
  if (now === null) return normalized.slice(0, -1);

  return normalized.filter((bar) => bar.timeSec + 10 * 60 <= now);
}

function readMarkPrice(mark) {
  return toNum(mark?.price ?? mark?.p ?? mark?.value ?? mark);
}

function readMarkTimeSec(mark) {
  return parseTimeSec(mark?.time ?? mark?.timestamp ?? mark?.t ?? null);
}

function isConfirmedMark(mark) {
  return upper(mark?.status ?? mark?.maturity) === "CONFIRMED" || mark?.confirmed === true;
}

function roundToTick(value, tickSize = 0.25) {
  const n = toNum(value);
  const tick = toNum(tickSize);
  if (n === null) return null;
  if (tick === null || tick <= 0) return round2(n);
  return round2(Math.round(n / tick) * tick);
}

function getReactionReads(reactionContext = null) {
  if (!reactionContext || typeof reactionContext !== "object") return [];

  return [
    reactionContext?.paperScalpReaction,
    reactionContext?.currentLevelAction,
    reactionContext?.engine3FastImbalanceReaction,
    reactionContext?.fastImbalanceReaction,
    reactionContext,
  ].filter((value) => value && typeof value === "object");
}

function getVolumeReads(volumeContext = null) {
  if (!volumeContext || typeof volumeContext !== "object") return [];

  return [
    volumeContext?.engine4AuthorizedReactionParticipation,
    volumeContext?.authorizedReactionParticipation,
    volumeContext?.engine4Volume,
    volumeContext,
  ].filter((value) => value && typeof value === "object");
}

const BEARISH_REACTION_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "BREAKOUT_FAILING",
  "REJECTING_VALUE",
  "SELLING_PRESSURE",
]);

const BULLISH_REACTION_STATES = new Set([
  "RECLAIMED_LEVEL",
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "HELD_LEVEL",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

function reactionConfirmation(reactionContext = null) {
  const reads = getReactionReads(reactionContext);

  const classify = (direction, states) =>
    reads.some((read) => {
      const readDirection = upper(
        read?.direction ?? read?.expectedReactionDirection ?? read?.reactionDirection
      );
      const state = upper(read?.state ?? read?.status ?? read?.read ?? read?.setupType);
      const confirmed =
        read?.reactionConfirmed === true ||
        read?.confirmed === true ||
        read?.quality === "GOOD" ||
        read?.participationConfirmed === true ||
        states.has(state);

      return readDirection === direction && confirmed;
    });

  return {
    bearish: classify("SHORT", BEARISH_REACTION_STATES),
    bullish: classify("LONG", BULLISH_REACTION_STATES),
  };
}

function volumeConfirmation(volumeContext = null) {
  const reads = getVolumeReads(volumeContext);

  const classify = (direction) =>
    reads.some((read) => {
      const readDirection = upper(
        read?.direction ?? read?.participationDirection ?? read?.bias
      );
      const quality = upper(read?.participationQuality ?? read?.quality);
      const confirmed =
        read?.participationConfirmed === true ||
        read?.confirmed === true ||
        read?.paperParticipationAllowed === true ||
        quality === "CONFIRMED";

      return readDirection === direction && confirmed;
    });

  return {
    bearish: classify("SHORT"),
    bullish: classify("LONG"),
  };
}

function buildRetracementMap({
  symbol,
  w2Low,
  w3HighCandidate,
  currentPrice,
  structuralPrice,
} = {}) {
  const w2 = toNum(w2Low);
  const high = toNum(w3HighCandidate);
  const live = toNum(currentPrice);
  const structural = toNum(structuralPrice);
  const price = live ?? structural;
  const tickSize = tickSizeForSymbol(symbol) || 0.25;

  if (w2 === null || high === null || high <= w2) return null;

  const range = high - w2;
  const rawLevels = {
    r236Raw: high - range * 0.236,
    r382Raw: high - range * 0.382,
    r500Raw: high - range * 0.5,
    r618Raw: high - range * 0.618,
    r786Raw: high - range * 0.786,
  };

  const levels = {
    r236: roundToTick(rawLevels.r236Raw, tickSize),
    r382: roundToTick(rawLevels.r382Raw, tickSize),
    r500: roundToTick(rawLevels.r500Raw, tickSize),
    r618: roundToTick(rawLevels.r618Raw, tickSize),
    r786: roundToTick(rawLevels.r786Raw, tickSize),
  };

  const ratio = price === null ? null : Math.max(0, (high - price) / range);
  const percent = ratio === null ? null : round2(ratio * 100);
  const levelEntries = Object.entries(levels).filter(([, value]) => value !== null);
  const nearest =
    price === null || !levelEntries.length
      ? null
      : levelEntries
          .map(([key, value]) => ({ key, price: value, distance: Math.abs(price - value) }))
          .sort((a, b) => a.distance - b.distance)[0];

  const nextBelow =
    price === null
      ? null
      : levelEntries
          .filter(([, value]) => value < price)
          .map(([key, value]) => ({ key, price: value }))
          .sort((a, b) => b.price - a.price)[0] || null;

  const nearThreshold = Math.max(tickSize * 4, 1);
  const near = levelEntries.find(([, value]) => price !== null && Math.abs(price - value) <= nearThreshold);

  let zoneState = "UNKNOWN";
  if (near) {
    zoneState = `AT_OR_NEAR_${near[0].toUpperCase()}`;
  } else if (price !== null) {
    if (price > levels.r236) zoneState = "ABOVE_R236";
    else if (price > levels.r382) zoneState = "BETWEEN_R236_R382";
    else if (price > levels.r500) zoneState = "BETWEEN_R382_R500";
    else if (price > levels.r618) zoneState = "BETWEEN_R500_R618";
    else if (price > levels.r786) zoneState = "BETWEEN_R618_R786";
    else zoneState = "BELOW_R786";
  }

  return {
    w2Low: round2(w2),
    w3HighCandidate: round2(high),
    range: round2(range),
    rawLevels: Object.fromEntries(
      Object.entries(rawLevels).map(([key, value]) => [key, round2(value)])
    ),
    ...levels,
    currentPrice: round2(price),
    structuralPrice: round2(structural),
    currentRetracementRatio: ratio === null ? null : Number(ratio.toFixed(4)),
    currentRetracementPercent: percent,
    currentRetracementDisplay: percent === null ? null : `${percent}%`,
    nearestRetracement: nearest ? { key: nearest.key, price: nearest.price } : null,
    nextRetracementBelow: nextBelow,
    zoneState,
    tickSize,
    normalization: tickSize === 0.25 ? "ES_TICK_ROUNDED" : "SOURCE_TICK_ROUNDED",
  };
}

function countBearishStructureBreaks(postHighBars = []) {
  let count = 0;

  for (let i = 1; i < postHighBars.length; i += 1) {
    const prev = postHighBars[i - 1];
    const curr = postHighBars[i];
    const lowerHigh = curr.high < prev.high;
    const lowerLow = curr.low < prev.low;
    const closeBelowPriorLow = curr.close < prev.low;

    if ((lowerHigh && lowerLow) || closeBelowPriorLow) count += 1;
  }

  return count;
}

function countBullishRecoveryBars(postHighBars = []) {
  let count = 0;

  for (let i = 1; i < postHighBars.length; i += 1) {
    const prev = postHighBars[i - 1];
    const curr = postHighBars[i];
    if (curr.close > prev.close && curr.low >= prev.low) count += 1;
  }

  return count;
}

export function buildMinuteW3W4TransitionModel({
  symbol = "ES",
  minuteStructure = null,
  bars10m = [],
  currentPrice = null,
  reactionContext = null,
  volumeContext = null,
  snapshotNow = null,
  currentTimeSec = null,
} = {}) {
  if (!minuteStructure || typeof minuteStructure !== "object") return null;

  const activeWave = upper(minuteStructure?.activeWave ?? minuteStructure?.internalStructure?.parentWave);
  if (activeWave !== "W3" && activeWave !== "W4") return null;

  const marks = minuteStructure?.marks || minuteStructure?.waveMarks || {};
  const w2Mark = marks?.W2 || null;
  const w3Mark = marks?.W3 || null;
  const w2Low =
    readMarkPrice(w2Mark) ??
    toNum(minuteStructure?.targetModel?.projectionBase) ??
    toNum(minuteStructure?.targetModel?.anchorModel?.projectionBase);

  if (w2Low === null) return null;

  const nowSec = resolveNowSec({ snapshotNow, currentTimeSec });
  const completed = completedTenMinuteBars({ bars: bars10m, nowSec });
  const w2TimeSec = readMarkTimeSec(w2Mark);
  const scoped = completed.filter(
    (bar) => w2TimeSec === null || bar.timeSec >= w2TimeSec
  );

  const confirmedManualW3 = isConfirmedMark(w3Mark) ? readMarkPrice(w3Mark) : null;

  let recordHigh = null;
  const supersededCandidates = [];

  for (const bar of scoped) {
    if (!recordHigh || bar.high > recordHigh.price) {
      if (recordHigh) {
        supersededCandidates.push({
          price: round2(recordHigh.price),
          timeSec: recordHigh.timeSec,
          status: "SUPERSEDED",
        });
      }
      recordHigh = { price: bar.high, timeSec: bar.timeSec };
    }
  }

  const candidatePrice = confirmedManualW3 ?? recordHigh?.price ?? null;
  const candidateTimeSec = confirmedManualW3 !== null ? readMarkTimeSec(w3Mark) : recordHigh?.timeSec ?? null;

  if (candidatePrice === null) {
    return {
      active: true,
      source: "engine22.minuteW3W4Transition.v1",
      state: "W3_EXTENSION_ACTIVE",
      w3HighCandidate: null,
      w3HighCandidateStatus: "WATCH",
      w4RetracementMap: null,
      w4PullbackState: "W3_EXTENSION_ACTIVE",
      currentInternalWave: minuteStructure?.internalStructure?.currentInternalWave || "iii",
      nextExpectedInternalWave: minuteStructure?.internalStructure?.nextExpectedInternalWave || "iv",
      nextExpectedParentWave: null,
      parentWaveComplete: false,
      parentTransitionPossible: false,
      noExecution: true,
      noPermissionCreated: true,
      watchOnly: true,
      reasonCodes: ["W3_HIGH_CANDIDATE_NOT_AVAILABLE", "NO_EXECUTION", "NO_PERMISSION_CREATED"],
    };
  }

  const targetLevels = minuteStructure?.targetModel?.levels || {};
  const maturityFloor =
    toNum(targetLevels?.e1618) ??
    toNum(targetLevels?.["1.618"]) ??
    w2Low;
  const reachedMaturity = candidatePrice >= maturityFloor;

  const postHighBars = scoped.filter(
    (bar) => candidateTimeSec !== null && bar.timeSec > candidateTimeSec
  );
  const latestCompleted = scoped[scoped.length - 1] || null;
  const structuralPrice = latestCompleted?.close ?? toNum(currentPrice);
  const retracementMap = buildRetracementMap({
    symbol,
    w2Low,
    w3HighCandidate: candidatePrice,
    currentPrice,
    structuralPrice,
  });

  const structuralRatio =
    structuralPrice === null || candidatePrice <= w2Low
      ? 0
      : Math.max(0, (candidatePrice - structuralPrice) / (candidatePrice - w2Low));

  const bearishBreakCount = countBearishStructureBreaks(postHighBars);
  const bullishRecoveryBars = countBullishRecoveryBars(postHighBars);
  const reaction = reactionConfirmation(reactionContext);
  const participation = volumeConfirmation(volumeContext);
  const bearishConfirmed = reaction.bearish && participation.bearish;
  const bullishConfirmed = reaction.bullish && participation.bullish;
  const candidateUnreclaimed =
    postHighBars.length === 0 ||
    Math.max(...postHighBars.map((bar) => bar.high)) <= candidatePrice;
  const pullbackPoints = Math.max(0, candidatePrice - (structuralPrice ?? candidatePrice));
  const minimumPullbackPoints = Math.max((tickSizeForSymbol(symbol) || 0.25) * 4, (candidatePrice - w2Low) * 0.03);
  const pullbackStarted =
    reachedMaturity &&
    postHighBars.length >= 1 &&
    candidateUnreclaimed &&
    (pullbackPoints >= minimumPullbackPoints || bearishBreakCount >= 1);

  const reachedRetracementSupport = structuralRatio >= 0.20;
  const internalVContinuation =
    pullbackStarted &&
    bullishConfirmed &&
    bullishRecoveryBars >= 2 &&
    structuralPrice < candidatePrice;

  let state = reachedMaturity ? "W3_HIGH_CANDIDATE_FORMING" : "W3_EXTENSION_ACTIVE";
  let currentInternalWave = "iii";
  let nextExpectedInternalWave = "iv";
  let nextExpectedParentWave = null;
  let parentWaveComplete = false;
  let parentTransitionPossible = false;
  let w3HighCandidateStatus = confirmedManualW3 !== null ? "CONFIRMED" : "ACTIVE_CANDIDATE";

  if (pullbackStarted) {
    state = "INTERNAL_IV_PULLBACK_ACTIVE";
    currentInternalWave = "iv";
    nextExpectedInternalWave = "v";
  }

  if (pullbackStarted && reachedRetracementSupport && bullishConfirmed) {
    state = "INTERNAL_IV_HOLD_RECLAIM_WATCH";
    currentInternalWave = "iv";
    nextExpectedInternalWave = "v";
  }

  if (internalVContinuation) {
    state = "INTERNAL_V_CONTINUATION_WATCH";
    currentInternalWave = "v";
    nextExpectedInternalWave = null;
    nextExpectedParentWave = "W4";
  }

  // Engine 22 owns structural wave classification. Engine 3 / Engine 4 are
  // confirming inputs, not hard owners of the parent-wave count. A strong,
  // persistent completed-10m post-high structure can therefore advance the
  // structural transition even when downstream confirmation is unavailable.
  //
  // This specifically prevents a mature parent W4 from being trapped forever
  // as "internal iv" merely because Engine 3 is waiting on Engine 26 or
  // Engine 4 has not yet published an authorized participation read.
  const structuralW3CompletionEvidence =
    candidateUnreclaimed &&
    postHighBars.length >= 6 &&
    bearishBreakCount >= 3 &&
    structuralRatio >= 0.04;

  const strongParentW4Structure =
    candidateUnreclaimed &&
    postHighBars.length >= 10 &&
    bearishBreakCount >= 5 &&
    structuralRatio >= 0.05;

  const w3CompletionCandidate =
    pullbackStarted &&
    candidateUnreclaimed &&
    postHighBars.length >= 2 &&
    bearishBreakCount >= 1 &&
    (reaction.bearish || structuralW3CompletionEvidence) &&
    !internalVContinuation;

  if (w3CompletionCandidate) {
    state = "W3_COMPLETION_CANDIDATE";
    currentInternalWave = "v";
    nextExpectedInternalWave = null;
    nextExpectedParentWave = "W4";
  }

  const parentW4Possible =
    w3CompletionCandidate &&
    (
      (bearishConfirmed && bearishBreakCount >= 1 && postHighBars.length >= 2) ||
      strongParentW4Structure
    );

  if (parentW4Possible) {
    state = "PARENT_W4_TRANSITION_POSSIBLE";
    parentTransitionPossible = true;
  }

  const parentW4ActiveCandidate =
    parentW4Possible &&
    candidateUnreclaimed &&
    (
      (bearishConfirmed && postHighBars.length >= 3 && bearishBreakCount >= 2) ||
      strongParentW4Structure
    );

  if (parentW4ActiveCandidate) {
    state = "PARENT_W4_ACTIVE_CANDIDATE";
    parentWaveComplete = true;
    parentTransitionPossible = true;
    nextExpectedParentWave = "W4";
    w3HighCandidateStatus = "CONFIRMED";
  }

  return {
    active: true,
    source: "engine22.minuteW3W4Transition.v1",
    state,
    w3HighCandidate: round2(candidatePrice),
    w3HighCandidateTimeSec: candidateTimeSec,
    w3HighCandidateStatus,
    supersededCandidates,
    w4RetracementMap: retracementMap,
    w4PullbackState: state,
    currentInternalWave,
    nextExpectedInternalWave,
    nextExpectedParentWave,
    parentWaveComplete,
    parentTransitionPossible,
    evidence: {
      completed10mBars: completed.length,
      scoped10mBarsSinceW2: scoped.length,
      postHighCompleted10mBars: postHighBars.length,
      reachedExtensionMaturity: reachedMaturity,
      candidateUnreclaimed,
      pullbackStarted,
      structuralRetracementRatio: Number(structuralRatio.toFixed(4)),
      bearishStructureBreakCount: bearishBreakCount,
      bullishRecoveryBarCount: bullishRecoveryBars,
      engine3BearishReactionConfirmed: reaction.bearish,
      engine3BullishReactionConfirmed: reaction.bullish,
      engine4BearishParticipationConfirmed: participation.bearish,
      engine4BullishParticipationConfirmed: participation.bullish,
      bearishDownstreamConfirmation: bearishConfirmed,
      bullishDownstreamConfirmation: bullishConfirmed,
      structuralW3CompletionEvidence,
      strongParentW4Structure,
      structuralTransitionAuthority: strongParentW4Structure
        ? "CANONICAL_10M_STRUCTURE"
        : bearishConfirmed
        ? "ENGINE3_ENGINE4_CONFIRMED"
        : "DEVELOPING",
    },
    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,
    reasonCodes: [
      "ENGINE22_MINUTE_W3_W4_TRANSITION_MODEL_BUILT",
      state,
      "COMPLETED_10M_CANDLES_ARE_CANONICAL",
      confirmedManualW3 !== null ? "CONFIRMED_MANUAL_W3_MARK_HAS_PRIORITY" : "W3_HIGH_DERIVED_FROM_COMPLETED_10M_BARS",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function attachMinuteW3W4TransitionToActiveStructures({
  symbol,
  activeStructures = {},
  barsByTf = {},
  currentPrice = null,
  reactionContext = null,
  volumeContext = null,
  snapshotNow = null,
  currentTimeSec = null,
} = {}) {
  if (!activeStructures || typeof activeStructures !== "object") return activeStructures;

  const minute = activeStructures?.minute;
  if (!minute || typeof minute !== "object") return activeStructures;

  const model = buildMinuteW3W4TransitionModel({
    symbol,
    minuteStructure: minute,
    bars10m: barsByTf?.["10m"] || [],
    currentPrice,
    reactionContext,
    volumeContext,
    snapshotNow,
    currentTimeSec,
  });

  if (!model?.active) return activeStructures;

  const internal = minute?.internalStructure || {};
  const w4Active = model.state === "PARENT_W4_ACTIVE_CANDIDATE";

  return {
    ...activeStructures,
    minute: {
      ...minute,
      activeWave: w4Active ? "W4" : minute.activeWave,
      stage: model.state,
      currentRead: `MINUTE_${model.state}`,
      direction: w4Active ? "DOWN" : minute.direction,
      w3HighCandidate: model.w3HighCandidate,
      w3HighCandidateStatus: model.w3HighCandidateStatus,
      w3HighCandidateTimeSec: model.w3HighCandidateTimeSec,
      w3HighCandidateHistory: model.supersededCandidates,
      w4RetracementMap: model.w4RetracementMap,
      w4PullbackState: model.w4PullbackState,
      nextExpectedParentWave: model.nextExpectedParentWave,
      w3W4TransitionModel: model,
      internalStructure: {
        ...internal,
        previousInternalWave:
          model.currentInternalWave === "iv"
            ? "iii"
            : model.currentInternalWave === "v"
            ? "iv"
            : internal.previousInternalWave,
        currentInternalWave: model.currentInternalWave,
        nextExpectedInternalWave: model.nextExpectedInternalWave,
        nextExpectedParentWave: model.nextExpectedParentWave,
        internalLegDirection:
          model.currentInternalWave === "iv" || w4Active
            ? "DOWN"
            : model.currentInternalWave === "v"
            ? "UP"
            : internal.internalLegDirection,
        parentWave: w4Active ? "W4" : internal.parentWave,
        parentWaveDirection: w4Active ? "DOWN" : internal.parentWaveDirection,
        parentWaveStillValid: w4Active ? false : internal.parentWaveStillValid !== false,
        parentWaveComplete: model.parentWaveComplete,
        parentTransitionPossible: model.parentTransitionPossible,
        retracementZone: model.w4RetracementMap
          ? {
              r236: model.w4RetracementMap.r236,
              r382: model.w4RetracementMap.r382,
              r500: model.w4RetracementMap.r500,
              r618: model.w4RetracementMap.r618,
              r786: model.w4RetracementMap.r786,
              zoneState: model.w4RetracementMap.zoneState,
            }
          : internal.retracementZone || null,
        evidence: {
          ...(internal.evidence || {}),
          ...(model.evidence || {}),
        },
        reasonCodes: [
          ...(Array.isArray(internal.reasonCodes) ? internal.reasonCodes : []),
          ...(Array.isArray(model.reasonCodes) ? model.reasonCodes : []),
        ],
        noExecution: true,
        noPermissionCreated: true,
        watchOnly: true,
      },
      reasonCodes: [
        ...(Array.isArray(minute.reasonCodes) ? minute.reasonCodes : []),
        ...(Array.isArray(model.reasonCodes) ? model.reasonCodes : []),
      ],
      noExecution: true,
      noPermissionCreated: true,
      watchOnly: true,
    },
  };
}

function isImpulsePhase(phase) {
  const p = upper(phase);
  return p === "IN_W1" || p === "IN_W3" || p === "IN_W5";
}

function isPullbackPhase(phase) {
  const p = upper(phase);
  return p === "IN_W2" || p === "IN_W4";
}

function chaseRiskRank(risk) {
  const r = upper(risk);

  if (r === "EXTREME") return 5;
  if (r === "VERY_HIGH") return 4;
  if (r === "HIGH") return 3;
  if (r === "ELEVATED") return 2;
  if (r === "MODERATE") return 1;
  if (r === "LOW_TO_MODERATE") return 0;

  return -1;
}

function strongestChaseRisk(degrees = {}) {
  let best = {
    risk: "UNKNOWN",
    rank: -1,
    degree: null,
  };

  for (const degree of DEGREE_ORDER) {
    const risk = degrees?.[degree]?.fibPressure?.chaseRisk || "UNKNOWN";
    const rank = chaseRiskRank(risk);

    if (rank > best.rank) {
      best = {
        risk,
        rank,
        degree,
      };
    }
  }

  return best;
}

function findHighestFibPressureDegree(degrees = {}) {
  let best = null;

  for (const degree of DEGREE_ORDER) {
    const d = degrees?.[degree];
    const risk = d?.fibPressure?.chaseRisk || "UNKNOWN";
    const rank = chaseRiskRank(risk);

    if (!best || rank > best.rank) {
      best = {
        degree,
        rank,
        risk,
        extensionState: d?.fibPressure?.extensionState || "UNKNOWN",
        nearestFib: d?.fibPressure?.nearestFib || null,
        nearestFibPrice: d?.fibPressure?.nearestFibPrice ?? null,
      };
    }
  }

  return best;
}

function tickSizeForSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (
    s === "ES" ||
    s.startsWith("ES") ||
    s === "MES" ||
    s.startsWith("MES") ||
    s === "NQ" ||
    s.startsWith("NQ") ||
    s === "MNQ" ||
    s.startsWith("MNQ")
  ) {
    return 0.25;
  }

  return null;
}

function attachW4LevelsToDegrees({
  symbol,
  engine2State,
  degrees,
  currentPrice,
}) {
  const tickSize = tickSizeForSymbol(symbol);

  for (const degree of DEGREE_ORDER) {
    const degreeState = degrees?.[degree];
    const engine2Block = engine2State?.[degree] || null;

    if (!degreeState?.ok || !engine2Block) continue;

    const phase = upper(degreeState.phase);
    const confirmedPhase = upper(degreeState.confirmedPhase);
    const nextExpectedWave = upper(degreeState.nextExpectedWave);

    const shouldBuildW4Levels =
      phase === "IN_W4" ||
      confirmedPhase === "IN_W3" ||
      nextExpectedWave === "W5";

    if (!shouldBuildW4Levels) continue;

    const w4Levels = buildW4Levels({
      symbol,
      degree,
      degreeState,
      engine2Block,
      currentPrice,
      tickSize,
    });

    degrees[degree] = {
      ...degreeState,
      w4Levels,
    };
  }

  return degrees;
}

function attachRawManualMarksToDegrees({ engine2State, degrees } = {}) {
  if (!engine2State || typeof engine2State !== "object") return degrees;
  if (!degrees || typeof degrees !== "object") return degrees;

  for (const degree of DEGREE_ORDER) {
    const degreeState = degrees?.[degree];
    const engine2Block = engine2State?.[degree] || null;

    if (!degreeState || !engine2Block) continue;

    const abcUpMarks =
      engine2Block?.abcUpMarks && typeof engine2Block.abcUpMarks === "object"
        ? engine2Block.abcUpMarks
        : null;

    const downImpulseMarks =
      engine2Block?.downImpulseMarks &&
      typeof engine2Block.downImpulseMarks === "object"
        ? engine2Block.downImpulseMarks
        : null;

    const postW5BounceMarks =
      engine2Block?.postW5BounceMarks &&
      typeof engine2Block.postW5BounceMarks === "object"
        ? engine2Block.postW5BounceMarks
        : null;

    const possibleW5UpMarks =
      engine2Block?.possibleW5UpMarks &&
      typeof engine2Block.possibleW5UpMarks === "object"
        ? engine2Block.possibleW5UpMarks
        : null;

    if (
      !abcUpMarks &&
      !downImpulseMarks &&
      !postW5BounceMarks &&
      !possibleW5UpMarks
    ) {
      continue;
    }

    degrees[degree] = {
      ...degreeState,
      ...(abcUpMarks ? { abcUpMarks } : {}),
      ...(downImpulseMarks ? { downImpulseMarks } : {}),
      ...(postW5BounceMarks ? { postW5BounceMarks } : {}),
      ...(possibleW5UpMarks ? { possibleW5UpMarks } : {}),
    };
  }

  return degrees;
}

function findActiveTradingDegree(degrees = {}) {
  // Prefer the lowest-degree active pullback because that is where entry timing later happens.
  for (const degree of ["micro", "minute", "minor", "intermediate", "primary"]) {
    const d = degrees?.[degree];
    if (!d?.ok) continue;

    if (isPullbackPhase(d.phase)) {
      return {
        degree,
        reason: `${degree.toUpperCase()}_${d.phase}_ACTIVE`,
        setup:
          d.phase === "IN_W4"
            ? `${degree.toUpperCase()}_W4_TO_W5`
            : `${degree.toUpperCase()}_W2_TO_W3`,
      };
    }
  }

  // If no pullback is active, use the lowest impulse degree.
  for (const degree of ["micro", "minute", "minor", "intermediate", "primary"]) {
    const d = degrees?.[degree];
    if (!d?.ok) continue;

    if (isImpulsePhase(d.phase)) {
      return {
        degree,
        reason: `${degree.toUpperCase()}_${d.phase}_ACTIVE`,
        setup:
          d.phase === "IN_W5"
            ? `${degree.toUpperCase()}_W5_EXTENSION`
            : `${degree.toUpperCase()}_IMPULSE`,
      };
    }
  }

  return {
    degree: null,
    reason: "NO_ACTIVE_TRADING_DEGREE",
    setup: "NONE",
  };
}

function buildStackBias({ degrees, chaseRisk }) {
  const primary = degrees?.primary;
  const intermediate = degrees?.intermediate;
  const minor = degrees?.minor;
  const minute = degrees?.minute;
  const micro = degrees?.micro;

  const higherBullish =
    isImpulsePhase(primary?.phase) &&
    isImpulsePhase(intermediate?.phase) &&
    isImpulsePhase(minor?.phase);

  const allFinalImpulse =
    primary?.phase === "IN_W5" &&
    intermediate?.phase === "IN_W5" &&
    minor?.phase === "IN_W5";

  const lowerPullback =
    isPullbackPhase(minute?.phase) || isPullbackPhase(micro?.phase);

  const highRisk =
    chaseRisk?.risk === "HIGH" ||
    chaseRisk?.risk === "VERY_HIGH" ||
    chaseRisk?.risk === "EXTREME";

  if (allFinalImpulse && lowerPullback && highRisk) {
    return "BULLISH_LATE_EXTENSION_REACTION_ZONE";
  }

  if (higherBullish && lowerPullback) {
    return "BULLISH_PULLBACK_INSIDE_HIGHER_IMPULSE";
  }

  if (allFinalImpulse && highRisk) {
    return "BULLISH_FINAL_IMPULSE_HIGH_CHASE_RISK";
  }

  if (higherBullish) {
    return "BULLISH_IMPULSE_STACK";
  }

  return "MIXED_OR_UNKNOWN_WAVE_STACK";
}

function sentenceForDegree(degree, d) {
  if (!d || d.ok !== true) return null;
  if (d.inactiveDegree === true) return null;

  const name = `${degree.charAt(0).toUpperCase()}${degree.slice(1)}`;

  if (d.extensionProgress?.state === "POST_EXTENSION_PULLBACK") {
    return `${name} ${d.extensionProgress.activeWave} already tagged ${d.extensionProgress.highestExtensionHit} near ${d.extensionProgress.highestExtensionPrice} and is now pulling back.`;
  }

  if (
    d.phase === "IN_W5" &&
    d.fibPressure?.extensionState === "NEAR_1_618_REACTION_ZONE"
  ) {
    return `${name} W5 is reacting near its 1.618 extension at ${d.fibPressure.nearestFibPrice}.`;
  }

  if (d.phase === "IN_W5" && d.fibProjection?.levels?.e100 != null) {
    return `${name} W5 is active with its 1.000 extension near ${d.fibProjection.levels.e100}.`;
  }

  if (d.phase === "IN_W4" && d.confirmedPhase === "IN_W3") {
    return `${name} W4 pullback is active after ${name} W3 completed.`;
  }

  if (d.phase === "IN_W2" && d.confirmedPhase === "IN_W1") {
    return `${name} W2 pullback is active after ${name} W1 completed.`;
  }

  if (d.phase === "IN_W3") {
    return `${name} W3 expansion is active.`;
  }

  return `${name} phase is ${d.phase}.`;
}

function buildPlainEnglishSummary({
  symbol,
  degrees,
  stackBias,
  chaseRisk,
  activeTradingDegree,
}) {
  const parts = [];

  const pressure = findHighestFibPressureDegree(degrees);

  const activeDegree = activeTradingDegree?.degree
    ? degrees?.[activeTradingDegree.degree]
    : null;

  if (activeDegree?.extensionProgress?.state === "POST_EXTENSION_PULLBACK") {
    parts.push(activeDegree.extensionProgress.read);
  } else if (
    pressure &&
    pressure.degree &&
    pressure.extensionState === "NEAR_1_618_REACTION_ZONE"
  ) {
    const degreeName =
      pressure.degree.charAt(0).toUpperCase() + pressure.degree.slice(1);

    parts.push(
      `${symbol} reacted near ${degreeName} W5 1.618 around ${pressure.nearestFibPrice}.`
    );
  } else {
    const intermediateSentence = sentenceForDegree(
      "intermediate",
      degrees?.intermediate
    );
    if (intermediateSentence) parts.push(intermediateSentence);
  }

  const minuteSentence = sentenceForDegree("minute", degrees?.minute);
  const microSentence = sentenceForDegree("micro", degrees?.micro);

  if (minuteSentence) parts.push(minuteSentence);
  if (microSentence) parts.push(microSentence);

  if (
    stackBias === "BULLISH_LATE_EXTENSION_REACTION_ZONE" ||
    stackBias === "BULLISH_FINAL_IMPULSE_HIGH_CHASE_RISK"
  ) {
    parts.push("Higher trend remains bullish, but chase risk is high.");
  } else if (stackBias === "BULLISH_PULLBACK_INSIDE_HIGHER_IMPULSE") {
    parts.push(
      "Higher trend remains bullish while the lower degree is pulling back."
    );
  }

  if (activeTradingDegree?.degree && activeTradingDegree?.setup) {
    parts.push(
      `Active trading focus is ${activeTradingDegree.setup}; wait for support/reclaim before any trigger.`
    );
  }

  if (!parts.length) {
    return `${symbol} wave/fib stack is mixed or unavailable. Wait for clearer Engine 2 structure.`;
  }

  return parts.join(" ");
}

export function analyzeWaveStack({
  symbol = "SPY",
  engine2State = null,
  currentPrice = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  snapshotNow = null,
  currentTimeSec = null,
  barsByTf = {},

  // Engine 22D lifecycle context bridge.
  // Read-only only. Used for lifecycle warnings, not permission or execution.
  marketMeterContext = null,
  marketRegime = null,
  engine25Context = null,
} = {}) {
  if (!engine2State || typeof engine2State !== "object") {
    return {
      ok: false,
      engine: "engine22.waveFibState.v1",
      symbol,
      currentPrice: round2(currentPrice),
      activeDegreeKeys: null,
      activeStructuresSource: null,
      markMaturity: null,
      stackBias: "UNKNOWN",
      activeTradingDegree: null,
      activeSetup: "NONE",
      chaseRisk: "UNKNOWN",
      degrees: {},
      summary: `${symbol} Engine 2 state is unavailable.`,
      reasonCodes: ["MISSING_ENGINE2_STATE"],
    };
  }

  const activeStructuresSource = getActiveWaveStateMeta({ symbol });

  const activeDegreeKeys = Array.isArray(
    activeStructuresSource?.activeDegreeKeys
  )
    ? activeStructuresSource.activeDegreeKeys
    : null;

const activeStructuresFromMeta =
  getActiveStructuresFromMeta(activeStructuresSource);

const activeStructuresWithTargets =
  attachTargetModelsToActiveStructures({
    symbol,
    activeStructures: activeStructuresFromMeta,
    currentPrice,
  });

const activeStructuresWithCorrections =
  attachCorrectionModelsToActiveStructures({
    symbol,
    activeStructures: activeStructuresWithTargets,
    currentPrice,
    maContext: null,
    institutionalZones: null,
    engine3Reference: reactionContext?.currentLevelAction || null,
  });

const markMaturity = validateWaveMarkMaturity({
  symbol,
  activeStructures: activeStructuresWithCorrections,
  currentPrice,
  barsByTf,
});

function applyResolvedCorrectionMarksToActiveStructures({
  activeStructures = {},
  markMaturity = null,
} = {}) {
  if (!activeStructures || typeof activeStructures !== "object") {
    return activeStructures;
  }

  const byDegree = markMaturity?.byDegree || {};
  const out = { ...activeStructures };

  for (const [degree, structure] of Object.entries(activeStructures)) {
    const resolvedMarks =
      byDegree?.[degree]?.correction?.resolvedMarks || null;

    if (!resolvedMarks || !structure?.correction) continue;

    const currentMarks =
      structure.correction?.marks && typeof structure.correction.marks === "object"
        ? structure.correction.marks
        : {};

    out[degree] = {
      ...structure,
      correction: {
        ...structure.correction,
        resolvedMarks,
        marks: {
          ...currentMarks,
          ...Object.fromEntries(
            Object.entries(resolvedMarks).filter(([, value]) => value !== null)
          ),
        },
        noExecution: true,
        noPermissionCreated: true,
        watchOnly: true,
      },
    };
  }

  return out;
}

const activeStructuresWithResolvedCorrectionMarks =
  applyResolvedCorrectionMarksToActiveStructures({
    activeStructures: activeStructuresWithCorrections,
    markMaturity,
  });

const activeStructuresWithMatureCorrections =
  attachCorrectionModelsToActiveStructures({
    symbol,
    activeStructures: activeStructuresWithResolvedCorrectionMarks,
    currentPrice,
    maContext: null,
    institutionalZones: null,
    engine3Reference: reactionContext?.currentLevelAction || null,
  }); 

const activeStructuresWithMinuteTransition =
  attachMinuteW3W4TransitionToActiveStructures({
    symbol,
    activeStructures: activeStructuresWithMatureCorrections,
    barsByTf,
    currentPrice,
    reactionContext,
    volumeContext,
    snapshotNow,
    currentTimeSec,
  });


  let degrees = {};

  for (const degree of DEGREE_ORDER) {
    const parentDegree = PARENT_BY_DEGREE[degree];
    const block = engine2State?.[degree] || null;
    const parentBlock = parentDegree
      ? engine2State?.[parentDegree] || null
      : null;

    degrees[degree] = analyzeWaveDegree({
      symbol,
      degree,
      parentDegree,
      block,
      parentBlock,
      currentPrice,
      barsByTf,
    });
  }

  degrees = attachW4LevelsToDegrees({
    symbol,
    engine2State,
    degrees,
    currentPrice,
  });

  degrees = attachRawManualMarksToDegrees({
    engine2State,
    degrees,
  });

  degrees = applyActiveDegreeFilter({
    degrees,
    activeDegreeKeys,
  });

  const chaseRisk = strongestChaseRisk(degrees);
  const activeTradingDegree = findActiveTradingDegree(degrees);
  const stackBias = buildStackBias({
    degrees,
    chaseRisk,
  });

  const microW4AbcRisk =
    activeTradingDegree?.setup === "MICRO_W4_TO_W5"
      ? analyzeMicroW4AbcRisk({
          symbol,
          engine2State,
          currentPrice,
          regimeLayers,
          reactionContext,
          volumeContext,
        })
      : {
          ok: true,
          active: false,
          symbol,
          state: "NO_ACTIVE_MICRO_W4_RISK",
          reasonCodes: ["ACTIVE_SETUP_NOT_MICRO_W4_TO_W5"],
        };

  const waveDuration = analyzeWaveDuration({
    symbol,
    engine2State,
    snapshotNow,
    currentTimeSec,
    barsByTf,
  });

  const activeDegreeName = activeTradingDegree?.degree || null;
  const activeDegreeBlock = activeDegreeName
    ? engine2State?.[activeDegreeName] || null
    : null;
  const activeDegreePhase = upper(activeDegreeBlock?.phase);
  const activeDegreeConfirmedPhase = upper(activeDegreeBlock?.confirmedPhase);

  const activeCorrectionFor =
    activeDegreePhase === "IN_W4" && activeDegreeConfirmedPhase === "IN_W3"
      ? "W4"
      : activeDegreePhase === "IN_W2" && activeDegreeConfirmedPhase === "IN_W1"
      ? "W2"
      : null;

  const abcCorrection =
    activeDegreeName && activeCorrectionFor
      ? analyzeAbcCorrection({
          symbol,
          degree: activeDegreeName,
          correctionFor: activeCorrectionFor,
          block: activeDegreeBlock,
          currentPrice,
          barsByTf,
        })
      : {
          ok: true,
          active: false,
          symbol,
          degree: activeDegreeName,
          correctionFor: null,
          state: "NO_ACTIVE_ABC_CORRECTION",
          reasonCodes: ["ACTIVE_SETUP_NOT_ACTIVE_CORRECTION_DEGREE"],
        };

  const summary = buildPlainEnglishSummary({
    symbol,
    degrees,
    stackBias,
    chaseRisk,
    activeTradingDegree,
  });

  const reasonCodes = [
    "ENGINE22_WAVE_FIB_STATE_BUILT",
    stackBias,
    activeTradingDegree?.reason || null,
    chaseRisk?.degree
      ? `CHASE_RISK_FROM_${chaseRisk.degree.toUpperCase()}`
      : null,
    ...(Array.isArray(activeDegreeKeys)
      ? [
          "ACTIVE_WAVE_STATE_DEGREES_ENFORCED",
          ...DEGREE_ORDER.filter(
            (degree) => !isDegreeActiveByMeta(activeDegreeKeys, degree)
          ).map(
            (degree) =>
              `${degree.toUpperCase()}_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE`
          ),
        ]
      : []),
  ].filter(Boolean);

const partialWaveFibState = {
  ok: true,
  engine: "engine22.waveFibState.v1",
  symbol,
  currentPrice: round2(currentPrice),

  activeDegreeKeys,
  activeStructuresSource,

  // Engine 22 lifecycle views / dashboard contract:
  // expose normalized active structures directly so downstream readers
  // do not need to know the active-wave-state file wrapper shape.
  activeStructures: activeStructuresWithMinuteTransition,
  activeWaveState: activeStructuresSource || null,
  
  markMaturity,

    stackBias,
    activeTradingDegree: activeTradingDegree.degree,
    activeSetup: activeTradingDegree.setup,
    activeTradingDegreeReason: activeTradingDegree.reason,

    chaseRisk: chaseRisk.risk,
    chaseRiskDegree: chaseRisk.degree,

    degrees,
    microW4AbcRisk,
    abcCorrection,
    waveDuration,

    summary,
    reasonCodes,
  };

  const lifecycle = classifyWaveLifecycle({
    symbol,
    waveFibState: partialWaveFibState,
    currentPrice,
    barsByTf,
    engine16: regimeLayers,

    // Engine 22D lifecycle context bridge.
    // Read-only only. Does not create trades, shorts, permission, or execution.
    engine25Context,
    marketRegime,
    marketMeterContext,
  });

  partialWaveFibState.lifecycle = lifecycle;

  const tradeContextSummary = buildTradeContextSummary({
    waveFibState: partialWaveFibState,
  });

return {
  ok: true,
  engine: "engine22.waveFibState.v1",
  symbol,
  currentPrice: round2(currentPrice),

  activeDegreeKeys,
  activeStructuresSource,

  // Engine 22 lifecycle views / dashboard contract:
  // expose normalized active structures directly so downstream readers
  // do not need to know the active-wave-state file wrapper shape.
  activeStructures: activeStructuresWithMinuteTransition,
  activeWaveState: activeStructuresSource || null,

  markMaturity,

    stackBias,
    activeTradingDegree: activeTradingDegree.degree,
    activeSetup: activeTradingDegree.setup,
    activeTradingDegreeReason: activeTradingDegree.reason,

    chaseRisk: chaseRisk.risk,
    chaseRiskDegree: chaseRisk.degree,

    degrees,
    microW4AbcRisk,
    abcCorrection,
    waveDuration,
    lifecycle,
    tradeContextSummary,

    regimeContext: regimeLayers || null,
    marketRegime: marketRegime || null,
    marketMeterContext: marketMeterContext || null,
    engine25Context: engine25Context || null,

    reactionContext: reactionContext || null,
    volumeContext: volumeContext || null,

    summary,
    reasonCodes,
  };
}

export default analyzeWaveStack;
