// services/core/logic/engine25MarketHealth.js

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isNum(value) {
  return Number.isFinite(Number(value));
}

function scoreInverse(value, goodBelow, badAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n <= goodBelow) return 100;
  if (n >= badAbove) return 0;
  return clamp(100 - ((n - goodBelow) / (badAbove - goodBelow)) * 100);
}

function scoreDirect(value, badBelow, goodAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n >= goodAbove) return 100;
  if (n <= badBelow) return 0;
  return clamp(((n - badBelow) / (goodAbove - badBelow)) * 100);
}

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return 50;
  return clamp(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

function weightedAvg(items) {
  const valid = items.filter(
    (item) =>
      item &&
      Number.isFinite(Number(item.value)) &&
      Number.isFinite(Number(item.weight)) &&
      Number(item.weight) > 0
  );

  if (!valid.length) return 50;

  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  const weightedSum = valid.reduce(
    (sum, item) => sum + Number(item.value) * Number(item.weight),
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
  if (isNum(unrate) && Number(unrate) >= 4.8) warnings.push("Unemployment rate elevated");
  if (isNum(initialClaims) && Number(initialClaims) >= 275000) {
    warnings.push("Initial claims rising into caution zone");
  }
  if (isNum(continuingClaims) && Number(continuingClaims) >= 2100000) {
    warnings.push("Continuing claims elevated");
  }

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
  if (isNum(nfci) && Number(nfci) > 0) warnings.push("Financial conditions tightening");
  if (isNum(stlfsi) && Number(stlfsi) > 0.5) warnings.push("Financial stress elevated");
  if (isNum(highYieldSpread) && Number(highYieldSpread) > 4.5) {
    warnings.push("High-yield credit spread widening");
  }

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
  if (isNum(tenYear) && Number(tenYear) >= 4.5) warnings.push("10Y yield pressure elevated");
  if (isNum(twoYear) && Number(twoYear) >= 4.25) warnings.push("2Y yield suggests Fed hawkish pressure");
  if (isNum(tenMinusTwo) && Number(tenMinusTwo) < 0) warnings.push("10Y-2Y curve inverted");
  if (isNum(tenMinusThreeMonth) && Number(tenMinusThreeMonth) < 0) {
    warnings.push("10Y-3M curve inverted");
  }

  return {
    score,
    label:
      score >= 70
        ? "BONDS_SUPPORTIVE"
        : score >= 50
          ? "BONDS_MIXED"
          : "BONDS_PRESSURE",
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
  if (isNum(tgaBalance) && Number(tgaBalance) >= 850000) {
    warnings.push("TGA balance high, liquidity drain risk");
  }
  if (isNum(bankReserves) && Number(bankReserves) < 2800000) {
    warnings.push("Bank reserves low");
  }
  if (isNum(fedBalanceSheet) && Number(fedBalanceSheet) < 6400000) {
    warnings.push("Fed balance sheet liquidity declining");
  }

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

  // v0.2 still uses index-level pressure. Later we upgrade to YoY/MoM inflation rates.
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

    const emaScore =
      boolScore(item.aboveEma10, 25, 0) +
      boolScore(item.aboveEma20, 25, 0) +
      boolScore(item.aboveEma50, 25, 0) +
      boolScore(item.aboveEma200, 25, 0);

    const momentumScore = scoreDirect(item.pctChange20d, -5, 5);

    return weightedAvg([
      { value: emaScore, weight: 0.7 },
      { value: momentumScore, weight: 0.3 },
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
  if (uvxy?.aboveEma10 === true || (isNum(uvxy?.pctChange5d) && uvxy.pctChange5d > 10)) {
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
    return weightedAvg([
      { value: boolScore(item.aboveEma20, 100, 0), weight: 0.35 },
      { value: boolScore(item.aboveEma50, 100, 0), weight: 0.3 },
      { value: scoreDirect(item.pctChange20d, -5, 7), weight: 0.35 },
    ]);
  }

  const riskOnScore = avg(riskOnSymbols.map(simpleSymbolScore));
  const defensiveScore = avg(defensiveSymbols.map(simpleSymbolScore));
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

    const emaScore =
      boolScore(item.aboveEma10, 20, 0) +
      boolScore(item.aboveEma20, 25, 0) +
      boolScore(item.aboveEma50, 25, 0) +
      boolScore(item.aboveEma200, 30, 0);

    const momentumScore = scoreDirect(item.pctChange20d, -8, 12);

    symbolScores[symbol] = weightedAvg([
      { value: emaScore, weight: 0.7 },
      { value: momentumScore, weight: 0.3 },
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

function scoreCreditFragility(marketData) {
  const credit = marketData?.quickRead?.creditFragility || {};
  const marketTrend = marketData?.quickRead?.marketTrend || {};

  const hyg = credit.HYG;
  const jnk = credit.JNK;
  const lqd = credit.LQD;
  const kre = credit.KRE;
  const iwm = marketTrend.IWM;

  function bondFragilityScore(item) {
    if (!item?.ok) return 50;

    const trendScore = weightedAvg([
      { value: boolScore(item.aboveEma10, 100, 0), weight: 0.2 },
      { value: boolScore(item.aboveEma20, 100, 0), weight: 0.3 },
      { value: boolScore(item.aboveEma50, 100, 0), weight: 0.25 },
      { value: boolScore(item.aboveEma200, 100, 0), weight: 0.25 },
    ]);

    const momentumScore = weightedAvg([
      { value: scoreDirect(item.pctChange5d, -3, 2), weight: 0.35 },
      { value: scoreDirect(item.pctChange20d, -5, 3), weight: 0.45 },
      { value: scoreDirect(item.pctChange50d, -8, 5), weight: 0.2 },
    ]);

    return weightedAvg([
      { value: trendScore, weight: 0.65 },
      { value: momentumScore, weight: 0.35 },
    ]);
  }

  function equityFragilityScore(item) {
    if (!item?.ok) return 50;

    const trendScore = weightedAvg([
      { value: boolScore(item.aboveEma10, 100, 0), weight: 0.2 },
      { value: boolScore(item.aboveEma20, 100, 0), weight: 0.3 },
      { value: boolScore(item.aboveEma50, 100, 0), weight: 0.25 },
      { value: boolScore(item.aboveEma200, 100, 0), weight: 0.25 },
    ]);

    const momentumScore = weightedAvg([
      { value: scoreDirect(item.pctChange5d, -5, 3), weight: 0.35 },
      { value: scoreDirect(item.pctChange20d, -8, 5), weight: 0.45 },
      { value: scoreDirect(item.pctChange50d, -12, 8), weight: 0.2 },
    ]);

    return weightedAvg([
      { value: trendScore, weight: 0.65 },
      { value: momentumScore, weight: 0.35 },
    ]);
  }

  const hygScore = bondFragilityScore(hyg);
  const jnkScore = bondFragilityScore(jnk);
  const lqdScore = bondFragilityScore(lqd);
  const kreScore = equityFragilityScore(kre);
  const iwmScore = equityFragilityScore(iwm);

  const score = weightedAvg([
    { value: hygScore, weight: 0.25 },
    { value: jnkScore, weight: 0.25 },
    { value: lqdScore, weight: 0.15 },
    { value: kreScore, weight: 0.2 },
    { value: iwmScore, weight: 0.15 },
  ]);

  const warnings = [];

  if (hyg?.aboveEma20 === false && hyg?.aboveEma50 === false) {
    warnings.push("HYG below EMA20/EMA50; high-yield credit weakening");
  }

  if (jnk?.aboveEma20 === false && jnk?.aboveEma50 === false) {
    warnings.push("JNK below EMA20/EMA50; junk-credit fragility rising");
  }

  if (lqd?.aboveEma20 === false && lqd?.aboveEma50 === false) {
    warnings.push("LQD below EMA20/EMA50; investment-grade bonds under pressure");
  }

  if (kre?.aboveEma20 === false && kre?.aboveEma50 === false) {
    warnings.push("KRE below EMA20/EMA50; regional bank pressure rising");
  }

  if (iwm?.aboveEma20 === false) {
    warnings.push("IWM below EMA20; small-cap borrower/risk appetite weak");
  }

  let creditRegime = "CREDIT_SURFACE_STRONG";

  if (score >= 75) {
    creditRegime = "CREDIT_SURFACE_STRONG";
  } else if (score >= 60) {
    creditRegime = "CREDIT_SURFACE_OK_FRAGILITY_WATCH";
  } else if (score >= 45) {
    creditRegime = "STRONG_SURFACE_FRAGILE_UNDERNEATH";
  } else {
    creditRegime = "LOW_QUALITY_CREDIT_STRESS_RISING";
  }

  return {
    score,
    label:
      score >= 75
        ? "CREDIT_FRAGILITY_LOW"
        : score >= 60
          ? "CREDIT_FRAGILITY_WATCH"
          : score >= 45
            ? "CREDIT_FRAGILITY_ELEVATED"
            : "CREDIT_FRAGILITY_HIGH",
    creditRegime,
    inputs: {
      HYG: hyg,
      JNK: jnk,
      LQD: lqd,
      KRE: kre,
      IWM: iwm,
      hygScore,
      jnkScore,
      lqdScore,
      kreScore,
      iwmScore,
    },
    warnings,
  };
}

function scoreMacroPressure(macroData, marketData, components) {
  const tenYear = getFredValue(macroData, "DGS10");
  const twoYear = getFredValue(macroData, "DGS2");
  const tenMinusTwo = getFredValue(macroData, "T10Y2Y");

  const uso = getSymbol(marketData, "macroProxies", "USO");
  const tlt = getSymbol(marketData, "macroProxies", "TLT");
  const uup = getSymbol(marketData, "macroProxies", "UUP");

  const spy = getSymbol(marketData, "marketTrend", "SPY");
  const qqq = getSymbol(marketData, "marketTrend", "QQQ");
  const iwm = getSymbol(marketData, "marketTrend", "IWM");

  const ai = marketData?.quickRead?.aiLeadership || {};
  const aiSymbols = ["NVDA", "MSFT", "AVGO", "AMD", "META", "GOOGL", "AMZN", "TSM", "ARM", "PLTR"];

  const aiAbove20 = aiSymbols.filter((symbol) => ai[symbol]?.aboveEma20 === true).length;
  const aiAbove50 = aiSymbols.filter((symbol) => ai[symbol]?.aboveEma50 === true).length;

  const tenYearPressureScore = scoreInverse(tenYear, 4.25, 5.0);
  const twoYearPressureScore = scoreInverse(twoYear, 4.0, 5.0);

  const tltTrendScore = weightedAvg([
    { value: boolScore(tlt?.aboveEma20, 100, 0), weight: 0.35 },
    { value: boolScore(tlt?.aboveEma50, 100, 0), weight: 0.35 },
    { value: scoreDirect(tlt?.pctChange20d, -8, 5), weight: 0.3 },
  ]);

  const oilPressureScore = weightedAvg([
    { value: boolScore(uso?.aboveEma20, 30, 80), weight: 0.35 },
    { value: boolScore(uso?.aboveEma50, 30, 80), weight: 0.25 },
    { value: scoreInverse(uso?.pctChange20d, 2, 15), weight: 0.4 },
  ]);

  const dollarPressureScore = weightedAvg([
    { value: boolScore(uup?.aboveEma20, 35, 75), weight: 0.4 },
    { value: scoreInverse(uup?.pctChange20d, 1, 6), weight: 0.6 },
  ]);

  const smallCapParticipationScore = weightedAvg([
    { value: boolScore(iwm?.aboveEma20, 100, 0), weight: 0.45 },
    { value: boolScore(iwm?.aboveEma50, 100, 0), weight: 0.25 },
    { value: scoreDirect(iwm?.pctChange20d, -5, 5), weight: 0.3 },
  ]);

  const aiBreadthScore = weightedAvg([
    { value: scoreDirect(aiAbove20, 3, 8), weight: 0.6 },
    { value: scoreDirect(aiAbove50, 3, 8), weight: 0.4 },
  ]);

  const narrowLeadershipScore = weightedAvg([
    { value: smallCapParticipationScore, weight: 0.45 },
    { value: aiBreadthScore, weight: 0.55 },
  ]);

  const inflationScore = components?.inflation?.score ?? 50;

  const fedHawkishScore = weightedAvg([
    { value: tenYearPressureScore, weight: 0.35 },
    { value: twoYearPressureScore, weight: 0.3 },
    { value: inflationScore, weight: 0.25 },
    { value: scoreDirect(tenMinusTwo, -0.5, 0.75), weight: 0.1 },
  ]);

  const score = weightedAvg([
    { value: tenYearPressureScore, weight: 0.15 },
    { value: twoYearPressureScore, weight: 0.12 },
    { value: tltTrendScore, weight: 0.16 },
    { value: oilPressureScore, weight: 0.18 },
    { value: dollarPressureScore, weight: 0.08 },
    { value: narrowLeadershipScore, weight: 0.16 },
    { value: fedHawkishScore, weight: 0.15 },
  ]);

  const warnings = [];

  if (isNum(tenYear) && Number(tenYear) >= 4.5) {
    warnings.push("10Y yield pressure elevated");
  }

  if (isNum(twoYear) && Number(twoYear) >= 4.25) {
    warnings.push("2Y yield suggests Fed hawkish pressure");
  }

  if (tlt?.aboveEma20 === false && isNum(tlt?.pctChange20d) && Number(tlt.pctChange20d) < 0) {
    warnings.push("TLT weak; bond market pressure rising");
  }

  if (uso?.aboveEma20 === true && isNum(uso?.pctChange20d) && Number(uso.pctChange20d) >= 5) {
    warnings.push("Oil/energy strength may pressure CPI");
  }

  if ((components?.inflation?.score ?? 50) < 50 && uso?.aboveEma20 === true) {
    warnings.push("Inflation pressure plus oil strength creates macro risk");
  }

  if (spy?.aboveEma20 === true && qqq?.aboveEma20 === true && iwm?.aboveEma20 === false) {
    warnings.push("Market leadership narrow: SPY/QQQ holding while small caps lag");
  }

  if (aiAbove20 <= 5) {
    warnings.push("AI leadership breadth is narrowing");
  }

  if (fedHawkishScore < 45) {
    warnings.push("Fed hawkish / higher-for-longer risk elevated");
  }

  return {
    score,
    label:
      score >= 75
        ? "MACRO_PRESSURE_LOW"
        : score >= 60
          ? "MACRO_PRESSURE_MANAGEABLE"
          : score >= 45
            ? "MACRO_PRESSURE_ELEVATED"
            : "MACRO_PRESSURE_HIGH",
    inputs: {
      tenYear,
      twoYear,
      tenMinusTwo,
      USO: uso,
      TLT: tlt,
      UUP: uup,
      SPY: spy,
      QQQ: qqq,
      IWM: iwm,
      aiAbove20,
      aiAbove50,
      tenYearPressureScore,
      twoYearPressureScore,
      tltTrendScore,
      oilPressureScore,
      dollarPressureScore,
      smallCapParticipationScore,
      aiBreadthScore,
      narrowLeadershipScore,
      fedHawkishScore,
    },
    warnings,
  };
}

function scoreDistributionPressure(sectorHealthData) {
  const block = sectorHealthData?.distributionPressure;

  if (!block || block.score === undefined || block.score === null) {
    return {
      score: 50,
      label: "DISTRIBUTION_PRESSURE_UNKNOWN",
      inputs: {},
      warnings: [],
    };
  }

  return {
    score: block.score,
    label: block.label || "DISTRIBUTION_PRESSURE_UNKNOWN",
    inputs: block.inputs || {},
    warnings: block.warnings || [],
  };
}

function scoreBreadthParticipation(sectorHealthData) {
  const block = sectorHealthData?.breadthParticipation;

  if (!block || block.score === undefined || block.score === null) {
    return {
      score: 50,
      label: "BREADTH_PARTICIPATION_UNKNOWN",
      inputs: {},
      warnings: [],
    };
  }

  return {
    score: block.score,
    label: block.label || "BREADTH_PARTICIPATION_UNKNOWN",
    inputs: block.inputs || {},
    warnings: block.warnings || [],
  };
}

function deriveRegime(score, components) {
  const macroPressureScore = components?.macroPressure?.score ?? 50;
  const aiScore = components?.aiLeadership?.score ?? 50;
  const inflationScore = components?.inflation?.score ?? 50;
  const bondScore = components?.bondMarket?.score ?? 50;

  if (score >= 80 && macroPressureScore >= 65) return "STRONG_RISK_ON";

  if (score >= 68 && macroPressureScore < 60) {
    return "AI_SUPPORTED_BULL_WITH_MACRO_PRESSURE";
  }

  if (score >= 68) return "HEALTHY_RISK_ON";

  if (score >= 55 && aiScore >= 65 && macroPressureScore < 55) {
    return "AI_HOLDING_MARKET_UP";
  }

  if (score >= 55) return "MIXED_BULLISH";

  if (score >= 45 && (inflationScore < 50 || bondScore < 55)) {
    return "NEUTRAL_CHOP_WITH_RATE_PRESSURE";
  }

  if (score >= 45) return "NEUTRAL_CHOP";
  if (score >= 35) return "RISK_OFF_WARNING";
  return "MARKET_STRESS";
}

function deriveBias(score, components) {
  const macroPressureScore = components?.macroPressure?.score ?? 50;
  const marketTrendScore = components?.marketTrend?.score ?? 50;
  const volatilityScore = components?.volatility?.score ?? 50;
  const creditFragilityScore = components?.creditFragility?.score ?? 50;

  // Full long bias is not allowed when underlying credit fragility is high.
  if (
    score >= 70 &&
    marketTrendScore >= 65 &&
    volatilityScore >= 60 &&
    macroPressureScore >= 60 &&
    creditFragilityScore >= 55
  ) {
    return "LONG_FAVORED";
  }

  if (score >= 60 && macroPressureScore >= 45) {
    if (creditFragilityScore < 45) return "SELECTIVE_LONGS_CREDIT_FRAGILITY";
    return "SELECTIVE_LONGS";
  }

  if (score >= 55) return "SELECTIVE_LONGS_MACRO_CAUTION";
  if (score >= 45) return "NEUTRAL_WAIT";
  return "DEFENSIVE";
}

function deriveRiskLevel(score) {
  if (score >= 75) return "LOW_TO_MODERATE";
  if (score >= 55) return "MODERATE";
  if (score >= 40) return "ELEVATED";
  return "HIGH";
}

function deriveTradePermission(score, bias, components) {
  const macroPressureScore = components?.macroPressure?.score ?? 50;
  const creditFragilityScore = components?.creditFragility?.score ?? 50;

  // Credit fragility override:
  // Public credit may look calm, but if HYG/JNK/LQD/KRE/IWM are weak,
  // Engine 25 cannot allow full-size aggression.
  if (creditFragilityScore < 45 && score >= 60) {
    return {
      longScalps: true,
      shortScalps: false,
      swingLongs: true,
      swingShorts: false,
      engine22Mode: "SELECTIVE_LONGS_CREDIT_FRAGILITY_REDUCED_SIZE",
      sizeMultiplier: 0.75,
      notes: [
        "Public credit stress may be calm, but credit fragility is elevated underneath.",
        "Avoid weak small caps, regional banks, junk-credit-sensitive names, and overleveraged stocks.",
        "Prefer SPY/QQQ/AI leadership only."
      ],
    };
  }

  if (score >= 70 && bias === "LONG_FAVORED" && macroPressureScore >= 60) {
    return {
      longScalps: true,
      shortScalps: false,
      swingLongs: true,
      swingShorts: false,
      engine22Mode: "NORMAL_LONGS_ALLOWED",
      sizeMultiplier: 1.0,
    };
  }

  if (score >= 60 && macroPressureScore >= 50) {
    return {
      longScalps: true,
      shortScalps: false,
      swingLongs: true,
      swingShorts: false,
      engine22Mode: "SELECTIVE_LONGS_REDUCED_SIZE",
      sizeMultiplier: 0.75,
    };
  }

  if (score >= 55) {
    return {
      longScalps: true,
      shortScalps: false,
      swingLongs: false,
      swingShorts: false,
      engine22Mode: "LONGS_ALLOWED_MACRO_CAUTION_A_PLUS_ONLY",
      sizeMultiplier: 0.5,
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

function deriveEsPermission(score, regime, bias, riskLevel, components, tradePermission) {
  const creditFragilityScore = components?.creditFragility?.score ?? 50;
  const macroPressureScore = components?.macroPressure?.score ?? 50;
  const marketTrendScore = components?.marketTrend?.score ?? 50;
  const aiLeadershipScore = components?.aiLeadership?.score ?? 50;
  const volatilityScore = components?.volatility?.score ?? 50;

  let esBias = "NEUTRAL_WAIT";
  let esMode = "WAIT_FOR_CONFIRMATION";
  let longScalps = false;
  let shortScalps = false;
  let sizeMultiplier = tradePermission?.sizeMultiplier ?? 0.5;

  if (
    score >= 60 &&
    marketTrendScore >= 65 &&
    volatilityScore >= 55 &&
    aiLeadershipScore >= 55
  ) {
    esBias = "SELECTIVE_LONG";
    esMode = "CONFIRMED_LONG_SCALPS_ONLY";
    longScalps = true;
    shortScalps = false;
  }

  if (creditFragilityScore < 45) {
    esMode = "SELECTIVE_LONG_CREDIT_FRAGILITY_REDUCED_SIZE";
    sizeMultiplier = Math.min(sizeMultiplier, 0.75);
  }

  if (macroPressureScore < 50) {
    esMode = "A_PLUS_LONGS_ONLY_MACRO_PRESSURE";
    sizeMultiplier = Math.min(sizeMultiplier, 0.5);
  }

  if (score < 55) {
    esBias = "NEUTRAL_WAIT";
    esMode = "A_PLUS_ONLY_OR_WAIT";
    longScalps = true;
    shortScalps = false;
    sizeMultiplier = Math.min(sizeMultiplier, 0.5);
  }

  if (score < 45) {
    esBias = "DEFENSIVE";
    esMode = "DEFENSIVE_NO_BLIND_LONGS";
    longScalps = false;
    shortScalps = true;
    sizeMultiplier = 0.25;
  }

  const notes = [];

  if (longScalps) {
    notes.push("ES long scalps are allowed only on confirmed reclaim, continuation, or clean pullback-to-support setups.");
  }

  if (!shortScalps) {
    notes.push("No blind ES shorts while market trend, AI leadership, and volatility remain supportive.");
  }

  if (creditFragilityScore < 45) {
    notes.push("Credit fragility is elevated; do not use full-size ES aggression.");
    notes.push("Avoid weak small-cap, regional-bank, junk-credit, and lower-quality sympathy risk.");
  }

  if (macroPressureScore < 60) {
    notes.push("Macro pressure is present; watch TLT, oil/USO, yields, and IWM before increasing ES size.");
  }

  if (regime === "AI_SUPPORTED_BULL_WITH_MACRO_PRESSURE") {
    notes.push("AI/large-cap leadership supports ES, but fragile undercurrents require selective execution.");
  }

  return {
    symbol: "ES",
    instrumentType: "futures",
    bias: esBias,
    mode: esMode,
    longScalps,
    shortScalps,
    swingLongs: tradePermission?.swingLongs ?? false,
    swingShorts: tradePermission?.swingShorts ?? false,
    sizeMultiplier,
    riskLevel,
    sourceRegime: regime,
    sourceBias: bias,
    notes,
  };
}

function normalizeEsTechnicalContext(esTechnicalContextData) {
  const read = esTechnicalContextData?.technicalRead;

  if (!esTechnicalContextData?.ok || !read) {
    return null;
  }

  return {
    ok: true,
    engine: esTechnicalContextData.engine || "engine25.esTechnicalContext.v0.1",
    state: read.state,
    bias: read.bias,
    permission: read.permission,
    requiredAction: read.requiredAction,
    sizeCap: read.sizeCap,
    notes: read.notes || [],
    rules: read.rules || {},
    daily: esTechnicalContextData.daily || null,
    fourHour: esTechnicalContextData.fourHour || null,
    oneHour: esTechnicalContextData.oneHour || null,
    tenMinute: esTechnicalContextData.tenMinute || null,
  };
}

function applyEsTechnicalContextToPermission(esPermission, esTechnicalContext) {
  if (!esTechnicalContext?.ok) {
    return esPermission;
  }

  const technicalSizeCap = Number(esTechnicalContext.sizeCap);
  const currentSize = Number(esPermission?.sizeMultiplier ?? 0.5);

  const sizeMultiplier = Number.isFinite(technicalSizeCap)
    ? Math.min(currentSize, technicalSizeCap)
    : currentSize;

  let mode = esPermission?.mode || "WAIT_FOR_CONFIRMATION";

  if (esTechnicalContext.permission === "A_PLUS_LONGS_ONLY") {
    if (mode.includes("MACRO_PRESSURE")) {
      mode = "A_PLUS_LONGS_ONLY_MACRO_AND_TECHNICAL_PULLBACK";
    } else if (!mode.includes("A_PLUS")) {
      mode = "A_PLUS_LONGS_ONLY_TECHNICAL_PULLBACK";
    }
  }

  if (esTechnicalContext.state === "DAILY_20EMA_SUPPORT_FAILING") {
    mode = "NO_NORMAL_LONGS_DAILY_20EMA_FAILING";
  }

  const notes = [
    ...(esPermission?.notes || []),
    ...(esTechnicalContext.notes || []),
  ];

  return {
    ...esPermission,
    mode,
    sizeMultiplier,
    technicalState: esTechnicalContext.state,
    requiredTechnicalAction: esTechnicalContext.requiredAction,
    notes: [...new Set(notes)],
  };
}

export function computeEngine25MarketHealth({
  macroData,
  marketData,
  fmpData = null,
  sectorHealthData = null,
  esTechnicalContextData = null,
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
  const creditFragility = scoreCreditFragility(marketData);
  const distributionPressure = scoreDistributionPressure(sectorHealthData);
  const breadthParticipation = scoreBreadthParticipation(sectorHealthData);
  const eventRisk = scoreEventRisk(fmpData);

  const baseComponents = {
  labor,
  creditStress,
  creditFragility,
  bondMarket,
  liquidity,
  inflation,
  marketTrend,
  volatility,
  sectorRotation,
  aiLeadership,
  distributionPressure,
  breadthParticipation,
  eventRisk,
};

  const macroPressure = scoreMacroPressure(macroData, marketData, baseComponents);
  const esTechnicalContext = normalizeEsTechnicalContext(esTechnicalContextData);

  const components = {
    ...baseComponents,
    macroPressure,
  };

  const weights = {
  labor: 0.06,
  creditStress: 0.07,
  creditFragility: 0.07,
  bondMarket: 0.07,
  liquidity: 0.07,
  inflation: 0.07,
  marketTrend: 0.13,
  volatility: 0.08,
  sectorRotation: 0.07,
  aiLeadership: 0.08,
  distributionPressure: 0.09,
  breadthParticipation: 0.07,
  eventRisk: 0.03,
  macroPressure: 0.07,
};

  const score = clamp(
    Object.entries(weights).reduce((sum, [key, weight]) => {
      return sum + (components[key]?.score ?? 50) * weight;
    }, 0)
  );

  const regime = deriveRegime(score, components);
  const bias = deriveBias(score, components);
  const riskLevel = deriveRiskLevel(score);
  const tradePermission = deriveTradePermission(score, bias, components);

  const baseEsPermission = deriveEsPermission(
    score,
    regime,
    bias,
    riskLevel,
    components,
    tradePermission
  );

  const esPermission = applyEsTechnicalContextToPermission(
    baseEsPermission,
    esTechnicalContext
  );

  const warnings = Object.values(components)
    .flatMap((component) => component.warnings || [])
    .filter(Boolean)
    .slice(0, 30);

  return {
    ok: true,
    engine: "engine25.marketHealth.v0.2",
    updatedAt: new Date().toISOString(),
    score,
    regime,
    bias,
    riskLevel,
    weights,
    components,
    warnings,
    tradePermission,
    esPermission, 
    summary: {
      plainEnglish:
        score >= 70
          ? "Market health is supportive, but macro pressure must still be watched. Long setups are favored only when bonds, oil, and volatility are not actively pressuring the tape."
          : score >= 60
            ? "Market health is constructive but fragile. AI leadership may support the market, but bond yields, oil, inflation, or Fed hawkish risk require reduced size."
            : score >= 55
              ? "Market health is mixed. Selective long setups are allowed, but macro pressure requires A+ quality only."
              : score >= 45
                ? "Market health is choppy. Only A+ setups should be considered."
                : "Market health is defensive. Reduce risk and avoid blind long exposure.",
    },
  };
}
