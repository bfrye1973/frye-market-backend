// services/core/logic/engine25MarketHealth.js

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function valueAt(path, fallback = null) {
  return path === undefined || path === null ? fallback : path;
}

function scoreInverse(value, goodBelow, badAbove) {
  if (!Number.isFinite(value)) return 50;
  if (value <= goodBelow) return 100;
  if (value >= badAbove) return 0;
  return clamp(100 - ((value - goodBelow) / (badAbove - goodBelow)) * 100);
}

function scoreDirect(value, badBelow, goodAbove) {
  if (!Number.isFinite(value)) return 50;
  if (value >= goodAbove) return 100;
  if (value <= badBelow) return 0;
  return clamp(((value - badBelow) / (goodAbove - badBelow)) * 100);
}

function avg(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return 50;
  return clamp(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

function weightedAvg(items) {
  const valid = items.filter(
    (item) =>
      item &&
      Number.isFinite(item.value) &&
      Number.isFinite(item.weight) &&
      item.weight > 0
  );

  if (!valid.length) return 50;

  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  const weightedSum = valid.reduce(
    (sum, item) => sum + item.value * item.weight,
    0
  );

  return clamp(weightedSum / totalWeight);
}

function boolScore(value, trueScore = 100, falseScore = 0, unknownScore = 50) {
  if (value === true) return trueScore;
  if (value === false) return falseScore;
  return unknownScore;
}

function getFredValue(macroData, key) {
  return macroData?.sources?.fred?.latest?.[key]?.value ?? null;
}

function getTgaBalance(macroData) {
  return (
    macroData?.quickRead?.liquidityConditions?.treasuryOperatingCashBalance
      ?.effective_balance ?? null
  );
}

function getSymbol(marketData, group, symbol) {
  return marketData?.quickRead?.[group]?.[symbol] ?? null;
}

function scoreLabor(macroData) {
  const unrate = getFredValue(macroData, "UNRATE");
  const initialClaims = getFredValue(macroData, "ICSA");
  const continuingClaims = getFredValue(macroData, "CCSA");

  const unemploymentScore = scoreInverse(unrate, 3.8, 5.5);
  const initialClaimsScore = scoreInverse(initialClaims, 200000, 325000);
  const continuingClaimsScore = scoreInverse(continuingClaims, 1700000, 2300000);

  const score = weightedAvg([
  { value: unemploymentScore, weight: 0.4 },
  { value: initialClaimsScore, weight: 0.35 },
  { value: continuingClaimsScore, weight: 0.25 },
]);

  const warnings = [];
  if (unrate >= 4.8) warnings.push("Unemployment rate elevated");
  if (initialClaims >= 275000) warnings.push("Initial claims rising into caution zone");
  if (continuingClaims >= 2100000) warnings.push("Continuing claims elevated");

  return {
    score,
    label: score >= 70 ? "LABOR_HEALTHY" : score >= 50 ? "LABOR_MIXED" : "LABOR_WEAK",
    inputs: {
      unemploymentRate: unrate,
      initialClaims,
      continuingClaims,
      unemploymentScore,
      initialClaimsScore,
      continuingClaimsScore,
    },
    warnings,
  };
}

function scoreCreditStress(macroData) {
  const nfci = getFredValue(macroData, "NFCI");
  const stlfsi = getFredValue(macroData, "STLFSI4");
  const highYieldSpread = getFredValue(macroData, "BAMLH0A0HYM2");

  const nfciScore = scoreInverse(nfci, -0.5, 0.5);
  const stlfsiScore = scoreInverse(stlfsi, -0.5, 1.0);
  const hyScore = scoreInverse(highYieldSpread, 3.0, 6.0);

  const score = weightedAvg([
  { value: nfciScore, weight: 0.35 },
  { value: stlfsiScore, weight: 0.35 },
  { value: hyScore, weight: 0.3 },
]);

  const warnings = [];
  if (nfci > 0) warnings.push("Financial conditions tightening");
  if (stlfsi > 0.5) warnings.push("Financial stress elevated");
  if (highYieldSpread > 4.5) warnings.push("High-yield credit spread widening");

  return {
    score,
    label:
      score >= 75
        ? "CREDIT_STRESS_LOW"
        : score >= 50
          ? "CREDIT_STRESS_NORMAL"
          : "CREDIT_STRESS_HIGH",
    inputs: {
      nfci,
      stlfsi,
      highYieldSpread,
      nfciScore,
      stlfsiScore,
      hyScore,
    },
    warnings,
  };
}

function scoreBondMarket(macroData) {
  const tenYear = getFredValue(macroData, "DGS10");
  const twoYear = getFredValue(macroData, "DGS2");
  const tenMinusTwo = getFredValue(macroData, "T10Y2Y");
  const tenMinusThreeMonth = getFredValue(macroData, "T10Y3M");

  const tenYearScore = scoreInverse(tenYear, 3.75, 5.25);
  const twoYearScore = scoreInverse(twoYear, 3.5, 5.25);
  const curveScore = scoreDirect(tenMinusTwo, -0.75, 0.75);
  const threeMonthCurveScore = scoreDirect(tenMinusThreeMonth, -1.0, 1.0);

  const score = weightedAvg([
  { value: tenYearScore, weight: 0.3 },
  { value: twoYearScore, weight: 0.25 },
  { value: curveScore, weight: 0.25 },
  { value: threeMonthCurveScore, weight: 0.2 },
]);

  const warnings = [];
  if (tenYear >= 4.75) warnings.push("10Y yield elevated");
  if (twoYear >= 4.75) warnings.push("2Y yield elevated");
  if (tenMinusTwo < 0) warnings.push("10Y-2Y curve inverted");
  if (tenMinusThreeMonth < 0) warnings.push("10Y-3M curve inverted");

  return {
    score,
    label: score >= 70 ? "BONDS_SUPPORTIVE" : score >= 50 ? "BONDS_MIXED" : "BONDS_PRESSURE",
    inputs: {
      tenYear,
      twoYear,
      tenMinusTwo,
      tenMinusThreeMonth,
      tenYearScore,
      twoYearScore,
      curveScore,
      threeMonthCurveScore,
    },
    warnings,
  };
}

function scoreLiquidity(macroData) {
  const fedBalanceSheet = getFredValue(macroData, "WALCL");
  const reverseRepo = getFredValue(macroData, "RRPONTSYD");
  const bankReserves = getFredValue(macroData, "WRESBAL");
  const m2 = getFredValue(macroData, "M2SL");
  const tgaBalance = getTgaBalance(macroData);

  const fedBalanceSheetScore = scoreDirect(fedBalanceSheet, 6000000, 8000000);
  const reverseRepoScore = scoreInverse(reverseRepo, 100, 1200);
  const bankReservesScore = scoreDirect(bankReserves, 2500000, 3600000);
  const m2Score = scoreDirect(m2, 20000, 23500);
  const tgaScore = scoreInverse(tgaBalance, 500000, 1000000);

  const score = weightedAvg([
  { value: fedBalanceSheetScore, weight: 0.2 },
  { value: reverseRepoScore, weight: 0.15 },
  { value: bankReservesScore, weight: 0.25 },
  { value: m2Score, weight: 0.2 },
  { value: tgaScore, weight: 0.2 },
]);

  const warnings = [];
  if (tgaBalance >= 850000) warnings.push("TGA balance high, liquidity drain risk");
  if (bankReserves < 2800000) warnings.push("Bank reserves low");
  if (fedBalanceSheet < 6400000) warnings.push("Fed balance sheet liquidity declining");

  return {
    score,
    label:
      score >= 70
        ? "LIQUIDITY_SUPPORTIVE"
        : score >= 50
          ? "LIQUIDITY_MIXED"
          : "LIQUIDITY_TIGHT",
    inputs: {
      fedBalanceSheet,
      reverseRepo,
      bankReserves,
      m2,
      tgaBalance,
      fedBalanceSheetScore,
      reverseRepoScore,
      bankReservesScore,
      m2Score,
      tgaScore,
    },
    warnings,
  };
}

function scoreInflation(macroData) {
  const cpi = getFredValue(macroData, "CPIAUCSL");
  const ppi = getFredValue(macroData, "PPIACO");

  // First version uses index-level zones. Later we will upgrade to YoY/MoM rates.
  const cpiScore = scoreInverse(cpi, 315, 345);
  const ppiScore = scoreInverse(ppi, 260, 300);

  const score = weightedAvg([
   { value: cpiScore, weight: 0.55 },
   { value: ppiScore, weight: 0.45 },
 ]); 
  const warnings = [];
  if (score < 50) warnings.push("Inflation index pressure remains elevated");

  return {
    score,
    label:
      score >= 70
        ? "INFLATION_COOLING"
        : score >= 50
          ? "INFLATION_MIXED"
          : "INFLATION_PRESSURE",
    inputs: {
      cpi,
      ppi,
      cpiScore,
      ppiScore,
    },
    warnings,
  };
}

function scoreMarketTrend(marketData) {
  const spy = getSymbol(marketData, "marketTrend", "SPY");
  const qqq = getSymbol(marketData, "marketTrend", "QQQ");
  const iwm = getSymbol(marketData, "marketTrend", "IWM");
  const dia = getSymbol(marketData, "marketTrend", "DIA");

  function symbolTrendScore(item) {
    if (!item?.ok) return 50;

    return avg([
      boolScore(item.aboveEma10, 25, 0),
      boolScore(item.aboveEma20, 25, 0),
      boolScore(item.aboveEma50, 25, 0),
      boolScore(item.aboveEma200, 25, 0),
      scoreDirect(item.pctChange20d, -5, 5),
    ]);
  }

  const spyScore = symbolTrendScore(spy);
  const qqqScore = symbolTrendScore(qqq);
  const iwmScore = symbolTrendScore(iwm);
  const diaScore = symbolTrendScore(dia);

  const score = weightedAvg([
  { value: spyScore, weight: 0.35 },
  { value: qqqScore, weight: 0.35 },
  { value: iwmScore, weight: 0.15 },
  { value: diaScore, weight: 0.15 },
]);

  const warnings = [];
  if (iwm?.aboveEma10 === false || iwm?.aboveEma20 === false) {
    warnings.push("Small caps lagging short-term trend");
  }
  if (spy?.aboveEma20 === false) warnings.push("SPY below Daily EMA20");
  if (qqq?.aboveEma20 === false) warnings.push("QQQ below Daily EMA20");

  return {
    score,
    label:
      score >= 75
        ? "MARKET_TREND_STRONG"
        : score >= 55
          ? "MARKET_TREND_HEALTHY"
          : "MARKET_TREND_WEAK",
    inputs: {
      SPY: spy,
      QQQ: qqq,
      IWM: iwm,
      DIA: dia,
      spyScore,
      qqqScore,
      iwmScore,
      diaScore,
    },
    warnings,
  };
}

function scoreVolatility(marketData) {
  const uvxy = getSymbol(marketData, "volatility", "UVXY");

  const emaScore = avg([
    boolScore(uvxy?.aboveEma10, 0, 100),
    boolScore(uvxy?.aboveEma20, 0, 100),
    boolScore(uvxy?.aboveEma50, 0, 100),
    boolScore(uvxy?.aboveEma200, 0, 100),
  ]);

  const changeScore = scoreInverse(uvxy?.pctChange20d, -10, 25);
  const score = weightedAvg([
  { value: emaScore, weight: 0.65 },
  { value: changeScore, weight: 0.35 },
]);

  const warnings = [];
  if (uvxy?.aboveEma10 === true || uvxy?.pctChange5d > 10) {
    warnings.push("UVXY volatility pressure rising");
  }

  return {
    score,
    label:
      score >= 75
        ? "VOLATILITY_CALM"
        : score >= 50
          ? "VOLATILITY_NORMAL"
          : "VOLATILITY_RISING",
    inputs: {
      UVXY: uvxy,
      emaScore,
      changeScore,
    },
    warnings,
  };
}

function scoreSectorRotation(marketData) {
  const sector = marketData?.quickRead?.sectorRotation || {};

  const riskOnSymbols = ["XLK", "XLY", "XLF", "XLI", "SMH", "IGV"];
  const defensiveSymbols = ["XLP", "XLU", "XLV"];

  function simpleSymbolScore(symbol) {
    const item = sector[symbol];
    if (!item?.ok) return 50;
    return avg([
      boolScore(item.aboveEma20, 100, 0),
      boolScore(item.aboveEma50, 100, 0),
      scoreDirect(item.pctChange20d, -5, 7),
    ]);
  }

  const riskOnScore = avg(riskOnSymbols.map(simpleSymbolScore));
  const defensiveScore = avg(defensiveSymbols.map(simpleSymbolScore));

  // Risk-on leadership good. Defensive leadership is not bad by itself,
  // but if defensive is stronger than risk-on, reduce the score.
  const spreadScore = clamp(50 + (riskOnScore - defensiveScore));
  const score = weightedAvg([
  { value: riskOnScore, weight: 0.7 },
  { value: spreadScore, weight: 0.3 },
]);
  
  const warnings = [];
  if (riskOnScore < defensiveScore) {
    warnings.push("Defensive sectors outperforming risk-on sectors");
  }
  if (sector.SMH?.aboveEma20 === false) {
    warnings.push("Semiconductors below EMA20");
  }

  return {
    score,
    label:
      score >= 70
        ? "RISK_ON_ROTATION"
        : score >= 50
          ? "MIXED_ROTATION"
          : "DEFENSIVE_ROTATION",
    inputs: {
      riskOnScore,
      defensiveScore,
      spreadScore,
      symbols: sector,
    },
    warnings,
  };
}

function scoreAiLeadership(marketData) {
  const ai = marketData?.quickRead?.aiLeadership || {};

  const leadershipSymbols = [
    "NVDA",
    "MSFT",
    "AVGO",
    "AMD",
    "META",
    "GOOGL",
    "AMZN",
    "TSM",
    "ARM",
    "PLTR",
  ];

  const symbolScores = {};

  for (const symbol of leadershipSymbols) {
    const item = ai[symbol];
    if (!item?.ok) {
      symbolScores[symbol] = 50;
      continue;
    }

    symbolScores[symbol] = avg([
      boolScore(item.aboveEma10, 100, 0),
      boolScore(item.aboveEma20, 100, 0),
      boolScore(item.aboveEma50, 100, 0),
      boolScore(item.aboveEma200, 100, 0),
      scoreDirect(item.pctChange20d, -8, 12),
    ]);
  }

  const score = avg(Object.values(symbolScores));

  const warnings = [];
  if (symbolScores.NVDA < 60) warnings.push("NVDA leadership weakening");
  if (symbolScores.META < 40) warnings.push("META below major AI leadership trend");
  if (symbolScores.PLTR < 40) warnings.push("PLTR below major AI leadership trend");

  return {
    score,
    label:
      score >= 75
        ? "AI_LEADERSHIP_STRONG"
        : score >= 55
          ? "AI_LEADERSHIP_MIXED_SUPPORTIVE"
          : "AI_LEADERSHIP_WEAK",
    inputs: {
      symbolScores,
      symbols: ai,
    },
    warnings,
  };
}

function scoreEventRisk(fmpData) {
  const economicEvents = fmpData?.quickRead?.economicCalendar || [];
  const earningsEvents = fmpData?.quickRead?.earningsCalendar || [];
  const newsItems = fmpData?.quickRead?.stockNews || [];

  const usHighImpactEvents = economicEvents.filter(
    (event) => event.country === "US" && String(event.impact).toLowerCase() === "high"
  );

  const majorAiSymbols = new Set([
    "NVDA",
    "MSFT",
    "AVGO",
    "AMD",
    "META",
    "GOOGL",
    "AMZN",
    "TSM",
    "ARM",
    "PLTR",
  ]);

  const aiEarnings = earningsEvents.filter((event) =>
    majorAiSymbols.has(String(event.symbol || "").toUpperCase())
  );

  const riskPenalty =
    Math.min(usHighImpactEvents.length * 8, 32) +
    Math.min(aiEarnings.length * 10, 30);

  const score = clamp(100 - riskPenalty);

  const warnings = [];
  if (usHighImpactEvents.length > 0) {
    warnings.push(`${usHighImpactEvents.length} high-impact U.S. economic event(s) ahead`);
  }
  if (aiEarnings.length > 0) {
    warnings.push(`${aiEarnings.length} AI leadership earnings event(s) ahead`);
  }

  return {
    score,
    label:
      score >= 80
        ? "EVENT_RISK_LOW"
        : score >= 60
          ? "EVENT_RISK_MODERATE"
          : "EVENT_RISK_HIGH",
    inputs: {
      usHighImpactEvents: usHighImpactEvents.slice(0, 10),
      aiEarnings: aiEarnings.slice(0, 10),
      newsSample: newsItems.slice(0, 5),
      economicEventCount: economicEvents.length,
      earningsEventCount: earningsEvents.length,
      newsCount: newsItems.length,
    },
    warnings,
  };
}

function deriveRegime(score, components) {
  if (score >= 80) return "STRONG_RISK_ON";
  if (score >= 68) return "HEALTHY_RISK_ON";
  if (score >= 55) return "MIXED_BULLISH";
  if (score >= 45) return "NEUTRAL_CHOP";
  if (score >= 35) return "RISK_OFF_WARNING";
  return "MARKET_STRESS";
}

function deriveBias(score, components) {
  if (score >= 68 && components.marketTrend?.score >= 65 && components.volatility?.score >= 60) {
    return "LONG_FAVORED";
  }

  if (score >= 55) return "SELECTIVE_LONGS";

  if (score >= 45) return "NEUTRAL_WAIT";

  return "DEFENSIVE";
}

function deriveRiskLevel(score, components) {
  if (score >= 75) return "LOW_TO_MODERATE";
  if (score >= 55) return "MODERATE";
  if (score >= 40) return "ELEVATED";
  return "HIGH";
}

function deriveTradePermission(score, bias, components) {
  if (score >= 70 && bias === "LONG_FAVORED") {
    return {
      longScalps: true,
      shortScalps: false,
      swingLongs: true,
      swingShorts: false,
      engine22Mode: "NORMAL_LONGS_ALLOWED",
      sizeMultiplier: 1.0,
    };
  }

  if (score >= 55) {
    return {
      longScalps: true,
      shortScalps: false,
      swingLongs: true,
      swingShorts: false,
      engine22Mode: "SELECTIVE_LONGS_REDUCED_SIZE",
      sizeMultiplier: 0.75,
    };
  }

  if (score >= 45) {
    return {
      longScalps: true,
      shortScalps: true,
      swingLongs: false,
      swingShorts: false,
      engine22Mode: "A_PLUS_ONLY_CHOP_MODE",
      sizeMultiplier: 0.5,
    };
  }

  return {
    longScalps: false,
    shortScalps: true,
    swingLongs: false,
    swingShorts: true,
    engine22Mode: "DEFENSIVE_RISK_OFF",
    sizeMultiplier: 0.25,
  };
}

export function computeEngine25MarketHealth({
  macroData,
  marketData,
  fmpData = null,
} = {}) {
  const labor = scoreLabor(macroData);
  const creditStress = scoreCreditStress(macroData);
  const bondMarket = scoreBondMarket(macroData);
  const liquidity = scoreLiquidity(macroData);
  const inflation = scoreInflation(macroData);

  const marketTrend = scoreMarketTrend(marketData);
  const volatility = scoreVolatility(marketData);
  const sectorRotation = scoreSectorRotation(marketData);
  const aiLeadership = scoreAiLeadership(marketData);

  const eventRisk = scoreEventRisk(fmpData);

  const components = {
    labor,
    creditStress,
    bondMarket,
    liquidity,
    inflation,
    marketTrend,
    volatility,
    sectorRotation,
    aiLeadership,
    eventRisk,
  };

  const weights = {
    labor: 0.08,
    creditStress: 0.11,
    bondMarket: 0.09,
    liquidity: 0.1,
    inflation: 0.08,
    marketTrend: 0.18,
    volatility: 0.11,
    sectorRotation: 0.1,
    aiLeadership: 0.1,
    eventRisk: 0.05,
  };

  const score = clamp(
    Object.entries(weights).reduce((sum, [key, weight]) => {
      return sum + (components[key]?.score ?? 50) * weight;
    }, 0)
  );

  const regime = deriveRegime(score, components);
  const bias = deriveBias(score, components);
  const riskLevel = deriveRiskLevel(score, components);
  const tradePermission = deriveTradePermission(score, bias, components);

  const warnings = Object.values(components)
    .flatMap((component) => component.warnings || [])
    .slice(0, 20);

  return {
    ok: true,
    engine: "engine25.marketHealth.v0.1",
    updatedAt: new Date().toISOString(),
    score,
    regime,
    bias,
    riskLevel,
    weights,
    components,
    warnings,
    tradePermission,
    summary: {
      plainEnglish:
        score >= 70
          ? "Market health is supportive. Long setups are favored, but event risk and weak pockets should still be respected."
          : score >= 55
            ? "Market health is mixed but constructive. Long setups are allowed with selectivity and reduced size."
            : score >= 45
              ? "Market health is choppy. Only A+ setups should be considered."
              : "Market health is defensive. Reduce risk and avoid blind long exposure.",
    },
  };
}
