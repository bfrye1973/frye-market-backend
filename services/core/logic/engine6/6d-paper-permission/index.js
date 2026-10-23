// Engine 6D — interface boundary ONLY. Live permission and lock stay in
// buildStrategySnapshot.js until a separately authorized extraction.
// Never imports a shadow evaluator or grants PAPER permission.
export const ENGINE6D_INTERFACE_V1 = Object.freeze({
 contract: "engine6.paperPermissionBoundary.v1",
 mode: "INTERFACE_ONLY",
 livePermissionOwner: "buildStrategySnapshot.js",
 approvalLockOwner: "buildStrategySnapshot.js",
 activationAuthorized: false,
});
