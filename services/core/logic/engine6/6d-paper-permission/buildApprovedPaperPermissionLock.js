// Engine 6D: exact extraction of per-strategy invocation approval lock.
// Factory scope preserves the previous closure lifetime. No new validation or expiry.
export function createEngine6ApprovedPaperPermissionLock(nowIso) {
  let engine6ApprovedPaperPermissionLock = null;
  
  const validContext = (paper, context) => {
    const candidate = context?.candidate;
    if (!candidate?.candidateId || !candidate?.zoneId ||
        candidate.candidateId !== paper?.candidateId ||
        candidate.zoneId !== paper?.zoneId) return false;

    const memory = candidate.zoneMemorySummary;
    const status = String(candidate.status || "").toUpperCase();
    if (["COMPLETED","INVALIDATED","RETIRED","CANCELLED","EXPIRED"].includes(status) ||
        candidate.invalidatedAt != null ||
        candidate.invalidationFacts?.completedCloseInvalidationConfirmed === true ||
        candidate.candidateInvalidated === true ||
        candidate.locationInvalidated === true ||
        (memory?.currentCandidateId === candidate.candidateId &&
         ["COMPLETED","INVALIDATED","RETIRED","CANCELLED","EXPIRED"].includes(String(memory.lifecycleStatus||"").toUpperCase()))) return false;
    const generation = candidate.candidateLifecycleStartTime ??
      (memory?.currentCandidateId === candidate.candidateId ? memory.candidateLifecycleStartTime : null);
    const saved = paper?.candidateLifecycleStartTime;
    if (saved != null && generation != null && saved !== generation) return false;
    return true;
  };
  // Only NEW approvals require present upstream authorization.
  // Restoration is identity/lifecycle preservation, not fresh qualification.
  const newApprovalAuthorized = (context) =>
    context?.candidate?.active === true &&
    context?.reactionHandoff?.evaluationAuthorized === true &&
    context?.reactionHandoff?.candidateId === context?.candidate?.candidateId &&
    context?.reactionHandoff?.zoneId === context?.candidate?.zoneId;
  const rememberEngine6ApprovedPaperPermission = (permission, context) => {
    const paper = permission?.paper || null;
  
    if (
      paper?.decision === "FAST_INTRADAY_PAPER_ALLOW" &&
      paper?.allowed === true &&
      paper?.paperAllowed === true &&
      ["LONG", "SHORT"].includes(String(paper?.direction || "").toUpperCase()) &&
      paper?.candidateId &&
      paper?.zoneId &&
      validContext(paper, context) &&
      newApprovalAuthorized(context)
    ) {
      engine6ApprovedPaperPermissionLock =
        JSON.parse(JSON.stringify({
          ...paper,
          candidateLifecycleStartTime: context.candidate.candidateLifecycleStartTime ?? (context.candidate.zoneMemorySummary?.currentCandidateId === context.candidate.candidateId ? context.candidate.zoneMemorySummary?.candidateLifecycleStartTime : null) ?? null,
          locked: true,
          lockedAt: nowIso(),
          lockSource: "ENGINE6_FAST_INTRADAY_PAPER_ALLOW",
          lockReason: "ENGINE6_GO_CANNOT_BE_DOWNGRADED_DOWNSTREAM",
        }));
    }
  };
  
  const applyEngine6ApprovedPaperPermissionLock = (permission, context) => {
    if (!engine6ApprovedPaperPermissionLock || !validContext(engine6ApprovedPaperPermissionLock, context)) {
      return permission;
    }
  
    return {
      ...(permission || {}),
      permission:
        permission?.permission === "STAND_DOWN"
          ? "REDUCE"
          : permission?.permission || "REDUCE",
  
      direction:
        engine6ApprovedPaperPermissionLock.direction,
  
      watchOnly: false,
      setupEligible: true,
  
      paper: {
        ...(permission?.paper || {}),
        ...engine6ApprovedPaperPermissionLock,
  
        decision: "FAST_INTRADAY_PAPER_ALLOW",
        allowed: true,
        paperAllowed: true,
  
        paperShortAllowed:
          engine6ApprovedPaperPermissionLock.direction === "SHORT",
  
        paperLongAllowed:
          engine6ApprovedPaperPermissionLock.direction === "LONG",
  
        fastIntradayPaperAllow: true,
  
        blockers: [],
        warnings: [
          ...new Set([
            ...(Array.isArray(permission?.paper?.warnings)
              ? permission.paper.warnings
              : []),
            "ENGINE6_APPROVED_PERMISSION_LOCK_ACTIVE",
          ]),
        ],
  
        reasonCodes: [
          ...new Set([
            ...(Array.isArray(engine6ApprovedPaperPermissionLock.reasonCodes)
              ? engine6ApprovedPaperPermissionLock.reasonCodes
              : []),
            "ENGINE6_APPROVED_PERMISSION_LOCK_ACTIVE",
            "DOWNSTREAM_PERMISSION_DOWNGRADE_BLOCKED",
          ]),
        ],
  
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
  };
  return { rememberEngine6ApprovedPaperPermission, applyEngine6ApprovedPaperPermissionLock };
}
