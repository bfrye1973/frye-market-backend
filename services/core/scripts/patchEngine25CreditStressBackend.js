// patchEngine25CreditStressBackend.js
//
// Purpose:
// 1. Patch services/core/routes/engine25FullDashboard.js
// 2. Add creditStressDetail to the Engine 25 full-dashboard response
// 3. Fix live component score extraction when components are full objects
//
// This patch does NOT change:
// - Engine 25 scoring
// - Engine 6 permission
// - Engine 22 logic
// - execution or paper trading

import fs from "fs";
import path from "path";

const TARGET_FILE = path.resolve(
  process.cwd(),
  "services/core/routes/engine25FullDashboard.js"
);

const BACKUP_FILE = path.resolve(
  process.cwd(),
  "services/core/routes/engine25FullDashboard.before-credit-stress.js"
);

function fail(message) {
  console.error(`\n[Engine25 Credit Stress Patch] ERROR: ${message}\n`);
  process.exit(1);
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    fail(`Could not find required anchor: ${label}`);
  }

  return source.replace(search, replacement);
}

if (!fs.existsSync(TARGET_FILE)) {
  fail(`Target file not found: ${TARGET_FILE}`);
}

const original = fs.readFileSync(TARGET_FILE, "utf8");

if (!fs.existsSync(BACKUP_FILE)) {
  fs.writeFileSync(BACKUP_FILE, original);
  console.log(`[Backup] Created ${BACKUP_FILE}`);
} else {
  console.log(`[Backup] Existing backup preserved: ${BACKUP_FILE}`);
}

if (
  original.includes("function buildCreditStressDetail(") &&
  original.includes("creditStressDetail,")
) {
  console.log(
    "[Engine25 Credit Stress Patch] Patch already appears to be installed."
  );
  process.exit(0);
}

let output = original;

/*
|--------------------------------------------------------------------------
| 1. Fix live component score extraction
|--------------------------------------------------------------------------
|
| Engine 25 components are full objects:
|
| {
|   score,
|   label,
|   inputs,
|   warnings
| }
|
| The old route attempted Number(componentObject), which returned null.
|
*/

const oldLiveBreakdown = `function buildLiveComponentBreakdown(marketHealth) {
  const components = marketHealth?.components || {};

  return [
    {
      key: "labor",
      label: "Labor",
      score: safeNumber(components.labor),
      color: scoreColor(components.labor),
      direction: "higher_is_better",
    },
    {
      key: "creditStress",
      label: "Credit Stress",
      score: safeNumber(components.creditStress),
      color: scoreColor(components.creditStress),
      direction: "higher_is_better",
    },
    {
      key: "creditFragility",
      label: "Credit Fragility",
      score: safeNumber(components.creditFragility),
      color: scoreColor(components.creditFragility),
      direction: "higher_is_better",
    },
    {
      key: "liquidity",
      label: "Liquidity",
      score: safeNumber(components.liquidity),
      color: scoreColor(components.liquidity),
      direction: "higher_is_better",
    },
    {
      key: "marketTrend",
      label: "Market Trend",
      score: safeNumber(components.marketTrend),
      color: scoreColor(components.marketTrend),
      direction: "higher_is_better",
    },
    {
      key: "distributionPressure",
      label: "Distribution Pressure",
      score: safeNumber(components.distributionPressure),
      color: scoreColor(components.distributionPressure, true),
      direction: "lower_is_better",
    },
    {
      key: "breadthParticipation",
      label: "Breadth Participation",
      score: safeNumber(components.breadthParticipation),
      color: scoreColor(components.breadthParticipation),
      direction: "higher_is_better",
    },
    {
      key: "aiLeadership",
      label: "AI Leadership",
      score: safeNumber(components.aiLeadership),
      color: scoreColor(components.aiLeadership),
      direction: "higher_is_better",
    },
  ];
}`;

const newLiveBreakdown = `function componentScore(component) {
  return safeNumber(component?.score ?? component);
}

function buildLiveComponentBreakdown(marketHealth) {
  const components = marketHealth?.components || {};

  return [
    {
      key: "labor",
      label: "Labor",
      score: componentScore(components.labor),
      color: scoreColor(componentScore(components.labor)),
      direction: "higher_is_better",
    },
    {
      key: "creditStress",
      label: "Credit Stress",
      score: componentScore(components.creditStress),
      color: scoreColor(componentScore(components.creditStress)),
      direction: "higher_is_better",
    },
    {
      key: "creditFragility",
      label: "Credit Fragility",
      score: componentScore(components.creditFragility),
      color: scoreColor(componentScore(components.creditFragility)),
      direction: "higher_is_better",
    },
    {
      key: "liquidity",
      label: "Liquidity",
      score: componentScore(components.liquidity),
      color: scoreColor(componentScore(components.liquidity)),
      direction: "higher_is_better",
    },
    {
      key: "marketTrend",
      label: "Market Trend",
      score: componentScore(components.marketTrend),
      color: scoreColor(componentScore(components.marketTrend)),
      direction: "higher_is_better",
    },
    {
      key: "distributionPressure",
      label: "Distribution Pressure",
      score: componentScore(components.distributionPressure),
      color: scoreColor(
        componentScore(components.distributionPressure),
        true
      ),
      direction: "lower_is_better",
    },
    {
      key: "breadthParticipation",
      label: "Breadth Participation",
      score: componentScore(components.breadthParticipation),
      color: scoreColor(componentScore(components.breadthParticipation)),
      direction: "higher_is_better",
    },
    {
      key: "aiLeadership",
      label: "AI Leadership",
      score: componentScore(components.aiLeadership),
      color: scoreColor(componentScore(components.aiLeadership)),
      direction: "higher_is_better",
    },
  ];
}`;

output = replaceOnce(
  output,
  oldLiveBreakdown,
  newLiveBreakdown,
  "buildLiveComponentBreakdown"
);

/*
|--------------------------------------------------------------------------
| 2. Add Credit / Rates / Liquidity stress-detail helpers
|--------------------------------------------------------------------------
*/

const helperAnchor = `function pickComparisonRow(rows, offsetFromEnd) {`;

const creditStressHelpers = `function buildSeverityFlag(active, severity = "NONE", reasons = []) {
  return {
    active: active === true,
    severity: active === true ? severity : "NONE",
    reasons: active === true ? reasons.filter(Boolean) : [],
  };
}

function marketProxyAvailable(item) {
  return Boolean(item && item.ok !== false);
}

function marketProxyValue(item) {
  return safeNumber(
    item?.close ??
      item?.value ??
      item?.price ??
      item?.latestClose ??
      item?.last
  );
}

function deriveMarketProxyState(item, key) {
  if (!marketProxyAvailable(item)) return "UNAVAILABLE";

  const below20 = item?.aboveEma20 === false;
  const below50 = item?.aboveEma50 === false;

  const change20 = safeNumber(item?.pctChange20d);
  const negative20 =
    Number.isFinite(change20) &&
    change20 < 0;

  if (key === "IWM") {
    if (below20 && below50) return "BREAKING_DOWN";
    if (below20) return "WEAKENING";
    if (item?.aboveEma20 === true) return "HOLDING_OR_IMPROVING";
    return "MIXED";
  }

  if (below20 && below50) return "BREAKING_DOWN";
  if (below20 || below50 || negative20) return "WEAKENING";

  if (
    item?.aboveEma20 === true &&
    item?.aboveEma50 === true
  ) {
    return "HOLDING_OR_IMPROVING";
  }

  return "MIXED";
}

function buildMarketProxyItem({
  key,
  label,
  item,
  read,
  fallbackRead,
}) {
  if (!marketProxyAvailable(item)) {
    return {
      key,
      label,
      available: false,
      value: null,
      close: null,
      priorValue: null,
      change: null,
      observationDate: null,
      fetchedAt: null,
      aboveEma10: null,
      aboveEma20: null,
      aboveEma50: null,
      aboveEma200: null,
      pctChange1d: null,
      pctChange5d: null,
      pctChange20d: null,
      pctChange50d: null,
      state: "UNAVAILABLE",
      read:
        fallbackRead ||
        \`Latest \${key} market proxy is unavailable.\`,
    };
  }

  const pctChange1d = safeNumber(
    item?.pctChange1d ??
      item?.dayChangePct ??
      item?.percentChange
  );

  return {
    key,
    label,
    available: true,
    value: marketProxyValue(item),
    close: marketProxyValue(item),
    priorValue: null,
    change: pctChange1d,
    observationDate:
      item?.date ||
      item?.sessionDate ||
      item?.latestDate ||
      null,
    fetchedAt:
      item?.fetchedAt ||
      item?.updatedAt ||
      null,
    aboveEma10:
      typeof item?.aboveEma10 === "boolean"
        ? item.aboveEma10
        : null,
    aboveEma20:
      typeof item?.aboveEma20 === "boolean"
        ? item.aboveEma20
        : null,
    aboveEma50:
      typeof item?.aboveEma50 === "boolean"
        ? item.aboveEma50
        : null,
    aboveEma200:
      typeof item?.aboveEma200 === "boolean"
        ? item.aboveEma200
        : null,
    pctChange1d,
    pctChange5d: safeNumber(item?.pctChange5d),
    pctChange20d: safeNumber(item?.pctChange20d),
    pctChange50d: safeNumber(item?.pctChange50d),
    state: deriveMarketProxyState(item, key),
    read,
  };
}

function buildMacroStressItem({
  key,
  label,
  value,
  state,
  read,
  marketHealth,
}) {
  const numericValue = safeNumber(value);
  const available = Number.isFinite(numericValue);

  return {
    key,
    label,
    available,
    value: available ? numericValue : null,
    priorValue: null,
    change: null,
    observationDate: null,
    fetchedAt:
      marketHealth?.updatedAt ||
      marketHealth?.generatedAtUtc ||
      null,
    state: available ? state : "UNAVAILABLE",
    read: available
      ? read
      : "Latest observation unavailable.",
  };
}

function buildCreditStressDetail(marketHealth) {
  const components = marketHealth?.components || {};

  const creditFragility = components.creditFragility || {};
  const creditStress = components.creditStress || {};
  const bondMarket = components.bondMarket || {};
  const liquidity = components.liquidity || {};
  const macroPressure = components.macroPressure || {};

  const creditInputs = creditFragility?.inputs || {};
  const stressInputs = creditStress?.inputs || {};
  const bondInputs = bondMarket?.inputs || {};
  const liquidityInputs = liquidity?.inputs || {};
  const macroInputs = macroPressure?.inputs || {};

  const hyg = creditInputs.HYG || null;
  const jnk = creditInputs.JNK || null;
  const lqd = creditInputs.LQD || null;
  const kre = creditInputs.KRE || null;
  const iwm = creditInputs.IWM || null;
  const tlt = macroInputs.TLT || null;

  const highYieldSpread = safeNumber(
    stressInputs.highYieldSpread
  );

  const nfci = safeNumber(stressInputs.nfci);
  const stlfsi = safeNumber(stressInputs.stlfsi);

  const tenYear = safeNumber(bondInputs.tenYear);
  const twoYear = safeNumber(bondInputs.twoYear);
  const tenMinusTwo = safeNumber(bondInputs.tenMinusTwo);

  const tenMinusThreeMonth = safeNumber(
    bondInputs.tenMinusThreeMonth
  );

  const bankReserves = safeNumber(
    liquidityInputs.bankReserves
  );

  const reverseRepo = safeNumber(
    liquidityInputs.reverseRepo
  );

  const fedBalanceSheet = safeNumber(
    liquidityInputs.fedBalanceSheet
  );

  const m2 = safeNumber(liquidityInputs.m2);

  const tgaBalance = safeNumber(
    liquidityInputs.tgaBalance
  );

  const hygWeak =
    hyg?.aboveEma20 === false &&
    hyg?.aboveEma50 === false;

  const jnkWeak =
    jnk?.aboveEma20 === false &&
    jnk?.aboveEma50 === false;

  const lqdWeak =
    lqd?.aboveEma20 === false &&
    lqd?.aboveEma50 === false;

  const kreWeak =
    kre?.aboveEma20 === false &&
    kre?.aboveEma50 === false;

  const iwmWeak =
    iwm?.aboveEma20 === false;

  const tltChange20 = safeNumber(tlt?.pctChange20d);

  const tltWeak =
    tlt?.aboveEma20 === false &&
    Number.isFinite(tltChange20) &&
    tltChange20 < 0;

  const spreadElevated =
    Number.isFinite(highYieldSpread) &&
    highYieldSpread > 4.5;

  const conditionsTight =
    Number.isFinite(nfci) &&
    nfci > 0;

  const financialStressElevated =
    Number.isFinite(stlfsi) &&
    stlfsi > 0.5;

  const tenYearElevated =
    Number.isFinite(tenYear) &&
    tenYear >= 4.5;

  const twoYearElevated =
    Number.isFinite(twoYear) &&
    twoYear >= 4.25;

  const curveInverted =
    (Number.isFinite(tenMinusTwo) &&
      tenMinusTwo < 0) ||
    (Number.isFinite(tenMinusThreeMonth) &&
      tenMinusThreeMonth < 0);

  const reservesLow =
    Number.isFinite(bankReserves) &&
    bankReserves < 2800000;

  const fedBalanceSheetDrain =
    Number.isFinite(fedBalanceSheet) &&
    fedBalanceSheet < 6400000;

  const tgaDrainRisk =
    Number.isFinite(tgaBalance) &&
    tgaBalance >= 850000;

  let bondSelloffSeverity = "NONE";
  const bondSelloffReasons = [];

  if (tenYearElevated || twoYearElevated || tltWeak) {
    bondSelloffSeverity = "WATCH";
  }

  if (
    tltWeak &&
    (tenYearElevated || twoYearElevated)
  ) {
    bondSelloffSeverity = "CONFIRMED";
  }

  if (
    tltWeak &&
    tenYearElevated &&
    lqdWeak
  ) {
    bondSelloffSeverity = "STRONG";
  }

  if (tenYearElevated) {
    bondSelloffReasons.push(
      "10Y yield is at or above the Engine 25 pressure threshold."
    );
  }

  if (twoYearElevated) {
    bondSelloffReasons.push(
      "2Y yield is at or above the Engine 25 hawkish-pressure threshold."
    );
  }

  if (tltWeak) {
    bondSelloffReasons.push(
      "TLT is below EMA20 with negative 20-day momentum."
    );
  }

  if (lqdWeak) {
    bondSelloffReasons.push(
      "LQD is below EMA20 and EMA50."
    );
  }

  const liquidityWarningCount = [
    reservesLow,
    fedBalanceSheetDrain,
    tgaDrainRisk,
  ].filter(Boolean).length;

  const liquidityDeteriorating =
    liquidityWarningCount > 0;

  const broadCreditWeakness =
    hygWeak ||
    jnkWeak ||
    lqdWeak;

  const systemicStress =
    broadCreditWeakness &&
    (
      spreadElevated ||
      conditionsTight ||
      financialStressElevated
    );

  let displayLabel = "MIXED";

  let interpretation =
    "Credit, rates, and liquidity are sending a mixed signal. Use the individual groups to determine whether weakness is tactical or broadening.";

  if (systemicStress) {
    displayLabel = "CREDIT_CONFIRMING_RISK_OFF";

    interpretation =
      "Credit is confirming risk-off. High-yield or investment-grade proxies are weakening while macro credit or financial-stress measures are also elevated.";
  } else if (
    bondSelloffSeverity !== "NONE" &&
    !hygWeak &&
    !jnkWeak &&
    !lqdWeak
  ) {
    displayLabel =
      "RATES_PRESSURE_WITH_CREDIT_HOLDING";

    interpretation =
      "Treasury and rate pressure are present, but corporate-credit proxies are still holding. The stress currently looks more rate-driven than broad credit-system stress.";
  } else if (liquidityDeteriorating) {
    displayLabel = "LIQUIDITY_DRAIN_WATCH";

    interpretation =
      "Liquidity conditions require attention. Bank reserves, the Fed balance sheet, or Treasury cash conditions are showing a potential drain backdrop.";
  } else if (
    componentScore(creditFragility) >= 60 &&
    componentScore(creditStress) >= 50
  ) {
    displayLabel = "CREDIT_SUPPORTIVE";

    interpretation =
      "Credit is not confirming broad systemic stress. High-yield, investment-grade, banking, and financial-stress inputs remain broadly supportive or manageable.";
  }

  const creditEtfItems = [
    buildMarketProxyItem({
      key: "HYG",
      label: "High Yield Corporate Bond ETF",
      item: hyg,
      read: hygWeak
        ? "High-yield credit is below EMA20 and EMA50."
        : "High-yield credit is holding or showing mixed support.",
    }),

    buildMarketProxyItem({
      key: "JNK",
      label: "Junk Bond ETF",
      item: jnk,
      read: jnkWeak
        ? "Junk-credit fragility is rising."
        : "Junk-credit conditions are holding or mixed.",
    }),

    buildMarketProxyItem({
      key: "LQD",
      label: "Investment Grade Corporate Bond ETF",
      item: lqd,
      read: lqdWeak
        ? "Investment-grade bonds are under pressure."
        : "Investment-grade credit is holding or mixed.",
    }),

    buildMarketProxyItem({
      key: "KRE",
      label: "Regional Bank ETF",
      item: kre,
      read: kreWeak
        ? "Regional-bank pressure is rising."
        : "Regional banks are holding or mixed.",
    }),

    buildMarketProxyItem({
      key: "IWM",
      label: "Small Caps / Risk Appetite Proxy",
      item: iwm,
      read: iwmWeak
        ? "Small-cap borrower and risk appetite are weak."
        : "Small-cap risk appetite is holding or mixed.",
    }),
  ];

  const macroCreditItems = [
    buildMacroStressItem({
      key: "BAMLH0A0HYM2",
      label: "High Yield Credit Spread",
      value: highYieldSpread,
      state: spreadElevated
        ? "STRESS_ELEVATED"
        : "CALM",
      read: spreadElevated
        ? "High-yield spread is above the Engine 25 warning threshold."
        : "High-yield spread is below the Engine 25 warning threshold.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "NFCI",
      label:
        "Chicago Fed National Financial Conditions Index",
      value: nfci,
      state: conditionsTight
        ? "CONDITIONS_TIGHT"
        : "CONDITIONS_SUPPORTIVE",
      read: conditionsTight
        ? "Financial conditions are tighter than average."
        : "Financial conditions are not tighter than average.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "STLFSI4",
      label:
        "St. Louis Fed Financial Stress Index",
      value: stlfsi,
      state: financialStressElevated
        ? "STRESS_ELEVATED"
        : "STRESS_LOW_OR_NORMAL",
      read: financialStressElevated
        ? "Broad financial stress is above the Engine 25 warning threshold."
        : "Broad financial stress is below the Engine 25 warning threshold.",
      marketHealth,
    }),
  ];

  const ratesCurveItems = [
    buildMacroStressItem({
      key: "DGS10",
      label: "10-Year Treasury Rate",
      value: tenYear,
      state: tenYearElevated
        ? "YIELD_PRESSURE_ELEVATED"
        : "YIELD_PRESSURE_MANAGEABLE",
      read: tenYearElevated
        ? "10Y yield pressure is elevated."
        : "10Y yield is below the Engine 25 pressure threshold.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "DGS2",
      label: "2-Year Treasury Rate",
      value: twoYear,
      state: twoYearElevated
        ? "FED_PRESSURE_ELEVATED"
        : "FED_PRESSURE_MANAGEABLE",
      read: twoYearElevated
        ? "2Y yield reflects elevated hawkish or higher-for-longer pressure."
        : "2Y yield is below the Engine 25 hawkish-pressure threshold.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "T10Y2Y",
      label: "10Y Minus 2Y Yield Spread",
      value: tenMinusTwo,
      state:
        Number.isFinite(tenMinusTwo) &&
        tenMinusTwo < 0
          ? "CURVE_INVERTED"
          : "CURVE_NORMAL",
      read:
        Number.isFinite(tenMinusTwo) &&
        tenMinusTwo < 0
          ? "The 10Y-2Y curve is inverted."
          : "The 10Y-2Y curve is not inverted.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "T10Y3M",
      label: "10Y Minus 3M Yield Spread",
      value: tenMinusThreeMonth,
      state:
        Number.isFinite(tenMinusThreeMonth) &&
        tenMinusThreeMonth < 0
          ? "CURVE_INVERTED"
          : "CURVE_NORMAL",
      read:
        Number.isFinite(tenMinusThreeMonth) &&
        tenMinusThreeMonth < 0
          ? "The 10Y-3M curve is inverted."
          : "The 10Y-3M curve is not inverted.",
      marketHealth,
    }),

    buildMarketProxyItem({
      key: "TLT",
      label: "20+ Year Treasury Bond ETF",
      item: tlt,
      read: tltWeak
        ? "TLT weakness confirms bond-price pressure."
        : "TLT is stable, supportive, or mixed.",
      fallbackRead:
        "TLT market proxy unavailable in the latest Engine 25 output.",
    }),
  ];

  const liquidityItems = [
    buildMacroStressItem({
      key: "WRESBAL",
      label: "Bank Reserves",
      value: bankReserves,
      state: reservesLow
        ? "RESERVES_LOW"
        : "RESERVE_CUSHION_AVAILABLE",
      read: reservesLow
        ? "Bank reserve cushion is below the Engine 25 warning threshold."
        : "Bank reserve cushion is above the Engine 25 warning threshold.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "RRPONTSYD",
      label: "Reverse Repo",
      value: reverseRepo,
      state: "CONTEXT_REQUIRED",
      read:
        "A lower reverse-repo balance can release cash from the facility, but direction requires prior-observation context.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "WALCL",
      label: "Fed Balance Sheet",
      value: fedBalanceSheet,
      state: fedBalanceSheetDrain
        ? "FED_BALANCE_SHEET_DRAIN"
        : "FED_BALANCE_SHEET_SUPPORT",
      read: fedBalanceSheetDrain
        ? "Fed balance sheet is below the Engine 25 liquidity threshold."
        : "Fed balance sheet remains above the Engine 25 liquidity threshold.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "M2SL",
      label: "M2 Money Supply",
      value: m2,
      state: "CONTEXT_REQUIRED",
      read:
        "Money-supply direction requires comparison with its prior monthly observation.",
      marketHealth,
    }),

    buildMacroStressItem({
      key: "TGA",
      label:
        "Treasury General Account / Operating Cash Balance",
      value: tgaBalance,
      state: tgaDrainRisk
        ? "TGA_DRAIN_RISK"
        : "TGA_NOT_ELEVATED",
      read: tgaDrainRisk
        ? "Treasury operating cash is high enough to create a liquidity-drain watch."
        : "Treasury operating cash is below the Engine 25 drain-risk threshold.",
      marketHealth,
    }),
  ];

  return {
    available: Boolean(
      marketHealth &&
      marketHealth.components
    ),

    source: "engine25-market-health.json",

    updatedAt:
      marketHealth?.updatedAt ||
      marketHealth?.generatedAtUtc ||
      null,

    scores: {
      creditFragility:
        componentScore(creditFragility),
      creditStress:
        componentScore(creditStress),
      bondMarket:
        componentScore(bondMarket),
      liquidity:
        componentScore(liquidity),
    },

    labels: {
      creditFragility:
        creditFragility?.label || null,
      creditRegime:
        creditFragility?.creditRegime || null,
      creditStress:
        creditStress?.label || null,
      bondMarket:
        bondMarket?.label || null,
      liquidity:
        liquidity?.label || null,
    },

    displayLabel,
    interpretation,

    groups: {
      creditEtfFragility: {
        key: "creditEtfFragility",
        label: "Credit ETF Fragility",
        score: componentScore(creditFragility),
        componentLabel:
          creditFragility?.label || null,
        read:
          "High-yield, investment-grade, regional-bank, and small-cap risk-appetite proxies.",
        items: creditEtfItems,
      },

      macroCreditStress: {
        key: "macroCreditStress",
        label: "Macro Credit Stress",
        score: componentScore(creditStress),
        componentLabel:
          creditStress?.label || null,
        read:
          "FRED credit-spread and financial-stress measures.",
        items: macroCreditItems,
      },

      ratesCurvePressure: {
        key: "ratesCurvePressure",
        label: "Rates / Yield Curve Pressure",
        score: componentScore(bondMarket),
        componentLabel:
          bondMarket?.label || null,
        read:
          "Treasury yields, yield-curve structure, and TLT bond-price pressure.",
        items: ratesCurveItems,
      },

      liquidityBackdrop: {
        key: "liquidityBackdrop",
        label: "Liquidity Backdrop",
        score: componentScore(liquidity),
        componentLabel:
          liquidity?.label || null,
        read:
          "Bank reserves, reverse repo, Fed balance sheet, money supply, and Treasury operating cash.",
        items: liquidityItems,
      },
    },

    warningFlags: {
      bondsSellingOff: buildSeverityFlag(
        bondSelloffSeverity !== "NONE",
        bondSelloffSeverity,
        bondSelloffReasons
      ),

      creditSpreadsWidening: buildSeverityFlag(
        spreadElevated,
        spreadElevated ? "WATCH" : "NONE",
        spreadElevated
          ? [
              "High-yield spread is above the Engine 25 warning threshold.",
            ]
          : []
      ),

      financialStressRising: buildSeverityFlag(
        conditionsTight ||
          financialStressElevated,
        conditionsTight &&
          financialStressElevated
          ? "CONFIRMED"
          : "WATCH",
        [
          conditionsTight
            ? "NFCI is above zero, indicating tighter-than-average financial conditions."
            : null,

          financialStressElevated
            ? "STLFSI4 is above the Engine 25 elevated-stress threshold."
            : null,
        ]
      ),

      banksBreakingDown: buildSeverityFlag(
        kreWeak,
        "CONFIRMED",
        kreWeak
          ? ["KRE is below EMA20 and EMA50."]
          : []
      ),

      investmentGradeWeakening:
        buildSeverityFlag(
          lqdWeak,
          "CONFIRMED",
          lqdWeak
            ? ["LQD is below EMA20 and EMA50."]
            : []
        ),

      highYieldWeakening: buildSeverityFlag(
        hygWeak || jnkWeak,
        hygWeak && jnkWeak
          ? "CONFIRMED"
          : "WATCH",
        [
          hygWeak
            ? "HYG is below EMA20 and EMA50."
            : null,

          jnkWeak
            ? "JNK is below EMA20 and EMA50."
            : null,
        ]
      ),

      curveInverted: buildSeverityFlag(
        curveInverted,
        "CONFIRMED",
        [
          Number.isFinite(tenMinusTwo) &&
          tenMinusTwo < 0
            ? "The 10Y-2Y yield curve is inverted."
            : null,

          Number.isFinite(tenMinusThreeMonth) &&
          tenMinusThreeMonth < 0
            ? "The 10Y-3M yield curve is inverted."
            : null,
        ]
      ),

      liquidityDeteriorating:
        buildSeverityFlag(
          liquidityDeteriorating,
          liquidityWarningCount >= 2
            ? "CONFIRMED"
            : "WATCH",
          [
            reservesLow
              ? "Bank reserves are below the Engine 25 warning threshold."
              : null,

            fedBalanceSheetDrain
              ? "Fed balance sheet is below the Engine 25 liquidity threshold."
              : null,

            tgaDrainRisk
              ? "Treasury operating cash is in the Engine 25 drain-risk zone."
              : null,
          ]
        ),
    },

    reasonCodes: [
      displayLabel,

      ...(hygWeak ? ["HYG_WEAK"] : []),
      ...(jnkWeak ? ["JNK_WEAK"] : []),
      ...(lqdWeak ? ["LQD_WEAK"] : []),
      ...(kreWeak ? ["KRE_WEAK"] : []),
      ...(iwmWeak ? ["IWM_WEAK"] : []),

      ...(spreadElevated
        ? ["HIGH_YIELD_SPREAD_ELEVATED"]
        : []),

      ...(conditionsTight
        ? ["FINANCIAL_CONDITIONS_TIGHT"]
        : []),

      ...(financialStressElevated
        ? ["FINANCIAL_STRESS_ELEVATED"]
        : []),

      ...(curveInverted
        ? ["YIELD_CURVE_INVERTED"]
        : []),

      ...(liquidityDeteriorating
        ? ["LIQUIDITY_DRAIN_WATCH"]
        : []),

      "CREDIT_STRESS_DETAIL_DISPLAY_ONLY",
    ],
  };
}

`;

output = replaceOnce(
  output,
  helperAnchor,
  `${creditStressHelpers}${helperAnchor}`,
  "pickComparisonRow helper insertion"
);

/*
|--------------------------------------------------------------------------
| 3. Build creditStressDetail inside the route
|--------------------------------------------------------------------------
*/

const oldRouteBuild = `    const liveMarketHealth = buildLiveMarketHealthSummary(marketHealth);

    const sectorBreadth = buildSectorBreadthSummary(sectorBreadthRaw);`;

const newRouteBuild = `    const liveMarketHealth = buildLiveMarketHealthSummary(marketHealth);

    const creditStressDetail =
      buildCreditStressDetail(marketHealth);

    const sectorBreadth = buildSectorBreadthSummary(sectorBreadthRaw);`;

output = replaceOnce(
  output,
  oldRouteBuild,
  newRouteBuild,
  "creditStressDetail route construction"
);

/*
|--------------------------------------------------------------------------
| 4. Bump route version
|--------------------------------------------------------------------------
*/

output = replaceOnce(
  output,
  `engine: "engine25.fullDashboard.v0.4"`,
  `engine: "engine25.fullDashboard.v0.5"`,
  "full dashboard route version"
);

/*
|--------------------------------------------------------------------------
| 5. Add creditStressDetail to response
|--------------------------------------------------------------------------
*/

const oldResponseAnchor = `      liveMarketHealth,

      zoneRead: zoneRead || null,`;

const newResponseAnchor = `      liveMarketHealth,
      creditStressDetail,

      zoneRead: zoneRead || null,`;

output = replaceOnce(
  output,
  oldResponseAnchor,
  newResponseAnchor,
  "creditStressDetail response field"
);

/*
|--------------------------------------------------------------------------
| 6. Write patched route
|--------------------------------------------------------------------------
*/

fs.writeFileSync(TARGET_FILE, output);

console.log("");
console.log("[Engine25 Credit Stress Patch] COMPLETE");
console.log(`[Patched] ${TARGET_FILE}`);
console.log(`[Backup]  ${BACKUP_FILE}`);
console.log("");
console.log("Next validation command:");
console.log(
  "node --check services/core/routes/engine25FullDashboard.js"
);
console.log("");
