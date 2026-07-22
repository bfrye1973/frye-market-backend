import { createHash } from "node:crypto";

export const STRATEGY1_SETUP_CLASS = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
export const STRATEGY1_SETUP_GRADE = "A+++";
export const STRATEGY1_IDENTITY_KEY = STRATEGY1_SETUP_CLASS;
export const STRATEGY1_IDENTITY_VERSION = "engine26.strategy1.v1";

function stableHash(prefix, parts) {
  const body = parts
    .map((part) => String(part ?? "NULL").trim().toUpperCase())
    .join("|");

  return `${prefix}-${createHash("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 20)}`;
}

function normalizeDirection(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["LONG", "UP", "BULL", "BULLISH"].includes(text) || text.includes("LONG")) return "LONG";
  if (["SHORT", "DOWN", "BEAR", "BEARISH"].includes(text) || text.includes("SHORT")) return "SHORT";
  return "NEUTRAL";
}

export function resolveEngine26Strategy1Identity({
  symbol,
  strategyId,
  zoneId,
  directionBias,
  previousLocationCandidate = null,
} = {}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const normalizedStrategyId = String(strategyId || "");
  const normalizedDirection = normalizeDirection(directionBias);

  const priorDirection = normalizeDirection(
    previousLocationCandidate?.directionBias ?? previousLocationCandidate?.direction
  );

  const priorStatus = String(previousLocationCandidate?.status || "").toUpperCase();

  const mayAdoptLegacy =
    Boolean(previousLocationCandidate?.candidateId) &&
    previousLocationCandidate?.active === true &&
    priorStatus !== "INVALIDATED" &&
    !previousLocationCandidate?.invalidatedAt &&
    previousLocationCandidate?.zoneId === zoneId &&
    previousLocationCandidate?.strategyId === normalizedStrategyId &&
    String(previousLocationCandidate?.symbol || "").toUpperCase() === normalizedSymbol &&
    priorDirection !== "NEUTRAL" &&
    priorDirection === normalizedDirection;

  const generatedCandidateId = stableHash("E26C", [
    normalizedSymbol,
    normalizedStrategyId,
    zoneId,
    normalizedDirection,
    STRATEGY1_IDENTITY_KEY,
  ]);

  return {
    candidateId: mayAdoptLegacy
      ? previousLocationCandidate.candidateId
      : generatedCandidateId,
    setupClass: STRATEGY1_SETUP_CLASS,
    setupGrade: STRATEGY1_SETUP_GRADE,
    identitySetupKey: STRATEGY1_IDENTITY_KEY,
    candidateIdentityVersion: STRATEGY1_IDENTITY_VERSION,
    identityAdoptedFromLegacy: mayAdoptLegacy,
    legacyCandidateId: mayAdoptLegacy
      ? previousLocationCandidate.candidateId
      : null,
    generatedCandidateId,
    reasonCodes: mayAdoptLegacy
      ? [
          "ENGINE26_STRATEGY1_LEGACY_ACTIVE_CANDIDATE_ID_ADOPTED",
          "ENGINE26_STRATEGY1_ZONE_ID_MATCHED",
          "ENGINE26_STRATEGY1_DIRECTION_MATCHED",
        ]
      : [
          "ENGINE26_STRATEGY1_STABLE_IDENTITY_GENERATED",
          "ENGINE26_STRATEGY1_IDENTITY_EXCLUDES_VOLATILE_CONTEXT",
        ],
  };
}

export default resolveEngine26Strategy1Identity;
