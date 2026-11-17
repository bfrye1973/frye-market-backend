// services/core/config/paperRiskConfig.js
//
// Paper-only risk configuration for Strategy 1.
//
// The owner trades the Micro E-mini S&P 500 (MES):
// $5 per point, $1.25 per 0.25 tick, 1/10 the size of ES.
// MES moves tick for tick with ES, so ES price data, zones and
// geometry are unchanged; only the dollar value per point differs.
//
// The export name ES_PAPER_RISK_CONFIG is kept so existing imports
// keep working. Strategy identity (symbol "ES") is unchanged.
//
// This file contains configuration only.
// It does not calculate sizing and does not create permission or execution.

export const ES_PAPER_RISK_CONFIG = Object.freeze({
  instrument: "MES",

  // Maximum estimated dollar risk for the paper sizing preview.
  riskBudgetDollars: 1000,

  // MES contract value: $5 per index point.
  dollarsPerPoint: 5,

  // Never round up to force a trade.
  minimumContracts: 1,

  // Frozen Strategy 1 plan: three contracts (P1 at zone entry,
  // P2 and P3 at destination midpoint).
  maximumContracts: 3,

  roundingRule: "FLOOR",

  // Estimated entry and exit slippage.
  estimatedSlippagePointsPerSide: 0.25,

  // Estimated round-trip commission and fees for one MES contract.
  commissionDollarsPerContractRoundTrip: 1.5,

  paperOnly: true,
});

export default ES_PAPER_RISK_CONFIG;
