// Engine 22 Submicro migration shadow.
//
// Purpose:
// Reclassify the legacy lowest blue intraday sequence that was previously
// published as Micro into an additive Submicro shadow contract.
// This does NOT delete or mutate the current Micro contract.
// It exists only to support the approved seven-degree migration:
//
// SUBMICRO -> MICRO -> SUBMINUTE -> MINUTE -> MINOR -> INTERMEDIATE -> PRIMARY
//
// No new Elliott prices or counts are invented here. The shadow copies the
// existing canonical Micro execution context exactly and changes only the
// presentation degree identity for migration review.

export const ENGINE22_SUBMICRO_MIGRATION_SCHEMA =
  "engine22.submicroMigrationShadow.v1";

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function buildSubmicroMigrationShadow({
  microExecutionContext = null,
} = {}) {
  if (
    !microExecutionContext ||
    microExecutionContext.available !== true
  ) {
    return {
      schema: ENGINE22_SUBMICRO_MIGRATION_SCHEMA,
      available: false,
      migrationStatus: "SHADOW_ONLY",
      automationEligible: false,
      reasonCodes: [
        "LEGACY_MICRO_EXECUTION_CONTEXT_UNAVAILABLE",
        "SUBMICRO_MIGRATION_NOT_READY",
      ],
      noPermissionCreated: true,
      noExecution: true,
      noSizing: true,
      noManagement: true,
      noJournalMutation: true,
    };
  }

  return {
    ...clone(microExecutionContext),

    schema: ENGINE22_SUBMICRO_MIGRATION_SCHEMA,
    available: true,

    degree: "SUBMICRO",
    parentDegree: "MICRO",

    migrationStatus: "SHADOW_ONLY",
    automationEligible: false,

    migration: {
      sourceDegree: "MICRO",
      targetDegree: "SUBMICRO",
      sourceContract: "engine22WaveStrategy.microExecutionContext",
      classification:
        "LEGACY_LOWEST_INTRADAY_BLUE_SEQUENCE_RECLASSIFIED_AS_SUBMICRO_SHADOW",
      canonicalPromotionApproved: false,
      requiresTrueMicroParentMapping: true,
      noPriceMutation: true,
      noWaveMutation: true,
    },

    reasonCodes: [
      ...(Array.isArray(microExecutionContext.reasonCodes)
        ? microExecutionContext.reasonCodes
        : []),
      "SUBMICRO_MIGRATION_SHADOW_BUILT",
      "LEGACY_MICRO_BLUE_SEQUENCE_PRESERVED_EXACTLY",
      "TRUE_MICRO_PARENT_NOT_YET_MAPPED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],

    noPermissionCreated: true,
    noExecution: true,
    noSizing: true,
    noManagement: true,
    noJournalMutation: true,
  };
}

export default {
  ENGINE22_SUBMICRO_MIGRATION_SCHEMA,
  buildSubmicroMigrationShadow,
};
