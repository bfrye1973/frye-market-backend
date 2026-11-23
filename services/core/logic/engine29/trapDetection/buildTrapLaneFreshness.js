// Engine 29-owned, read-only trap freshness decision.
// This summarizes already-existing source availability/freshness contracts.
// No new numeric freshness thresholds, trap scoring, or trade permissions.
function sourceFreshness(freshness, available, reasonWhenMissing) {
  const known = freshness !== null && typeof freshness === "object";
  const stale = freshness?.stale === true;
  const current = available === true && known && freshness.stale === false;
  return {
    available: available === true,
    freshness: freshness ?? null,
    current,
    reason: !available ? reasonWhenMissing
      : !known ? "FRESHNESS_UNVERIFIED"
      : stale ? "SOURCE_STALE"
      : freshness.stale !== false ? "FRESHNESS_UNVERIFIED"
      : "CURRENT",
  };
}

export function buildEngine29TrapLaneFreshness({
  detection = null,
  dataQuality = null,
  structuralParticipation = null,
} = {}) {
  const event = detection?.auctionEvent || null;
  const ten = event?.tenMinuteEvidence || null;
  const acceptance = event?.acceptance30m || null;
  const zone = event?.liquidityLevel || null;
  const primary = detection?.participation?.primary || null;
  const secondary = detection?.participation?.secondary || null;
  const quality = dataQuality || {};
  const tenSource = sourceFreshness(
    quality.esLiveMonitorFreshness,
    detection?.dataQuality?.tenMinuteAvailable === true,
    "TEN_MINUTE_SOURCE_UNAVAILABLE"
  );
  const thirtySource = sourceFreshness(
    quality.esThirtyMinuteFreshness,
    detection?.dataQuality?.thirtyMinuteAvailable === true,
    "THIRTY_MINUTE_SOURCE_UNAVAILABLE"
  );
  const hourlySource = sourceFreshness(
    quality.esOneHourFreshness,
    detection?.dataQuality?.oneHourAvailable === true,
    "ONE_HOUR_SOURCE_UNAVAILABLE"
  );
  const locationAvailable = Boolean(
    zone && zone.eventEligible !== false &&
    (zone.type !== "INSTITUTIONAL_ZONE" || event?.engine26ZoneId)
  );
  const tenCompleted = ten?.completed === true &&
    Number.isFinite(ten.completedBarTime);
  const thirtyCompleted = Number.isFinite(acceptance?.time);
  const acceptanceFailureConfirmed = acceptance?.priorAcceptanceFailure === true;
  // Engine25 itself owns the participation freshness decision.
  const primaryUsable = primary?.available === true &&
    primary?.source?.currentTrapConfirmationUsable === true &&
    primary?.source?.contractValid === true;
  const primaryFreshness = primary?.freshness ?? null;
  // Engine29 owns secondary evidence interpretation; fresh source bars and
  // actual block evidence are required, but agreement is a separate question.
  const blocks = secondary?.blocks || {};
  const secondaryObserved = ["leadership", "credit", "financials"]
    .some((key) => Boolean(blocks[key]?.direction));
  const secondaryAvailable = Boolean(secondary) && secondaryObserved;
  const sources = {
    completed10m: { ...tenSource, completed: tenCompleted,
      completedBarTime: ten?.completedBarTime ?? null,
      formingPresent: ten?.formingPresent === true },
    completed30m: { ...thirtySource, completed: thirtyCompleted,
      completedBarTime: acceptance?.time ?? null,
      priorAcceptanceFailure: acceptanceFailureConfirmed },
    oneHour: hourlySource,
    engine25Primary: {
      available: primary?.available === true,
      current: primaryUsable,
      freshness: primaryFreshness,
      sourceTimestamp: primary?.sourceUpdatedAt ?? null,
      reason: primaryUsable ? "CURRENT_ENGINE25_AUTHORITY"
        : "ENGINE25_PRIMARY_NOT_CURRENT_OR_UNVERIFIED",
    },
    engine29Secondary: {
      available: secondaryAvailable,
      current: secondaryAvailable && hourlySource.current && tenSource.current,
      sourceFreshness: { oneHour: hourlySource.freshness, tenMinute: tenSource.freshness },
      reason: !secondaryAvailable ? "ENGINE29_SECONDARY_EVIDENCE_MISSING"
        : !hourlySource.current || !tenSource.current ? "ENGINE29_SECONDARY_SOURCE_NOT_CURRENT"
        : "CURRENT",
    },
    location: {
      available: locationAvailable,
      current: locationAvailable,
      zoneId: event?.engine26ZoneId ?? null,
      source: zone?.source ?? null,
      type: zone?.type ?? null,
      locationQuality: detection?.macroLiquidityMap?.locationQuality ??
        detection?.locationQuality ?? null,
      reason: locationAvailable ? "LOCATION_AVAILABLE" : "LOCATION_UNVERIFIED",
    },
  };

  const noEvent = detection?.state === "NO_ACTIVE_TRAP" ||
    detection?.trapSide == null || detection?.trapSide === "NONE";
  const blockedBy = [
    !tenSource.current ? tenSource.reason : null,
    !tenCompleted ? "COMPLETED_10M_REQUIRED" : null,
    !thirtySource.current ? thirtySource.reason : null,
    !thirtyCompleted ? "COMPLETED_30M_REQUIRED" : null,
    !acceptanceFailureConfirmed ? "PRIOR_30M_ACCEPTANCE_LOSS_NOT_PROVEN" : null,
    !hourlySource.current ? hourlySource.reason : null,
    !locationAvailable ? "ELIGIBLE_LOCATION_REQUIRED" : null,
    !primaryUsable ? "ENGINE25_CURRENT_PRIMARY_REQUIRED" : null,
    !sources.engine29Secondary.current ? sources.engine29Secondary.reason : null,
  ].filter(Boolean);
  const usableForConfirmation = blockedBy.length === 0;
  return {
    owner: "ENGINE29",
    authority: "TRAP_EVIDENCE_FRESHNESS_ONLY",
    state: noEvent ? "NO_ACTIVE_TRAP" : usableForConfirmation ? "CURRENT" : "DEGRADED",
    dataDegraded: !usableForConfirmation,
    usableForConfirmation: !noEvent && usableForConfirmation,
    confirmationBlockedBy: blockedBy,
    sources,
    // This cannot grant Engine4 use or trading authority.
    eligibleForEngine4: false,
  };
}
