// services/core/logic/engine22/wave/corrections/buildAbcCorrectionModel.js
// Engine 22D — Reusable ABC Corrective-Down Model
//
// Purpose:
// Train Engine 22 on reusable ABC-down correction structure after a completed impulse up.
//
// User rule:
// After completed impulse up:
// - A down usually reacts near the 0.50 retracement.
// - B up usually bounces into moving averages / institutional zones.
// - C down often bottoms near the 0.382 retracement.
//
// Safety:
// This is structural watch logic only.
// It does NOT create execution permission.
// It does NOT create Engine 6 allow.
// It does NOT create Engine 15 readiness.
// It does NOT call Engine 8.

const DEGREE_ORDER = ["subminute", "minute", "minor", "intermediate", "primary", "micro"];

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

function normalizeManualMark(mark = null) {
  if (!mark || typeof mark !== "object") return null;

  const status = mark.status || "WATCH";

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
    basis: mark.basis || null,
    reasonCodes: Array.isArray(mark.reasonCodes) ? mark.reasonCodes : [],
  };
}

function inferImpulseStart(structure = {}) {
  const marks = structure?.marks || structure?.waveMarks || {};

  // Best case: W1 has a low/high object. The impulse starts at W1.low.
  const w1Low = toNum(marks?.W1?.low?.price ?? marks?.W1?.low?.p);
  if (w1Low !== null) return w1Low;

  // Some structures store W1 as a direct price.
  const w1Direct = getMarkPrice(marks?.W1);
  if (w1Direct !== null) return w1Direct;

  // Fallbacks if the structure is incomplete.
  const w2 = getMarkPrice(marks?.W2);
  if (w2 !== null) return w2;

  return null;
}

function inferCompletedHigh(structure = {}, parentCompletedWave = "W5") {
  const marks = structure?.marks || structure?.waveMarks || {};

  const wave = upper(parentCompletedWave).includes("W5") ? "W5" : parentCompletedWave;
  const direct = getMarkPrice(marks?.[wave]);
  if (direct !== null) return direct;

  const w5 = getMarkPrice(marks?.W5);
  if (w5 !== null) return w5;

  return null;
}

function buildRetracementLevels({ impulseStart, impulseHigh }) {
  const start = toNum(impulseStart);
  const high = toNum(impulseHigh);

  if (start === null || high === null || high <= start) {
    return {
      ok: false,
      impulseStart: round2(start),
      impulseHigh: round2(high),
      range: null,
      r382: null,
      r500: null,
      reasonCodes: ["ABC_FIB_ANCHORS_INVALID"],
    };
  }

  const range = high - start;

  return {
    ok: true,
    impulseStart: round2(start),
    impulseHigh: round2(high),
    range: round2(range),

    // User-trained ABC-down model:
    // A reacts near 0.50.
    // C often bottoms near 0.382.
    r382: round2(high - range * 0.382),
    r500: round2(high - range * 0.5),

    reasonCodes: ["ABC_FIB_ANCHORS_VALID"],
  };
}

function chooseStage({ manualA, manualB, manualC, currentPrice, levels }) {
  const cConfirmed = manualC?.confirmed === true;
  const bConfirmed = manualB?.confirmed === true;
  const aPresent = manualA !== null;
  const bPresent = manualB !== null;
  const cPresent = manualC !== null;

  if (cConfirmed) return "ABC_COMPLETE_WATCH";
  if (cPresent && upper(manualC?.status) !== "PROJECTED") return "C_WATCH";
  if (bConfirmed || (bPresent && upper(manualB?.status) !== "PROJECTED")) return "C_WATCH";
  if (aPresent) return "B_WATCH";

  const px = toNum(currentPrice);
  const r500 = toNum(levels?.r500);

  if (px !== null && r500 !== null && px <= r500) return "A_REACTION_WATCH";

  return "A_WATCH";
}

function normalizeZoneList(listLike) {
  if (!listLike) return [];

  const arr = Array.isArray(listLike) ? listLike : [listLike];

  return arr
    .filter(Boolean)
    .map((z) => {
      if (typeof z !== "object") return null;

      return {
        label: z.label || z.name || z.type || "ZONE",
        lo: round2(z.lo ?? z.low ?? z.priceLow ?? z.min ?? z.price),
        hi: round2(z.hi ?? z.high ?? z.priceHigh ?? z.max ?? z.price),
        source: z.source || z.kind || "UNKNOWN",
        confidence: z.confidence || null,
      };
    })
    .filter(Boolean);
}

function buildBZoneContext({
  maContext = null,
  institutionalZones = null,
  engine3Reference = null,
} = {}) {
  const manualZones = normalizeZoneList(institutionalZones?.manual || institutionalZones);
  const shelfZones = normalizeZoneList(institutionalZones?.shelves || institutionalZones?.autoShelves);
  const imbalanceZones = normalizeZoneList(
    institutionalZones?.imbalances || institutionalZones?.imbalanceZones
  );

  const maZones = normalizeZoneList(maContext?.zones || maContext?.clusters || maContext);

  const engine3Zones = normalizeZoneList(engine3Reference);

  const zones = [
    ...manualZones.map((z) => ({ ...z, priority: 1 })),
    ...shelfZones.map((z) => ({ ...z, priority: 2 })),
    ...imbalanceZones.map((z) => ({ ...z, priority: 2 })),
    ...maZones.map((z) => ({ ...z, priority: 3 })),
    ...engine3Zones.map((z) => ({ ...z, priority: 4 })),
  ].sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99));

  if (!zones.length) {
    return {
      available: false,
      watchType: "B_BOUNCE_WATCH_NO_ZONE_CONTEXT",
      zones: [],
      reasonCodes: ["B_BOUNCE_WATCH_NO_ZONE_CONTEXT"],
    };
  }

  return {
    available: true,
    watchType: "B_BOUNCE_ZONE_MA_OR_INSTITUTIONAL",
    zones,
    reasonCodes: ["B_BOUNCE_ZONE_CONTEXT_AVAILABLE"],
  };
}

export function buildAbcCorrectionModel({
  symbol = "ES",
  degree = null,
  direction = "DOWN",
  parentCompletedWave = "W5",
  impulseStart = null,
  impulseHigh = null,
  currentPrice = null,
  maContext = null,
  institutionalZones = null,
  engine3Reference = null,
  manualCorrectionMarks = null,
  existingCorrection = null,
} = {}) {
  const existingMarks =
    existingCorrection?.marks && typeof existingCorrection.marks === "object"
      ? existingCorrection.marks
      : {};

  const manualMarks =
    manualCorrectionMarks && typeof manualCorrectionMarks === "object"
      ? manualCorrectionMarks
      : existingMarks;

  const manualA = normalizeManualMark(manualMarks?.A || manualMarks?.a || null);
  const manualB = normalizeManualMark(manualMarks?.B || manualMarks?.b || null);
  const manualC = normalizeManualMark(manualMarks?.C || manualMarks?.c || null);

  const levels = buildRetracementLevels({
    impulseStart,
    impulseHigh,
  });

  const bZoneContext = buildBZoneContext({
    maContext,
    institutionalZones,
    engine3Reference,
  });

  const stage =
    existingCorrection?.stage ||
    chooseStage({
      manualA,
      manualB,
      manualC,
      currentPrice,
      levels,
    });

  return {
    type: "ABC_DOWN",
    active: true,
    symbol,
    degree,
    direction: "DOWN",
    parentCompletedWave,

    stage,
    currentRead:
      existingCorrection?.currentRead ||
      `${upper(degree)}_ABC_DOWN_${stage}`,

    fibAnchors: {
      impulseStart: levels.impulseStart,
      impulseHigh: levels.impulseHigh,
      range: levels.range,
      retracementSource: "IMPULSE_START_LOW_TO_COMPLETED_IMPULSE_HIGH",
      valid: levels.ok === true,
    },

    levels: {
      aReactionFib: "0.50",
      aReactionPrice: levels.r500,
      cCompletionFib: "0.382",
      cCompletionPrice: levels.r382,
    },

    aLeg: manualA || {
      price: levels.r500,
      time: null,
      status: "PROJECTED",
      confidence: levels.ok ? "MODEL" : "LOW",
      maturity: "PROJECTED",
      confirmed: false,
      source: "ABC_MODEL_FIB_050",
      basis: [
        "A_DOWN_USUALLY_REACTS_NEAR_050_RETRACEMENT",
        "STRUCTURAL_WATCH_ONLY",
      ],
      reasonCodes: ["A_REACTION_ZONE_NEAR_050"],
    },

    bLeg: manualB || {
      price: null,
      time: null,
      status: "PROJECTED",
      confidence: bZoneContext.available ? "MODEL_WITH_ZONE_CONTEXT" : "LOW",
      maturity: "PROJECTED",
      confirmed: false,
      source: bZoneContext.available
        ? "MA_OR_INSTITUTIONAL_ZONE_CONTEXT"
        : "ABC_MODEL_NO_B_ZONE_CONTEXT",
      zones: bZoneContext.zones,
      basis: [
        "B_UP_USUALLY_BOUNCES_INTO_MOVING_AVERAGES_OR_INSTITUTIONAL_ZONES",
        "STRUCTURAL_WATCH_ONLY",
      ],
      reasonCodes: [bZoneContext.watchType],
    },

    cLeg: manualC || {
      price: levels.r382,
      time: null,
      status: "PROJECTED",
      confidence: levels.ok ? "MODEL" : "LOW",
      maturity: "PROJECTED",
      confirmed: false,
      source: "ABC_MODEL_FIB_0382",
      basis: [
        "C_DOWN_OFTEN_BOTTOMS_NEAR_0382_RETRACEMENT",
        "STRUCTURAL_WATCH_ONLY",
      ],
      reasonCodes: ["C_COMPLETION_ZONE_NEAR_0382"],
    },

    manualMarks: {
      A: manualA,
      B: manualB,
      C: manualC,
    },

    manualMarksPresent: manualA !== null || manualB !== null || manualC !== null,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "ENGINE22_ABC_CORRECTION_MODEL_BUILT",
      "ABC_DOWN_AFTER_COMPLETED_IMPULSE_UP",
      "A_REACTION_ZONE_NEAR_050",
      bZoneContext.watchType,
      "C_COMPLETION_ZONE_NEAR_0382",
      "STRUCTURAL_WATCH_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
      ...(Array.isArray(levels.reasonCodes) ? levels.reasonCodes : []),
      ...(Array.isArray(existingCorrection?.reasonCodes)
        ? existingCorrection.reasonCodes
        : []),
    ],
  };
}

function shouldBuildAbcForStructure(structure = {}) {
  if (!structure || typeof structure !== "object") return false;

  const activeWave = upper(structure.activeWave);
  const stage = upper(structure.stage);
  const correction = structure.correction;

  if (correction && typeof correction === "object") return true;

  if (activeWave === "W5" && stage === "COMPLETE") return true;

  const w5 = structure?.marks?.W5 || structure?.waveMarks?.W5 || null;
  const w5Status = upper(w5?.status);

  if (w5 && (w5Status === "CONFIRMED" || w5Status === "COMPLETE")) {
    return true;
  }

  return false;
}

export function attachAbcCorrectionModelsToActiveStructures({
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

  const out = {
    ...activeStructures,
  };

  for (const degree of DEGREE_ORDER) {
    const structure = activeStructures?.[degree];
    if (!shouldBuildAbcForStructure(structure)) continue;

    const existingCorrection =
      structure?.correction && typeof structure.correction === "object"
        ? structure.correction
        : null;

    const impulseStart = inferImpulseStart(structure);
    const impulseHigh = inferCompletedHigh(structure, "W5");

    const correctionModel = buildAbcCorrectionModel({
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

    out[degree] = {
      ...structure,
      correction: {
        ...(existingCorrection || {}),
        ...correctionModel,
        type: "ABC_DOWN",
        active: true,
        direction: "DOWN",
        parentCompletedWave: "W5",
        noExecution: true,
        noPermissionCreated: true,
        watchOnly: true,
      },
    };
  }

  return out;
}

export default buildAbcCorrectionModel;
