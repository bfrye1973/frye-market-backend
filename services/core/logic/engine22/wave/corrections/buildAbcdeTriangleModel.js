// services/core/logic/engine22/wave/corrections/buildAbcdeTriangleModel.js
// Engine 22D — Reusable ABCDE Triangle Correction Model
//
// Purpose:
// Model sideways corrective compression after a completed impulse.
// This is structural watch logic only.
//
// Safety:
// Does NOT create execution permission.
// Does NOT create Engine 6 allow.
// Does NOT create Engine 15 readiness.
// Does NOT call Engine 8.
// Does NOT create Engine 26 tickets.

const TRIANGLE_MARK_KEYS = ["A", "B", "C", "D", "E"];

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function round2(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getMarkPrice(mark) {
  if (!mark || typeof mark !== "object") return null;

  const direct = toNum(mark.price ?? mark.p ?? mark.value);
  if (direct !== null) return direct;

  const high = toNum(mark.high?.price ?? mark.high?.p);
  if (high !== null) return high;

  const low = toNum(mark.low?.price ?? mark.low?.p);
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

function normalizeTriangleMark(mark = null, fallbackStatus = "PROJECTED") {
  if (!mark || typeof mark !== "object") return null;

  const status = mark.status || fallbackStatus;

  return {
    price: round2(getMarkPrice(mark)),
    time: getMarkTime(mark),
    status,
    confidence: mark.confidence || null,
    maturity: mark.maturity || status,
    confirmed: mark.confirmed === true || upper(status) === "CONFIRMED",
    superseded:
      mark.superseded === true ||
      mark.supersededPreviousMark === true ||
      upper(status) === "SUPERSEDED",
    previousMark: mark.previousMark || mark.replaces || null,
    source: mark.source || "activeStructures",
    basis: Array.isArray(mark.basis) ? mark.basis : [],
    reasonCodes: Array.isArray(mark.reasonCodes) ? mark.reasonCodes : [],
  };
}

function normalizeTriangleMarks(rawMarks = {}) {
  const out = {};

  for (const key of TRIANGLE_MARK_KEYS) {
    out[key] = normalizeTriangleMark(
      rawMarks?.[key] || rawMarks?.[key.toLowerCase()] || null,
      key === "E" ? "PROJECTED" : "WATCH"
    );
  }

  return out;
}

function countPresentMarks(marks = {}) {
  return TRIANGLE_MARK_KEYS.filter((key) => marks?.[key]?.price != null).length;
}

function chooseStage(marks = {}) {
  if (marks?.E?.price != null) return "BREAKOUT_WATCH";
  if (marks?.D?.price != null) return "E_WATCH";
  if (marks?.C?.price != null) return "D_WATCH";
  if (marks?.B?.price != null) return "C_WATCH";
  if (marks?.A?.price != null) return "B_WATCH";
  return "A_WATCH";
}

function buildUpperTrendline(marks = {}) {
  const b = marks?.B || null;
  const d = marks?.D || null;

  const anchors = [];
  if (b?.price != null) anchors.push("B");
  if (d?.price != null) anchors.push("D");

  const prices = [b?.price, d?.price]
    .map(toNum)
    .filter((x) => x !== null);

  return {
    anchors,
    resistanceZone: {
      lo: prices.length ? round2(Math.min(...prices)) : null,
      hi: prices.length ? round2(Math.max(...prices)) : null,
    },
    latestResistance: d?.price ?? b?.price ?? null,
    status: anchors.length >= 2 ? "ACTIVE" : "INSUFFICIENT_ANCHORS",
    reasonCodes:
      anchors.length >= 2
        ? ["TRIANGLE_UPPER_TRENDLINE_B_D_ACTIVE"]
        : ["TRIANGLE_UPPER_TRENDLINE_WAITING_FOR_B_D"],
  };
}

function buildLowerTrendline(marks = {}) {
  const a = marks?.A || null;
  const c = marks?.C || null;
  const e = marks?.E || null;

  const anchors = [];
  if (a?.price != null) anchors.push("A");
  if (c?.price != null) anchors.push("C");
  if (e?.price != null) anchors.push("E");

  const prices = [a?.price, c?.price, e?.price]
    .map(toNum)
    .filter((x) => x !== null);

  return {
    anchors,
    supportZone: {
      lo: prices.length ? round2(Math.min(...prices)) : null,
      hi: prices.length ? round2(Math.max(...prices)) : null,
    },
    latestSupport: e?.price ?? c?.price ?? a?.price ?? null,
    status: anchors.length >= 2 ? "ACTIVE" : "INSUFFICIENT_ANCHORS",
    reasonCodes:
      anchors.length >= 2
        ? ["TRIANGLE_LOWER_TRENDLINE_A_C_E_ACTIVE"]
        : ["TRIANGLE_LOWER_TRENDLINE_WAITING_FOR_A_C_E"],
  };
}

function inferPreferredType({ marks, active = true } = {}) {
  const present = countPresentMarks(marks);

  if (!active) return "INACTIVE";
  if (present >= 4) return "ABCDE_TRIANGLE";
  if (present >= 3) return "ABCDE_TRIANGLE_CANDIDATE";

  return "TRIANGLE_WATCH";
}

export function buildAbcdeTriangleModel({
  symbol = "ES",
  degree = null,
  parentCompletedWave = "W5",
  currentPrice = null,
  manualTriangleMarks = null,
  existingCorrection = null,
} = {}) {
  const rawTriangle =
    existingCorrection?.triangle && typeof existingCorrection.triangle === "object"
      ? existingCorrection.triangle
      : existingCorrection?.abcdeTriangle &&
        typeof existingCorrection.abcdeTriangle === "object"
      ? existingCorrection.abcdeTriangle
      : existingCorrection?.models?.abcdeTriangle &&
        typeof existingCorrection.models.abcdeTriangle === "object"
      ? existingCorrection.models.abcdeTriangle
      : null;

  const rawMarks =
    manualTriangleMarks ||
    rawTriangle?.marks ||
    existingCorrection?.triangleMarks ||
    {};

  const marks = normalizeTriangleMarks(rawMarks);
  const stage = rawTriangle?.stage || chooseStage(marks);
  const upperTrendline = buildUpperTrendline(marks);
  const lowerTrendline = buildLowerTrendline(marks);
  const presentCount = countPresentMarks(marks);

  const active =
    rawTriangle?.active === true ||
    presentCount >= 2 ||
    existingCorrection?.preferredType === "ABCDE_TRIANGLE";

  return {
    type: "ABCDE_TRIANGLE",
    active,
    symbol,
    degree,
    parentCompletedWave,

    stage,
    currentRead:
      rawTriangle?.currentRead ||
      `${upper(degree)}_ABCDE_TRIANGLE_${stage}`,

    preferredType: inferPreferredType({ marks, active }),

    marks,

    upperTrendline,
    lowerTrendline,

    breakoutRules: {
      bullish: "BREAK_ABOVE_B_D_RESISTANCE",
      bearish: "BREAK_BELOW_A_C_E_SUPPORT",
      bullishReference: upperTrendline.latestResistance,
      bearishReference: lowerTrendline.latestSupport,
    },

    invalidationRules: [
      "TRIANGLE_INVALID_IF_PRICE_EXPANDS_DIRECTIONALLY_WITHOUT_COMPRESSION",
      "TRIANGLE_INVALID_IF_SUPPORT_BREAKS_AND_C_LEG_ACCELERATES",
      "TRIANGLE_INVALID_IF_RESISTANCE_BREAKS_AND_CONTINUATION_RECLAIM_CONFIRMS",
    ],

    currentPrice: round2(currentPrice),

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE22_ABCDE_TRIANGLE_MODEL_BUILT",
      presentCount >= 4
        ? "TRIANGLE_A_B_C_D_MARKS_PRESENT"
        : "TRIANGLE_PARTIAL_MARKS_PRESENT",
      stage,
      ...upperTrendline.reasonCodes,
      ...lowerTrendline.reasonCodes,
      "STRUCTURAL_WATCH_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
      ...(Array.isArray(rawTriangle?.reasonCodes) ? rawTriangle.reasonCodes : []),
    ],
  };
}

export default buildAbcdeTriangleModel;
