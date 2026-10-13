// Engine 28A — Micro timing shadow acceptance analyzer.
//
// Offline/read-only analytics over Strategy 1 snapshots.
// It intentionally deduplicates repeated snapshot builds that carry the same
// canonical Micro observation so cron cadence cannot manufacture sample size.
//
// This analyzer does not calculate trade P&L and must not be used to claim a
// win-rate improvement. It measures structural/timing gate behavior only.

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function strategyFromSnapshot(snapshot) {
  return (
    snapshot
      ?.strategies
      ?.[
        "intraday_scalp@10m"
      ] ||
    snapshot?.strategy ||
    null
  );
}

function observationKey(strategy) {
  const micro =
    strategy
      ?.engine22WaveStrategy
      ?.microExecutionContext ||
    null;

  if (!micro) return null;

  const countId =
    String(
      micro.sourceCountId || ""
    ).trim();

  const revision =
    micro.revision ?? null;

  const sourceTimestamp =
    micro.sourceTimestamp ?? null;

  if (!countId) return null;

  // Revision is preferred because it represents canonical state evolution.
  // Source timestamp is retained to distinguish migration snapshots that have
  // not yet accumulated a native V2 revision.
  return [
    countId,
    revision ?? "NO_REVISION",
    sourceTimestamp ?? "NO_TIMESTAMP",
  ].join("|");
}

function increment(map, key) {
  const normalized =
    String(key || "UNKNOWN");

  map[normalized] =
    Number(map[normalized] || 0) + 1;
}

export function summarizeMicroTimingShadowSnapshots(
  snapshots = []
) {
  const seen = new Set();

  const summary = {
    analyzer:
      "engine28a.microTimingShadowAcceptanceAnalyzer.v1",

    rawSnapshotCount: 0,
    uniqueCanonicalObservationCount: 0,
    duplicateSnapshotCount: 0,

    missingStrategyCount: 0,
    missingMicroContextCount: 0,
    missingAcceptanceShadowCount: 0,

    byMicroTimingState: {},
    byActiveWave: {},
    byLifecycle: {},
    byShadowStatus: {},
    byFirstWaitingStage: {},

    hypotheticalPaperTimingReadyCount: 0,
    producerAutomationEligibleCount: 0,
    productionActivationEligibleCount: 0,

    microDirectionAlignedCount: 0,
    microDirectionMisalignedCount: 0,
    candidateDirectionAlignedCount: 0,
    candidateDirectionMisalignedCount: 0,

    countIds: [],

    reasonCodes: [
      "READ_ONLY_SHADOW_ACCEPTANCE_ANALYTICS",
      "CANONICAL_OBSERVATION_DEDUPLICATION_ENABLED",
      "NO_WIN_RATE_CLAIM",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };

  const countIds = new Set();

  for (const snapshot of snapshots) {
    summary.rawSnapshotCount += 1;

    const strategy =
      strategyFromSnapshot(snapshot);

    if (!strategy) {
      summary.missingStrategyCount += 1;
      continue;
    }

    const micro =
      strategy
        ?.engine22WaveStrategy
        ?.microExecutionContext ||
      null;

    if (!micro) {
      summary.missingMicroContextCount += 1;
      continue;
    }

    const key =
      observationKey(strategy);

    if (!key) {
      summary.missingMicroContextCount += 1;
      continue;
    }

    if (seen.has(key)) {
      summary.duplicateSnapshotCount += 1;
      continue;
    }

    seen.add(key);

    summary.uniqueCanonicalObservationCount += 1;

    if (micro.sourceCountId) {
      countIds.add(
        String(micro.sourceCountId)
      );
    }

    increment(
      summary.byMicroTimingState,
      upper(micro.microTimingState) ||
        "UNKNOWN"
    );

    increment(
      summary.byActiveWave,
      upper(micro.activeWave) ||
        "UNKNOWN"
    );

    increment(
      summary.byLifecycle,
      upper(micro.lifecycle) ||
        "UNKNOWN"
    );

    const acceptance =
      strategy
        ?.engine28AMicroTimingAutomationShadow ||
      null;

    if (!acceptance) {
      summary.missingAcceptanceShadowCount += 1;
      continue;
    }

    increment(
      summary.byShadowStatus,
      upper(
        acceptance.shadowStatus
      ) || "UNKNOWN"
    );

    increment(
      summary.byFirstWaitingStage,
      acceptance.firstWaitingStage ??
        "NONE"
    );

    if (
      acceptance
        .hypotheticalPaperTimingReady ===
      true
    ) {
      summary.hypotheticalPaperTimingReadyCount +=
        1;
    }

    if (
      acceptance
        .producerAutomationEligible ===
      true
    ) {
      summary.producerAutomationEligibleCount +=
        1;
    }

    if (
      acceptance
        .productionActivationEligible ===
      true
    ) {
      summary.productionActivationEligibleCount +=
        1;
    }

    if (
      acceptance
        .microDirectionAligned ===
      true
    ) {
      summary.microDirectionAlignedCount += 1;
    } else if (
      acceptance
        .microDirectionAligned ===
      false
    ) {
      summary.microDirectionMisalignedCount += 1;
    }

    if (
      acceptance
        .candidateDirectionAligned ===
      true
    ) {
      summary.candidateDirectionAlignedCount += 1;
    } else if (
      acceptance
        .candidateDirectionAligned ===
      false
    ) {
      summary.candidateDirectionMisalignedCount +=
        1;
    }
  }

  summary.countIds =
    [...countIds].sort();

  const denominator =
    summary.uniqueCanonicalObservationCount;

  summary.rates = {
    hypotheticalPaperTimingReadyPct:
      denominator > 0
        ? Number(
            (
              (
                summary.hypotheticalPaperTimingReadyCount /
                denominator
              ) * 100
            ).toFixed(2)
          )
        : null,

    productionActivationEligiblePct:
      denominator > 0
        ? Number(
            (
              (
                summary.productionActivationEligibleCount /
                denominator
              ) * 100
            ).toFixed(2)
          )
        : null,
  };

  return summary;
}

export default {
  summarizeMicroTimingShadowSnapshots,
};
