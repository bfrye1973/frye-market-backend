// Engine 29 Bigger Picture v2 — ES weekly structure context.
//
// Uses the canonical ES anchor's existing Engine 29 weekly structure classifier.
// This module does not invent a second structure model or new thresholds.

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildEngine29EsWeeklyStructureContext(esAnchor) {
  const view = esAnchor?.structure?.structural || null;

  if (!view) {
    return {
      version: "engine29.biggerPicture.esWeeklyStructure.v1",
      authority: "ENGINE29_ES_WEEKLY_PRICE_STRUCTURE",
      available: false,
      resolvedSymbol: esAnchor?.resolvedSymbol || null,
      source: esAnchor?.source || null,
      reason: "ES_WEEKLY_STRUCTURE_UNAVAILABLE",
    };
  }

  const latest = view?.latest || null;
  const movingAverages = view?.movingAverages || null;
  const swings = view?.swings || null;
  const levels = view?.levels || null;
  const classification = view?.classification || null;
  const close = finite(latest?.close);

  return {
    version: "engine29.biggerPicture.esWeeklyStructure.v1",
    authority: "ENGINE29_ES_WEEKLY_PRICE_STRUCTURE",
    available: true,
    resolvedSymbol: esAnchor?.resolvedSymbol || null,
    source: esAnchor?.source || null,
    timeframe: "1W",
    sourceTimeframe: "1D_AGGREGATED_TO_1W",
    barCount: finite(view?.barCount),
    freshness: view?.freshness || esAnchor?.structuralFreshness || null,

    classification: {
      state: classification?.state || null,
      stage: classification?.stage || null,
      confidence: classification?.confidence || null,
      evidence: classification?.evidence || null,
    },

    trend: {
      swingTrend: swings?.trend || null,
      highStructure: swings?.highStructure || null,
      lowStructure: swings?.lowStructure || null,
      priorSwingHigh: swings?.priorSwingHigh || null,
      lastSwingHigh: swings?.lastSwingHigh || null,
      priorSwingLow: swings?.priorSwingLow || null,
      lastSwingLow: swings?.lastSwingLow || null,
    },

    latestWeeklyBar: latest,

    movingAverages: {
      ema10: finite(movingAverages?.ema10),
      ema20: finite(movingAverages?.ema20),
      ema50: finite(movingAverages?.ema50),
      ema200: finite(movingAverages?.ema200),
      ema10SlopePct: finite(movingAverages?.ema10SlopePct),
      ema20SlopePct: finite(movingAverages?.ema20SlopePct),
      ema50SlopePct: finite(movingAverages?.ema50SlopePct),
      closeAboveEma10:
        close !== null && finite(movingAverages?.ema10) !== null
          ? close > Number(movingAverages.ema10)
          : null,
      closeAboveEma20:
        close !== null && finite(movingAverages?.ema20) !== null
          ? close > Number(movingAverages.ema20)
          : null,
      closeAboveEma50:
        close !== null && finite(movingAverages?.ema50) !== null
          ? close > Number(movingAverages.ema50)
          : null,
      closeAboveEma200:
        close !== null && finite(movingAverages?.ema200) !== null
          ? close > Number(movingAverages.ema200)
          : null,
    },

    levels: {
      recentSupport: finite(levels?.recentSupport),
      recentResistance: finite(levels?.recentResistance),
      distanceFromSupportPct: finite(levels?.distanceFromSupportPct),
      distanceFromResistancePct: finite(levels?.distanceFromResistancePct),
      supportSource: levels?.supportSource || null,
      resistanceSource: levels?.resistanceSource || null,
    },

    currentWeekCompleted: latest?.completed === true,
  };
}

export default buildEngine29EsWeeklyStructureContext;
