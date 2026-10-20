import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSubmicroMigrationShadow,
} from "../logic/engine22/submicro/buildSubmicroMigrationShadow.js";

function micro(overrides = {}) {
  return {
    available: true,
    sourceCountId: "COUNT-1",
    sequenceId: "SEQ-1",
    canonicalStateVersion: 2,
    revision: 7,
    sourceTimestamp: "2026-10-10T20:00:00.000Z",
    degree: "MICRO",
    parentDegree: "SUBMINUTE",
    parentWave: "W3",
    activeWave: "W2",
    waveDirection: "DOWN",
    lifecycle: "CONFIRMED",
    microTimingState: "TRANSITION_CONFIRMING",
    countStatus: "ACTIVE",
    currentPrice: 7810,
    invalidation: { price: 7782.75 },
    reasonCodes: ["MICRO_EXECUTION_CONTEXT_PROJECTED_FROM_CANONICAL_STATE"],
    ...overrides,
  };
}

test("Submicro shadow preserves the legacy blue-sequence facts exactly", () => {
  const source = micro();
  const out = buildSubmicroMigrationShadow({
    microExecutionContext: source,
  });

  assert.equal(out.available, true);
  assert.equal(out.degree, "SUBMICRO");
  assert.equal(out.parentDegree, "MICRO");
  assert.equal(out.activeWave, source.activeWave);
  assert.equal(out.waveDirection, source.waveDirection);
  assert.equal(out.lifecycle, source.lifecycle);
  assert.equal(out.sourceCountId, source.sourceCountId);
  assert.equal(out.revision, source.revision);
  assert.equal(out.currentPrice, source.currentPrice);
  assert.deepEqual(out.invalidation, source.invalidation);

  assert.equal(out.migrationStatus, "SHADOW_ONLY");
  assert.equal(out.automationEligible, false);
  assert.equal(out.migration.sourceDegree, "MICRO");
  assert.equal(out.migration.targetDegree, "SUBMICRO");
  assert.equal(out.migration.noPriceMutation, true);
  assert.equal(out.migration.noWaveMutation, true);
  assert.equal(out.migration.requiresTrueMicroParentMapping, true);

  assert.equal(out.noPermissionCreated, true);
  assert.equal(out.noExecution, true);
  assert.equal(out.noSizing, true);

  assert.equal(source.degree, "MICRO");
  assert.equal(source.parentDegree, "SUBMINUTE");
});

test("Submicro shadow fails closed when legacy Micro is unavailable", () => {
  const out = buildSubmicroMigrationShadow({
    microExecutionContext: null,
  });

  assert.equal(out.available, false);
  assert.equal(out.migrationStatus, "SHADOW_ONLY");
  assert.equal(out.automationEligible, false);
  assert.ok(out.reasonCodes.includes("SUBMICRO_MIGRATION_NOT_READY"));
});
