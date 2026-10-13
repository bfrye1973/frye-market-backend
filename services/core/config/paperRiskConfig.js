// services/core/config/paperRiskConfig.js
//
// Paper-only risk configuration for the first ES acceptance test.
//
// This file contains configuration only.
// It does not calculate sizing and does not create permission or execution.

export const ES_PAPER_RISK_CONFIG = Object.freeze({
  instrument: "ES",

  // Maximum estimated dollar risk for the paper sizing preview.
  riskBudgetDollars: 1000,

  // ES contract value.
  dollarsPerPoint: 50,

  // Never round up to force a trade.
  minimumContracts: 1,

  // First acceptance test is capped at one ES contract.
  maximumContracts: 1,

  roundingRule: "FLOOR",

  // Estimated entry and exit slippage.
  estimatedSlippagePointsPerSide: 0.25,

  // Estimated round-trip commission and fees for one contract.
  commissionDollarsPerContractRoundTrip: 5,

  paperOnly: true,
});

export default ES_PAPER_RISK_CONFIG;
