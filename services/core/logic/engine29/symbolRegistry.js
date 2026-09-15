// services/core/logic/engine29/symbolRegistry.js

import {
  ENGINE29_EVIDENCE_QUALITY,
  ENGINE29_GROUP_IDS,
  ENGINE29_STRESS_DIRECTIONS,
} from "./constants.js";

function polygon(symbol) {
  return Object.freeze({
    provider: "POLYGON",
    symbol,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.DIRECT,
    isProxy: false,
    proxyFor: null,
  });
}

function fred(seriesId) {
  return Object.freeze({
    provider: "FRED",
    seriesId,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.DIRECT,
    isProxy: false,
    proxyFor: null,
  });
}

function polygonProxy(symbol, proxyFor) {
  return Object.freeze({
    provider: "POLYGON",
    symbol,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.PROXY,
    isProxy: true,
    proxyFor,
  });
}

function pendingDirect(canonicalInstrument) {
  return Object.freeze({
    provider: "PENDING_DIRECT_FEED_VERIFICATION",
    canonicalInstrument,
    evidenceQuality: ENGINE29_EVIDENCE_QUALITY.MISSING,
    isProxy: false,
    proxyFor: null,
  });
}

export const ENGINE29_SYMBOL_REGISTRY = Object.freeze({
  SPX: {
    canonicalSymbol: "SPX",
    label: "S&P 500 Index",
    group: ENGINE29_GROUP_IDS.HEADLINE_INDEX,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: pendingDirect("SPX"),
    fallback: polygonProxy("SPY", "SPX"),
  },
  SPY: {
    canonicalSymbol: "SPY",
    label: "S&P 500 ETF",
    group: ENGINE29_GROUP_IDS.HEADLINE_INDEX,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("SPY"),
    fallback: null,
  },
  NDX: {
    canonicalSymbol: "NDX",
    label: "Nasdaq-100 Index",
    group: ENGINE29_GROUP_IDS.HEADLINE_INDEX,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: pendingDirect("NDX"),
    fallback: polygonProxy("QQQ", "NDX"),
  },
  QQQ: {
    canonicalSymbol: "QQQ",
    label: "Nasdaq-100 ETF",
    group: ENGINE29_GROUP_IDS.HEADLINE_INDEX,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("QQQ"),
    fallback: null,
  },

  IWM: {
    canonicalSymbol: "IWM",
    label: "Russell 2000 ETF",
    group: ENGINE29_GROUP_IDS.BREADTH,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("IWM"),
    fallback: null,
  },
  MDY: {
    canonicalSymbol: "MDY",
    label: "S&P MidCap 400 ETF",
    group: ENGINE29_GROUP_IDS.BREADTH,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("MDY"),
    fallback: null,
  },
  RSP: {
    canonicalSymbol: "RSP",
    label: "Equal-Weight S&P 500 ETF",
    group: ENGINE29_GROUP_IDS.BREADTH,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("RSP"),
    fallback: null,
  },

  SMH: {
    canonicalSymbol: "SMH",
    label: "VanEck Semiconductor ETF",
    group: ENGINE29_GROUP_IDS.LEADERSHIP,
    subgroup: "SEMICONDUCTOR_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("SMH"),
    fallback: null,
  },
  SOX: {
    canonicalSymbol: "SOX",
    label: "Philadelphia Semiconductor Index",
    group: ENGINE29_GROUP_IDS.LEADERSHIP,
    subgroup: "SEMICONDUCTOR_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: pendingDirect("SOX"),
    fallback: null,
  },
  XLK: {
    canonicalSymbol: "XLK",
    label: "Technology Select Sector ETF",
    group: ENGINE29_GROUP_IDS.LEADERSHIP,
    subgroup: "TECHNOLOGY_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("XLK"),
    fallback: null,
  },

  HYG: {
    canonicalSymbol: "HYG",
    label: "High Yield Corporate Bond ETF",
    group: ENGINE29_GROUP_IDS.CREDIT,
    subgroup: "HIGH_YIELD_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("HYG"),
    fallback: null,
  },
  JNK: {
    canonicalSymbol: "JNK",
    label: "High Yield Bond ETF",
    group: ENGINE29_GROUP_IDS.CREDIT,
    subgroup: "HIGH_YIELD_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: false,
    primary: polygon("JNK"),
    fallback: null,
  },
  LQD: {
    canonicalSymbol: "LQD",
    label: "Investment Grade Corporate Bond ETF",
    group: ENGINE29_GROUP_IDS.CREDIT,
    subgroup: "QUALITY_CREDIT_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: false,
    primary: polygon("LQD"),
    fallback: null,
  },
  XLF: {
    canonicalSymbol: "XLF",
    label: "Financial Select Sector ETF",
    group: ENGINE29_GROUP_IDS.CREDIT,
    subgroup: "FINANCIAL_BANK_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("XLF"),
    fallback: null,
  },
  KRE: {
    canonicalSymbol: "KRE",
    label: "Regional Bank ETF",
    group: ENGINE29_GROUP_IDS.CREDIT,
    subgroup: "FINANCIAL_BANK_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: false,
    primary: polygon("KRE"),
    fallback: null,
  },

  US10Y: {
    canonicalSymbol: "US10Y",
    label: "U.S. 10-Year Treasury Yield",
    group: ENGINE29_GROUP_IDS.RATES_DURATION,
    subgroup: "YIELD_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.HIGHER,
    required: true,
    primary: fred("DGS10"),
    fallback: null,
  },
  US30Y: {
    canonicalSymbol: "US30Y",
    label: "U.S. 30-Year Treasury Yield",
    group: ENGINE29_GROUP_IDS.RATES_DURATION,
    subgroup: "YIELD_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.HIGHER,
    required: true,
    primary: fred("DGS30"),
    fallback: null,
  },
  TLT: {
    canonicalSymbol: "TLT",
    label: "20+ Year Treasury Bond ETF",
    group: ENGINE29_GROUP_IDS.RATES_DURATION,
    subgroup: "DURATION_BLOCK",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.LOWER,
    required: true,
    primary: polygon("TLT"),
    fallback: null,
  },

  WTI: {
    canonicalSymbol: "WTI",
    label: "West Texas Intermediate Crude Oil",
    group: ENGINE29_GROUP_IDS.ENERGY_INFLATION,
    subgroup: "OIL_COMPLEX",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.HIGHER,
    required: true,
    primary: pendingDirect("WTI"),
    fallback: polygonProxy("USO", "WTI"),
  },
  BRENT: {
    canonicalSymbol: "BRENT",
    label: "Brent Crude Oil",
    group: ENGINE29_GROUP_IDS.ENERGY_INFLATION,
    subgroup: "OIL_COMPLEX",
    stressDirection: ENGINE29_STRESS_DIRECTIONS.HIGHER,
    required: true,
    primary: pendingDirect("BRENT"),
    fallback: null,
  },

  VIX: {
    canonicalSymbol: "VIX",
    label: "CBOE Volatility Index",
    group: ENGINE29_GROUP_IDS.VOLATILITY,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.HIGHER,
    required: true,
    primary: pendingDirect("VIX"),
    fallback: polygonProxy("UVXY", "VIX"),
  },

  DXY: {
    canonicalSymbol: "DXY",
    label: "U.S. Dollar Index",
    group: ENGINE29_GROUP_IDS.FINANCIAL_CONDITIONS,
    stressDirection: ENGINE29_STRESS_DIRECTIONS.CONTEXTUAL,
    required: true,
    primary: pendingDirect("DXY"),
    fallback: polygonProxy("UUP", "DXY"),
  },
});

export const ENGINE29_REQUIRED_SYMBOLS = Object.freeze(
  Object.values(ENGINE29_SYMBOL_REGISTRY)
    .filter((item) => item.required)
    .map((item) => item.canonicalSymbol)
);

export function getEngine29SymbolDefinition(symbol) {
  return ENGINE29_SYMBOL_REGISTRY[String(symbol || "").toUpperCase()] || null;
}

export function getEngine29SymbolsForGroup(group) {
  return Object.values(ENGINE29_SYMBOL_REGISTRY).filter(
    (item) => item.group === group
  );
}
