// services/core/logic/engine22/wave/corrections/buildAbcCorrectionModel.js
// Engine 22D — Reusable ABC Corrective-Down Model
//
// Purpose:
// Train Engine 22 on reusable ABC-down correction structure after a completed impulse up.
//
// Correct long-term model:
// - parentImpulseFib = full completed impulse context.
// - abcInternalFib = internal A-leg retracement map used for B bounce.
// - B bounce watches internal A-leg 0.382 / 0.500 / 0.618 plus confluence.
// - C projection is separate from parent impulse fib.
//
// Safety:
// This is structural watch logic only.
// It does NOT create execution permission.
// It does NOT create Engine 6 allow.
// It does NOT create Engine 15 readiness.
// It does NOT call Engine 8.

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

  const w1Low = toNum(marks?.W1?.low?.price ?? marks?.W1?.low?.p);
  if (w1Low !== null) return w1Low;

  const w1Direct = getMarkPrice(marks?.W1);
  if (w1Direct !== null) return w1Direct;

  const w2 = getMarkPrice(marks?.W2);
  if (w2 !== null) return w2;

  return null;
}

function inferCompletedHigh(structure = {}, parentCompletedWave = "W5") {
  const marks = structure?.marks || structure?.waveMarks || {};

  const wave = upper(parentCompletedWave).includes("W5")
    ? "W5"
    : parentCompletedWave;

  const direct = getMarkPrice(marks?.[wave]);
  if (direct !== null) return direct;

  const w5 = getMarkPrice(marks?.W5);
  if (w5 !== null) return w5;

  return null;
}

function buildParentImpulseFib({ impulseStart, impulseHigh }) {
  const low = toNum(impulseStart);
  const high = toNum(impulseHigh);

  if (low === null || high === null || high <= low) {
    return {
      valid: false,
      purpose: "FULL_PARENT_IMPULSE_CORRECTION_CONTEXT",
      anchorLow: round2(low),
      anchorHigh: round2(high),
      range: null,
      r236: null,
      r382: null,
      r500: null,
      r618: null,
      r786: null,
      reasonCodes: ["PARENT_IMPULSE_FIB_ANCHORS_INVALID"],
    };
  }

  const range = high - low;

  return {
    valid: true,
    purpose: "FULL_PARENT_IMPULSE_CORRECTION_CONTEXT",
    anchorLow: round2(low),
    anchorHigh: round2(high),
    range: round2(range),

    // Retracement down from completed impulse high.
    r236: round2(high - range * 0.236),
    r382: round2(high - range * 0.382),
    r500: round2(high - range * 0.5),
    r618: round2(high - range * 0.618),
    r786: round2(high - range * 0.786),

    reasonCodes: ["PARENT_IMPULSE_FIB_ANCHORS_VALID"],
  };
}

function buildAbcInternalFib({ impulseHigh, aLegLow }) {
  const high = toNum(impulseHigh);
  const low = toNum(aLegLow);

  if (high === null || low === null || high <= low) {
    return {
      valid: false,
      purpose: "B_BOUNCE_RETRACEMENT_OF_A_LEG",
      anchorHigh: round2(high),
      anchorLow: round2(low),
      range: null,
      r236: null,
      r382: null,
      r500: null,
      r618: null,
      r786: null,
      reasonCodes: ["ABC_INTERNAL_FIB_ANCHORS_INVALID_OR_A_MISSING"],
    };
  }

  const range = high - low;

  return {
    valid: true,
    purpose: "B_BOUNCE_RETRACEMENT_OF_A_LEG",
    anchorHigh: round2(high),
    anchorLow: round2(low),
    range: round2(range),

    // B bounce retraces upward from A low toward W5 high.
    r236: round2(low + range * 0.236),
    r382: round2(low + range * 0.382),
    r500: round2(low + range * 0.5),
    r618: round2(low + range * 0.618),
    r786: round2(low + range * 0.786),

    reasonCodes: ["ABC_INTERNAL_FIB_ANCHORS_VALID"],
  };
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

function buildConfluenceContext({
  maContext = null,
  institutionalZones = null,
  engine3Reference = null,
} = {}) {
  const manualZones = normalizeZoneList(
    institutionalZones?.manual || institutionalZones
  );

  const shelfZones = normalizeZoneList(
    institutionalZones?.shelves || institutionalZones?.autoShelves
  );

  const imbalanceZones = normalizeZoneList(
    institutionalZones?.imbalances || institutionalZones?.imbalanceZones
  );

  const maZones = normalizeZoneList(
    maContext?.zones || maContext?.clusters || maContext
  );

  const engine3Zones = normalizeZoneList(engine3Reference);

  const zones = [
    ...manualZones.map((z) => ({ ...z, priority: 1 })),
    ...shelfZones.map((z) => ({ ...z, priority: 2 })),
    ...imbalanceZones.map((z) => ({ ...z, priority: 2 })),
    ...maZones.map((z) => ({ ...z, priority: 3 })),
    ...engine3Zones.map((z) => ({ ...z, priority: 4 })),
  ].sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99));

  return {
    available: zones.length > 0,
    movingAverages: maZones,
    institutionalZones: [...manualZones, ...shelfZones, ...imbalanceZones],
    engine3ReferenceLevels: engine3Zones,
    zones,
    reasonCodes: zones.length
      ? ["ABC_CONFLUENCE_CONTEXT_AVAILABLE"]
      : ["ABC_CONFLUENCE_CONTEXT_UNAVAILABLE"],
  };
}

function buildAReactionZone({ parentImpulseFib, manualA }) {
  return {
    source: "PARENT_IMPULSE_CONTEXT_PLUS_MANUAL_A",
    status: manualA ? manualA.status : "PROJECTED",
    manualMarkPresent: manualA !== null,

    parentFibContext: {
      r382: parentImpulseFib?.r382 ?? null,
      r500: parentImpulseFib?.r500 ?? null,
      r618: parentImpulseFib?.r618 ?? null,
    },

    preferredContext: {
      label: "A_REACTION_PARENT_CONTEXT",
      watchNear: parentImpulseFib?.r500 ?? null,
      note:
        "A often reacts into parent impulse retracement context, but parent 0.50 is not a hard rule.",
    },

    manualA: manualA || null,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "A_REACTION_ZONE_PARENT_IMPULSE_CONTEXT",
      ...(manualA ? ["MANUAL_A_MARK_USED"] : ["NO_MANUAL_A_MARK"]),
    ],
  };
}

function buildBBounceZone({ abcInternalFib, confluenceContext, manualB }) {
  const fibBand =
    abcInternalFib?.valid === true
      ? {
          r382: abcInternalFib.r382,
          r500: abcInternalFib.r500,
          r618: abcInternalFib.r618,
        }
      : {
          r382: null,
          r500: null,
          r618: null,
        };

  const preferredBand =
    abcInternalFib?.valid === true
      ? {
          low: Math.min(
            Number(abcInternalFib.r382),
            Number(abcInternalFib.r618)
          ),
          high: Math.max(
            Number(abcInternalFib.r382),
            Number(abcInternalFib.r618)
          ),
          source: "R382_R618_INTERNAL_A_LEG_RETRACEMENT",
        }
      : {
          low: null,
          high: null,
          source: "ABC_INTERNAL_FIB_UNAVAILABLE",
        };

  return {
    source: "ABC_INTERNAL_A_LEG_RETRACEMENT_PLUS_CONFLUENCE",
    status: manualB ? manualB.status : "PROJECTED",
    manualMarkPresent: manualB !== null,

    fibBand,
    preferredBand,

    confluence: {
      movingAverages: confluenceContext.movingAverages,
      institutionalZones: confluenceContext.institutionalZones,
      engine3ReferenceLevels: confluenceContext.engine3ReferenceLevels,
    },

    manualB: manualB || null,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      abcInternalFib?.valid
        ? "B_BOUNCE_INTERNAL_FIB_BAND_AVAILABLE"
        : "B_BOUNCE_INTERNAL_FIB_BAND_UNAVAILABLE",
      confluenceContext.available
        ? "B_BOUNCE_CONFLUENCE_CONTEXT_AVAILABLE"
        : "B_BOUNCE_WATCH_NO_ZONE_CONTEXT",
      ...(manualB ? ["MANUAL_B_MARK_USED"] : ["NO_MANUAL_B_MARK"]),
    ],
  };
}

function buildCProjectionZone({
  parentImpulseFib,
  abcInternalFib,
  manualA,
  manualB,
  manualC,
}) {
  const aHigh = toNum(abcInternalFib?.anchorHigh);
  const aLow = toNum(abcInternalFib?.anchorLow);
  const bHigh = toNum(manualB?.price);

  const aLength =
    aHigh !== null && aLow !== null && aHigh > aLow ? aHigh - aLow : null;

  const c100 =
    bHigh !== null && aLength !== null ? round2(bHigh - aLength) : null;

  const c1272 =
    bHigh !== null && aLength !== null ? round2(bHigh - aLength * 1.272) : null;

  const c1618 =
    bHigh !== null && aLength !== null ? round2(bHigh - aLength * 1.618) : null;

  return {
    source: "A_LENGTH_PROJECTION_FROM_B_HIGH_PLUS_PARENT_CONTEXT",
    status: manualC ? manualC.status : "PROJECTED",
    manualMarkPresent: manualC !== null,

    projectionFromB:
      bHigh !== null && aLength !== null
        ? {
            bHigh: round2(bHigh),
            aLength: round2(aLength),
            c100,
            c1272,
            c1618,
          }
        : {
            bHigh: round2(bHigh),
            aLength: round2(aLength),
            c100: null,
            c1272: null,
            c1618: null,
            reason: "MANUAL_B_REQUIRED_FOR_C_PROJECTION",
          },

    parentFibConfluence: {
      r382: parentImpulseFib?.r382 ?? null,
      r500: parentImpulseFib?.r500 ?? null,
      r618: parentImpulseFib?.r618 ?? null,
    },

    manualA: manualA || null,
    manualB: manualB || null,
    manualC: manualC || null,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      bHigh !== null
        ? "C_PROJECTION_FROM_MANUAL_B_AVAILABLE"
        : "C_PROJECTION_WAITING_FOR_B_MARK",
      "C_PROJECTION_SEPARATED_FROM_PARENT_FIB",
      ...(manualC ? ["MANUAL_C_MARK_USED"] : ["NO_MANUAL_C_MARK"]),
    ],
  };
}

function chooseStage({ manualA, manualB, manualC, currentPrice, parentImpulseFib }) {
  const cConfirmed = manualC?.confirmed === true;
  const bConfirmed = manualB?.confirmed === true;
  const aPresent = manualA !== null;
  const bPresent = manualB !== null;
  const cPresent = manualC !== null;

  if (cConfirmed) return "ABC_COMPLETE_WATCH";
  if (cPresent && upper(manualC?.status) !== "PROJECTED") return "C_WATCH";
  if (bConfirmed || (bPresent && upper(manualB?.status) !== "PROJECTED")) {
    return "C_WATCH";
  }
  if (aPresent) return "B_WATCH";

  const px = toNum(currentPrice);
  const parentR500 = toNum(parentImpulseFib?.r500);

  if (px !== null && parentR500 !== null && px <= parentR500) {
    return "A_REACTION_WATCH";
  }

  return "A_WATCH";
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

  const parentImpulseFib = buildParentImpulseFib({
    impulseStart,
    impulseHigh,
  });

  const abcInternalFib = buildAbcInternalFib({
    impulseHigh,
    aLegLow: manualA?.price ?? null,
  });

  const confluenceContext = buildConfluenceContext({
    maContext,
    institutionalZones,
    engine3Reference,
  });

  const aReactionZone = buildAReactionZone({
    parentImpulseFib,
    manualA,
  });

  const bBounceZone = buildBBounceZone({
    abcInternalFib,
    confluenceContext,
    manualB,
  });

  const cProjectionZone = buildCProjectionZone({
    parentImpulseFib,
    abcInternalFib,
    manualA,
    manualB,
    manualC,
  });

  const stage =
    existingCorrection?.stage ||
    chooseStage({
      manualA,
      manualB,
      manualC,
      currentPrice,
      parentImpulseFib,
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

    parentImpulseFib,
    abcInternalFib,

    aReactionZone,
    bBounceZone,
    cProjectionZone,

    // Keep these aliases for existing display contracts.
    fibAnchors: {
      impulseStart: parentImpulseFib.anchorLow,
      impulseHigh: parentImpulseFib.anchorHigh,
      range: parentImpulseFib.range,
      retracementSource: "IMPULSE_START_LOW_TO_COMPLETED_IMPULSE_HIGH",
      valid: parentImpulseFib.valid === true,
    },

    // Deprecated. Kept temporarily so older frontend/debug jq does not break.
    levels: null,

    aLeg: manualA || {
      price: parentImpulseFib.r500,
      time: null,
      status: "PROJECTED",
      confidence: parentImpulseFib.valid ? "MODEL" : "LOW",
      maturity: "PROJECTED",
      confirmed: false,
      source: "ABC_MODEL_PARENT_IMPULSE_CONTEXT",
      basis: [
        "A_DOWN_REACTS_IN_PARENT_IMPULSE_RETRACEMENT_CONTEXT",
        "PARENT_050_IS_CONTEXT_NOT_HARD_RULE",
        "STRUCTURAL_WATCH_ONLY",
      ],
      reasonCodes: ["A_REACTION_ZONE_PARENT_IMPULSE_CONTEXT"],
    },

    bLeg: manualB || {
      price: null,
      time: null,
      status: "PROJECTED",
      confidence: abcInternalFib.valid
        ? "MODEL_INTERNAL_FIB_WITH_CONFLUENCE"
        : "LOW",
      maturity: "PROJECTED",
      confirmed: false,
      source: "ABC_INTERNAL_A_LEG_RETRACEMENT",
      fibBand: bBounceZone.fibBand,
      preferredBand: bBounceZone.preferredBand,
      zones: confluenceContext.zones,
      basis: [
        "B_UP_RETRACES_THE_A_LEG_USING_INTERNAL_ABC_FIBS",
        "WATCH_0382_050_0618_PLUS_MA_OR_INSTITUTIONAL_CONFLUENCE",
        "STRUCTURAL_WATCH_ONLY",
      ],
      reasonCodes: bBounceZone.reasonCodes,
    },

    cLeg: manualC || {
      price: null,
      time: null,
      status: "PROJECTED",
      confidence: "LOW",
      maturity: "PROJECTED",
      confirmed: false,
      source: "ABC_C_PROJECTION_PENDING_B_MARK",
      projectionFromB: cProjectionZone.projectionFromB,
      parentFibConfluence: cProjectionZone.parentFibConfluence,
      basis: [
        "C_DOWN_PROJECTS_FROM_B_HIGH_USING_A_LEG_LENGTH",
        "PARENT_IMPULSE_FIBS_AND_INSTITUTIONAL_ZONES_ARE_CONFLUENCE",
        "STRUCTURAL_WATCH_ONLY",
      ],
      reasonCodes: cProjectionZone.reasonCodes,
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
      "PARENT_IMPULSE_FIB_CONTEXT_BUILT",
      parentImpulseFib.valid
        ? "PARENT_IMPULSE_FIB_ANCHORS_VALID"
        : "PARENT_IMPULSE_FIB_ANCHORS_INVALID",
      abcInternalFib.valid
        ? "ABC_INTERNAL_FIB_ANCHORS_VALID"
        : "ABC_INTERNAL_FIB_WAITING_FOR_A_LOW",
      "B_BOUNCE_USES_INTERNAL_A_LEG_RETRACEMENT",
      "C_PROJECTION_SEPARATE_FROM_PARENT_FIB",
      "STRUCTURAL_WATCH_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
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
