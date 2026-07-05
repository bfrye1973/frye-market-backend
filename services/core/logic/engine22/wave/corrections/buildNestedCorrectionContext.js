// services/core/logic/engine22/wave/corrections/buildNestedCorrectionContext.js
// Engine 22 — Nested Correction Context
//
// Purpose:
// Teach Engine 22 how lower-degree corrections relate to parent corrections.
// Example:
// Minor W2 ABCDE triangle has D complete and E watch.
// Minute ABC_DOWN becomes the internal A-B-C structure used to complete Minor E.
//
// This is structural display context only.
// It does NOT create execution permission.
// It does NOT change Engine 6.
// It does NOT change Engine 15.
// It does NOT call Engine 8.

const SOURCE = "engine22.wave.nestedCorrection.v1";

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function getPrice(mark) {
  if (!mark || typeof mark !== "object") return null;
  return round2(mark.price ?? mark.p ?? mark.value);
}

function getMark(model, key) {
  const k = String(key || "").toUpperCase();

  return (
    model?.marks?.[k] ||
    model?.manualMarks?.[k] ||
    model?.[`${k.toLowerCase()}Leg`] ||
    null
  );
}

function hasPrice(mark) {
  return getPrice(mark) != null;
}

function isTriangleModel(model) {
  const type = upper(model?.type || model?.preferredType || "");
  return (
    type.includes("TRIANGLE") ||
    model?.upperTrendline ||
    model?.lowerTrendline ||
    model?.breakoutRules
  );
}

function isAbcDownModel(model) {
  const type = upper(model?.type || model?.preferredType || "");
  const direction = upper(model?.direction || "");

  return type.includes("ABC") && (type.includes("DOWN") || direction === "DOWN");
}

function inferChildStageFromMinuteAbc(minuteModel = {}) {
  const a = getMark(minuteModel, "A");
  const b = getMark(minuteModel, "B");
  const c = getMark(minuteModel, "C");

  if (hasPrice(c)) {
    return {
      currentChildLeg: "C_MARKED_MINOR_E_COMPLETION_CHECK",
      currentRead:
        "Minute C is marked. Check whether Minor E completed and whether triangle resolution begins.",
      nextExpected: "CHECK_MINOR_E_COMPLETION_AND_TRIANGLE_RESOLUTION",
      minuteA: a,
      minuteB: b,
      minuteC: c,
    };
  }

  if (hasPrice(b)) {
    return {
      currentChildLeg: "C_DOWN_WATCH_TO_COMPLETE_MINOR_E",
      currentRead:
        "Minute B is marked. Watch Minute C down as the likely internal leg to complete Minor E.",
      nextExpected: "WATCH_MINUTE_C_DOWN",
      minuteA: a,
      minuteB: b,
      minuteC: c,
    };
  }

  if (hasPrice(a)) {
    return {
      currentChildLeg: "B_UP_COMPLETION_WATCH_THEN_C_DOWN",
      currentRead:
        "Minute A down is marked. Minute B bounce is active or completing; after B, watch C down to complete Minor E.",
      nextExpected: "MARK_OR_CONFIRM_MINUTE_B_THEN_WATCH_C_DOWN",
      minuteA: a,
      minuteB: b,
      minuteC: c,
    };
  }

  return {
    currentChildLeg: "A_DOWN_WATCH",
    currentRead:
      "Minute internal ABC is expected, but Minute A has not been marked yet.",
    nextExpected: "WATCH_MINUTE_A_DOWN",
    minuteA: a,
    minuteB: b,
    minuteC: c,
  };
}

export function buildNestedCorrectionContext({
  parentDegreeState = null,
  childDegreeState = null,
} = {}) {
  const parentModel = parentDegreeState?.correctionModel || null;
  const childModel = childDegreeState?.correctionModel || null;

  if (!parentDegreeState || !childDegreeState) return null;
  if (!isTriangleModel(parentModel)) return null;
  if (!isAbcDownModel(childModel)) return null;

  const parentStage = upper(parentModel?.stage || parentDegreeState?.stage || "");
  const parentMarks = parentModel?.marks || parentModel?.manualMarks || {};

  const parentD = parentMarks?.D || null;
  const parentE = parentMarks?.E || null;

  const dComplete =
    hasPrice(parentD) ||
    parentStage.includes("E_WATCH") ||
    parentStage.includes("BREAKOUT_WATCH");

  const ePending =
    !hasPrice(parentE) ||
    upper(parentE?.status).includes("PROJECTED") ||
    parentStage.includes("E_WATCH");

  if (!dComplete || !ePending) return null;

  const childStage = inferChildStageFromMinuteAbc(childModel);

  return {
    active: true,
    source: SOURCE,

    parentDegree: parentDegreeState.degree || "minor",
    parentActiveWave: parentDegreeState.activeWave || null,
    parentCorrectionType: "ABCDE_TRIANGLE",
    parentCompletedLeg: "D",
    parentActiveLeg: "E",
    parentStage: parentModel?.stage || "E_WATCH",

    childDegree: childDegreeState.degree || "minute",
    childCorrectionType: "ABC_DOWN",
    childPurpose: "INTERNAL_STRUCTURE_TO_COMPLETE_PARENT_E_LEG",

    expectedPath: "A_DOWN_B_UP_C_DOWN",
    currentChildLeg: childStage.currentChildLeg,
    currentRead: childStage.currentRead,
    nextExpected: childStage.nextExpected,
    completionGoal: "COMPLETE_MINOR_E_THEN_WATCH_TRIANGLE_RESOLUTION",

    minuteMarks: {
      A: childStage.minuteA || null,
      B: childStage.minuteB || null,
      C: childStage.minuteC || null,
    },

    parentTriangleMarks: {
      A: parentMarks?.A || null,
      B: parentMarks?.B || null,
      C: parentMarks?.C || null,
      D: parentMarks?.D || null,
      E: parentMarks?.E || null,
    },

    bBounceZone: childModel?.bBounceZone || null,
    cProjectionZone: childModel?.cProjectionZone || null,

    invalidationRules: [
      "IF_PRICE_BREAKS_ABOVE_B_D_RESISTANCE_BEFORE_E_COMPLETES_TRIANGLE_MAY_RESOLVE_UP",
      "IF_PRICE_BREAKS_BELOW_A_C_E_SUPPORT_MINOR_W2_CAN_EXPAND_DEEPER",
      "IF_MINUTE_B_IS_NOT_MARKED_DO_NOT_ASSUME_C_DOWN_CONFIRMED",
    ],

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "NESTED_CORRECTION_CONTEXT_BUILT",
      "PARENT_MINOR_ABCDE_TRIANGLE",
      "PARENT_D_COMPLETE_E_WATCH",
      "CHILD_MINUTE_ABC_DOWN_INTERNAL_TO_MINOR_E",
      childStage.currentChildLeg,
      "STRUCTURAL_DISPLAY_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

export function attachNestedCorrectionContexts(degreeStates = {}) {
  if (!degreeStates || typeof degreeStates !== "object") return degreeStates;

  const out = { ...degreeStates };

  const minor = out.minor || null;
  const minute = out.minute || null;
  const subminute = out.subminute || null;

  const minuteNested = buildNestedCorrectionContext({
    parentDegreeState: minor,
    childDegreeState: minute,
  });

  if (minuteNested) {
    out.minute = {
      ...minute,
      nestedCorrectionContext: minuteNested,
      reasonCodes: [
        ...(Array.isArray(minute?.reasonCodes) ? minute.reasonCodes : []),
        "NESTED_CORRECTION_CONTEXT_ATTACHED",
        "MINUTE_INTERNAL_TO_MINOR_E",
      ],
    };

    if (subminute && typeof subminute === "object") {
      out.subminute = {
        ...subminute,
        nestedCorrectionContext: {
          active: true,
          source: SOURCE,
          parentDegree: "minute",
          parentRole: "TACTICAL_TIMING_FOR_MINOR_E_INTERNAL_ABC",
          parentCurrentRead: minuteNested.currentRead,
          tacticalFocus:
            minuteNested.currentChildLeg === "C_DOWN_WATCH_TO_COMPLETE_MINOR_E"
              ? "WATCH_SUBMINUTE_C_DOWN_PARTICIPATION"
              : "WATCH_SUBMINUTE_B_TOP_OR_REJECTION",
          noExecution: true,
          noPermissionCreated: true,
          watchOnly: true,
          reasonCodes: [
            "SUBMINUTE_NESTED_UNDER_MINUTE_INTERNAL_ABC",
            "TACTICAL_TIMING_ONLY",
            "NO_EXECUTION",
            "NO_PERMISSION_CREATED",
          ],
        },
        reasonCodes: [
          ...(Array.isArray(subminute.reasonCodes) ? subminute.reasonCodes : []),
          "SUBMINUTE_NESTED_CORRECTION_CONTEXT_ATTACHED",
        ],
      };
    }
  }

  return out;
}

export default buildNestedCorrectionContext;
