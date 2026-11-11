// Engine 6D Stage 4: permission gate for NEW ES Strategy 1 PAPER entries.
// This does not override pre-existing Engine 6D candidate-bound approvals.
export function gateNewStrategy1PaperPermission(permission, classification) {
  const paper = permission?.paper;
  if (!paper || paper.decision !== "FAST_INTRADAY_PAPER_ALLOW" || paper.allowed !== true) return permission;
  if (classification?.decision === "ALLOW" && classification?.phase4MandatoryQualified === true) return permission;
  const state = ["REDUCE","WAIT","BLOCK"].includes(classification?.decision)
    ? classification.decision : "WAIT";
  return {
    ...permission,
    permission: "STAND_DOWN",
    watchOnly: true,
    setupEligible: false,
    paper: {
      ...paper,
      decision: "PAPER_STAND_DOWN",
      classification: state,
      allowed: false,
      paperAllowed: false,
      planningAllowed: false,
      paperLongAllowed: false,
      paperShortAllowed: false,
      fastIntradayPaperAllow: false,
      locked: false,
      blockers: [...new Set([...(paper.blockers || []), "ENGINE6C_NEW_ENTRY_"+state])],
      realExecutionAllowed: false,
      executable: false,
      brokerExecutionAllowed: false,
      schwabExecutionAllowed: false,
    },
    realExecutionAllowed: false,
    executable: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
  };
}
