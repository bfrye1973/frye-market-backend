// Engine 8 — additive, read-only resolution of the legacy one-time PAPER trial lock.
//
// The legacy acceptance record is immutable audit evidence. This module must
// never reset it, infer an operator decision from missing data, or permit a
// completed trial to bypass an explicit operator disable.
//
// An existing trial-closed flag may be bypassed for a DIFFERENT candidate only
// when the record has recognizable final-close provenance AND the operator has
// separately authorized the continuous-PAPER compatibility mode.
//
// Engine 6 (not Engine 8) is responsible for the trade decision. This module
// only resolves an execution authorization / legacy-state compatibility issue.

function id(value) {
  return String(value ?? "").trim();
}

function provenLegacyTrialClose(state) {
  if (!id(state?.tradeId) || !id(state?.executionId) ||
      !id(state?.candidateId) || !id(state?.planId) ||
      !id(state?.closedAt)) return false;

  if (state.reason === "ENGINE10_CLOSED_ACKNOWLEDGED") {
    // Durable Engine 8 duplicate-state writer's legacy completion marker.
    return true;
  }

  if (state.reason === "ENGINE10_CONFIRMED_FINAL_CLOSE") {
    // Legacy lifecycle writer includes the explicit Engine 10 close receipt.
    return state.journalCompleted === true &&
      state.engine10Status === "CLOSED" &&
      state.remainingQty === 0;
  }

  return false;
}

export function resolveEngine8PaperAcceptanceEligibility({
  state = null,
  storePresent = false,
  candidateId = null,
  planId = null,
  continuousPaperAuthorized = false,
  operatorPaperDisabled = false,
} = {}) {
  const fail = (reason) => ({
    allowed: false,
    reason,
    priorTrialCompleted: state?.acceptanceTradeCompleted === true,
    priorTrialProven: false,
  });
  if (operatorPaperDisabled === true) return fail("ENGINE8_OPERATOR_PAPER_ORDERS_DISABLED");
  if (storePresent !== true || !state || typeof state !== "object" ||
      Array.isArray(state)) return fail("PAPER_ACCEPTANCE_STATE_UNAVAILABLE");
  if (typeof state.acceptanceTradeCompleted !== "boolean" ||
      typeof state.newPaperOrdersAllowed !== "boolean") {
    return fail("PAPER_ACCEPTANCE_STATE_AMBIGUOUS");
  }

  if (state.acceptanceTradeCompleted === false) {
    if (state.newPaperOrdersAllowed !== true) return fail("NEW_PAPER_ORDERS_DISABLED");
    return {
      allowed: true,
      reason: "PAPER_ACCEPTANCE_STATE_AUTHORIZED",
      priorTrialCompleted: false,
      priorTrialProven: false,
    };
  }

  // A completed acceptance trial is not a market veto, but the old flag was
  // globally disabling orders. Never reinterpret an unknown record as safe.
  if (state.newPaperOrdersAllowed !== false ||
      !provenLegacyTrialClose(state)) {
    return fail("PAPER_ACCEPTANCE_PROVENANCE_UNVERIFIED");
  }

  // Preserve the completed candidate/plan identity even if historical order
  // files were archived. This is IN ADDITION to idempotency/Journal checks.
  if ((id(candidateId) && id(candidateId) === id(state.candidateId)) ||
      (id(planId) && id(planId) === id(state.planId))) {
    return fail("COMPLETED_ACCEPTANCE_CANDIDATE_REPLAY");
  }

  // Separate approval is required to interpret old automatic close behavior
  // as audit-only. Default OFF: no production behavior changes on deploy.
  if (continuousPaperAuthorized !== true) {
    return fail("CONTINUOUS_PAPER_COMPATIBILITY_NOT_AUTHORIZED");
  }

  return {
    allowed: true,
    reason: "PRIOR_ACCEPTANCE_TRIAL_AUDIT_ONLY",
    priorTrialCompleted: true,
    priorTrialProven: true,
  };
}
