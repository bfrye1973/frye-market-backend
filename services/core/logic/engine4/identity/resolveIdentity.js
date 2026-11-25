import { pickFirst } from "../contracts/inputUtils.js";

const STRATEGY_1_SETUP_CLASS = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

export function resolveIdentity({ reaction, engine26LocationCandidate = null, engine26ReactionHandoff = null }) {
  const candidateId = pickFirst(
    reaction?.candidateId,
    reaction?.engine26LocationContext?.candidateId,
    engine26ReactionHandoff?.candidateId,
    engine26LocationCandidate?.candidateId
  );

  const zoneId = pickFirst(
    reaction?.zoneId,
    reaction?.engine26LocationContext?.zoneId,
    engine26ReactionHandoff?.zoneId,
    engine26LocationCandidate?.zoneId
  );

  const laneId = pickFirst(
    reaction?.laneId,
    reaction?.engine26LocationContext?.laneId,
    engine26ReactionHandoff?.laneId,
    engine26LocationCandidate?.laneId,
    "minute"
  );

  const strategyId = pickFirst(
    reaction?.strategyId,
    reaction?.engine26LocationContext?.strategyId,
    engine26ReactionHandoff?.strategyId,
    engine26LocationCandidate?.strategyId,
    "intraday_scalp@10m"
  );

  const symbol = pickFirst(
    reaction?.symbol,
    reaction?.engine26LocationContext?.symbol,
    engine26ReactionHandoff?.symbol,
    engine26LocationCandidate?.symbol,
    "ES"
  );

  const setupClass = pickFirst(
    reaction?.setupClass,
    reaction?.engine26LocationContext?.setupClass,
    engine26ReactionHandoff?.setupClass,
    engine26LocationCandidate?.setupClass,
    STRATEGY_1_SETUP_CLASS
  );

  const setupGrade = pickFirst(
    reaction?.setupGrade,
    reaction?.engine26LocationContext?.setupGrade,
    engine26ReactionHandoff?.setupGrade,
    engine26LocationCandidate?.setupGrade,
    "A+++"
  );

  const identitySetupKey = pickFirst(
    reaction?.identitySetupKey,
    reaction?.engine26LocationContext?.identitySetupKey,
    engine26ReactionHandoff?.identitySetupKey,
    engine26LocationCandidate?.identitySetupKey,
    setupClass
  );

  const candidateIdentityVersion = pickFirst(
    reaction?.candidateIdentityVersion,
    reaction?.engine26LocationContext?.candidateIdentityVersion,
    engine26ReactionHandoff?.candidateIdentityVersion,
    engine26LocationCandidate?.candidateIdentityVersion,
    "engine26.strategy1.v1"
  );

  const comparedCandidateId = engine26LocationCandidate?.candidateId || engine26ReactionHandoff?.candidateId || null;
  const comparedZoneId = engine26LocationCandidate?.zoneId || engine26ReactionHandoff?.zoneId || null;

  const missing = [];
  if (!candidateId) missing.push("CANDIDATE_ID_MISSING");
  if (!zoneId) missing.push("ZONE_ID_MISSING");
  if (!laneId) missing.push("LANE_ID_MISSING");
  if (!strategyId) missing.push("STRATEGY_ID_MISSING");

  const mismatches = [];
  if (comparedCandidateId && candidateId && comparedCandidateId !== candidateId) {
    mismatches.push("CANDIDATE_ID_MISMATCH");
  }
  if (comparedZoneId && zoneId && comparedZoneId !== zoneId) {
    mismatches.push("ZONE_ID_MISMATCH");
  }
  if (laneId && laneId !== "minute") mismatches.push("LANE_ID_MISMATCH");
  if (strategyId && strategyId !== "intraday_scalp@10m") mismatches.push("STRATEGY_ID_MISMATCH");

  return {
    laneId,
    strategyId,
    candidateId,
    zoneId,
    symbol,
    setupClass,
    setupGrade,
    identitySetupKey,
    candidateIdentityVersion,
    identityMissing: missing.length > 0,
    identityMismatch: mismatches.length > 0,
    identityMissingCodes: missing,
    identityMismatchCodes: mismatches,
  };
}
