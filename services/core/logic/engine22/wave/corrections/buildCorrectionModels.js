// services/core/logic/engine22/wave/corrections/buildCorrectionModels.js
// Engine 22D — Correction Model Wrapper
//
// Purpose:
// Carry multiple valid correction paths at once.
// Preferred model drives compact dashboard display.
// Alternate models remain available for full strategy context.
//
// Supported:
// - ABC_DOWN
// - ABCDE_TRIANGLE

import { buildAbcCorrectionModel } from "./buildAbcCorrectionModel.js";
import { buildAbcdeTriangleModel } from "./buildAbcdeTriangleModel.js";

const DEGREE_ORDER = [
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
  "micro",
];

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function getMarkPrice(mark) {
  if (!mark || typeof mark !== "object") return null;

  const direct = Number(mark.price ?? mark.p ?? mark.value);
  if (Number.isFinite(direct)) return direct;

  const high = Number(mark.high?.price ?? mark.high?.p);
  if (Number.isFinite(high)) return high;

  const low = Number(mark.low?.price ?? mark.low?.p);
  if (Number.isFinite(low)) return low;

  return null;
}

function inferImpulseStart(structure = {}) {
  const marks = structure?.marks || structure?.waveMarks || {};

  const w1Low = Number(marks?.W1?.low?.price ?? marks?.W1?.low?.p);
  if (Number.isFinite(w1Low)) return w1Low;

  const w1Direct = getMarkPrice(marks?.W1);
  if (Number.isFinite(w1Direct)) return w1Direct;

  const w2 = getMarkPrice(marks?.W2);
  if (Number.isFinite(w2)) return w2;

  return null;
}

function inferCompletedHigh(structure = {}, parentCompletedWave = "W5") {
  const marks = structure?.marks || structure?.waveMarks || {};

  const wave = upper(parentCompletedWave).includes("W5")
    ? "W5"
    : parentCompletedWave;

  const direct = getMarkPrice(marks?.[wave]);
  if (Number.isFinite(direct)) return direct;

  const w5 = getMarkPrice(marks?.W5);
  if (Number.isFinite(w5)) return w5;

  return null;
}

function shouldBuildCorrectionsForStructure(structure = {}) {
  if (!structure || typeof structure !== "object") return false;

  const correction = structure.correction;
  if (correction && typeof correction === "object") return true;

  const activeWave = upper(structure.activeWave);
  const stage = upper(structure.stage);

  if (activeWave === "W5" && stage === "COMPLETE") return true;

  const w5 = structure?.marks?.W5 || structure?.waveMarks?.W5 || null;
  const w5Status = upper(w5?.status);

  if (w5 && (w5Status === "CONFIRMED" || w5Status === "COMPLETE")) {
    return true;
  }

  return false;
}

function choosePreferredType({
  existingCorrection = null,
  abcDown = null,
  abcdeTriangle = null,
} = {}) {
  const explicit = upper(existingCorrection?.preferredType);
  if (explicit === "ABCDE_TRIANGLE") return "ABCDE_TRIANGLE";
  if (explicit === "ABC_DOWN") return "ABC_DOWN";

  if (abcdeTriangle?.active === true) {
    const stage = upper(abcdeTriangle.stage);
    const reasonCodes = Array.isArray(abcdeTriangle.reasonCodes)
      ? abcdeTriangle.reasonCodes
      : [];

    if (
      stage === "E_WATCH" ||
      stage === "BREAKOUT_WATCH" ||
      reasonCodes.includes("TRIANGLE_A_B_C_D_MARKS_PRESENT")
    ) {
      return "ABCDE_TRIANGLE";
    }
  }

  if (abcDown?.active === true) return "ABC_DOWN";
  if (abcdeTriangle?.active === true) return "ABCDE_TRIANGLE";

  return "NONE";
}

function buildCorrectionWrapper({
  symbol,
  degree,
  structure,
  currentPrice,
  maContext,
  institutionalZones,
  engine3Reference,
} = {}) {
  const existingCorrection =
    structure?.correction && typeof structure.correction === "object"
      ? structure.correction
      : null;

  const impulseStart = inferImpulseStart(structure);
  const impulseHigh = inferCompletedHigh(structure, "W5");

  const abcDown = buildAbcCorrectionModel({
    symbol,
    degree,
    direction: "DOWN",
    parentCompletedWave: "W5",
    impulseStart,
    impulseHigh,
    currentPrice,
    maContext,
    institutionalZones,
    engine3Reference,
    manualCorrectionMarks: existingCorrection?.marks || null,
    existingCorrection,
  });

  const abcdeTriangle = buildAbcdeTriangleModel({
    symbol,
    degree,
    parentCompletedWave: "W5",
    currentPrice,
    manualTriangleMarks:
      existingCorrection?.triangle?.marks ||
      existingCorrection?.abcdeTriangle?.marks ||
      existingCorrection?.triangleMarks ||
      null,
    existingCorrection,
  });

  const preferredType = choosePreferredType({
    existingCorrection,
    abcDown,
    abcdeTriangle,
  });

  const preferredModel =
    preferredType === "ABCDE_TRIANGLE"
      ? abcdeTriangle
      : preferredType === "ABC_DOWN"
      ? abcDown
      : null;

  const alternateModels =
    preferredType === "ABCDE_TRIANGLE"
      ? { abcDown }
      : preferredType === "ABC_DOWN"
      ? { abcdeTriangle }
      : {};

  return {
    active: preferredModel?.active === true,
    preferredType,
    models: {
      abcDown,
      abcdeTriangle,
    },
    preferredModel,
    alternateModels,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE22_CORRECTION_MODELS_WRAPPER_BUILT",
      preferredType ? `PREFERRED_${preferredType}` : "NO_PREFERRED_CORRECTION",
      "MULTI_CORRECTION_PATHS_SUPPORTED",
      "STRUCTURAL_WATCH_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

export function attachCorrectionModelsToActiveStructures({
  symbol = "ES",
  activeStructures = {},
  currentPrice = null,
  maContext = null,
  institutionalZones = null,
  engine3Reference = null,
} = {}) {
  if (!activeStructures || typeof activeStructures !== "object") {
    return {};
  }

  const out = { ...activeStructures };

  for (const degree of DEGREE_ORDER) {
    const structure = activeStructures?.[degree];
    if (!shouldBuildCorrectionsForStructure(structure)) continue;

    const wrapper = buildCorrectionWrapper({
      symbol,
      degree,
      structure,
      currentPrice,
      maContext,
      institutionalZones,
      engine3Reference,
    });

    out[degree] = {
      ...structure,
      correction: {
        ...(structure?.correction || {}),
        ...wrapper,
        active: wrapper.active === true,
        noExecution: true,
        noPermissionCreated: true,
        watchOnly: true,
      },
    };
  }

  return out;
}

export default buildCorrectionWrapper;
