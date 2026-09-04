// services/core/logic/engine3/v5/diagnostics/buildEngine3Trace.js
//
// Engine 3 v5 — Diagnostic trace builder.
//
// Contract:
// - Assembly-only diagnostic module.
// - Preserves the full reasoning path from Engine 26 location input
//   through timeframe evidence, control, travel state, and canonical output.
// - Does not calculate price action.
// - Does not calculate buyer/seller control.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// Purpose:
// Make every Engine 3 v5 decision explainable from one trace object:
//
// input
//   -> evidence
//   -> approach
//   -> contact
//   -> reaction
//   -> followThrough
//   -> control
//   -> stateMachine
//   -> canonical

const ENGINE = "engine3.v5.diagnostics.buildEngine3Trace.v1";
const SOURCE = "engine3.v5.diagnostics.buildEngine3Trace";

function uniqueReasonCodes(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter(Boolean)
        .map((value) => String(value))
    ),
  ];
}

export function buildEngine3Trace({
  normalizedZoneInput = null,
  oneMinuteEvidence = null,
  fiveMinuteReaction = null,
  tenMinuteContext = null,
  departureState = null,
  ema10TravelState = null,
  stateMachine = null,
  canonical = null,
} = {}) {
  const completed5m =
    fiveMinuteReaction?.completed || null;

  const forming5m =
    fiveMinuteReaction?.current || null;

  return {
    ok: true,

    engine: ENGINE,
    source: SOURCE,

    mode: "DIAGNOSTIC_TRACE_ONLY",

    input: {
      identity:
        normalizedZoneInput?.identity || null,

      lifecycle:
        normalizedZoneInput?.lifecycle || null,

      zone:
        normalizedZoneInput?.zone || null,

      eligible:
        normalizedZoneInput?.eligible === true,

      zoneIdentityMatches:
        normalizedZoneInput?.zoneIdentityMatches === true,

      upstreamExpectation:
        normalizedZoneInput?.upstreamExpectation || null,

      directionalAuthority: {
        engine26LocationAuthority:
          normalizedZoneInput
            ?.directionalAuthority
            ?.engine26LocationAuthority === true,

        engine26DirectionalOpinionAuthority:
          false,

        engine3MustResolveObservedControl:
          true,
      },
    },

    evidence: {
      oneMinute: {
        role:
          oneMinuteEvidence?.role || null,

        canonicalAuthority:
          false,

        current:
          oneMinuteEvidence?.current || null,

        completed:
          oneMinuteEvidence?.completed || null,

        display:
          oneMinuteEvidence?.display || null,
      },

      fiveMinute: {
        role:
          fiveMinuteReaction?.role || null,

        formingAuthority:
          "DIAGNOSTIC_ONLY",

        completedAuthority:
          "MATURE_ZONE_REACTION_CONTROL",

        forming:
          forming5m,

        completed:
          completed5m,

        stateMachineHandoff:
          fiveMinuteReaction?.stateMachineHandoff || null,

        display:
          fiveMinuteReaction?.display || null,
      },

      tenMinute: {
        role:
          tenMinuteContext?.role || null,

        canonicalAuthority:
          false,

        current:
          tenMinuteContext?.current || null,

        completed:
          tenMinuteContext?.completed || null,

        travelEvidence:
          tenMinuteContext?.travelEvidence || null,

        display:
          tenMinuteContext?.display || null,
      },
    },

    approach: {
      completed5m:
        completed5m?.approach || null,

      forming5m:
        forming5m?.approach || null,

      oneMinuteCurrent:
        oneMinuteEvidence?.current?.approach || null,

      tenMinuteCompleted:
        tenMinuteContext?.completed?.approach || null,
    },

    contact: {
      completed5m:
        completed5m?.contact || null,

      forming5m:
        forming5m?.contact || null,

      oneMinuteCurrent:
        oneMinuteEvidence?.current?.contact || null,

      tenMinuteCompleted:
        tenMinuteContext?.completed?.contact || null,
    },

    reaction: {
      completed5m:
        completed5m?.reaction || null,

      forming5m:
        forming5m?.reaction || null,

      oneMinuteCurrent:
        oneMinuteEvidence?.current?.reaction || null,

      tenMinuteCompleted:
        tenMinuteContext?.completed?.reaction || null,
    },

    followThrough: {
      completed5m:
        completed5m?.followThrough || null,

      forming5m:
        forming5m?.followThrough || null,

      oneMinuteCurrent:
        oneMinuteEvidence?.current?.followThrough || null,

      tenMinuteCompleted:
        tenMinuteContext?.completed?.followThrough || null,
    },

    control: {
      completed5m:
        completed5m?.control || null,

      forming5mDiagnosticOnly:
        forming5m?.control || null,

      quality:
        completed5m?.quality || null,

      canonicalControlState:
        fiveMinuteReaction
          ?.stateMachineHandoff
          ?.controlState ||
        null,

      canonicalControlConfidence:
        fiveMinuteReaction
          ?.stateMachineHandoff
          ?.controlConfidence ||
        null,
    },

    travel: {
      departure:
        departureState || null,

      ema10:
        ema10TravelState || null,
    },

    stateMachine: {
      ...(stateMachine || {}),

      soleCanonicalDirectionPublisher:
        stateMachine
          ?.soleCanonicalDirectionPublisher === true,
    },

    canonical: {
      ...(canonical?.canonical || {}),

      publishedContract:
        canonical || null,
    },

    safeguards: {
      oneMinuteCanCreateCanonicalDirection:
        false,

      formingFiveMinuteCanCreateCanonicalDirection:
        false,

      completedFiveMinuteEvidenceAuthority:
        fiveMinuteReaction
          ?.completed5mAuthorizedForStateMachine === true,

      tenMinuteCanCreateInitialCanonicalDirection:
        false,

      departureCanCreateDirectionFromNeutral:
        false,

      ema10CanCreateDirection:
        false,

      ema10CanReverseDirection:
        false,

      stateMachineSoleDirectionPublisher:
        stateMachine
          ?.soleCanonicalDirectionPublisher === true,

      engine4Authority:
        false,

      engine6Authority:
        false,

      noPermissionCreated:
        true,

      noExecution:
        true,
    },

    reasonCodes: uniqueReasonCodes([
      "ENGINE3_V5_TRACE_BUILT",
      "ENGINE3_V5_TRACE_INPUT_PRESERVED",
      "ENGINE3_V5_TRACE_EVIDENCE_PRESERVED",
      "ENGINE3_V5_TRACE_CONTROL_PRESERVED",
      "ENGINE3_V5_TRACE_STATE_MACHINE_PRESERVED",
      "ENGINE3_V5_TRACE_CANONICAL_PRESERVED",
      "ENGINE3_V5_TRACE_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ]),
  };
}

export default buildEngine3Trace;
