// Engine 6D: exact extraction of per-strategy invocation approval lock.
// Factory scope preserves the previous closure lifetime. No new validation or expiry.
export function createEngine6ApprovedPaperPermissionLock(nowIso) {
  let engine6ApprovedPaperPermissionLock = null;
  
  const rememberEngine6ApprovedPaperPermission = (permission) => {
    const paper = permission?.paper || null;
  
    if (
      paper?.decision === "FAST_INTRADAY_PAPER_ALLOW" &&
      paper?.allowed === true &&
      paper?.paperAllowed === true &&
      ["LONG", "SHORT"].includes(String(paper?.direction || "").toUpperCase()) &&
      paper?.candidateId &&
      paper?.zoneId
    ) {
      engine6ApprovedPaperPermissionLock =
        JSON.parse(JSON.stringify({
          ...paper,
          locked: true,
          lockedAt: nowIso(),
          lockSource: "ENGINE6_FAST_INTRADAY_PAPER_ALLOW",
          lockReason: "ENGINE6_GO_CANNOT_BE_DOWNGRADED_DOWNSTREAM",
        }));
    }
  };
  
  const applyEngine6ApprovedPaperPermissionLock = (permission) => {
    if (!engine6ApprovedPaperPermissionLock) {
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
