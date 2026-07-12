// services/core/logic/engine22/wave/buildDegreeStates.js
// Engine 22D — Wave Degree State Contract
//
// Purpose:
// Build separated Elliott Wave degree states for dashboard display.
//
// This is NOT execution logic.
// This is NOT Engine 6 permission.
// This is NOT Engine 15 readiness.
// This is a structural display/contract layer only.
//
// Engine 27 contract repair:
// - Preserve real Engine 22 stage names instead of flattening everything to ACTIVE.
// - Publish previousWave, previousWaveMark, and nextExpectedWave for each degree.
// - Keep existing correction display behavior intact.

import { attachNestedCorrectionContexts } from "./corrections/buildNestedCorrectionContext.js";

const DEGREE_ORDER = ["subminute", "minute", "minor", "intermediate", "primary"];

// Supports impulse marks and corrective marks.
// A/B/C = normal correction
// A/B/C/D/E = triangle correction
const WAVE_MARK_KEYS = ["W1", "W2", "W3", "W4", "W5", "A", "B", "C", "D", "E"];

const IMPULSE_SEQUENCE = ["W1", "W2", "W3", "W4", "W5"];
const CORRECTION_SEQUENCE = ["A", "B", "C", "D", "E"];

const DEFAULT_TF_BY_DEGREE = {
  subminute: "10m",
  minute: "10m",
  minor: "1h",
  intermediate: "4h",
  primary: "1d",
};

const FALLBACK_PARENT_BY_DEGREE = {
  subminute: "minute",
  minute: "minor",
  minor: "intermediate",
  intermediate: "primary",
  primary: null,
};

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function titleCase(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function round2(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeDegree(value) {
  const s = String(value || "").trim().toLowerCase();

  if (s === "micro") return "subminute";
  if (s === "submin") return "subminute";
  if (s === "subminute") return "subminute";
  if (s === "minute") return "minute";
  if (s === "minor") return "minor";
  if (s === "intermediate") return "intermediate";
  if (s === "primary") return "primary";

  return null;
}

function normalizeWave(value) {
  const s = upper(value);

  if (WAVE_MARK_KEYS.includes(s)) return s;

  if (s.includes("WAVE_1") || s.includes("W1")) return "W1";
  if (s.includes("WAVE_2") || s.includes("W2")) return "W2";
  if (s.includes("WAVE_3") || s.includes("W3")) return "W3";
  if (s.includes("WAVE_4") || s.includes("W4")) return "W4";
  if (s.includes("WAVE_5") || s.includes("W5")) return "W5";

  if (s === "A" || s.includes("A_LEG") || s.includes("WAVE_A")) return "A";
  if (s === "B" || s.includes("B_LEG") || s.includes("WAVE_B")) return "B";
  if (s === "C" || s.includes("C_LEG") || s.includes("WAVE_C")) return "C";
  if (s === "D" || s.includes("D_LEG") || s.includes("WAVE_D")) return "D";
  if (s === "E" || s.includes("E_LEG") || s.includes("WAVE_E")) return "E";

  return null;
}

function sequenceForWave(wave) {
  const w = normalizeWave(wave);

  if (IMPULSE_SEQUENCE.includes(w)) return IMPULSE_SEQUENCE;
  if (CORRECTION_SEQUENCE.includes(w)) return CORRECTION_SEQUENCE;

  return [];
}

function previousWaveFor(activeWave) {
  const wave = normalizeWave(activeWave);
  const sequence = sequenceForWave(wave);
  const index = sequence.indexOf(wave);

  if (index <= 0) return null;

  return sequence[index - 1];
}

function nextExpectedWaveFor(activeWave) {
  const wave = normalizeWave(activeWave);
  const sequence = sequenceForWave(wave);
  const index = sequence.indexOf(wave);

  if (index < 0) return null;

  if (wave === "W5") {
    return "POST_W5_CORRECTION_OR_COMPLETION_WATCH";
  }

  if (wave === "E") {
    return "TRIANGLE_RESOLUTION_WATCH";
  }

  return sequence[index + 1] || null;
}

function normalizeParentWave(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeWave(raw);
  if (normalized) return normalized;

  // Preserve useful structural parent labels like W5_COMPLETE.
  const s = upper(raw);
  if (s) return s;

  return null;
}

function inferDirection(structure = {}) {
  const raw =
    structure.direction ||
    structure.structuralDirection ||
    structure.trend ||
    structure.bias ||
    null;

  const s = upper(raw);

  if (["UP", "BULLISH", "LONG"].includes(s)) return "UP";
  if (["DOWN", "BEARISH", "SHORT"].includes(s)) return "DOWN";
  if (["SIDEWAYS", "NEUTRAL", "COMPRESSION", "SIDEWAYS_DECISION"].includes(s)) {
    return "NEUTRAL";
  }

  const activeWave = normalizeWave(structure.activeWave || structure.wave);

  if (["W1", "W3", "W5"].includes(activeWave)) return "UP";
  if (["A", "C"].includes(activeWave)) return "DOWN";
  if (["B", "D", "E"].includes(activeWave)) return "NEUTRAL";

  return "NEUTRAL";
}

function inferStage(structure = {}) {
  const raw =
    structure.stage ||
    structure.status ||
    structure.state ||
    structure.lifecycle ||
    null;

  const s = upper(raw);

  // Preserve real Engine 22 stages for Engine 27:
  // ACTIVE, BREAKOUT_CANDIDATE, ACTIVE_CANDIDATE, WATCH,
  // E_COMPLETED_CANDIDATE_TRIANGLE_RESOLUTION_WATCH, etc.
  if (s) return s;

  if (structure.active === true || structure.isActive === true) return "ACTIVE";

  return "ACTIVE";
}

function getMarkPrice(mark) {
  if (!mark || typeof mark !== "object") return null;

  const direct = round2(mark.price ?? mark.p ?? mark.value);
  if (direct !== null) return direct;

  const high = round2(mark.high?.price ?? mark.high?.p);
  if (high !== null) return high;

  const low = round2(mark.low?.price ?? mark.low?.p);
  if (low !== null) return low;

  return null;
}

function getMarkTime(mark) {
  if (!mark || typeof mark !== "object") return null;

  return (
    mark.time ||
    mark.t ||
    mark.timestamp ||
    mark.high?.time ||
    mark.high?.t ||
    mark.low?.time ||
    mark.low?.t ||
    null
  );
}

function getMarkSummary(mark) {
  if (!mark || typeof mark !== "object") return null;

  return {
    price: getMarkPrice(mark),
    time: getMarkTime(mark),
    status: mark.status || mark.maturity || null,
    confidence: mark.confidence || null,
  };
}

function normalizeOneMark({
  mark,
  maturityInfo,
  fallbackSource = "activeStructures",
}) {
  if (!mark && !maturityInfo) return null;

  const status =
    maturityInfo?.status ||
    mark?.status ||
    mark?.maturity ||
    "UNKNOWN";

  const superseded =
    maturityInfo?.superseded === true ||
    maturityInfo?.supersededPreviousMark === true ||
    mark?.superseded === true ||
    mark?.supersededPreviousMark === true ||
    upper(status) === "SUPERSEDED";

  const replaces = maturityInfo?.replaces || mark?.replaces || null;

  return {
    price: round2(
      maturityInfo?.price ??
        mark?.price ??
        mark?.p ??
        mark?.value ??
        getMarkPrice(mark)
    ),

    time:
      maturityInfo?.time ||
      maturityInfo?.timestamp ||
      getMarkTime(mark),

    status,

    confidence:
      maturityInfo?.confidence ??
      mark?.confidence ??
      null,

    maturity: maturityInfo?.maturity || status || "UNKNOWN",

    confirmed:
      maturityInfo?.confirmed === true ||
      mark?.confirmed === true ||
      upper(status) === "CONFIRMED",

    superseded,

    previousMark:
      maturityInfo?.previousMark ||
      mark?.previousMark ||
      replaces ||
      null,

    source:
      maturityInfo?.source ||
      mark?.source ||
      fallbackSource,

    basis:
      maturityInfo?.basis ||
      mark?.basis ||
      null,

    reasonCodes: [
      ...(Array.isArray(mark?.reasonCodes) ? mark.reasonCodes : []),
      ...(Array.isArray(maturityInfo?.reasonCodes)
        ? maturityInfo.reasonCodes
        : []),
    ],
  };
}

function normalizeMarks({ marks = {}, maturityByWave = {} }) {
  const out = {};

  for (const wave of WAVE_MARK_KEYS) {
    out[wave] = normalizeOneMark({
      mark: marks?.[wave] || marks?.[wave.toLowerCase()] || null,
      maturityInfo:
        maturityByWave?.[wave] ||
        maturityByWave?.[wave.toLowerCase()] ||
        null,
    });
  }

  return out;
}

function inferActiveWave(structure = {}, marks = {}) {
  const explicit = normalizeWave(
    structure.activeWave ||
      structure.currentWave ||
      structure.wave ||
      structure.activeLeg
  );

  if (explicit) return explicit;

  const waves = ["E", "D", "C", "B", "A", "W5", "W4", "W3", "W2", "W1"];

  for (const wave of waves) {
    if (marks?.[wave]) return wave;
  }

  return null;
}

function buildEmptyMarks() {
  return WAVE_MARK_KEYS.reduce((acc, wave) => {
    acc[wave] = null;
    return acc;
  }, {});
}

function normalizeCorrectionModel({ structure, marks }) {
  const correction = structure?.correction || null;

  if (!correction || typeof correction !== "object") return null;

  const correctionMarks = normalizeMarks({
    marks:
      correction?.marks ||
      correction?.preferredModel?.marks ||
      correction?.models?.abcdeTriangle?.marks ||
      correction?.models?.abcDown?.manualMarks ||
      {},
    maturityByWave: {},
  });

  const preferredModel =
    correction?.preferredModel && typeof correction.preferredModel === "object"
      ? correction.preferredModel
      : null;

  const modelSource = preferredModel || correction;

  const mergedManualMarks = {
    A:
      marks?.A ||
      correctionMarks?.A ||
      modelSource?.manualMarks?.A ||
      modelSource?.marks?.A ||
      null,
    B:
      marks?.B ||
      correctionMarks?.B ||
      modelSource?.manualMarks?.B ||
      modelSource?.marks?.B ||
      null,
    C:
      marks?.C ||
      correctionMarks?.C ||
      modelSource?.manualMarks?.C ||
      modelSource?.marks?.C ||
      null,
    D:
      marks?.D ||
      correctionMarks?.D ||
      modelSource?.marks?.D ||
      null,
    E:
      marks?.E ||
      correctionMarks?.E ||
      modelSource?.marks?.E ||
      null,
  };

  const manualMarksPresent =
    mergedManualMarks.A !== null ||
    mergedManualMarks.B !== null ||
    mergedManualMarks.C !== null ||
    mergedManualMarks.D !== null ||
    mergedManualMarks.E !== null;

  const fullWrapper =
    correction?.models && typeof correction.models === "object"
      ? correction
      : null;

  return {
    type:
      modelSource.type ||
      correction.preferredType ||
      correction.type ||
      "ABC_DOWN",

    active: modelSource.active === true || correction.active === true,

    direction:
      modelSource.direction ||
      correction.direction ||
      "DOWN",

    parentCompletedWave:
      modelSource.parentCompletedWave ||
      correction.parentCompletedWave ||
      correction.parentWave ||
      structure?.parentWave ||
      null,

    stage:
      modelSource.stage ||
      correction.stage ||
      correction.currentStage ||
      "INACTIVE",

    currentRead:
      modelSource.currentRead ||
      correction.currentRead ||
      null,

    preferredType:
      correction.preferredType ||
      modelSource.preferredType ||
      modelSource.type ||
      null,

    fibAnchors:
      modelSource.fibAnchors ||
      correction.fibAnchors ||
      null,

    parentImpulseFib:
      modelSource.parentImpulseFib ||
      correction.parentImpulseFib ||
      null,

    abcInternalFib:
      modelSource.abcInternalFib ||
      correction.abcInternalFib ||
      null,

    aReactionZone:
      modelSource.aReactionZone ||
      correction.aReactionZone ||
      null,

    bBounceZone:
      modelSource.bBounceZone ||
      correction.bBounceZone ||
      null,

    cProjectionZone:
      modelSource.cProjectionZone ||
      correction.cProjectionZone ||
      null,

    upperTrendline:
      modelSource.upperTrendline ||
      null,

    lowerTrendline:
      modelSource.lowerTrendline ||
      null,

    breakoutRules:
      modelSource.breakoutRules ||
      null,

    invalidationRules:
      Array.isArray(modelSource.invalidationRules)
        ? modelSource.invalidationRules
        : [],

    levels:
      modelSource.levels ||
      correction.levels ||
      null,

    aLeg:
      modelSource.aLeg ||
      correction.aLeg ||
      correctionMarks.A ||
      mergedManualMarks.A ||
      null,

    bLeg:
      modelSource.bLeg ||
      correction.bLeg ||
      correctionMarks.B ||
      mergedManualMarks.B ||
      null,

    cLeg:
      modelSource.cLeg ||
      correction.cLeg ||
      correctionMarks.C ||
      mergedManualMarks.C ||
      null,

    marks:
      modelSource.marks ||
      null,

    manualMarks: mergedManualMarks,
    manualMarksPresent,

    correctionModels: fullWrapper,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE22_CORRECTION_MODEL_NORMALIZED",
      ...(preferredModel ? ["ENGINE22_PREFERRED_CORRECTION_MODEL_SELECTED"] : []),
      ...(Array.isArray(modelSource.reasonCodes) ? modelSource.reasonCodes : []),
      ...(Array.isArray(correction.reasonCodes) ? correction.reasonCodes : []),
    ],
  };
}

function buildInactiveDegreeState(degree) {
  const label = titleCase(degree);

  return {
    degree,
    tf: DEFAULT_TF_BY_DEGREE[degree] || null,
    active: false,
    direction: "NEUTRAL",
    activeWave: null,
    stage: "NO_ACTIVE_MARKS_OR_CONTEXT",
    previousWave: null,
    previousWaveMark: null,
    nextExpectedWave: null,
    currentRead: `${upper(degree)}_NO_ACTIVE_MARKS_OR_CONTEXT`,
    headline: `${label} degree context unavailable`,
    action: "NO_ACTION",
    parentDegree: null,
    parentWave: null,

    noExecution: true,
    noPermissionCreated: true,
    paperTradeCandidate: false,

    marks: buildEmptyMarks(),
    targetModel: null,
    correctionModel: null,
    correctionModels: null,

    warnings: [],
    reasonCodes: ["NO_ACTIVE_MARKS_OR_CONTEXT"],
  };
}

function buildActiveDegreeState({
  degree,
  structure,
  maturityByWave,
  tf,
  currentPrice,
}) {
  const rawMarks = structure?.marks || structure?.waveMarks || {};

  const marks = normalizeMarks({
    marks: rawMarks,
    maturityByWave,
  });

  const activeWave = inferActiveWave(structure, marks);
  const stage = inferStage(structure);
  const direction = inferDirection(structure);

  const previousWave = previousWaveFor(activeWave);
  const nextExpectedWave = nextExpectedWaveFor(activeWave);

  const previousWaveMark =
    previousWave && marks?.[previousWave]
      ? getMarkSummary(marks[previousWave])
      : null;

  const parentDegree =
    normalizeDegree(structure?.parentDegree) ||
    FALLBACK_PARENT_BY_DEGREE[degree] ||
    null;

  const parentWave = normalizeParentWave(structure?.parentWave);

  const label = titleCase(degree);

  const headline =
    structure?.headline ||
    structure?.label ||
    (activeWave
      ? `${label} ${activeWave} ${stage.toLowerCase()}`
      : `${label} degree active`);

  const action =
    structure?.action ||
    (activeWave === "W3"
      ? "TRACK_EXTENSION_DO_NOT_CHASE"
      : activeWave === "W5"
      ? "CONTINUATION_LEG_ACTIVE_DO_NOT_CHASE"
      : ["A", "B", "C", "D", "E"].includes(activeWave)
      ? "TRACK_CORRECTION_STRUCTURE_DO_NOT_CHASE"
      : "TRACK_STRUCTURE_DO_NOT_CHASE");

  const currentRead =
    structure?.currentRead ||
    (activeWave
      ? `${upper(degree)}_${activeWave}_${stage}`
      : `${upper(degree)}_${stage}`);

  const correctionModel = normalizeCorrectionModel({
    structure,
    marks,
  });

  return {
    degree,
    tf:
      structure?.tf ||
      structure?.timeframe ||
      tf ||
      DEFAULT_TF_BY_DEGREE[degree] ||
      null,

    active: true,
    direction,
    activeWave,
    stage,
    previousWave,
    previousWaveMark,
    nextExpectedWave,
    currentRead,

    headline,
    action,

    parentDegree,
    parentWave,

    noExecution: true,
    noPermissionCreated: true,
    paperTradeCandidate: false,

    marks,

    // Extension / retracement display model.
    // Used by Primary, Intermediate, and Minor cards.
    // This is display-only structural context.
    targetModel:
      structure?.targetModel && typeof structure.targetModel === "object"
        ? structure.targetModel
        : null,

     // Preferred compact display model.
     correctionModel,

     // Full wrapper with alternate paths.
     correctionModels:
       structure?.correction?.models && typeof structure.correction.models === "object"
         ? structure.correction
         : null,

     warnings: Array.isArray(structure?.warnings) ? structure.warnings : [],

    reasonCodes: [
      "ENGINE22_DEGREE_STATE_BUILT",
      `${upper(degree)}_DEGREE_STATE_BUILT`,
      ...(correctionModel ? ["ENGINE22_DEGREE_CORRECTION_MODEL_ATTACHED"] : []),
      ...(structure?.correction?.models
        ? ["ENGINE22_DEGREE_CORRECTION_MODELS_WRAPPER_ATTACHED"]
        : []),
      ...(Array.isArray(structure?.reasonCodes) ? structure.reasonCodes : []),
    ],

    currentPrice: round2(currentPrice),
  };
}

export function buildDegreeStates({
  waveFibState = null,
  activeStructures = null,
  markMaturity = null,
  tf = null,
  currentPrice = null,
} = {}) {
  const structures =
    activeStructures ||
    waveFibState?.activeStructures ||
    waveFibState?.activeWaveState?.activeStructures ||
    {};

  const maturityRoot =
    markMaturity ||
    waveFibState?.markMaturity ||
    {};

  const byDegree = maturityRoot?.byDegree || {};

  const out = {};

  for (const degree of DEGREE_ORDER) {
    const structure =
      structures?.[degree] ||
      (degree === "subminute" ? structures?.micro : null) ||
      null;

    if (!structure || typeof structure !== "object") {
      out[degree] = buildInactiveDegreeState(degree);
      continue;
    }

    const activeFlag =
      structure.active === true ||
      structure.isActive === true ||
      structure.activeWave ||
      structure.currentWave ||
      structure.wave ||
      structure.activeLeg ||
      structure.marks ||
      structure.waveMarks ||
      structure.correction;

    if (!activeFlag) {
      out[degree] = buildInactiveDegreeState(degree);
      continue;
    }

    out[degree] = buildActiveDegreeState({
      degree,
      structure,
      maturityByWave: byDegree?.[degree] || {},
      tf,
      currentPrice,
    });
  }

  return attachNestedCorrectionContexts(out);
}

export default buildDegreeStates;
