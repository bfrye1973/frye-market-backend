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

const DEGREE_ORDER = ["subminute", "minute", "minor", "intermediate", "primary"];

const WAVE_MARK_KEYS = ["W1", "W2", "W3", "W4", "W5", "A", "B", "C"];

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

  return null;
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

  const activeWave = normalizeWave(structure.activeWave || structure.wave);

  if (["W1", "W3", "W5"].includes(activeWave)) return "UP";
  if (["A", "C"].includes(activeWave)) return "DOWN";

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

  if (s.includes("COMPLETE")) return "COMPLETE";
  if (s.includes("WATCH")) return "WATCH";
  if (s.includes("ACTIVE")) return "ACTIVE";
  if (s.includes("PROJECTED")) return "PROJECTED";
  if (s.includes("INVALID")) return "INVALIDATED";

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

  const waves = ["C", "B", "A", "W5", "W4", "W3", "W2", "W1"];

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
    marks: correction?.marks || {},
    maturityByWave: {},
  });

  const mergedManualMarks = {
    A: marks?.A || correctionMarks?.A || null,
    B: marks?.B || correctionMarks?.B || null,
    C: marks?.C || correctionMarks?.C || null,
  };

  const manualMarksPresent =
    mergedManualMarks.A !== null ||
    mergedManualMarks.B !== null ||
    mergedManualMarks.C !== null;

  return {
    type: correction.type || "ABC_DOWN",
    active: correction.active === true,
    direction: correction.direction || "DOWN",
    parentCompletedWave:
      correction.parentCompletedWave ||
      correction.parentWave ||
      structure?.parentWave ||
      null,

    stage:
      correction.stage ||
      correction.currentStage ||
      "INACTIVE",

    currentRead:
      correction.currentRead ||
      null,

    fibAnchors: correction.fibAnchors || null,

    parentImpulseFib: correction.parentImpulseFib || null,
    abcInternalFib: correction.abcInternalFib || null,
    aReactionZone: correction.aReactionZone || null,
    bBounceZone: correction.bBounceZone || null,
    cProjectionZone: correction.cProjectionZone || null,

    levels: correction.levels || null,

    aLeg:
      correction.aLeg ||
      correctionMarks.A ||
      mergedManualMarks.A ||
      null,

    bLeg:
      correction.bLeg ||
      correctionMarks.B ||
      mergedManualMarks.B ||
      null,

    cLeg:
      correction.cLeg ||
      correctionMarks.C ||
      mergedManualMarks.C ||
      null,

    manualMarks: mergedManualMarks,
    manualMarksPresent,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE22_CORRECTION_MODEL_NORMALIZED",
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
    currentRead: `${upper(degree)}_NO_ACTIVE_MARKS_OR_CONTEXT`,
    headline: `${label} degree context unavailable`,
    action: "NO_ACTION",
    parentDegree: null,
    parentWave: null,

    noExecution: true,
    noPermissionCreated: true,
    paperTradeCandidate: false,

    marks: buildEmptyMarks(),
    correctionModel: null,

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
      : ["A", "B", "C"].includes(activeWave)
      ? "TRACK_ABC_CORRECTION_DO_NOT_CHASE"
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
    currentRead,

    headline,
    action,

    parentDegree,
    parentWave,

    noExecution: true,
    noPermissionCreated: true,
    paperTradeCandidate: false,

    marks,
    correctionModel,

    warnings: Array.isArray(structure?.warnings) ? structure.warnings : [],

    reasonCodes: [
      "ENGINE22_DEGREE_STATE_BUILT",
      `${upper(degree)}_DEGREE_STATE_BUILT`,
      ...(correctionModel ? ["ENGINE22_DEGREE_CORRECTION_MODEL_ATTACHED"] : []),
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

  return out;
}

export default buildDegreeStates;
