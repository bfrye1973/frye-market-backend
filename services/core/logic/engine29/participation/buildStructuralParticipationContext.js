// Engine 29 Bigger Picture v2 — read-only Engine 25 structural participation lane.
//
// Authority boundary:
// - Engine 25 owns breadth / distribution / stock-volume / sector participation truth.
// - Engine 29 consumes the canonical artifact unchanged.
// - This module does not recalculate Engine 25 formulas.
// - This lane is context only and cannot rewrite Engine 29's canonical 1W structural state.

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildEngine29StructuralParticipationContext(
  engine25Participation
) {
  const source = engine25Participation || null;
  const contractValid = source?.contractValid === true;
  const participation = source?.participation || null;
  const distribution = participation?.distributionPressure || null;
  const breadth = participation?.breadth || null;
  const stockVolume = participation?.stockVolume || null;
  const sectorParticipation = participation?.sectorParticipation || null;
  const freshness = source?.freshness || null;

  const distributionV2 =
    contractValid &&
    distribution?.engine === "engine25.distributionPressure.v2" &&
    distribution?.schema === "engine25.distributionPressure.v2";

  const structural4h = distributionV2
    ? distribution?.structural4h || null
    : null;

  return {
    version: "engine29.biggerPicture.structuralParticipation.v1",
    authority: "ENGINE25_READ_ONLY_CONTEXT",
    owner: "ENGINE25",
    role: "STRUCTURAL_PARTICIPATION_CONTEXT_ONLY",
    mayRewriteEngine29StructuralState: false,
    contractValid,
    available:
      contractValid &&
      distributionV2 &&
      distribution?.available === true,

    distribution: {
      canonicalEngine: distribution?.engine || null,
      canonicalSchema: distribution?.schema || null,
      canonicalScoreTimeframe:
        distribution?.authority?.canonicalScoreTimeframe || null,
      label: distribution?.label || null,
      pressureLabel: distribution?.pressureLabel || null,
      rawPressure: finite(distribution?.rawPressure),
      score: finite(distribution?.score),
      integratedState: distribution?.integratedState || null,
      persistence: distribution?.persistence || null,
      structural4h,
      tactical1h: distributionV2 ? distribution?.tactical1h || null : null,
      confirmation30m:
        distributionV2 ? distribution?.confirmation30m || null : null,
      acceleration10m:
        distributionV2 ? distribution?.acceleration10m || null : null,
    },

    breadth,
    stockVolume,
    sectorParticipation,

    freshness: {
      state: freshness?.state || "UNAVAILABLE",
      reason: freshness?.reason || null,
      equityScannerSession:
        freshness?.equityScannerSession || null,
      intraday: freshness?.intraday || null,
      eod: freshness?.eod || null,
      lastValidEquityRead:
        freshness?.lastValidEquityRead === true,
    },

    diagnostics: source?.diagnostics || null,

    reasonCodes: [
      ...(Array.isArray(source?.reasonCodes) ? source.reasonCodes : []),
      !contractValid
        ? "ENGINE25_PARTICIPATION_CONTRACT_INVALID"
        : null,
      contractValid && !distributionV2
        ? "ENGINE25_DISTRIBUTION_V2_NOT_AVAILABLE"
        : null,
      contractValid && distributionV2
        ? "ENGINE25_DISTRIBUTION_V2_CONSUMED_READ_ONLY"
        : null,
    ].filter(Boolean),
  };
}

export default buildEngine29StructuralParticipationContext;
