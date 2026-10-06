import { evaluateStrategy1Geometry } from "./evaluateStrategy1Geometry.js";
import { buildEngine26BTargetStopGeometry } from "./buildEngine26BTargetStopGeometry.js";

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

  const entryZone =
    engine26GeometryHandoff?.entryZone ??
    engine26LocationCandidate?.entryZone ??
    null;

  const approvedNegotiatedZones =
    engine26GeometryHandoff?.approvedNegotiatedZoneInventory ??
    engine26LocationCandidate?.approvedNegotiatedZoneInventory ??
    [];

  const targetStopGeometry = lockedPackageValid
    ? buildEngine26BTargetStopGeometry({
        direction: paper?.direction,
        entryZone,
        approvedNegotiatedZones,
        tickSize: 0.25,
      })
    : null;

  const geometryCandidate = lockedPackageValid
    ? {
        ...(engine26LocationCandidate || {}),
        targetZone: targetStopGeometry?.targetZone ?? null,
        locationInvalidationBoundary:
          targetStopGeometry?.locationInvalidationBoundary ?? null,
        locationStopReference:
          targetStopGeometry?.locationStopReference ?? null,
      }
    : buildPreLockDiagnosticCandidate(engine26LocationCandidate);

  const geometryHandoff = lockedPackageValid
    ? {
        ...(engine26GeometryHandoff || {}),
        entryZone,
        targetZone: targetStopGeometry?.targetZone ?? null,
        locationInvalidationBoundary:
          targetStopGeometry?.locationInvalidationBoundary ?? null,
        locationStopReference:
          targetStopGeometry?.locationStopReference ?? null,
      }
    : buildPreLockDiagnosticHandoff(engine26GeometryHandoff);

  const geometry = evaluateStrategy1Geometry({
    symbol,
    strategyId,
    permission,
    engine26LocationCandidate: geometryCandidate,
    engine26GeometryHandoff: geometryHandoff,
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

    targetStopGeometry,
    targetStopGeometrySource: lockedPackageValid
      ? "ENGINE26B_TARGET_STOP_GEOMETRY"
      : "PRELOCK_NO_TARGET_STOP_AUTHORITY",

    reasonCodes: [
      ...(Array.isArray(geometry?.reasonCodes)
        ? geometry.reasonCodes
        : []),
      lockedPackageValid
        ? "ENGINE26B_PIPELINE_LOCKED_ENGINE6_PACKAGE_CONSUMED"
        : "ENGINE26B_PIPELINE_PRELOCK_DIAGNOSTIC_ONLY",
      "ENGINE26B_PIPELINE_GEOMETRY_INPUT_ENGINE26A_LOCATION_CONTEXT",
      lockedPackageValid
        ? "ENGINE26B_TARGET_STOP_MODULE_CONSUMED"
        : null,
    ].filter(Boolean),
  };
}

export default buildEngine26BPipeline;
