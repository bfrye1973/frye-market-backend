// services/core/logic/engine25/buildDistributionVolumePressure.js
// Stock-volume evidence for Engine 25 Distribution Pressure.
//
// Uses the same Index Sector stock scan as breadth. No second scanner.
// 4H is intentionally excluded from Phase 5.

export const MIN_VOLUME_COVERAGE = 0.70;

function finite(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(Number(value))) return null;
  return Math.max(min, Math.min(max, Number(value)));
}

function pressureLinear(value, low, high) {
  if (!finite(value)) return null;
  const n = Number(value);
  if (n <= low) return 0;
  if (n >= high) return 100;
  return clamp(((n - low) / (high - low)) * 100);
}

function pressureInverse(value, low, high) {
  if (!finite(value)) return null;
  const n = Number(value);
  if (n <= low) return 100;
  if (n >= high) return 0;
  return clamp(100 - ((n - low) / (high - low)) * 100);
}

function canonicalSectorKey(name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (normalized === "healthcare" || normalized === "health care") return "health-care";
  if (normalized === "tech" || normalized === "technology") return "technology";
  return normalized;
}

function dedupeCards(cards = []) {
  const bySector = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    const key = canonicalSectorKey(card?.sector);
    if (!key) continue;

    const existing = bySector.get(key);
    if (!existing) {
      bySector.set(key, card);
      continue;
    }

    // Prefer the observation with greater usable-volume coverage so legacy aliases
    // cannot double-vote and the richer canonical observation wins deterministically.
    const existingCoverage =
      finite(existing?.stocksScanned) && Number(existing.stocksScanned) > 0
        ? Number(existing?.stocksWithVolume || 0) / Number(existing.stocksScanned)
        : -1;
    const candidateCoverage =
      finite(card?.stocksScanned) && Number(card.stocksScanned) > 0
        ? Number(card?.stocksWithVolume || 0) / Number(card.stocksScanned)
        : -1;

    if (candidateCoverage > existingCoverage) bySector.set(key, card);
  }
  return [...bySector.values()];
}

export function buildTimeframeVolumePressure(cards = [], timeframe = "unknown") {
  const uniqueCards = dedupeCards(cards);

  const totals = uniqueCards.reduce(
    (out, card) => {
      out.stocksScanned += finite(card?.stocksScanned) ? Number(card.stocksScanned) : 0;
      out.stocksWithVolume += finite(card?.stocksWithVolume) ? Number(card.stocksWithVolume) : 0;
      out.advancingVolume += finite(card?.advancingVolume) ? Number(card.advancingVolume) : 0;
      out.decliningVolume += finite(card?.decliningVolume) ? Number(card.decliningVolume) : 0;
      out.unchangedVolume += finite(card?.unchangedVolume) ? Number(card.unchangedVolume) : 0;
      return out;
    },
    {
      stocksScanned: 0,
      stocksWithVolume: 0,
      advancingVolume: 0,
      decliningVolume: 0,
      unchangedVolume: 0,
    }
  );

  const directionalVolume = totals.advancingVolume + totals.decliningVolume;
  const coverage =
    totals.stocksScanned > 0 ? totals.stocksWithVolume / totals.stocksScanned : null;
  const coveragePct = finite(coverage) ? Number((coverage * 100).toFixed(2)) : null;

  const available =
    totals.stocksScanned > 0 &&
    totals.stocksWithVolume > 0 &&
    directionalVolume > 0 &&
    finite(coverage) &&
    coverage >= MIN_VOLUME_COVERAGE;

  if (!available) {
    return {
      timeframe,
      available: false,
      stocksScanned: totals.stocksScanned,
      stocksWithVolume: totals.stocksWithVolume,
      coveragePct,
      advancingVolume: totals.advancingVolume,
      decliningVolume: totals.decliningVolume,
      unchangedVolume: totals.unchangedVolume,
      directionalVolume,
      advancingVolumeShare: null,
      decliningVolumeShare: null,
      volumeImbalance: null,
      decliningSharePressure: null,
      advancingSharePressure: null,
      imbalancePressure: null,
      volumePressure: null,
      reason:
        totals.stocksScanned <= 0
          ? "NO_STOCKS_SCANNED"
          : totals.stocksWithVolume <= 0
            ? "NO_STOCK_VOLUME"
            : directionalVolume <= 0
              ? "NO_DIRECTIONAL_VOLUME"
              : "VOLUME_COVERAGE_BELOW_70_PERCENT",
      uniqueSectorCount: uniqueCards.length,
    };
  }

  const advancingVolumeShare = totals.advancingVolume / directionalVolume;
  const decliningVolumeShare = totals.decliningVolume / directionalVolume;
  const volumeImbalance =
    (totals.decliningVolume - totals.advancingVolume) / directionalVolume;

  const decliningSharePressure = pressureLinear(decliningVolumeShare, 0.45, 0.65);
  const advancingSharePressure = pressureInverse(advancingVolumeShare, 0.35, 0.55);
  const imbalancePressure = pressureLinear(volumeImbalance, -0.10, 0.30);

  const volumePressure =
    decliningSharePressure * 0.40 +
    advancingSharePressure * 0.20 +
    imbalancePressure * 0.40;

  return {
    timeframe,
    available: true,
    stocksScanned: totals.stocksScanned,
    stocksWithVolume: totals.stocksWithVolume,
    coveragePct,
    advancingVolume: totals.advancingVolume,
    decliningVolume: totals.decliningVolume,
    unchangedVolume: totals.unchangedVolume,
    directionalVolume,
    advancingVolumeShare,
    decliningVolumeShare,
    volumeImbalance,
    decliningSharePressure,
    advancingSharePressure,
    imbalancePressure,
    volumePressure,
    reason: null,
    uniqueSectorCount: uniqueCards.length,
  };
}

export function buildDistributionVolumePressure({
  intradayCards = [],
  eodCards = [],
} = {}) {
  const intraday = buildTimeframeVolumePressure(intradayCards, "intraday");
  const eod = buildTimeframeVolumePressure(eodCards, "eod");

  let combinedVolumePressure = null;
  let combination = "UNAVAILABLE";

  if (intraday.available && eod.available) {
    combinedVolumePressure = intraday.volumePressure * 0.60 + eod.volumePressure * 0.40;
    combination = "60PCT_INTRADAY_40PCT_EOD";
  } else if (intraday.available) {
    combinedVolumePressure = intraday.volumePressure;
    combination = "INTRADAY_ONLY";
  } else if (eod.available) {
    combinedVolumePressure = eod.volumePressure;
    combination = "EOD_ONLY";
  }

  return {
    available: finite(combinedVolumePressure),
    coverage: {
      minimumRequiredPct: MIN_VOLUME_COVERAGE * 100,
      intradayPct: intraday.coveragePct,
      eodPct: eod.coveragePct,
    },
    intraday,
    eod,
    combinedVolumePressure,
    combination,
  };
}

export default buildDistributionVolumePressure;
