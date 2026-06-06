// services/core/routes/engine25FullDashboard.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const COMPOSITE_FILE = path.join(
  DATA_DIR,
  "engine25-composite-overlay-6mo.json"
);

const ZONE_READ_FILE = path.join(
  DATA_DIR,
  "engine25-es-zone-aware-read.json"
);

const MARKET_HEALTH_FILE = path.join(
  DATA_DIR,
  "engine25-market-health.json"
);

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function diff(current, prior) {
  const c = safeNumber(current);
  const p = safeNumber(prior);

  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;

  return Number((c - p).toFixed(3));
}

function scoreColor(score, inverse = false) {
  const n = safeNumber(score);

  if (!Number.isFinite(n)) return "gray";

  if (inverse) {
    if (n < 30) return "green";
    if (n < 50) return "orange";
    if (n < 70) return "red";
    return "darkRed";
  }

  if (n >= 70) return "green";
  if (n >= 50) return "yellow";
  if (n >= 35) return "orange";
  return "red";
}

function normalizePermission(value) {
  return String(value || "UNKNOWN")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildComponentBreakdown(row) {
  const components = row?.components || {};

  return [
    {
      key: "macroAwareScore",
      label: "Macro Aware",
      score: safeNumber(components.macroAwareScore),
      color: scoreColor(components.macroAwareScore),
      direction: "higher_is_better",
    },
    {
      key: "breadthParticipation",
      label: "Breadth Participation",
      score: safeNumber(components.breadthParticipation),
      color: scoreColor(components.breadthParticipation),
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
      key: "marketTrend",
      label: "Market Trend",
      score: safeNumber(components.marketTrend),
      color: scoreColor(components.marketTrend),
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
      key: "aiLeadership",
      label: "AI Leadership",
      score: safeNumber(components.aiLeadership),
      color: scoreColor(components.aiLeadership),
      direction: "higher_is_better",
    },
  ];
}

function pickComparisonRow(rows, offsetFromEnd) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[Math.max(0, rows.length - 1 - offsetFromEnd)] || null;
}

function buildMetricRow(label, current, oneDayAgo, threeDaysAgo) {
  return {
    label,
    current,
    oneDayAgo,
    oneDayChange: diff(current, oneDayAgo),
    threeDaysAgo,
    threeDayChange: diff(current, threeDaysAgo),
  };
}

function buildUnderTheHoodComparison({ current, oneDayAgo, threeDaysAgo }) {
  const c = current || {};
  const d1 = oneDayAgo || {};
  const d3 = threeDaysAgo || {};

  const rows = [
    buildMetricRow("ES Close", c.esClose, d1.esClose, d3.esClose),
    buildMetricRow(
      "Composite",
      c.engine25CompositeScore,
      d1.engine25CompositeScore,
      d3.engine25CompositeScore
    ),
    buildMetricRow(
      "Macro Aware",
      c.components?.macroAwareScore,
      d1.components?.macroAwareScore,
      d3.components?.macroAwareScore
    ),
    buildMetricRow(
      "Breadth",
      c.components?.breadthParticipation,
      d1.components?.breadthParticipation,
      d3.components?.breadthParticipation
    ),
    buildMetricRow(
      "Distribution",
      c.components?.distributionPressure,
      d1.components?.distributionPressure,
      d3.components?.distributionPressure
    ),
    buildMetricRow(
      "Market Trend",
      c.components?.marketTrend,
      d1.components?.marketTrend,
      d3.components?.marketTrend
    ),
    buildMetricRow(
      "Credit Fragility",
      c.components?.creditFragility,
      d1.components?.creditFragility,
      d3.components?.creditFragility
    ),
    buildMetricRow(
      "AI Leadership",
      c.components?.aiLeadership,
      d1.components?.aiLeadership,
      d3.components?.aiLeadership
    ),
  ];

  const esChange = diff(c.esClose, d1.esClose);
  const compositeChange = diff(
    c.engine25CompositeScore,
    d1.engine25CompositeScore
  );
  const breadthChange = diff(
    c.components?.breadthParticipation,
    d1.components?.breadthParticipation
  );
  const distributionChange = diff(
    c.components?.distributionPressure,
    d1.components?.distributionPressure
  );

  let interpretation = "Engine 25 comparison is mixed.";

  if (
    Number.isFinite(esChange) &&
    esChange > 0 &&
    Number.isFinite(compositeChange) &&
    compositeChange < 0
  ) {
    interpretation =
      "Price improved, but the Engine 25 composite weakened. This looks more like tactical/news-driven strength than broad market confirmation.";
  } else if (
    Number.isFinite(esChange) &&
    esChange > 0 &&
    Number.isFinite(compositeChange) &&
    compositeChange > 0 &&
    Number.isFinite(breadthChange) &&
    breadthChange > 0
  ) {
    interpretation =
      "Price improved and internals improved. This is stronger confirmation than a price-only rally.";
  } else if (
    Number.isFinite(esChange) &&
    esChange < 0 &&
    Number.isFinite(compositeChange) &&
    compositeChange < 0
  ) {
    interpretation =
      "Price and Engine 25 weakened together. Market health confirms defensive conditions.";
  }

  if (Number.isFinite(distributionChange) && distributionChange > 0) {
    interpretation += " Distribution pressure increased.";
  }

  return {
    rows,
    interpretation,
  };
}

function buildLiveMarketHealthSummary(marketHealth) {
  if (!marketHealth) return null;

  return {
    score: marketHealth.score ?? null,
    regime: marketHealth.regime ?? null,
    bias: marketHealth.bias ?? null,
    riskLevel: marketHealth.riskLevel ?? null,
    updatedAt: marketHealth.updatedAt || marketHealth.generatedAtUtc || null,
  };
}

function buildDeskNote({ zoneRead, underTheHood, current, intradayProxyDamage, liveEsPermission }) {
  const intradayLabel = intradayProxyDamage?.label || null;
  const liveMode = liveEsPermission?.mode || null;

  if (intradayLabel === "INTRADAY_DISTRIBUTION_ACTIVE") {
    return [
      "Engine 25 daily/EOD read is risk-off and the live intraday layer confirms active distribution.",
      liveMode
        ? `Live ES permission: ${normalizePermission(liveMode)}.`
        : null,
      "Normal ES longs should stay blocked until reclaim, seller exhaustion, or a separate Engine 22 / Engine 6 confirmation appears.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  if (intradayLabel === "INTRADAY_DAMAGE_ELEVATED") {
    return [
      "Engine 25 daily/EOD read is available, but intraday damage is elevated.",
      liveMode
        ? `Live ES permission: ${normalizePermission(liveMode)}.`
        : null,
      "Require A+ confirmation before improving ES long permission.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return (
    zoneRead?.plainEnglish ||
    underTheHood?.interpretation ||
    current?.overlayInterpretation ||
    "Engine 25 market-health read is available."
  );
}

router.get("/engine25/full-dashboard", (_req, res) => {
  try {
    const composite = readJsonFile(COMPOSITE_FILE);
    const zoneRead = readJsonFile(ZONE_READ_FILE);
    const marketHealth = readJsonFile(MARKET_HEALTH_FILE);

    if (!composite) {
      return res.status(404).json({
        ok: false,
        error: "missing_engine25_composite_overlay",
        message:
          "Missing engine25-composite-overlay-6mo.json. Run Engine 25 full pipeline first.",
      });
    }

    const rows = Array.isArray(composite.rows) ? composite.rows : [];

    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        error: "empty_engine25_composite_overlay",
      });
    }

    const current = pickComparisonRow(rows, 0);
    const oneDayAgo = pickComparisonRow(rows, 1);
    const threeDaysAgo = pickComparisonRow(rows, 3);

    const componentBreakdown = buildComponentBreakdown(current);
    const underTheHood = buildUnderTheHoodComparison({
      current,
      oneDayAgo,
      threeDaysAgo,
    });

    const intradayProxyDamage = marketHealth?.intradayProxyDamage || null;
    const liveEsPermission = marketHealth?.esPermission || null;
    const liveTradePermission = marketHealth?.tradePermission || null;
    const liveMarketHealth = buildLiveMarketHealthSummary(marketHealth);

    const headline = {
      score: current.engine25CompositeScore,
      state: current.overlayState,
      label: current.overlayLabel,
      color: current.overlayColor,

      // Daily / EOD date contract
      date: current.latestEodDate || current.cashProxyDate || current.date,
      latestEodDate: current.latestEodDate || current.cashProxyDate || current.date,
      cashProxyDate: current.cashProxyDate || current.latestEodDate || current.date,
      esSessionDate: current.esSessionDate || current.date,
      dateAlignment: current.dateAlignment || null,

      esClose: current.esClose,

      // Daily / EOD permission
      permission: current.permissions?.finalPermission || null,
      permissionText: normalizePermission(current.permissions?.finalPermission),
      size: current.permissions?.finalSize ?? null,

      // Live / intraday permission summary
      livePermission: liveEsPermission?.mode || liveTradePermission?.engine22Mode || null,
      livePermissionText: normalizePermission(
        liveEsPermission?.mode || liveTradePermission?.engine22Mode
      ),
      liveSize:
        liveEsPermission?.sizeMultiplier ??
        liveTradePermission?.sizeMultiplier ??
        null,

      interpretation: current.overlayInterpretation,
    };

    const deskNote = buildDeskNote({
      zoneRead,
      underTheHood,
      current,
      intradayProxyDamage,
      liveEsPermission,
    });

    return res.json({
      ok: true,
      engine: "engine25.fullDashboard.v0.2",
      modelType: "ENGINE25_FULL_DASHBOARD_VIEW",
      generatedAtUtc: new Date().toISOString(),
      source: {
        compositeFile: "engine25-composite-overlay-6mo.json",
        zoneReadFile: "engine25-es-zone-aware-read.json",
        marketHealthFile: "engine25-market-health.json",
      },

      // Daily / EOD read
      headline,
      componentBreakdown,
      underTheHood,

      // Live / intraday read
      intradayProxyDamage,
      liveEsPermission,
      liveTradePermission,
      liveMarketHealth,

      zoneRead: zoneRead || null,

      overlay: {
        summary: composite.summary || null,
        rows,
      },

      deskNote,
    });
  } catch (err) {
    console.error("[engine25FullDashboard] failed:", err?.stack || err);

    return res.status(500).json({
      ok: false,
      error: "engine25_full_dashboard_error",
      detail: String(err?.message || err),
    });
  }
});

export default router;
