import { evaluateStrategy1Geometry } from "./evaluateStrategy1Geometry.js";

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

export function isLockedEngine6PaperPackageValid(permission) {
  const paper =
    permission?.paper && typeof permission.paper === "object"
      ? permission.paper
      : null;

  return (
    paper?.allowed === true &&
    paper?.paperAllowed === true &&
    paper?.locked === true &&
    ["LONG", "SHORT"].includes(upper(paper?.direction))
  );
}

function buildPreLockDiagnosticCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return candidate;

  return {
    ...candidate,
    directionBias: "NEUTRAL",
    tradeDirectionBias: "NEUTRAL",
    direction: "NEUTRAL",
    directionState: "NEUTRAL",
  };
}

function buildPreLockDiagnosticHandoff(handoff) {
  if (!handoff || typeof handoff !== "object") return handoff;

  return {
    ...handoff,
    direction: "NEUTRAL",
    directionState: "NEUTRAL",
  };
}

export function buildEngine26BPipeline({
  symbol,
  strategyId,
  permission,
  engine26LocationCandidate,
  engine26GeometryHandoff,
} = {}) {
  const paper =
    permission?.paper && typeof permission.paper === "object"
      ? permission.paper
      : null;

  const lockedPackageValid =
    isLockedEngine6PaperPackageValid(permission);

  const geometry = evaluateStrategy1Geometry({
    symbol,
    strategyId,
    permission,
    engine26LocationCandidate: lockedPackageValid
      ? engine26LocationCandidate
      : buildPreLockDiagnosticCandidate(engine26LocationCandidate),
    engine26GeometryHandoff: lockedPackageValid
      ? engine26GeometryHandoff
      : buildPreLockDiagnosticHandoff(engine26GeometryHandoff),
  });

  if (!geometry) return null;

  return {
    ...geometry,

    directionSource: lockedPackageValid
      ? "ENGINE6_LOCKED_PAPER_PERMISSION"
      : "PRELOCK_NO_AUTHORIZED_DIRECTION",

    geometryDirectionSource: lockedPackageValid
      ? "ENGINE6_LOCKED_PAPER_PERMISSION"
      : "PRELOCK_NO_AUTHORIZED_DIRECTION",

    permissionLocked: paper?.locked === true,
    lockedPaperPackageValid: lockedPackageValid,

    permissionCandidateId:
      paper?.candidateId ?? paper?.identity?.candidateId ?? null,

    permissionZoneId:
      paper?.zoneId ?? paper?.identity?.zoneId ?? null,

    geometryInputSource: "ENGINE26A_LOCATION_CONTEXT",
    permissionAuthority: "ENGINE6",

    reasonCodes: [
      ...(Array.isArray(geometry?.reasonCodes)
        ? geometry.reasonCodes
        : []),
      lockedPackageValid
        ? "ENGINE26B_PIPELINE_LOCKED_ENGINE6_PACKAGE_CONSUMED"
        : "ENGINE26B_PIPELINE_PRELOCK_DIAGNOSTIC_ONLY",
      "ENGINE26B_PIPELINE_GEOMETRY_INPUT_ENGINE26A_LOCATION_CONTEXT",
    ].filter(Boolean),
  };
}

export default buildEngine26BPipeline;
