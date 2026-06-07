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

const SECTOR_BREADTH_FILE = path.join(
  DATA_DIR,
  "engine25-sector-card-breadth-snapshots.json"
);

const ZONE_CLASSIFICATION_FILE = path.join(
  DATA_DIR,
  "engine25-zone-classification.json"
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

function buildSectorBreadthSummary(raw) {
  const latest = raw?.latest || null;

  if (!latest) {
    return {
      available: false,
      sourceFile: "engine25-sector-card-breadth-snapshots.json",
      historicalSectorCardBreadthAvailable: false,
      disabledReason: "NO_HISTORICAL_SECTOR_CARD_SNAPSHOTS",
      latest: null,
      tactical1h: null,
      regime4h: null,
      combinedRead: {
        available: false,
        score: null,
        label: "SECTOR_CARD_BREADTH_UNAVAILABLE",
        permissionImpact: "NO_IMPACT_DATA_UNAVAILABLE",
        reasonCodes: ["NO_SECTOR_CARD_BREADTH_SNAPSHOT"],
      },
    };
  }

  return {
    available: true,
    sourceFile: "engine25-sector-card-breadth-snapshots.json",
    engine: raw?.engine || null,
    latestSnapshotDate: raw?.latestSnapshotDate || latest.date || null,
    latestSnapshotKey: raw?.latestSnapshotKey || latest.snapshotKey || null,
    historicalSectorCardBreadthAvailable:
      raw?.historicalSectorCardBreadthAvailable === true,
    disabledReason:
      raw?.disabledReason || latest.disabledReason || "NO_HISTORICAL_SECTOR_CARD_SNAPSHOTS",
    sourceType: raw?.sourceType || latest.sourceType || "sectorCardProxyBreadth",
    latest,
    tactical1h: latest.tactical1h || null,
    regime4h: latest.regime4h || null,
    combinedRead: latest.combinedRead || null,
  };
}

function buildZoneDecisionRead(zoneRead) {
  const zs = zoneRead?.zoneState || null;

  if (!zs) {
    return {
      available: false,
      label: "ZONE_READ_UNAVAILABLE",
      permission: "UNKNOWN",
      priorityRead: "No zone-aware read is available yet.",
      nextConfirmation: [],
    };
  }

  const nextConfirmation = [];

  if (zs.failureInstitutional !== null && zs.failureInstitutional !== undefined) {
    nextConfirmation.push({
      label: "Reclaim institutional floor",
      level: zs.failureInstitutional,
      note: "First repair level after losing manual institutional value.",
    });
  }

  if (zs.reclaimNegotiated !== null && zs.reclaimNegotiated !== undefined) {
    nextConfirmation.push({
      label: "Reclaim negotiated value",
      level: zs.reclaimNegotiated,
      note: "Better signal that value is being accepted again.",
    });
  }

  if (zs.reclaimInstitutional !== null && zs.reclaimInstitutional !== undefined) {
    nextConfirmation.push({
      label: "Reclaim institutional high",
      level: zs.reclaimInstitutional,
      note: "Stronger confirmation above the manual institutional zone.",
    });
  }

  nextConfirmation.push({
    label: "Engine 6 final permission",
    level: null,
    note: "Engine 25 is context only. Engine 6 remains final trade referee.",
  });

  let priorityRead = "Engine 25 is reading current zone context.";

  if (zs.secondaryShelfDefense?.value === true) {
    priorityRead =
      "Manual institutional zone controls. Auto accumulation shelf defense is secondary and does not override manual zone risk.";
  } else if (zs.accumulationWatch?.value === true) {
    priorityRead =
      "Engine 3 reaction is constructive enough for accumulation watch, but reclaim confirmation is still required.";
  } else if (zs.state === "INSTITUTIONAL_SUPPORT_AT_RISK") {
    priorityRead =
      "ES is below manual institutional support. No blind longs until value is reclaimed.";
  } else if (zs.state === "FAILED_RECLAIM_WEAK_CLOSE") {
    priorityRead =
      "Engine 25 has a provisional failed-reclaim / weak-close read. Treat longs as blocked until reclaim.";
  }

  return {
    available: true,
    label: zs.state || "UNKNOWN",
    permission: zs.permission || "UNKNOWN",
    tone: zs.tone || null,
    priorityRead,
    nextConfirmation,
    secondaryShelfDefense: zs.secondaryShelfDefense || null,
    accumulationWatch: zs.accumulationWatch || null,
    failedReclaim: zs.failedReclaim || null,
    weakClose: zs.weakClose || null,
    highVolumeRejection: zs.highVolumeRejection || null,
    zoneAwareVolumeAvailable: zs.zoneAwareVolumeAvailable === true,
    zoneAwareVolumeSource: zs.zoneAwareVolumeSource || null,
    engine3Reaction: zs.engine3Reaction || null,
    engine4VolumeContext: zs.engine4VolumeContext || null,
    reasonCodes: Array.isArray(zs.reasonCodes) ? zs.reasonCodes : [],
  };
}

function buildDeskNote({
  zoneRead,
  sectorBreadth,
  underTheHood,
  current,
  intradayProxyDamage,
  liveEsPermission,
}) {
  const intradayLabel = intradayProxyDamage?.label || null;
  const liveMode = liveEsPermission?.mode || null;
  const sectorCombined = sectorBreadth?.combinedRead || null;
  const sectorImpact = sectorCombined?.permissionImpact || null;

  const parts = [];

  if (intradayLabel === "INTRADAY_DISTRIBUTION_ACTIVE") {
    parts.push(
      "Engine 25 daily/EOD read is risk-off and the live intraday layer confirms active distribution."
    );

    if (liveMode) {
      parts.push(`Live ES permission: ${normalizePermission(liveMode)}.`);
    }

    parts.push(
      "Normal ES longs should stay blocked until reclaim, seller exhaustion, or a separate Engine 22 / Engine 6 confirmation appears."
    );
  } else if (intradayLabel === "INTRADAY_DAMAGE_ELEVATED") {
    parts.push(
      "Engine 25 daily/EOD read is available, but intraday damage is elevated."
    );

    if (liveMode) {
      parts.push(`Live ES permission: ${normalizePermission(liveMode)}.`);
    }

    parts.push("Require A+ confirmation before improving ES long permission.");
  } else {
    parts.push(
      zoneRead?.plainEnglish ||
        underTheHood?.interpretation ||
        current?.overlayInterpretation ||
        "Engine 25 market-health read is available."
    );
  }

  if (sectorCombined?.available) {
    parts.push(
      `Sector breadth read: ${normalizePermission(
        sectorCombined.label
      )}. Permission impact: ${normalizePermission(sectorImpact)}.`
    );
  }

  return parts.filter(Boolean).join(" ");
}

router.get("/engine25/full-dashboard", (_req, res) => {
  try {
    const composite = readJsonFile(COMPOSITE_FILE);
    const zoneRead = readJsonFile(ZONE_READ_FILE);
    const marketHealth = readJsonFile(MARKET_HEALTH_FILE);
    const sectorBreadthRaw = readJsonFile(SECTOR_BREADTH_FILE);
    const zoneClassification = readJsonFile(ZONE_CLASSIFICATION_FILE);

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

    const sectorBreadth = buildSectorBreadthSummary(sectorBreadthRaw);
    const zoneDecisionRead = buildZoneDecisionRead(zoneRead);

    const headline = {
      score: current.engine25CompositeScore,
      state: current.overlayState,
      label: current.overlayLabel,
      color: current.overlayColor,

      date: current.latestEodDate || current.cashProxyDate || current.date,
      latestEodDate: current.latestEodDate || current.cashProxyDate || current.date,
      cashProxyDate: current.cashProxyDate || current.latestEodDate || current.date,
      esSessionDate: current.esSessionDate || current.date,
      requiredEodDate: current.requiredEodDate || null,
      dateAlignment: current.dateAlignment || null,

      esClose: current.esClose,

      permission: current.permissions?.finalPermission || null,
      permissionText: normalizePermission(current.permissions?.finalPermission),
      size: current.permissions?.finalSize ?? null,

      livePermission:
        liveEsPermission?.mode || liveTradePermission?.engine22Mode || null,
      livePermissionText: normalizePermission(
        liveEsPermission?.mode || liveTradePermission?.engine22Mode
      ),
      liveSize:
        liveEsPermission?.sizeMultiplier ??
        liveTradePermission?.sizeMultiplier ??
        null,

      sectorBreadthLabel: sectorBreadth?.combinedRead?.label || null,
      sectorBreadthScore: sectorBreadth?.combinedRead?.score ?? null,
      sectorBreadthPermissionImpact:
        sectorBreadth?.combinedRead?.permissionImpact || null,

      zoneState: zoneDecisionRead.label,
      zonePermission: zoneDecisionRead.permission,

      interpretation: current.overlayInterpretation,
    };

    const deskNote = buildDeskNote({
      zoneRead,
      sectorBreadth,
      underTheHood,
      current,
      intradayProxyDamage,
      liveEsPermission,
    });

    return res.json({
      ok: true,
      engine: "engine25.fullDashboard.v0.3",
      modelType: "ENGINE25_FULL_DASHBOARD_VIEW",
      generatedAtUtc: new Date().toISOString(),
      source: {       
        compositeFile: "engine25-composite-overlay-6mo.json",
        zoneReadFile: "engine25-es-zone-aware-read.json",
        marketHealthFile: "engine25-market-health.json",
        sectorBreadthFile: "engine25-sector-card-breadth-snapshots.json",
        zoneClassificationFile: "engine25-zone-classification.json",
      },

      headline,
      componentBreakdown,
      underTheHood,

      intradayProxyDamage,
      liveEsPermission,
      liveTradePermission,
      liveMarketHealth,

      zoneRead: zoneRead || null,
      zoneDecisionRead,

      sectorBreadth,
      zoneClassification: zoneClassification || null,

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
