import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveEngine29BiggerPictureCharacter,
} from "../logic/engine29/aggregate/resolveBiggerPictureCharacter.js";

function participation({
  freshnessState = "FRESH",
  sessionActive = true,
  pressureLabel = "LOW",
  persistenceConfirmed = true,
  breadthLabel = "BREADTH_PARTICIPATION_HEALTHY",
} = {}) {
  return {
    contractValid: true,
    distribution: {
      canonicalEngine: "engine25.distributionPressure.v2",
      pressureLabel,
      persistence: {
        confirmed: persistenceConfirmed,
      },
    },
    breadth: {
      label: breadthLabel,
    },
    freshness: {
      state: freshnessState,
      equityScannerSession: {
        active: sessionActive,
      },
    },
  };
}

test("healthy breadth plus low distribution is SUPPORTIVE during active session", () => {
  const r = resolveEngine29BiggerPictureCharacter({
    structuralState: "NORMAL",
    structuralParticipation: participation(),
  });

  assert.equal(r.state, "SUPPORTIVE");
  assert.equal(r.currentParticipationPromotionEligible, true);
});

test("weakening breadth or watch/elevated distribution produces NARROWING", () => {
  const byBreadth = resolveEngine29BiggerPictureCharacter({
    structuralState: "EARLY_WARNING",
    structuralParticipation: participation({
      pressureLabel: "LOW",
      breadthLabel: "BREADTH_PARTICIPATION_MIXED_WEAKENING",
    }),
  });

  const byDistribution = resolveEngine29BiggerPictureCharacter({
    structuralState: "NORMAL",
    structuralParticipation: participation({
      pressureLabel: "ELEVATED",
      breadthLabel: "BREADTH_PARTICIPATION_MIXED",
    }),
  });

  assert.equal(byBreadth.state, "NARROWING");
  assert.equal(byDistribution.state, "NARROWING");
});

test("HIGH/EXTREME distribution requires Engine25 persistence for DISTRIBUTION_PRESSURE", () => {
  const confirmed = resolveEngine29BiggerPictureCharacter({
    structuralState: "EARLY_WARNING",
    structuralParticipation: participation({
      pressureLabel: "HIGH",
      persistenceConfirmed: true,
      breadthLabel: "BREADTH_PARTICIPATION_WEAK",
    }),
  });

  const pending = resolveEngine29BiggerPictureCharacter({
    structuralState: "EARLY_WARNING",
    structuralParticipation: participation({
      pressureLabel: "HIGH",
      persistenceConfirmed: false,
      breadthLabel: "BREADTH_PARTICIPATION_MIXED",
    }),
  });

  assert.equal(confirmed.state, "DISTRIBUTION_PRESSURE");
  assert.notEqual(pending.state, "DISTRIBUTION_PRESSURE");
});

test("Engine29 structural broad deterioration outranks participation character", () => {
  const r = resolveEngine29BiggerPictureCharacter({
    structuralState: "RISK_OFF_CONFIRMED",
    structuralParticipation: participation({
      pressureLabel: "LOW",
      breadthLabel: "BREADTH_PARTICIPATION_HEALTHY",
    }),
  });

  assert.equal(r.state, "BROAD_DETERIORATION");
  assert.equal(r.reason, "ENGINE29_STRUCTURAL_DETERIORATION_CONFIRMED");
});

test("closed-session last-valid participation remains diagnostic only", () => {
  const r = resolveEngine29BiggerPictureCharacter({
    structuralState: "EARLY_WARNING",
    structuralParticipation: participation({
      freshnessState: "LAST_VALID_EQUITY_READ",
      sessionActive: false,
      pressureLabel: "EXTREME",
      persistenceConfirmed: true,
      breadthLabel: "BREADTH_PARTICIPATION_WEAK",
    }),
  });

  assert.equal(r.state, "STRUCTURE_ONLY");
  assert.equal(r.currentParticipationPromotionEligible, false);
  assert.equal(
    r.participationDiagnostic.state,
    "DISTRIBUTION_PRESSURE"
  );
});

test("Engine25 contract failure cannot create participation character", () => {
  const p = participation();
  p.contractValid = false;

  const r = resolveEngine29BiggerPictureCharacter({
    structuralState: "NORMAL",
    structuralParticipation: p,
  });

  assert.equal(r.state, "STRUCTURE_ONLY");
  assert.equal(r.currentParticipationPromotionEligible, true);
  assert.equal(r.participationDiagnostic.state, null);
});
