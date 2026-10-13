// services/core/logic/engine27/v3/buildTraderIntelligenceV3.js
//
// Engine 27 V3 — seven structural wavelengths / six strategy accounts.
//
// Manager-approved architecture (2026-10-11):
// - Structural wavelengths:
//   Submicro -> Micro -> Subminute -> Minute -> Minor -> Intermediate -> Primary.
// - Trading accounts remain six.
// - INTRADAY will ultimately be owned by Submicro.
// - Micro becomes the immediate parent context for Intraday.
// - Existing Engine 27 V2 remains frozen and unchanged during migration.
// - Engine 22 remains absolute owner of Elliott structural truth.
//
// IMPORTANT:
// The fast intraday sequence currently published through the legacy Micro lane
// is reclassified here as Submicro for presentation/migration analysis only.
// The true parent Micro structure is intentionally NOT invented. It remains
// unavailable until Engine 22 publishes that structure canonically.

import {
  buildEngine27TraderIntelligenceV2,
} from "../v2/buildTraderIntelligenceV2.js";

const DEGREE_ORDER = Object.freeze([
  "submicro",
  "micro",
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
]);

function clone(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function unavailableMicro() {
  return {
    degree: "micro",
    label: "Micro",
    activeWave: "NOT_PUBLISHED",
    waveDirection: null,
    currentCondition: "STRUCTURE_MAPPING_REQUIRED",
    potentialCompletion: {
      nextLevel: null,
      levels: [],
      summary:
        "True parent Micro structure is not yet canonically published. No structural price is invented.",
    },
    confirmationNeeded: {
      status: "NOT_PUBLISHED",
      evidence: [],
      rule: null,
      note:
        "Micro parent mapping must be supplied by Engine 22 before this degree can become authoritative.",
    },
    invalidation: {
      price: null,
      displayText: null,
      reviewRule: null,
      failureRule: null,
    },
    parentContext: {
      parentDegree: "subminute",
      parentWave: null,
      displayText:
        "Micro is the immediate parent of Submicro and child of Subminute.",
    },
    traderRead: {
      headline: "Micro parent structure mapping required",
      summary:
        "Engine 27 will not infer or fabricate the true Micro count during migration.",
      rules: [
        "Engine 22 owns the Micro count.",
        "Do not promote the legacy fast intraday sequence back to Micro.",
      ],
    },
    provenance: {
      structuralSource: "NOT_PUBLISHED",
      sourceMap: {
        activeWave: "NOT_PUBLISHED",
        waveDirection: "NOT_PUBLISHED",
        currentCondition: "MIGRATION_GUARDRAIL",
        potentialCompletion: "NOT_PUBLISHED",
        invalidation: "NOT_PUBLISHED",
        parentContext: "MANAGER_APPROVED_DEGREE_HIERARCHY",
      },
      confirmationStatus: "NOT_PUBLISHED",
      freshness: {
        status: "TIMESTAMP_UNAVAILABLE",
        snapshotTimestamp: null,
        evidenceTimestamp: null,
      },
    },
    noPermissionCreated: true,
    noSizingCreated: true,
    noGeometryCreated: true,
    noExecution: true,
    noJournalWrite: true,
  };
}

export function buildEngine27TraderIntelligenceV3({ snapshot } = {}) {
  const v2 = buildEngine27TraderIntelligenceV2({ snapshot });
  const legacyMicro = clone(v2?.degrees?.micro || null);

  const submicro = legacyMicro
    ? {
        ...legacyMicro,
        degree: "submicro",
        label: "Submicro",
        migration: {
          status: "RECLASSIFIED_FROM_LEGACY_MICRO",
          sourceDegree: "micro",
          targetDegree: "submicro",
          reason:
            "Fast intraday blue sequence is the wavelength used to track intraday movement; Micro is its immediate parent.",
          structuralAuthority: "ENGINE22",
          pricesRecalculated: false,
        },
        parentContext: {
          ...(legacyMicro.parentContext || {}),
          parentDegree: "micro",
          parentWave: null,
          displayText:
            "Submicro is the Intraday structural wavelength. Micro is its immediate parent context.",
        },
      }
    : {
        degree: "submicro",
        label: "Submicro",
        activeWave: "NOT_PUBLISHED",
        waveDirection: null,
        currentCondition: "LEGACY_INTRADAY_SEQUENCE_UNAVAILABLE",
        potentialCompletion: { nextLevel: null, levels: [], summary: "No Submicro structure is currently published." },
        confirmationNeeded: { status: "NOT_PUBLISHED", evidence: [], rule: null, note: null },
        invalidation: { price: null, displayText: null, reviewRule: null, failureRule: null },
        parentContext: { parentDegree: "micro", parentWave: null, displayText: null },
        traderRead: { headline: "Submicro unavailable", summary: "No fast intraday structural sequence is currently published.", rules: [] },
        provenance: {
          structuralSource: "NOT_PUBLISHED",
          sourceMap: {},
          confirmationStatus: "NOT_PUBLISHED",
          freshness: { status: "TIMESTAMP_UNAVAILABLE", snapshotTimestamp: null, evidenceTimestamp: null },
        },
        noPermissionCreated: true,
        noSizingCreated: true,
        noGeometryCreated: true,
        noExecution: true,
        noJournalWrite: true,
      };

  const degrees = {
    submicro,
    micro: unavailableMicro(),
    subminute: clone(v2?.degrees?.subminute),
    minute: clone(v2?.degrees?.minute),
    minor: clone(v2?.degrees?.minor),
    intermediate: clone(v2?.degrees?.intermediate),
    primary: clone(v2?.degrees?.primary),
  };

  return {
    active: v2?.active === true,
    engine: "engine27.traderIntelligenceV3.v1",
    mode: "READ_ONLY_MIGRATION",
    symbol: v2?.symbol ?? null,
    builtAt: new Date().toISOString(),
    degreeOrder: [...DEGREE_ORDER],
    degrees,

    strategyArchitecture: {
      strategyAccountCount: 6,
      structuralDegreeCount: 7,
      intraday: {
        plannedStructuralOwner: "SUBMICRO",
        immediateParentContext: "MICRO",
        migrationAppliedToAccountRouting: false,
      },
      subminute: { structuralOwner: "SUBMINUTE" },
      minute: { structuralOwner: "MINUTE" },
      minor: { structuralOwner: "MINOR" },
      intermediate: { structuralOwner: "INTERMEDIATE" },
      primary: { structuralOwner: "PRIMARY" },
    },

    migration: {
      v2Frozen: true,
      v2ProductionBehaviorChanged: false,
      legacyFastSequenceReclassifiedAs: "SUBMICRO",
      trueMicroParentMapped: false,
      accountRoutingChanged: false,
      frontendSwitched: false,
      nextGate:
        "ENGINE22_TRUE_MICRO_PARENT_MAPPING_AND_MANAGER_ACCEPTANCE",
    },

    architecture: clone(v2?.architecture || {}),
    noPermissionCreated: true,
    noSizingCreated: true,
    noGeometryCreated: true,
    noTicketCreated: true,
    noExecution: true,
    noJournalWrite: true,

    reasonCodes: [
      "ENGINE27_V3_SEVEN_STRUCTURAL_DEGREES_SIX_STRATEGIES",
      "LEGACY_FAST_MICRO_SEQUENCE_RECLASSIFIED_SUBMICRO",
      "TRUE_MICRO_PARENT_NOT_INVENTED",
      "ENGINE27_V2_FROZEN",
      "ENGINE22_STRUCTURAL_AUTHORITY_PRESERVED",
      "NO_ACCOUNT_ROUTING_CHANGE_YET",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine27TraderIntelligenceV3;
