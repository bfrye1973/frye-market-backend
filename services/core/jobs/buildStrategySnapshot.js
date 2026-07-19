// services/core/jobs/buildStrategySnapshot.js
// Stable snapshot builder (SPY only)
//
// Phase 4 / Conscious Brain wiring:
// - computes shared market regime from LIVE Market Meter endpoints
// - passes market regime into Engine 16 directly
// - passes market regime into Engine 6 permission body
// - keeps old engine15 + engine15Decision flow intact
//
// IMPORTANT:
// - MASTER is display only and NOT used for regime
// - direction comes from 30m + 1h
// - strictness comes from 4h + EOD
//
// PERFORMANCE / CORRECTNESS FIX:
// - Engine 16 is only computed for intraday_scalp@10m
// - minor_swing@1h and intermediate_long@4h get placeholder objects
// - avoids fake 1h/4h fallback-to-30m Engine 16 usage
//
// NEW:
// - skipped Engine 16 objects can now carry Engine 2 phase context
// - this lets Intermediate Swing move WAIT -> PREP when Engine 2 reaches IN_C

import fs from "fs";
import { computeConfluenceScore } from "../logic/confluenceScorer.js";
import computeEngine15Readiness from "../logic/engine15StrategyReadiness.js";
import { computeEngine15DecisionReferee } from "../logic/engine15DecisionReferee.js";
import { buildEngine15EsDecision } from "../logic/engine15EsReadiness.js";
import { computeMorningFib } from "../logic/engine16MorningFib.js";
import { computeEngine16EsRegimeLayers } from "../logic/engine16EsRegimeLayers.js";
import { computeMarketRegime } from "../logic/marketRegime.js";
import { updateSignalLock } from "../logic/signalLockStore.js";
import { getExecutionState } from "../logic/execution/executionStateService.js";
import { computeEngine22ScalpOpportunity } from "../logic/engine22ScalpOpportunity.js";
import { buildEngine22WaveStrategy } from "../logic/engine22/wave/buildEngine22WaveStrategy.js";
import { interpretWaveEnvironment } from "../logic/engine23/interpretation/interpretWaveEnvironment.js";
import { buildTenMinuteLayer } from "../logic/marketLayers/buildTenMinuteLayer.js";
import { buildWaveTradeDecision } from "../logic/engine22/decisions/buildWaveTradeDecision.js";
import { buildEngine22LifecycleReaction } from "../logic/engine3/engine22LifecycleReaction.js";
import { attachPaperScalpReactionToConfluence } from "../logic/engine3/paperScalpReaction.js";
import { attachFastImbalanceReactionToConfluence } from "../logic/engine3/fastImbalanceReaction.js";
import { attachCurrentLevelActionToConfluence } from "../logic/priceAction/currentLevelAction.js";
import { enrichCurrentLifecycleWithLivePriceAction } from "../logic/engine22/wave/lifecycle/enrich/enrichCurrentLifecycleWithLivePriceAction.js";
import { listTrades } from "../logic/journal/tradeJournalStore.js";
import { buildAiTradeCopilotRead } from "../logic/aiTradeCopilot/buildAiTradeCopilotRead.js";
import { buildEngine27Strategies } from "../logic/engine27/buildEngine27Strategies.js";
import {
  getManualLevelRowsFor,
  attachManualLevelsToEngine2Block,
} from "../logic/engine22/wave/manualMarks/readManualWaveMarks.js";
import {
  buildEngine26ImbalanceWatch,
  buildEngine26PaperTradePlan,
  buildEngine26StructuralContext,
} from "../logic/engine26/paperTradePlanner.js";
import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";
import {
  attachEngine4AuthorizedReactionParticipation,
} from "../logic/engine4/authorizedReactionParticipation.js";
import {
  preserveEngine6CandidateIdentity,
} from "../logic/engine6/preserveCandidateIdentity.js";
import {
  buildEngine7ProposedSizingPreview,
} from "../logic/engine7/v2/buildProposedSizingPreview.js";

import {
  ES_PAPER_RISK_CONFIG,
} from "../config/paperRiskConfig.js";
import {
  buildEngine9OfficialManagementPlan,
} from "../logic/engine9/v1/buildOfficialManagementPlan.js";
import {
  buildEngine7FinalPositionSizing,
} from "../logic/engine7/v2/buildFinalPositionSizing.js";
import {
  buildEngine8CanonicalPaperAdapter,
} from "../logic/trading/engine8CanonicalPaperAdapter.js";
import {
  getEngine8DuplicateState,
} from "../logic/trading/engine8DuplicateState.js";



/* -----------------------------
   Absolute paths / constants
------------------------------*/
const DATA_DIR = "/opt/render/project/src/services/core/data";
const SNAPSHOT_SYMBOL = String(process.env.SYMBOL || "SPY").toUpperCase();

const SNAPSHOT_FILE =
  SNAPSHOT_SYMBOL === "SPY"
    ? `${DATA_DIR}/strategy-snapshot.json`
    : `${DATA_DIR}/strategy-snapshot-${SNAPSHOT_SYMBOL.toLowerCase()}.json`;

const CORE_BASE = process.env.CORE_BASE || "http://127.0.0.1:10000";

const symbol = process.env.SYMBOL || "SPY";

const STRATEGIES = [
  { strategyId: "subminute_scalp@10m", tf: "10m", degree: "subminute", wave: "W1" },
  { strategyId: "intraday_scalp@10m", tf: "10m", degree: "minute", wave: "W1" },
  { strategyId: "minor_swing@1h", tf: "1h", degree: "minor", wave: "W1" },
  { strategyId: "intermediate_long@4h", tf: "4h", degree: "intermediate", wave: "W1" },
];

const ENGINE2_MAP = {
  subminute_scalp: { degree: "minute", tf: "1h" },
  intraday_scalp: { degree: "minor", tf: "1h" },
  minor_swing: { degree: "intermediate", tf: "1h" },
  intermediate_long: { degree: "primary", tf: "1d" },
};

function nowIso() {
  return new Date().toISOString();
}

function getPhoenixReplayParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value || "";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");

  return {
    dateYmd: `${year}-${month}-${day}`,
    timeHHMM: `${hour}${minute}`,
  };
}

function firstArrayItems(value, limit = 5) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : [];
}

function buildEngine26ReplayMarker({
  symbol,
  strategyId,
  engine26ImbalanceWatch,
  engine26StructuralContext,
  engine26PaperTradeTicket,
  engine26PaperTradeExecution,
  permission,
  confluence,
  engine15Decision,
}) {
  const structural = engine26StructuralContext || null;
  const paper = permission?.paper || null;

  if (structural?.active !== true) return null;

  const paperDecision = String(paper?.decision || "").toUpperCase();
  const status = String(structural?.status || "").toUpperCase();

  const importantPaperDecisions = new Set([
    "STRUCTURAL_FAST_WATCH",
    "PAPER_SHORT_RESEARCH_WATCH",
    "PAPER_WATCH_FAST",
    "PAPER_ALLOW",
    "FAST_INTRADAY_PAPER_ALLOW",
  ]);

  const shouldCreate =
    structural?.shortResearchOnly === true ||
    status.includes("WATCH") ||
    importantPaperDecisions.has(paperDecision) ||
    engine26PaperTradeTicket != null;

  if (!shouldCreate) return null;

  const markerType =
    engine26PaperTradeTicket != null || paperDecision === "PAPER_ALLOW"
      ? "ENGINE26_PAPER_TRADE_PREVIEW"
      : structural?.watchOnly === true
      ? "ENGINE26_STRUCTURAL_WATCH"
      : engine26ImbalanceWatch?.active === true
      ? "ENGINE26_IMBALANCE_WATCH"
      : "ENGINE26_STRUCTURAL_WATCH";

  const replayParts = getPhoenixReplayParts();
  const replayPath = `/var/data/replay/es/${replayParts.dateYmd}/${replayParts.timeHHMM}.json`;

  const activeImbalance = engine26ImbalanceWatch?.activeImbalance || null;

  const paperReaction =
    confluence?.context?.reaction?.paperScalpReaction ||
    confluence?.context?.reaction?.engine3FastImbalanceReaction ||
    null;

  const fastParticipation =
    confluence?.context?.volume?.engine4FastImbalanceParticipation || null;

  const paperReadiness = engine15Decision?.paperScalpReadiness || null;

  const currentPrice =
    Number(engine26ImbalanceWatch?.currentPrice) ||
    Number(confluence?.price) ||
    null;

  const direction =
    structural?.preferredDirection ||
    paper?.direction ||
    null;

  const setupType =
    structural?.template ||
    engine26ImbalanceWatch?.structuralTemplate ||
    null;

  const engine15Blockers = firstArrayItems(
    paperReadiness?.blockers ||
      engine15Decision?.blockers,
    5
  );

  const engine6Blockers = firstArrayItems(paper?.blockers, 8);

  const dedupeKey = [
    symbol,
    replayParts.dateYmd,
    replayParts.timeHHMM,
    markerType,
    structural?.status || "UNKNOWN_STATUS",
    paperDecision || "UNKNOWN_ENGINE6_DECISION",
  ].join("|");

  return {
    active: true,
    engine: "engine26.replayMarker.v1",
    mode: "REPLAY_POINTER_ONLY",

    markerType,

    symbol,
    strategyId,

    dateYmd: replayParts.dateYmd,
    timeHHMM: replayParts.timeHHMM,
    replayApiTime: replayParts.timeHHMM,
    replayPath,

    createdAt: nowIso(),

    currentPrice,

    direction,
    status: structural?.status || null,
    template: structural?.template || null,
    setupType,
    preferredAction: structural?.preferredAction || null,

    activeImbalanceRole: structural?.activeImbalanceRole || null,
    structuralBias: structural?.structuralBias || null,

    shortResearchOnly: structural?.shortResearchOnly === true,
    doNotChaseLong: structural?.doNotChaseLong === true,
    watchOnly: structural?.watchOnly === true,
    noExecution: true,
    noPermissionCreated: true,

    levels: structural?.levels || null,
    targetPathPreview: structural?.targetPathPreview || null,
    invalidation: structural?.invalidation || null,
    confirmationNeeds: Array.isArray(structural?.confirmationNeeds)
      ? structural.confirmationNeeds
      : [],

    dailyCandleContext: structural?.dailyCandleContext || null,
    locationContext: structural?.locationContext || null,
    controlLevelContext: structural?.controlLevelContext || null,

    zone: {
      zoneLo: activeImbalance?.lo ?? null,
      zoneHi: activeImbalance?.hi ?? null,
      zoneMid: activeImbalance?.mid ?? null,
      insideZone: activeImbalance?.inside === true,
      nearZone: activeImbalance?.near === true,
    },

    engine3: {
      state: paperReaction?.state || null,
      quality: paperReaction?.quality || null,
      direction: paperReaction?.direction || null,
      allowed: paperReaction?.allowed === true,
    },

    engine4: {
      state:
        fastParticipation?.participationState ||
        fastParticipation?.state ||
        null,
      quality:
        fastParticipation?.participationQuality ||
        fastParticipation?.quality ||
        null,
      intendedDirection:
        fastParticipation?.intendedDirection ||
        fastParticipation?.direction ||
        null,
      allowed: fastParticipation?.allowed === true,
      hardBlocked: fastParticipation?.hardBlocked === true,
    },

    engine15: {
      readiness:
        paperReadiness?.readiness ||
        paperReadiness?.readinessLabel ||
        engine15Decision?.readinessLabel ||
        null,
      direction:
        paperReadiness?.direction ||
        engine15Decision?.direction ||
        null,
      allowed: paperReadiness?.allowed === true,
      blockersSummary: engine15Blockers,
    },

    engine6: {
      decision: paper?.decision || null,
      allowed: paper?.allowed === true,
      direction: paper?.direction || null,
      structuralWatchOnly: paper?.structuralWatchOnly === true,
      shortResearchWatch: paper?.shortResearchWatch === true,
      paperShortAllowed: paper?.paperShortAllowed === true,
      blockersSummary: engine6Blockers,
    },

    ticket: {
      created: engine26PaperTradeTicket != null,
    },

    execution: {
      created: engine26PaperTradeExecution != null,
    },

    reasonCodes: [
      "ENGINE26_REPLAY_MARKER_CREATED",
      "REPLAY_POINTER_ONLY",
      markerType,
      structural?.active === true
        ? "ENGINE26_STRUCTURAL_CONTEXT_ACTIVE"
        : null,
      paperDecision ? `ENGINE6_${paperDecision}` : null,
      ...(Array.isArray(structural?.reasonCodes)
        ? structural.reasonCodes
        : []),
    ].filter(Boolean),

    dedupeKey,
  };
}

function isGoodTimelineRead(timelineRead) {
  if (!timelineRead || typeof timelineRead !== "object") return false;

  const headline = String(timelineRead.headline || "").trim();

  if (!headline) return false;
  if (headline === "Wave/Fib State unavailable") return false;
  if (headline.includes("unavailable")) return false;

  if (!Array.isArray(timelineRead.mainSections)) return false;
  if (timelineRead.mainSections.length < 1) return false;

  return true;
}

function loadPreviousSnapshotSafe() {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  } catch {
    return null;
  }
}

function loadJsonFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function getPhoenixDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    ymd: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
  };
}

function ymdToUtcDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
  return new Date(`${ymd}T00:00:00Z`);
}

function addDaysYmd(ymd, days) {
  const date = ymdToUtcDate(ymd);
  if (!date) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getLastCompletedMarketEodDate(now = new Date()) {
  const { ymd, weekday } = getPhoenixDateParts(now);

  // Weekend handling:
  // Saturday -> Friday
  // Sunday   -> Friday
  if (weekday === "Sat") return addDaysYmd(ymd, -1);
  if (weekday === "Sun") return addDaysYmd(ymd, -2);

  // During normal weekdays, before the cash session completes,
  // the latest completed EOD is the prior trading day.
  const phoenixHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      hour: "2-digit",
      hour12: false,
    }).format(now)
  );

  // Conservative cutoff: before 14:00 Phoenix, use prior trading day.
  // This avoids marking Engine 25 stale before EOD data has a chance to exist.
  if (Number.isFinite(phoenixHour) && phoenixHour < 14) {
    if (weekday === "Mon") return addDaysYmd(ymd, -3);
    return addDaysYmd(ymd, -1);
  }

  return ymd;
}

function computeEngine25FreshnessStatus(modelDate, updatedAt) {
  if (!modelDate && !updatedAt) return "STALE";

  const requiredEodDate = getLastCompletedMarketEodDate();

  if (modelDate && requiredEodDate && modelDate >= requiredEodDate) {
    return "FRESH";
  }

  if (modelDate && requiredEodDate) {
    return "WAITING_FOR_LATEST_EOD_ROW";
  }

  const updatedMs = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isFinite(updatedMs)) {
    const ageHours = (Date.now() - updatedMs) / (1000 * 60 * 60);
    if (ageHours <= 30) return "FRESH";
    return "STALE";
  }

  if (modelDate) return "ONE_ROW_BEHIND_OK";
  return "STALE";
}
function loadEngine25Context() {
  const canonicalFile = `${DATA_DIR}/engine25-context.json`;
  const canonical = loadJsonFileSafe(canonicalFile);

  if (canonical && typeof canonical === "object" && canonical.ok === true) {
    const freshnessStatus =
      canonical.freshnessStatus ||
      canonical?.freshness?.status ||
      null;

    const modelDate =
      canonical.modelDate ||
      canonical?.freshness?.modelDate ||
      null;

    const updatedAt =
      canonical.updatedAt ||
      canonical?.freshness?.updatedAt ||
      null;

    return {
      ...canonical,

      source: canonical.source || "engine25-context.json",
      canonicalSource: "engine25-context.json",
      canonicalContext: true,

      freshnessStatus,
      modelDate,
      updatedAt,

      score: canonical.score ?? null,
      regime: canonical.regime ?? "UNKNOWN",
      label: canonical.label ?? null,
      bias: canonical.bias ?? canonical.regime ?? "UNKNOWN",
      riskLevel: canonical.riskLevel ?? canonical.label ?? null,

      permission: canonical.permission ?? null,
      sizeMultiplier: canonical.sizeMultiplier ?? null,

      components: canonical.components ?? null,
      macroAwareScore:
        canonical?.components?.macroAwareScore ??
        canonical.macroAwareScore ??
        null,
      breadthParticipation:
        canonical?.components?.breadthParticipation ??
        canonical.breadthParticipation ??
        null,
      distributionPressure:
        canonical?.components?.distributionPressure ??
        canonical.distributionPressure ??
        null,
      marketTrend:
        canonical?.components?.marketTrend ??
        canonical.marketTrend ??
        null,
      creditFragility:
        canonical?.components?.creditFragility ??
        canonical.creditFragility ??
        null,
      aiLeadership:
        canonical?.components?.aiLeadership ??
        canonical.aiLeadership ??
        null,

      esPermission: canonical.esPermission || {
        permission: canonical.permission ?? null,
        sizeMultiplier: canonical.sizeMultiplier ?? null,
        zoneState: canonical.zoneState ?? null,
        nearestZone: canonical.nearestZone ?? null,
      },

      tradePermission: canonical.tradePermission || {
        permission: canonical.permission ?? null,
        sizeMultiplier: canonical.sizeMultiplier ?? null,
      },

      warnings: Array.isArray(canonical.warnings)
        ? canonical.warnings
        : [],

      reasonCodes: Array.isArray(canonical.reasonCodes)
        ? canonical.reasonCodes
        : [],

      summary: canonical.summary || null,

      hardBlock: canonical.hardBlock === true,
      noBlindLongs: canonical.noBlindLongs === true,
      noBlindShorts: canonical.noBlindShorts !== false,
      requireReclaim: canonical.requireReclaim === true,
      requiredSetupQuality: canonical.requiredSetupQuality || null,
    };
  }
  const overlayFile = `${DATA_DIR}/engine25-composite-overlay-6mo.json`;
  const zoneAwareFile = `${DATA_DIR}/engine25-es-zone-aware-read.json`;
  const marketHealthFile = `${DATA_DIR}/engine25-market-health.json`;
  const zoneClassificationFile = `${DATA_DIR}/engine25-zone-classification.json`;
  const sectorBreadthFile = `${DATA_DIR}/engine25-sector-card-breadth-snapshots.json`;

  const overlay = loadJsonFileSafe(overlayFile);
  const zoneAware = loadJsonFileSafe(zoneAwareFile);
  const marketHealth = loadJsonFileSafe(marketHealthFile);
  const zoneClassification = loadJsonFileSafe(zoneClassificationFile);
  const sectorBreadth = loadJsonFileSafe(sectorBreadthFile);

  const rows = Array.isArray(overlay?.rows) ? overlay.rows : [];
  const latest = rows.length ? rows[rows.length - 1] : null;

  const permissions = latest?.permissions || {};
  const components = latest?.components || marketHealth?.components || {};

  const updatedAt =
    overlay?.generatedAtUtc ||
    overlay?.finishedAt ||
    zoneAware?.generatedAtUtc ||
    marketHealth?.updatedAt ||
    marketHealth?.generatedAtUtc ||
    null;

  const modelDate =
    latest?.latestEodDate ||
    latest?.cashProxyDate ||
    latest?.date ||
    zoneAware?.context?.latestContextDate ||
    marketHealth?.modelDate ||
    marketHealth?.latestEodDate ||
    null;

  const esSessionDate =
    latest?.esSessionDate ||
    latest?.date ||
    zoneAware?.context?.esSessionDate ||
    null;

  const cashProxyDate =
    latest?.cashProxyDate ||
    latest?.latestEodDate ||
    modelDate;

  const requiredEodDate = getLastCompletedMarketEodDate();

  const finalPermission =
    permissions.finalPermission ??
    permissions.macroDistributionBreadthAware ??
    permissions.macroDistributionAware ??
    permissions.macroAware ??
    zoneAware?.context?.finalPermission ??
    marketHealth?.finalPermission ??
    marketHealth?.permission ??
    null;

  const finalSize =
    permissions.finalSize ??
    zoneAware?.context?.finalSize ??
    marketHealth?.finalSize ??
    marketHealth?.sizeMultiplier ??
    null;

  const score =
    latest?.engine25CompositeScore ??
    marketHealth?.score ??
    marketHealth?.engine25Score ??
    null;

  const regime =
    latest?.overlayState ??
    marketHealth?.regime ??
    marketHealth?.bias ??
    "UNKNOWN";

  const label =
    latest?.overlayLabel ??
    marketHealth?.label ??
    marketHealth?.riskLevel ??
    null;

  const hasZoneAware = zoneAware && typeof zoneAware === "object";
  const hasMarketHealth = marketHealth && typeof marketHealth === "object";
  const hasComposite = latest && typeof latest === "object";

  if (!hasComposite && !hasZoneAware && !hasMarketHealth) {
    return {
      ok: false,
      source: "engine25-context-files",
      score: null,
      regime: "UNKNOWN",
      label: null,
      bias: "UNKNOWN",
      riskLevel: "UNKNOWN",
      permission: null,
      sizeMultiplier: null,
      components: null,
      macroAwareScore: null,
      breadthParticipation: null,
      distributionPressure: null,
      marketTrend: null,
      creditFragility: null,
      aiLeadership: null,
      esPermission: null,
      tradePermission: null,
      zoneAwareRead: null,
      marketHealth: null,
      zoneClassification: null,
      sectorBreadth: null,
      dailyCompositeAvailable: false,
      compositeFallbackActive: false,
      warnings: ["ENGINE25_CONTEXT_MISSING"],
      summary: "Engine 25 context files are not available.",
      modelDate: null,
      updatedAt: null,
      freshnessStatus: "MISSING",
    };
  }

  const warnings = [
    ...(Array.isArray(latest?.warnings) ? latest.warnings : []),
    ...(!hasComposite ? ["ENGINE25_COMPOSITE_OVERLAY_MISSING_FALLBACK_ACTIVE"] : []),
    ...(!hasZoneAware ? ["ENGINE25_ZONE_AWARE_READ_MISSING"] : []),
  ];

  return {
    ok: true,
    source: hasComposite
      ? "engine25-composite-overlay-6mo.json"
      : "engine25-live-file-fallback",
    supplementalSource: hasZoneAware ? "engine25-es-zone-aware-read.json" : null,

    dailyCompositeAvailable: hasComposite,
    compositeFallbackActive: !hasComposite && (hasZoneAware || hasMarketHealth),

    score,
    regime,
    label,
    bias: regime,
    riskLevel: label ?? marketHealth?.riskLevel ?? null,

    permission: finalPermission,
    sizeMultiplier: finalSize,

    components,
    macroAwareScore:
      components?.macroAwareScore ??
      marketHealth?.macroAwareScore ??
      null,
    breadthParticipation:
      components?.breadthParticipation ??
      zoneAware?.context?.breadthParticipation ??
      marketHealth?.breadthParticipation ??
      null,
    distributionPressure:
      components?.distributionPressure ??
      zoneAware?.context?.distributionPressure ??
      marketHealth?.distributionPressure ??
      null,
    marketTrend:
      components?.marketTrend ??
      marketHealth?.marketTrend ??
      null,
    creditFragility:
      components?.creditFragility ??
      marketHealth?.creditFragility ??
      null,
    aiLeadership:
      components?.aiLeadership ??
      marketHealth?.aiLeadership ??
      null,

    esPermission: {
      permission: zoneAware?.context?.finalPermission ?? finalPermission,
      sizeMultiplier: zoneAware?.context?.finalSize ?? finalSize,
      zoneState: zoneAware?.zoneState ?? null,
      nearestZone: zoneAware?.nearestZone ?? null,
      zoneClassification: zoneClassification || null,
    },

    tradePermission: {
      permission: finalPermission,
      sizeMultiplier: finalSize,
    },

    zoneAwareRead: hasZoneAware
      ? {
          ok: zoneAware.ok === true,
          generatedAtUtc: zoneAware.generatedAtUtc || null,
          current: zoneAware.current || null,
          context: zoneAware.context || null,
          nearestZone: zoneAware.nearestZone || null,
          zoneState: zoneAware.zoneState || null,
          plainEnglish: zoneAware.plainEnglish || null,
        }
      : null,

    marketHealth: hasMarketHealth ? marketHealth : null,
    zoneClassification: zoneClassification || null,
    sectorBreadth: sectorBreadth || null,

    warnings,
    summary:
      zoneAware?.plainEnglish ||
      latest?.overlayInterpretation ||
      marketHealth?.summary ||
      null,

    modelDate,
    latestEodDate: modelDate,
    esSessionDate,
    cashProxyDate,
    requiredEodDate,
    updatedAt,
    freshnessStatus:
      hasZoneAware && !modelDate
        ? "FRESH"
        : computeEngine25FreshnessStatus(modelDate, updatedAt),
  };
}
function preserveLastGoodEngine22Timeline(result, previousSnapshot) {
  if (!result?.strategies || !previousSnapshot?.strategies) return result;

  for (const strategyId of Object.keys(result.strategies)) {
    const nextStrategy = result.strategies[strategyId];
    const prevStrategy = previousSnapshot.strategies?.[strategyId];

    const nextWave = nextStrategy?.engine22WaveStrategy;
    const prevWave = prevStrategy?.engine22WaveStrategy;

    const nextTimeline = nextWave?.timelineRead;
    const prevTimeline = prevWave?.timelineRead;

    const nextGood = isGoodTimelineRead(nextTimeline);
    const prevGood = isGoodTimelineRead(prevTimeline);

    if (!nextGood && prevGood) {
      result.strategies[strategyId] = {
        ...nextStrategy,
        engine22WaveStrategy: {
          ...(prevWave || {}),
          ...(nextWave || {}),
          timelineRead: prevTimeline,
          staleTimelineFallback: true,
          staleTimelineFallbackReason:
            "PRESERVED_LAST_GOOD_ENGINE22_TIMELINE_DURING_REBUILD",
          staleTimelineFallbackAt: nowIso(),
        },
      };
    }
  }

  return result;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildEngine4WaveContextFromDegreeStates(engine22WaveStrategy) {
  const degreeStates = engine22WaveStrategy?.degreeStates || null;

  if (!degreeStates || typeof degreeStates !== "object") {
    const currentLifecycleState =
      engine22WaveStrategy?.currentLifecycleState || null;

    return {
      available: false,
      source: "engine22WaveStrategy.currentLifecycleState",
      fallbackLifecycleKey: currentLifecycleState?.key || null,
      fallbackHeadline: currentLifecycleState?.headline || null,
      reasonCodes: ["ENGINE22_DEGREE_STATES_MISSING_FALLBACK_LIFECYCLE_USED"],
    };
  }

  const minor = degreeStates.minor || null;
  const minute = degreeStates.minute || null;
  const subminute = degreeStates.subminute || null;

  return {
    available: true,
    source: "engine22WaveStrategy.degreeStates",

    minor: {
      headline: minor?.headline || null,
      activeWave: minor?.activeWave || null,
      stage: minor?.stage || null,
      direction: minor?.direction || null,
      correctionType: minor?.correctionModel?.type || null,
      correctionStage: minor?.correctionModel?.stage || null,
      preferredType: minor?.correctionModels?.preferredType || null,
      localSupportWatch: minor?.targetModel?.localSupportWatch || null,
    },

    minute: {
      headline: minute?.headline || null,
      action: minute?.action || null,
      activeWave: minute?.activeWave || null,
      stage: minute?.stage || null,
      direction: minute?.direction || null,
      correctionType: minute?.correctionModel?.type || null,
      correctionStage: minute?.correctionModel?.stage || null,
      nestedPurpose: minute?.nestedCorrectionContext?.childPurpose || null,
      currentRead: minute?.nestedCorrectionContext?.currentRead || null,
      nextExpected: minute?.nestedCorrectionContext?.nextExpected || null,
    },

    subminute: {
      headline: subminute?.headline || null,
      action: subminute?.action || null,
      activeWave: subminute?.activeWave || null,
      stage: subminute?.stage || null,
      direction: subminute?.direction || null,
      correctionType: subminute?.correctionModel?.type || null,
      correctionStage: subminute?.correctionModel?.stage || null,
      nestedPurpose: subminute?.nestedCorrectionContext?.childPurpose || null,
      currentRead: subminute?.nestedCorrectionContext?.currentRead || null,
      nextExpected: subminute?.nestedCorrectionContext?.nextExpected || null,
    },

    reasonCodes: ["ENGINE22_DEGREE_STATES_CONSUMED_BY_ENGINE4"],
  };
}

function isFuturesSymbol(sym) {
  const s = String(sym || "").toUpperCase();
  return ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"].includes(s);
}

function ohlcPathForSymbol(sym) {
  return isFuturesSymbol(sym) ? "/api/v1/futures/ohlc" : "/api/v1/ohlc";
}
function normalizeEsEngine1Context(esJson) {
  const levels = Array.isArray(esJson?.levels) ? esJson.levels : [];

  const price = firstNumber(
    esJson?.current_price,
    esJson?.currentPrice,
    esJson?.meta?.current_price,
    esJson?.meta?.currentPrice,
    esJson?.meta?.current_price_anchor,
    esJson?.meta?.currentPriceAnchor
  );

  const shelves = levels.map((z) => {
    const lo = Number(z?.lo);
    const hi = Number(z?.hi);

    let distancePts = null;

    if (Number.isFinite(price) && Number.isFinite(lo) && Number.isFinite(hi)) {
      const a = Math.min(lo, hi);
      const b = Math.max(lo, hi);

      if (price >= a && price <= b) {
        distancePts = 0;
      } else {
        distancePts = price < a ? a - price : price - b;
      }
    }

    return {
      ...z,
      id: z?.id ?? null,
      type: z?.type ?? null,
      lo: Number.isFinite(lo) ? lo : null,
      hi: Number.isFinite(hi) ? hi : null,
      mid: firstNumber(z?.mid, z?.price),
      strength: firstNumber(z?.strength, z?.strength_raw),
      confidence: firstNumber(z?.confidence),
      distancePts:
        Number.isFinite(distancePts) ? Number(distancePts.toFixed(2)) : null,
      zoneType: "SHELF",
      source: "ES_ENGINE_1B_SHELVES",
    };
  });

  const sortedShelves = shelves
    .filter((z) => Number.isFinite(Number(z?.distancePts)))
    .sort((a, b) => Number(a.distancePts) - Number(b.distancePts));

  const activeShelf =
    sortedShelves.find((z) => Number(z.distancePts) === 0) || null;

  const nearestShelf =
    sortedShelves[0] || null;

  return {
    ok: esJson?.ok !== false,
    symbol: "ES",
    meta: {
      ...(esJson?.meta || {}),
      symbol: "ES",
      current_price: Number.isFinite(price) ? price : null,
      currentPrice: Number.isFinite(price) ? price : null,
      source: "ES_ENGINE_1B_SHELVES",
    },
    active: {
      negotiated: null,
      institutional: null,
      shelf: activeShelf,
    },
    nearest: {
      shelf: nearestShelf,
    },
    render: {
      negotiated: [],
      institutional: [],
      shelves,
    },
    flags: {
      source: "ES_ENGINE_1B_SHELVES",
    },
  };
} 

/* -----------------------------
   Safe HTTP helpers
------------------------------*/
async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);
      return { ok: res.ok, status: res.status, json, text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);
      return { ok: res.ok, status: res.status, json, text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -----------------------------
   Live Market Meter (authoritative)
------------------------------*/
async function fetchLiveMarketMeter() {
  const [intraday, m30, hourly, h4, eod] = await Promise.all([
    fetchJson(`${CORE_BASE}/live/intraday`, 15000),
    fetchJson(`${CORE_BASE}/live/30m`, 15000),
    fetchJson(`${CORE_BASE}/live/hourly`, 15000),
    fetchJson(`${CORE_BASE}/live/4h`, 15000),
    fetchJson(`${CORE_BASE}/live/eod`, 15000),
  ]);

  const intradayJ = intraday?.json || {};
  const m30J = m30?.json || {};
  const hourlyJ = hourly?.json || {};
  const h4J = h4?.json || {};
  const eodJ = eod?.json || {};

  return {
    score10m:
      toNum(intradayJ?.metrics?.overall_intraday_score) ??
      toNum(intradayJ?.intraday?.overall10m?.score) ??
      toNum(intradayJ?.engineLights?.["10m"]?.score),
    state10m:
      intradayJ?.metrics?.overall_intraday_state ??
      intradayJ?.intraday?.overall10m?.state ??
      intradayJ?.engineLights?.["10m"]?.state ??
      null,

    score30m:
      toNum(m30J?.metrics?.overall_30m_score) ??
      toNum(m30J?.thirtyMin?.overall30m?.score),
    state30m:
      m30J?.metrics?.overall_30m_state ??
      m30J?.thirtyMin?.overall30m?.state ??
      null,

    score1h:
      toNum(hourlyJ?.metrics?.overall_hourly_score) ??
      toNum(hourlyJ?.hourly?.overall1h?.score),
    state1h:
      hourlyJ?.metrics?.overall_hourly_state ??
      hourlyJ?.hourly?.overall1h?.state ??
      null,

    score4h:
      toNum(h4J?.metrics?.trend_strength_4h_pct) ??
      toNum(h4J?.fourHour?.overall4h?.score),
    state4h:
      h4J?.fourHour?.overall4h?.state ?? null,

    scoreEOD:
      toNum(eodJ?.metrics?.overall_eod_score) ??
      toNum(eodJ?.daily?.overallEOD?.score),
    stateEOD:
      eodJ?.metrics?.overall_eod_state ??
      eodJ?.daily?.overallEOD?.state ??
      null,

    raw: {
      intraday: intradayJ,
      m30: m30J,
      hourly: hourlyJ,
      h4: h4J,
      eod: eodJ,
    },

    _src: "LIVE_10M_30M_1H_4H_EOD",
  };
}

function firstNumber(...xs) {
  for (const x of xs) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pctDistance(price, ema) {
  const p = Number(price);
  const e = Number(ema);

  if (!Number.isFinite(p) || !Number.isFinite(e) || e === 0) return null;

  return Number((((p - e) / e) * 100).toFixed(2));
}

function pointDistance(price, ema) {
  const p = Number(price);
  const e = Number(ema);

  if (!Number.isFinite(p) || !Number.isFinite(e)) return null;

  return Number((p - e).toFixed(2));
}

function buildMarketMeterLayers(marketMind) {
  const eodRaw = marketMind?.raw?.eod || {};

  const close = firstNumber(
    eodRaw?.daily?.close,
    eodRaw?.daily?.lastClose,
    eodRaw?.daily?.last_close,
    eodRaw?.metrics?.close,
    eodRaw?.metrics?.lastClose,
    eodRaw?.metrics?.last_close,
    eodRaw?.meta?.current_price,
    eodRaw?.currentPrice,
    eodRaw?.close
  );

  const ema10 = firstNumber(
    eodRaw?.daily?.ema10,
    eodRaw?.daily?.ema_10,
    eodRaw?.daily?.ema10Daily,
    eodRaw?.metrics?.ema10,
    eodRaw?.metrics?.ema_10,
    eodRaw?.metrics?.ema10_daily,
    eodRaw?.ema10,
    eodRaw?.ema10_daily
  );

  const distanceToEma10 = pointDistance(close, ema10);
  const distanceToEma10Pct = pctDistance(close, ema10);

  const aboveEma10 =
    close !== null &&
    ema10 !== null
      ? close > ema10
      : null;

  return {
    layers: {
      eod: {
        close,
        ema10,
        distanceToEma10,
        distanceToEma10Pct,
        aboveEma10,
        trendState:
          marketMind?.stateEOD ??
          eodRaw?.metrics?.overall_eod_state ??
          eodRaw?.daily?.overallEOD?.state ??
          null,
        score:
          marketMind?.scoreEOD ??
          eodRaw?.metrics?.overall_eod_score ??
          eodRaw?.daily?.overallEOD?.score ??
          null,
        updatedAt:
          eodRaw?.updated_at_utc ??
          eodRaw?.updatedAt ??
          eodRaw?.meta?.updated_at_utc ??
          eodRaw?.meta?.updatedAt ??
          null,
      },
    },
    source: "LIVE_MARKET_METER",
  };
}

/* -----------------------------
   Momentum
------------------------------*/
function fallbackMomentum(sym) {
  return {
    ok: false,
    symbol: sym,
    smi10m: { k: null, d: null, direction: "UNKNOWN", cross: "NONE" },
    smi1h: { k: null, d: null, direction: "UNKNOWN", cross: "NONE" },
    alignment: "MIXED",
    compression: { active: false, bars: 0, width: 0 },
    momentumState: "UNKNOWN",
  };
}

async function fetchMomentumContext(sym) {
  const r = await fetchJson(`${CORE_BASE}/api/v1/momentum-context?symbol=${sym}`, 15000);
  return r?.json || fallbackMomentum(sym);
}

function fallbackEngine21Alignment(tf) {
  return {
    ok: false,
    tf,
    alignmentState: "NO_ALIGNMENT",
    alignmentScore: 0,
    bullishAligned: false,
    bearishAligned: false,
    bullishScore: 0,
    bearishScore: 0,
    components: {},
    updatedAt: null,
    error: "ENGINE21_UNAVAILABLE",
  };
}

async function fetchEngine21Alignment(tf) {
  const r = await fetchJson(
    `${CORE_BASE}/api/v1/engine21-alignment?tf=${encodeURIComponent(tf)}`,
    15000
  );

  if (r?.ok && r?.json && typeof r.json === "object") {
    return r.json;
  }

  return fallbackEngine21Alignment(tf);
}

async function fetchSpyReactionQuality(sym = "SPY", tf = "10m") {
  const r = await fetchJson(
    `${CORE_BASE}/api/v1/spy-reaction-quality?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}`,
    15000
  );

  return r?.json || {
    ok: false,
    error: "SPY_REACTION_QUALITY_UNAVAILABLE",
  };
}

async function fetchSpyVolumeBehavior(sym = "SPY", tf = "10m") {
  const r = await fetchJson(
    `${CORE_BASE}/api/v1/spy-volume-behavior?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}`,
    15000
  );

  return r?.json || {
    ok: false,
    error: "SPY_VOLUME_BEHAVIOR_UNAVAILABLE",
  };
}

/* -----------------------------
   Engine 16
------------------------------*/
function fallbackEngine16(sym, tf = "30m", marketRegime = null) {
  return {
    ok: false,
    symbol: sym,
    date: null,
    timeframe: tf,
    context: "NONE",
    marketRegime: marketRegime || null,
    anchors: {
      premarketLow: null,
      premarketHigh: null,
      sessionHigh: null,
      sessionLow: null,
      anchorA: null,
      anchorB: null,
    },
    fib: {
      r382: null,
      r500: null,
      r618: null,
      r786: null,
    },
    pullbackZone: { lo: null, hi: null },
    secondaryZone: { lo: null, hi: null },
    state: "NO_IMPULSE",
    insidePrimaryZone: false,
    insideSecondaryZone: false,
    invalidated: false,
    wickRejectionLong: false,
    wickRejectionShort: false,
    hasPulledBack: false,
    breakoutReady: false,
    breakdownReady: false,
    strategyType: "NONE",
    readinessLabel: "NO_SETUP",
    exhaustionDetected: false,
    exhaustionShort: false,
    exhaustionLong: false,
    exhaustionActive: false,
    exhaustionBarTime: null,
    exhaustionBarPrice: null,
    meta: {
      marketTz: "America/New_York",
      impulseWindowMinutes: 90,
      atrPeriod: 14,
      atrMultiple: 1.2,
    },
    error: "ENGINE16_UNAVAILABLE",
  };
}

function buildSkippedWaveContext(engine2Context = null) {
  const primaryPhase = engine2Context?.primary?.phase ?? "UNKNOWN";
  const intermediatePhase = engine2Context?.intermediate?.phase ?? "UNKNOWN";
  const minorPhase = engine2Context?.minor?.phase ?? "UNKNOWN";
  const intermediateWaveMode = engine2Context?.intermediate?.waveMode ?? null;
  const correctionDirection = engine2Context?.intermediate?.correctionDirection ?? null;

  let macroBias = "NONE";
  let waveState = "UNKNOWN";
  let wavePrep = false;
  let intermediateReadyForWave3 = false;

  if (
    primaryPhase === "COMPLETE_W5" &&
    ["IN_A", "IN_B", "IN_C"].includes(intermediatePhase)
  ) {
    if (correctionDirection === "UP") macroBias = "SHORT_PREFERENCE";
    if (correctionDirection === "DOWN") macroBias = "LONG_PREFERENCE";
  }

  if (intermediatePhase === "IN_A") waveState = "EARLY_CORRECTION";
  if (intermediatePhase === "IN_B") waveState = "MID_CORRECTION";
  if (intermediatePhase === "IN_C") {
    waveState = "FINAL_CORRECTION";
    wavePrep = true;
    intermediateReadyForWave3 = true;
  }

  if (["IN_W3", "IN_W5"].includes(intermediatePhase)) {
    waveState = "TRENDING_IMPULSE";
  }

  return {
    primaryPhase,
    intermediatePhase,
    minorPhase,
    intermediateWaveMode,
    correctionDirection,
    macroBias,
    waveState,
    wavePrep,
    intermediateReadyForWave3,
  };
}

function skippedEngine16(sym, tf = null, marketRegime = null, engine2Context = null) {
  const waveContext = buildSkippedWaveContext(engine2Context);

  return {
    ok: false,
    skipped: true,
    reason: "ENGINE16_NOT_ENABLED_FOR_THIS_STRATEGY",
    symbol: sym,
    timeframe: tf,
    marketRegime: marketRegime || null,

    // NEW: carry structure truth even when Engine16 is intentionally skipped
    engine2Context: engine2Context || null,
    waveContext,
    waveState: waveContext.waveState,
    wavePrep: waveContext.wavePrep,
    macroBias: waveContext.macroBias,
    primaryPhase: waveContext.primaryPhase,
    intermediatePhase: waveContext.intermediatePhase,
    minorPhase: waveContext.minorPhase,
    intermediateWaveMode: waveContext.intermediateWaveMode,
    correctionDirection: waveContext.correctionDirection,
  };
}

function isEngine16EnabledForStrategy(strategyId) {
  return (
  strategyId === "subminute_scalp@10m" ||
  strategyId === "intraday_scalp@10m" ||
  strategyId === "minor_swing@1h"
 );
}
async function buildEngine16Direct(sym, tf = "30m", marketRegime = null, engine2Context = null) {
  try {
    return await computeMorningFib({
      symbol: sym,
      tf,
      includeZones: true,
      includeVolume: true,
      marketRegime,
      engine2Context,
    });
  } catch (err) {
    return {
      ...fallbackEngine16(sym, tf, marketRegime),
      error: String(err?.message || err),
    };
  }
}

/* -----------------------------
   Permission helpers
------------------------------*/
function normalizeEngine5ForEngine6(confluenceJson) {
  if (!confluenceJson || typeof confluenceJson !== "object") {
    return { invalid: false, total: null, reasonCodes: [] };
  }

  const invalid = Boolean(confluenceJson.invalid);
  const reasonCodes = Array.isArray(confluenceJson.reasonCodes)
    ? confluenceJson.reasonCodes
    : [];

  const rawTotal =
    Number(confluenceJson?.scores?.total) ||
    Number(confluenceJson?.total);

  const total = Number.isFinite(rawTotal) ? rawTotal : null;

  const label = confluenceJson?.scores?.label || confluenceJson?.label || null;
  const flags = confluenceJson?.flags || null;
  const compression = confluenceJson?.compression || null;
  const bias = confluenceJson?.bias ?? null;

  return { invalid, total, reasonCodes, label, flags, compression, bias };
}

function isInside(price, z) {
  const p = Number(price);
  const lo = Number(z?.lo);
  const hi = Number(z?.hi);
  if (!Number.isFinite(p) || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return p >= a && p <= b;
}

function computeZoneTelemetryFromCtx(ctx) {
  const price = Number(ctx?.meta?.current_price ?? ctx?.meta?.currentPrice);
  const active = ctx?.active || {};

  let zoneType = "UNKNOWN";
  let activeZone = null;

  if (active?.negotiated) {
    zoneType = "NEGOTIATED";
    activeZone = active.negotiated;
  } else if (active?.institutional) {
    zoneType = "INSTITUTIONAL";
    activeZone = active.institutional;
  } else if (active?.shelf) {
    zoneType = "SHELF";
    activeZone = active.shelf;
  }

  const withinZone = activeZone ? isInside(price, activeZone) : false;
  return { zoneType, withinZone };
}

function buildEngine5Analytics(confluenceJson) {
  const score =
    Number(confluenceJson?.scores?.total) ||
    Number(confluenceJson?.total) ||
    null;

  return {
    ...(confluenceJson || {}),
    analyticsOnly: true,
    engineRole: "INGREDIENTS_ONLY",
    blockingAuthority: false,
    score,
    label: confluenceJson?.scores?.label || confluenceJson?.label || null,
  };
}

function buildEngine25ModifierPreview(engine25Context) {
  if (!engine25Context || typeof engine25Context !== "object") {
    return {
      applied: false,
      mode: "PREVIEW_ONLY",
      engine25Fresh: false,
      score: null,
      regime: null,
      macroPermission: null,
      wouldCapSizeTo: null,
      requiredSetupQuality: null,
      wouldAllowConfirmedLongs: false,
      wouldBlockBlindLongs: true,
      wouldBlockLateChase: true,
      wouldRequireReclaim: true,
      wouldDowngradePermission: false,
      reasonCodes: [
        "ENGINE25_CONTEXT_MISSING",
        "PREVIEW_ONLY_NO_PERMISSION_CHANGE",
      ],
    };
  }

const freshnessStatus = String(engine25Context?.freshnessStatus || "").toUpperCase();
const engine25Fresh =
  freshnessStatus === "FRESH" ||
  freshnessStatus === "ONE_ROW_BEHIND_OK";

if (
  engine25Context.ok !== true ||
  freshnessStatus === "MISSING" ||
  freshnessStatus === "STALE"
) {
  return {
    applied: false,
    mode: "PREVIEW_ONLY",
    engine25Fresh: false,
    score: null,
    regime: engine25Context?.regime || null,
    macroPermission: engine25Context?.permission || null,
    wouldCapSizeTo: null,
    requiredSetupQuality: null,
    wouldAllowConfirmedLongs: false,
    wouldBlockBlindLongs: true,
    wouldBlockLateChase: true,
    wouldRequireReclaim: true,
    wouldDowngradePermission: false,
    reasonCodes: [
      freshnessStatus === "MISSING"
        ? "ENGINE25_CONTEXT_MISSING"
        : "ENGINE25_STALE_NO_UPGRADE",
      "PREVIEW_ONLY_NO_PERMISSION_CHANGE",
    ],
  };
}

const numOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const score = numOrNull(engine25Context?.score);
  const regime = String(
    engine25Context?.regime ||
      engine25Context?.bias ||
      "UNKNOWN"
  ).toUpperCase();

  const macroPermission = String(
    engine25Context?.permission ||
      engine25Context?.esPermission?.permission ||
      engine25Context?.tradePermission?.permission ||
      "UNKNOWN"
  ).toUpperCase();

  const summary = String(engine25Context?.summary || "").toUpperCase();

  const wouldCapSizeTo =
    numOrNull(engine25Context?.sizeMultiplier) ??
    numOrNull(engine25Context?.esPermission?.sizeMultiplier) ??
    numOrNull(engine25Context?.tradePermission?.sizeMultiplier) ??
    (regime.includes("RISK_ON")
      ? 1.0
      : regime.includes("CONSTRUCTIVE")
      ? 0.75
      : regime.includes("DEFENSIVE") || regime.includes("RISK_OFF")
      ? 0.5
      : null);

  const zoneAtRisk =
    summary.includes("ZONE IS AT RISK") ||
    summary.includes("BELOW INSTITUTIONAL SUPPORT") ||
    summary.includes("RECLAIM");

  const canonicalRequiredSetupQuality = String(
    engine25Context?.requiredSetupQuality || ""
  ).toUpperCase();

  const requiresAPlus =
    canonicalRequiredSetupQuality === "A_PLUS_ONLY" ||
    summary.includes("A+ ONLY") ||
    summary.includes("A PLUS ONLY") ||
    summary.includes("A_PLUS_ONLY") ||
    macroPermission.includes("A_PLUS");

  const derivedRequiredSetupQuality =
    requiresAPlus
      ? "A_PLUS_ONLY"
      : canonicalRequiredSetupQuality === "A_ONLY"
      ? "A_ONLY"
      : canonicalRequiredSetupQuality === "A_OR_BETTER"
      ? "A_OR_BETTER"
      : canonicalRequiredSetupQuality === "B_OR_BETTER"
      ? "B_OR_BETTER"
      : zoneAtRisk
      ? "A_ONLY"
      : regime.includes("RISK_ON")
      ? "B_OR_BETTER"
      : regime.includes("CONSTRUCTIVE")
      ? "A_OR_BETTER"
      : regime.includes("DEFENSIVE") || regime.includes("RISK_OFF")
      ? "A_PLUS_ONLY"
      : "A_OR_BETTER";

  const requiredSetupQuality =
    canonicalRequiredSetupQuality || derivedRequiredSetupQuality;

  const wouldAllowConfirmedLongs =
    macroPermission.includes("CONFIRMED_LONGS_ALLOWED") ||
    macroPermission.includes("SELECTIVE_LONGS");

  const wouldDowngradePermission =
    regime.includes("DEFENSIVE") ||
    regime.includes("RISK_OFF");

  const reasonCodes = [];

  if (engine25Fresh) {
    reasonCodes.push("ENGINE25_FRESH");
  } else {
    reasonCodes.push("ENGINE25_STALE_NO_UPGRADE");
  }

  if (regime && regime !== "UNKNOWN") {
    reasonCodes.push(regime);
  }

  if (macroPermission && macroPermission !== "UNKNOWN") {
    reasonCodes.push(`ENGINE25_${macroPermission}`);
  }

  if (wouldCapSizeTo != null) {
    reasonCodes.push(
      `ENGINE25_SIZE_CAP_PREVIEW_${String(wouldCapSizeTo).replace(".", "_")}`
    );
  }

  if (zoneAtRisk) {
    reasonCodes.push("ENGINE25_ZONE_AT_RISK_REQUIRES_RECLAIM");
  }

  if (requiredSetupQuality === "A_PLUS_ONLY") {
    reasonCodes.push("ENGINE25_A_PLUS_ONLY_UNTIL_RECLAIM");
  } else if (requiredSetupQuality === "A_ONLY") {
    reasonCodes.push("ENGINE25_A_ONLY_UNTIL_RECLAIM");
  }

  reasonCodes.push("PREVIEW_ONLY_NO_PERMISSION_CHANGE");

  return {
    applied: false,
    mode: "PREVIEW_ONLY",
    engine25Fresh,
    score,
    regime,
    macroPermission,
    wouldCapSizeTo,
    requiredSetupQuality,
    wouldAllowConfirmedLongs,
    wouldBlockBlindLongs: true,
    wouldBlockLateChase: true,
    wouldRequireReclaim: true,
    wouldDowngradePermission,
    reasonCodes,
  };
}

function buildEngine6PaperPermission({
  symbol,
  strategyId,
  confluence,
  engine15Decision,
  engine22WaveStrategy,
  engine25Context,
  engine26ImbalanceWatch = null,

  // New explicit authorized inputs.
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
}) {
  const legacyPaperReaction =
    confluence?.context?.reaction?.paperScalpReaction || null;

  const paperReaction =
    engine3AuthorizedReaction &&
    typeof engine3AuthorizedReaction === "object"
      ? engine3AuthorizedReaction
      : legacyPaperReaction;

  const fastImbalanceParticipation =
    confluence?.context?.volume?.engine4FastImbalanceParticipation || null;

  const currentScalpParticipation =
    confluence?.context?.volume?.engine4CurrentScalpParticipation || null;

  const lifecyclePaperParticipation =
    confluence?.context?.volume?.engine22LifecycleParticipation
      ?.paperScalpParticipation || null;

  const explicitAuthorizedParticipation =
    engine4AuthorizedParticipation &&
    typeof engine4AuthorizedParticipation === "object"
      ? engine4AuthorizedParticipation
      : null;

  const paperParticipation =
    explicitAuthorizedParticipation ||
    (
      fastImbalanceParticipation?.active === true
        ? fastImbalanceParticipation
        : currentScalpParticipation?.active === true
        ? currentScalpParticipation
        : lifecyclePaperParticipation
    );

  const paperParticipationSource =
    explicitAuthorizedParticipation
      ? "engine4AuthorizedReactionParticipation"
      : fastImbalanceParticipation?.active === true
      ? "engine4FastImbalanceParticipation"
      : currentScalpParticipation?.active === true
      ? "engine4CurrentScalpParticipation"
      : lifecyclePaperParticipation
      ? "engine22LifecycleParticipation.paperScalpParticipation"
      : "NONE";

  const paperReadiness =
    engine15Decision?.paperScalpReadiness || null;

  const currentLifecycleState =
    engine22WaveStrategy?.currentLifecycleState || null;

  const isFastIntradayPaperLane =
    String(symbol || "").toUpperCase() === "ES" &&
    strategyId === "intraday_scalp@10m";

  const paperShortResearchEnabled =
    isFastIntradayPaperLane;

  const engine26PreferredDirection = String(
    engine26ImbalanceWatch?.preferredDirection || ""
  ).toUpperCase();

  const engine26Status = String(
    engine26ImbalanceWatch?.status || ""
  ).toUpperCase();

  const engine26Template = String(
    engine26ImbalanceWatch?.structuralTemplate ||
      engine26ImbalanceWatch?.structuralPlaybook?.template ||
      ""
  ).toUpperCase();

  const engine26ShortWatchOnly =
    engine26PreferredDirection === "SHORT_WATCH_ONLY" ||
    engine26ImbalanceWatch?.shortResearchOnly === true ||
    engine26Status.includes("C_DOWN_WATCH") ||
    engine26Template.includes("ABC_DOWN");

  const engine26DoNotChaseLong =
    engine26ImbalanceWatch?.doNotChaseLong === true;

  const engine26ShortResearchOnly =
    engine26ImbalanceWatch?.shortResearchOnly === true;

  const usingAuthorizedReaction =
    explicitAuthorizedParticipation != null ||
    (
      paperReaction?.authorized === true &&
      paperReaction?.candidateId != null &&
      paperReaction?.zoneId != null
    );

  const authorizedReactionState = String(
    paperReaction?.authorizedReactionState || ""
  ).toUpperCase();

  const reactionConfirmed =
    usingAuthorizedReaction
      ? (
          paperReaction?.authorized === true &&
          paperReaction?.authorizeEngine3Evaluation === true &&
          authorizedReactionState === "REACTION_CONFIRMED" &&
          paperReaction?.allowed === true
        )
      : paperReaction?.allowed === true;

  const reactionAllowed =
    reactionConfirmed === true;

  const reactionActive =
    paperReaction?.active === true;

  const authorizedParticipationStatus = String(
    paperParticipation?.status || ""
  ).toUpperCase();

  const participationWaitingForEngine3 =
    authorizedParticipationStatus ===
    "WAITING_FOR_ENGINE3_REACTION";

  const participationConfirmed =
    explicitAuthorizedParticipation
      ? (
          explicitAuthorizedParticipation.active === true &&
          explicitAuthorizedParticipation.confirmed === true &&
          explicitAuthorizedParticipation.allowed === true &&
          explicitAuthorizedParticipation.hardBlocked !== true &&
          authorizedParticipationStatus ===
            "PARTICIPATION_CONFIRMED"
        )
      : paperParticipation?.allowed === true;

  const participationAllowed =
    participationConfirmed === true;

  const participationActive =
    paperParticipation?.active === true;

  const participationHardBlocked =
    paperParticipation?.hardBlocked === true;

  const readinessAllowed =
    paperReadiness?.allowed === true;

  const readinessActive =
    paperReadiness?.active === true ||
    String(
      engine15Decision?.readinessLabel || ""
    ).toUpperCase() === "WATCH";

  const participationState = String(
    paperParticipation?.state ||
      paperParticipation?.participationState ||
      paperParticipation?.status ||
      ""
  ).toUpperCase();

  const participationRisk = String(
    paperParticipation?.risk || ""
  ).toUpperCase();

  const participationDirection = String(
    paperParticipation?.intendedDirection ||
      paperParticipation?.direction ||
      ""
  ).toUpperCase();

  const fastParticipationWaiting =
    participationActive === true &&
    participationAllowed !== true &&
    participationHardBlocked !== true &&
    (
      participationWaitingForEngine3 ||
      participationState.includes(
        "PRICE_ACTION_OK_VOLUME_NOT_READY"
      ) ||
      participationState.includes(
        "WAIT_FOR_PARTICIPATION"
      ) ||
      participationState.includes(
        "WEAK_LOW_VOLUME_PARTICIPATION"
      ) ||
      participationState.includes(
        "WEAK_FADING_PARTICIPATION"
      ) ||
      participationState.includes(
        "LOW_VOLUME_HOLD"
      ) ||
      participationState.includes(
        "NO_FAST_IMBALANCE_PARTICIPATION"
      ) ||
      participationState.includes(
        "NO_CURRENT_SCALP_PARTICIPATION"
      ) ||
      participationState.includes(
        "PARTICIPATION_DEVELOPING"
      ) ||
      participationRisk.includes(
        "WAIT_FOR_PARTICIPATION"
      )
    );

  const fastPaperWatchCandidate =
    reactionActive === true &&
    participationActive === true &&
    participationHardBlocked !== true &&
    readinessActive === true &&
    (
      paperParticipationSource ===
        "engine4AuthorizedReactionParticipation" ||
      paperParticipationSource ===
        "engine4FastImbalanceParticipation" ||
      paperParticipationSource ===
        "engine4CurrentScalpParticipation"
    );

  const engine25HardBlocked =
    engine25Context?.ok === true &&
    (
      String(
        engine25Context?.regime || ""
      )
        .toUpperCase()
        .includes("RISK_OFF") ||
      String(
        engine25Context?.permission || ""
      )
        .toUpperCase()
        .includes("NO_TRADE") ||
      String(
        engine25Context?.permission || ""
      )
        .toUpperCase()
        .includes("STAND_DOWN")
    );

  const lifecyclePaperCandidate =
    currentLifecycleState?.paperTradeCandidate === true ||
    engine22WaveStrategy?.paperTradeCandidate === true ||
    engine22WaveStrategy?.waveOpportunity?.paperTradeCandidate === true ||
    paperReadiness?.paperTradeCandidate === true ||
    paperReadiness?.active === true ||
    reactionActive === true ||
    participationActive === true;

  const pickUsableDirection = (...values) => {
    for (const value of values) {
      const normalized =
        String(value || "").toUpperCase();

      if (
        normalized &&
        normalized !== "NONE" &&
        normalized !== "NEUTRAL" &&
        normalized !== "UNKNOWN"
      ) {
        return normalized;
      }
    }

    return "NONE";
  };

  const direction =
    pickUsableDirection(
      paperReaction?.direction,
      paperReaction?.tradeDirectionBias,
      paperParticipation?.intendedDirection,
      paperParticipation?.direction,
      participationDirection,
      paperReadiness?.direction,
      engine15Decision?.direction,
      engine22WaveStrategy?.waveOpportunity?.direction,
      currentLifecycleState?.direction
    );

  const setupType =
    paperReaction?.setupType ||
    engine26ImbalanceWatch?.structuralTemplate ||
    engine26ImbalanceWatch?.structuralPlaybook?.template ||
    engine26ImbalanceWatch?.status ||
    paperReadiness?.setupType ||
    engine15Decision?.strategyType ||
    engine22WaveStrategy?.waveOpportunity?.setupType ||
    currentLifecycleState?.key ||
    "UNKNOWN_PAPER_SCALP_SETUP";

  const grade =
    paperReadiness?.grade ||
    paperParticipation?.grade ||
    paperReaction?.quality ||
    "D";

  const targetPoints =
    Number(paperReadiness?.targetPoints) ||
    Number(
      engine22WaveStrategy?.waveOpportunity?.targetPoints
    ) ||
    10;

  const blockers = [];
  const warnings = [];

  const reasonCodes = [
    "PAPER_ONLY_RESEARCH_LANE",
    "REAL_EXECUTION_REMAINS_BLOCKED",
    "ENGINE6_FINAL_PAPER_PERMISSION",
    usingAuthorizedReaction
      ? "ENGINE6_AUTHORIZED_ENGINE3_INPUT"
      : "ENGINE6_LEGACY_ENGINE3_INPUT",
    explicitAuthorizedParticipation
      ? "ENGINE6_AUTHORIZED_ENGINE4_INPUT"
      : "ENGINE6_LEGACY_ENGINE4_INPUT",
  ];

  if (!lifecyclePaperCandidate) {
    blockers.push(
      "ENGINE22_PAPER_TRADE_CANDIDATE_NOT_ACTIVE"
    );
  }

  if (!readinessAllowed) {
    blockers.push(
      "ENGINE15_PAPER_READINESS_NOT_ALLOWED"
    );
  }

  if (!reactionAllowed) {
    blockers.push(
      "ENGINE3_PAPER_REACTION_NOT_ALLOWED"
    );
  }

  if (
    usingAuthorizedReaction &&
    authorizedReactionState ===
      "REACTION_FAILED"
  ) {
    blockers.push(
      "ENGINE3_AUTHORIZED_REACTION_FAILED"
    );
  }

  if (
    usingAuthorizedReaction &&
    authorizedReactionState ===
      "REACTION_INVALIDATED"
  ) {
    blockers.push(
      "ENGINE3_AUTHORIZED_REACTION_INVALIDATED"
    );
  }

  if (
    !participationAllowed &&
    !fastParticipationWaiting
  ) {
    blockers.push(
      "ENGINE4_PAPER_PARTICIPATION_NOT_ALLOWED"
    );
  }

  if (participationWaitingForEngine3) {
    blockers.push(
      "ENGINE4_WAITING_FOR_ENGINE3_REACTION"
    );
  }

  if (fastParticipationWaiting) {
    warnings.push(
      "ENGINE4_FAST_PARTICIPATION_WAITING"
    );
  }

  if (participationHardBlocked) {
    blockers.push(
      "ENGINE4_PAPER_PARTICIPATION_HARD_BLOCKED"
    );
  }

  if (engine25HardBlocked) {
    blockers.push(
      "ENGINE25_HARD_RISK_BLOCK"
    );
  }

  if (
    !direction ||
    direction === "NONE" ||
    direction === "NEUTRAL"
  ) {
    blockers.push(
      "PAPER_DIRECTION_MISSING"
    );
  }

  if (
    direction === "SHORT" &&
    !paperShortResearchEnabled
  ) {
    blockers.push(
      "PAPER_SHORT_RESEARCH_DISABLED_V1"
    );
  }

  if (
    !Number.isFinite(targetPoints) ||
    targetPoints < 8
  ) {
    blockers.push(
      "PAPER_TARGET_PATH_MISSING_OR_TOO_SMALL"
    );
  }

  if (
    Array.isArray(
      paperReaction?.blockers
    )
  ) {
    blockers.push(
      ...paperReaction.blockers
    );
  }

  if (
    Array.isArray(
      paperParticipation?.blockers
    )
  ) {
    blockers.push(
      ...paperParticipation.blockers
    );
  }

  if (
    Array.isArray(
      paperReadiness?.blockers
    )
  ) {
    blockers.push(
      ...paperReadiness.blockers
    );
  }

  if (
    Array.isArray(
      paperReaction?.reasonCodes
    )
  ) {
    reasonCodes.push(
      ...paperReaction.reasonCodes
    );
  }

  if (
    Array.isArray(
      paperParticipation?.reasonCodes
    )
  ) {
    reasonCodes.push(
      ...paperParticipation.reasonCodes
    );
  }

  if (
    Array.isArray(
      paperReadiness?.reasonCodes
    )
  ) {
    reasonCodes.push(
      ...paperReadiness.reasonCodes
    );
  }

  if (
    paperParticipationSource &&
    paperParticipationSource !== "NONE"
  ) {
    reasonCodes.push(
      `ENGINE6_PAPER_PARTICIPATION_SOURCE_${paperParticipationSource.toUpperCase()}`
    );
  }

  if (fastPaperWatchCandidate) {
    reasonCodes.push(
      "ENGINE6_FAST_PAPER_WATCH_CANDIDATE"
    );
  }

  if (fastParticipationWaiting) {
    reasonCodes.push(
      "ENGINE4_FAST_PARTICIPATION_WAITING"
    );
  }

  if (paperParticipation?.risk) {
    reasonCodes.push(
      String(
        paperParticipation.risk
      ).toUpperCase()
    );
  }

  if (
    paperParticipation
      ?.participationQuality
  ) {
    reasonCodes.push(
      `ENGINE4_${String(
        paperParticipation
          .participationQuality
      ).toUpperCase()}_PARTICIPATION`
    );
  }

  if (
    Number(
      paperParticipation?.relativeVolume
    ) > 0 &&
    Number(
      paperParticipation?.relativeVolume
    ) < 0.75
  ) {
    reasonCodes.push(
      "RELATIVE_VOLUME_TOO_LOW"
    );
  }

  if (
    String(
      paperParticipation?.volumeTrend || ""
    ).toUpperCase() === "FADING"
  ) {
    reasonCodes.push(
      "WAIT_FOR_RECLAIM_VOLUME"
    );
  }

  reasonCodes.push(
    "REQUIRES_ENGINE8_PAPER"
  );

  reasonCodes.push(
    "REQUIRES_ENGINE10_JOURNAL"
  );

  const uniqueBlockers = [
    ...new Set(
      blockers.filter(Boolean)
    ),
  ];

  const uniqueWarnings = [
    ...new Set(
      warnings.filter(Boolean)
    ),
  ];

  const engine26IntradayCandidate =
    engine26ImbalanceWatch?.active === true ||
    engine26ImbalanceWatch
      ?.structuralContext
      ?.active === true ||
    engine26Status.includes("WATCH") ||
    engine26Template.includes("ABC_DOWN") ||
    engine26Template.includes("BOUNCE") ||
    engine26PreferredDirection.includes("WATCH") ||
    engine26PreferredDirection === "LONG" ||
    engine26PreferredDirection === "SHORT" ||
    engine26PreferredDirection ===
      "SHORT_WATCH_ONLY";

  const fastIntradayPaperAllow =
    isFastIntradayPaperLane === true &&
    engine26IntradayCandidate === true &&
    lifecyclePaperCandidate === true &&

    // Authorized Engine 3 must now be confirmed.
    reactionActive === true &&
    reactionAllowed === true &&

    // Authorized Engine 4 must now be confirmed.
    participationActive === true &&
    participationAllowed === true &&
    participationWaitingForEngine3 !== true &&
    participationHardBlocked !== true &&

    engine25HardBlocked !== true &&
    direction !== "NONE" &&
    direction !== "NEUTRAL" &&
    Number.isFinite(targetPoints) &&
    targetPoints >= 8;

  const standardPaperAllow =
    uniqueBlockers.length === 0 &&
    lifecyclePaperCandidate &&
    readinessAllowed &&
    reactionAllowed &&
    participationAllowed &&
    participationHardBlocked !== true &&
    engine25HardBlocked !== true &&
    direction === "LONG";

  const allowed =
    fastIntradayPaperAllow === true ||
    standardPaperAllow === true;

  if (fastIntradayPaperAllow) {
    reasonCodes.push(
      "FAST_INTRADAY_PAPER_ALLOW"
    );

    reasonCodes.push(
      "ENGINE6_INTRADAY_PAPER_LANE"
    );

    reasonCodes.push(
      "ENGINE15_BYPASSED_FOR_FAST_INTRADAY_PAPER"
    );

    reasonCodes.push(
      "ENGINE26_INTRADAY_CANDIDATE_CONFIRMED"
    );

    reasonCodes.push(
      "ENGINE3_AUTHORIZED_REACTION_CONFIRMED"
    );

    reasonCodes.push(
      "ENGINE4_AUTHORIZED_PARTICIPATION_CONFIRMED"
    );

    reasonCodes.push(
      "ENGINE25_NOT_HARD_BLOCKED"
    );

    reasonCodes.push(
      "PAPER_ONLY_NO_REAL_EXECUTION"
    );
  }

  const fastIntradayBypassedBlockers =
    fastIntradayPaperAllow
      ? uniqueBlockers.filter(
          (blocker) =>
            [
              "ENGINE15_PAPER_READINESS_NOT_ALLOWED",
              "PAPER_SHORT_RESEARCH_DISABLED_V1",
            ].includes(blocker)
        )
      : [];

  const finalBlockers =
    fastIntradayPaperAllow
      ? uniqueBlockers.filter(
          (blocker) =>
            !fastIntradayBypassedBlockers.includes(
              blocker
            )
        )
      : uniqueBlockers;

  const finalWarnings = [
    ...uniqueWarnings,

    ...fastIntradayBypassedBlockers.map(
      (blocker) =>
        `BYPASSED_${blocker}`
    ),
  ];

  if (
    fastIntradayBypassedBlockers.length
  ) {
    reasonCodes.push(
      "FAST_INTRADAY_STANDARD_BLOCKERS_BYPASSED"
    );
  }

  const watchFast =
    allowed !== true &&
    fastPaperWatchCandidate === true &&
    lifecyclePaperCandidate === true &&
    reactionActive === true &&
    direction === "LONG" &&
    participationHardBlocked !== true &&
    engine25HardBlocked !== true &&
    !uniqueBlockers.includes(
      "PAPER_DIRECTION_MISSING"
    ) &&
    !uniqueBlockers.includes(
      "PAPER_SHORT_RESEARCH_DISABLED_V1"
    ) &&
    !uniqueBlockers.includes(
      "ENGINE25_HARD_RISK_BLOCK"
    );

  const shortReactionState =
    String(
      paperReaction?.state ||
        paperReaction?.fastReactionState ||
        ""
    ).toUpperCase();

  const shortReactionDirection =
    String(
      paperReaction?.direction || ""
    ).toUpperCase();

  const engine3ShortRejection =
    shortReactionDirection === "SHORT" &&
    (
      shortReactionState.includes(
        "BREAKOUT_FAILING"
      ) ||
      shortReactionState.includes(
        "REJECTING"
      ) ||
      shortReactionState.includes(
        "LOST"
      ) ||
      shortReactionState.includes(
        "FAILED_RECLAIM"
      )
    );

  const shortResearchWatch =
    allowed !== true &&
    engine26ShortWatchOnly === true &&
    engine26DoNotChaseLong === true &&
    engine26ShortResearchOnly === true &&
    engine3ShortRejection === true &&
    participationHardBlocked !== true &&
    engine25HardBlocked !== true &&
    !uniqueBlockers.includes(
      "ENGINE25_HARD_RISK_BLOCK"
    ) &&
    !uniqueBlockers.includes(
      "ENGINE4_PAPER_PARTICIPATION_HARD_BLOCKED"
    );

  const structuralFastWatch =
    allowed !== true &&
    shortResearchWatch !== true &&
    engine26ShortWatchOnly === true &&
    engine26DoNotChaseLong === true &&
    engine26ShortResearchOnly === true &&
    engine25HardBlocked !== true &&
    !uniqueBlockers.includes(
      "ENGINE25_HARD_RISK_BLOCK"
    );

  if (shortResearchWatch) {
    reasonCodes.push(
      "ENGINE6_SHORT_RESEARCH_WATCH"
    );

    reasonCodes.push(
      "ENGINE26_SHORT_WATCH_ONLY"
    );

    reasonCodes.push(
      "ENGINE26_DO_NOT_CHASE_LONG"
    );

    reasonCodes.push(
      "ENGINE26_SHORT_RESEARCH_ONLY"
    );

    reasonCodes.push(
      "ENGINE3_SHORT_REJECTION_OR_FAILED_ACCEPTANCE"
    );

    reasonCodes.push(
      "SHORT_RESEARCH_ONLY_NO_PAPER_ALLOW"
    );

    reasonCodes.push(
      "ENGINE15_SHORT_READINESS_NOT_BUILT"
    );
  }

  if (structuralFastWatch) {
    reasonCodes.push(
      "ENGINE6_STRUCTURAL_FAST_WATCH"
    );

    reasonCodes.push(
      "ENGINE26_SHORT_WATCH_ONLY"
    );

    reasonCodes.push(
      "ENGINE26_DO_NOT_CHASE_LONG"
    );

    reasonCodes.push(
      "ENGINE26_SHORT_RESEARCH_ONLY"
    );

    reasonCodes.push(
      "ENGINE26_C_DOWN_WATCH"
    );

    reasonCodes.push(
      "WATCH_ONLY_NO_PAPER_ALLOW"
    );

    reasonCodes.push(
      "NO_TICKET"
    );

    reasonCodes.push(
      "NO_EXECUTION"
    );
  }

  const decision =
    fastIntradayPaperAllow
      ? "FAST_INTRADAY_PAPER_ALLOW"
      : allowed
      ? "PAPER_ALLOW"
      : shortResearchWatch
      ? "PAPER_SHORT_RESEARCH_WATCH"
      : structuralFastWatch
      ? "STRUCTURAL_FAST_WATCH"
      : watchFast
      ? "PAPER_WATCH_FAST"
      : "PAPER_STAND_DOWN";

  return {
    active: true,
    mode: "PAPER_ONLY",
    decision,
    allowed,

    intradayPaperLane:
      fastIntradayPaperAllow === true,

    engine15Bypassed:
      fastIntradayPaperAllow === true,

    standardPaperAllow:
      standardPaperAllow === true,

    fastIntradayPaperAllow:
      fastIntradayPaperAllow === true,

    realExecutionAllowed: false,
    executable: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    requiresEngine8Paper: true,
    requiresEngine10Journal: true,

    symbol,
    strategyId,

    setupFamily:
      "IMBALANCE_TO_IMBALANCE_SCALP",

    setupType,

    direction:
      shortResearchWatch === true ||
      structuralFastWatch === true
        ? "SHORT"
        : direction,

    targetPoints:
      Number.isFinite(targetPoints)
        ? targetPoints
        : 10,

    exitModel: "THREE_BLOCKS",

    grade,

    source:
      "ENGINE6_PAPER_PERMISSION",

    paperParticipationSource,
    fastPaperWatchCandidate,
    fastParticipationWaiting,

    authorizedEngine3Input:
      usingAuthorizedReaction,

    authorizedEngine3State:
      authorizedReactionState || null,

    authorizedEngine4Input:
      explicitAuthorizedParticipation != null,

    authorizedEngine4Status:
      authorizedParticipationStatus || null,

    engine3PaperReactionActive:
      reactionActive,

    engine3PaperReactionAllowed:
      reactionAllowed,

    engine4PaperParticipationActive:
      participationActive,

    engine4PaperParticipationAllowed:
      participationAllowed,

    engine4PaperParticipationHardBlocked:
      participationHardBlocked,

    engine15PaperReadinessActive:
      readinessActive,

    engine15PaperReadinessAllowed:
      readinessAllowed,

    paperShortResearchEnabled:
      paperShortResearchEnabled ||
      shortResearchWatch === true ||
      structuralFastWatch === true ||
      (
        fastIntradayPaperAllow === true &&
        direction === "SHORT"
      ),

    paperShortAllowed:
      fastIntradayPaperAllow === true &&
      direction === "SHORT",

    paperLongAllowed:
      fastIntradayPaperAllow === true &&
      direction === "LONG",

    structuralWatchOnly:
      structuralFastWatch === true,

    fastWatch:
      structuralFastWatch === true ||
      watchFast === true,

    shortResearchOnly:
      shortResearchWatch === true ||
      structuralFastWatch === true,

    shortResearchWatch:
      shortResearchWatch === true,

    engine26ShortWatchOnly,
    engine26DoNotChaseLong,
    engine26ShortResearchOnly,

    candidateId:
      paperReaction?.candidateId ??
      paperParticipation?.candidateId ??
      null,

    zoneId:
      paperReaction?.zoneId ??
      paperParticipation?.zoneId ??
      null,

    duplicateCheckRequired: true,

    blockers: finalBlockers,

    warnings: [
      ...new Set(
        finalWarnings.filter(Boolean)
      ),
    ],

    reasonCodes: [
      ...new Set(
        reasonCodes.filter(Boolean)
      ),
    ],
  };
}
function buildFinalPermissionFromEngine15({
  symbol,
  strategyId,
  tf,
  preliminaryPermission,
  engine15Decision,
  marketRegime,
  zoneContext,
  engine5Analytics,
  engine25Context,
  engine22WaveStrategy,
  confluence,
  engine26ImbalanceWatch = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
}) {
  const preliminary =
    preliminaryPermission && typeof preliminaryPermission === "object"
      ? preliminaryPermission
      : {
          permission: "UNKNOWN",
          sizeMultiplier: null,
          reasonCodes: [],
        };

const readiness = String(engine15Decision?.readinessLabel || "").toUpperCase();
const action = String(engine15Decision?.action || "").toUpperCase();
const strategyType = String(engine15Decision?.strategyType || "NONE").toUpperCase();
const direction = String(engine15Decision?.direction || "NONE").toUpperCase();

const currentLifecycleState =
  engine22WaveStrategy?.currentLifecycleState ||
  engine15Decision?.engine22CurrentLifecycleState ||
  engine15Decision?.currentLifecycleState ||
  null;

const isPossibleW5UpCompletePullbackWatch =
  currentLifecycleState?.key === "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH" ||
  strategyType === "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH";

const setupEligible =
  isPossibleW5UpCompletePullbackWatch
    ? false
    : (
        engine15Decision?.freshEntryNow === true ||
        ["READY", "CONFIRMED", "TRIGGERED"].includes(readiness) ||
        ["ENTER_OK", "REDUCE_OK"].includes(action)
      );

const engine25ModifierPreview = buildEngine25ModifierPreview(engine25Context);
const engine6PaperPermission = buildEngine6PaperPermission({
  symbol,
  strategyId,
  confluence,
  engine15Decision,
  engine22WaveStrategy,
  engine25Context,
  engine26ImbalanceWatch,
  engine3AuthorizedReaction,
  engine4AuthorizedParticipation,
});
  

  const baseReasonCodes = Array.isArray(preliminary.reasonCodes)
    ? preliminary.reasonCodes
    : [];

  const engine15ReasonCodes = Array.isArray(engine15Decision?.reasonCodes)
    ? engine15Decision.reasonCodes
    : [];

  const blockers = Array.isArray(engine15Decision?.blockers)
    ? engine15Decision.blockers
    : [];

  const needs = Array.isArray(engine15Decision?.needs)
    ? engine15Decision.needs
    : [];

  const final = {
    ...preliminary,
    engine: "engine6.finalFromEngine15.v1",
    symbol,
    tf,

    engine15Authority: true,
    engine5Authority: false,

    strategyType,
    direction,
    readinessLabel: readiness || "UNKNOWN",
    action: action || "UNKNOWN",
    executionBias: engine15Decision?.executionBias || null,

    executable: false,
    watchOnly: false,
    setupEligible,
    engine25ModifierPreview,
    paper: engine6PaperPermission,
    engine22CurrentLifecycleState: currentLifecycleState,

    engine15Decision: {
      strategyType,
      direction,
      action,
      readinessLabel: readiness,
      executionBias: engine15Decision?.executionBias || null,
      qualityGatePassed: engine15Decision?.qualityGatePassed === true,
      momentumGatePassed: engine15Decision?.momentumGatePassed === true,
      permissionGatePassed: engine15Decision?.permissionGatePassed === true,
      freshEntryNow: engine15Decision?.freshEntryNow === true,
      qualityScore: engine15Decision?.qualityScore ?? null,
      qualityGrade: engine15Decision?.qualityGrade ?? null,
      qualityBand: engine15Decision?.qualityBand ?? null,
      summary: engine15Decision?.summary || null,
      blockers,
      needs,
      reasonCodes: engine15ReasonCodes,
    },

    marketRegime: marketRegime || null,
    zoneContext: zoneContext
      ? {
          zoneType: zoneContext.zoneType || null,
          withinZone: zoneContext.withinZone === true,
          nearAllowedZone: zoneContext.nearAllowedZone === true,
          locationState: zoneContext.locationState || null,
        }
      : null,

    engine25Context: engine25Context
      ? {
          ok: engine25Context.ok === true,
          engine: engine25Context.engine ?? null,
          source: engine25Context.source || null,
          canonicalSource: engine25Context.canonicalSource ?? null,
          canonicalContext: engine25Context.canonicalContext === true,

          score: engine25Context.score ?? null,
          regime: engine25Context.regime ?? null,
          label: engine25Context.label ?? null,
          permission: engine25Context.permission ?? null,
          sizeMultiplier: engine25Context.sizeMultiplier ?? null,

          modelDate: engine25Context.modelDate ?? null,
          updatedAt: engine25Context.updatedAt ?? null,
          freshnessStatus: engine25Context.freshnessStatus ?? null,

          hardBlock: engine25Context.hardBlock === true,
          noBlindLongs: engine25Context.noBlindLongs === true,
          noBlindShorts: engine25Context.noBlindShorts !== false,
          requireReclaim: engine25Context.requireReclaim === true,
          requiredSetupQuality: engine25Context.requiredSetupQuality ?? null,

          flags: engine25Context.flags ?? null,
          quality: engine25Context.quality ?? null,
          esPermission: engine25Context.esPermission ?? null,

          warnings: Array.isArray(engine25Context.warnings)
            ? engine25Context.warnings
            : [],
          reasonCodes: Array.isArray(engine25Context.reasonCodes)
            ? engine25Context.reasonCodes
            : [],

          summary: engine25Context.summary || null,
        }
      : null,

    engine5Analytics: engine5Analytics
      ? {
          score: engine5Analytics.score ?? null,
          label: engine5Analytics.label ?? null,
          analyticsOnly: true,
          blockingAuthority: false,
        }
      : null,
  };

  if (isPossibleW5UpCompletePullbackWatch) {
    return {
      ...final,
      permission:
        preliminary.permission === "STAND_DOWN"
          ? "STAND_DOWN"
          : "REDUCE",
      sizeMultiplier:
        preliminary.permission === "STAND_DOWN"
          ? 0
          : Number(preliminary.sizeMultiplier ?? 0.5),
      executable: false,
      watchOnly: true,
      setupEligible: false,
      direction: "NONE",
      reasonCodes: [
        "ENGINE6_POSSIBLE_W5_UP_COMPLETE_WATCH_ONLY",
        currentLifecycleState ? "ENGINE22_CURRENT_LIFECYCLE_STATE_CONSUMED" : null,
        "ENGINE22_POSSIBLE_W5_UP_COMPLETE",
        "ENGINE15_WATCH_ONLY",
        "POSSIBLE_W5_UP_COMPLETE_WAITING_FOR_PULLBACK_REACTION",
        "WAIT_FOR_POST_W5_PULLBACK_REACTION",
        "ENGINE3_REACTION_REQUIRED",
        "ENGINE4_PARTICIPATION_REQUIRED",
        "NO_CHASE",
        "NO_EXECUTION",
        "DIRECTION_NONE",
        ...baseReasonCodes,
      ].filter(Boolean),
      engine22CurrentLifecycleState: currentLifecycleState,
    };
  }

  if (readiness === "BLOCKED" || readiness === "NO_SETUP" || action === "BLOCKED") {
    return {
      ...final,
      permission: "STAND_DOWN",
      sizeMultiplier: 0,
      executable: false,
      watchOnly: false,
      reasonCodes: [
        "ENGINE15_NOT_TRADABLE",
        readiness ? `ENGINE15_${readiness}` : null,
        ...baseReasonCodes,
      ].filter(Boolean),
    };
  }

  if (readiness === "WATCH" || action === "WATCH") {
    return {
      ...final,
      permission: preliminary.permission === "STAND_DOWN" ? "STAND_DOWN" : "REDUCE",
      sizeMultiplier:
        preliminary.permission === "STAND_DOWN"
          ? 0
          : Number(preliminary.sizeMultiplier ?? 0.5),
      executable: false,
      watchOnly: true,
      reasonCodes: [
        "ENGINE15_WATCH_ONLY",
        strategyType ? `${strategyType}_WATCH` : null,
        "WAITING_FOR_CONFIRMATION",
        ...baseReasonCodes,
      ].filter(Boolean),
    };
  }

  const readyLike =
    readiness === "READY" ||
    readiness === "CONFIRMED" ||
    readiness === "TRIGGERED" ||
    action === "ENTER_OK" ||
    action === "REDUCE_OK";

  if (readyLike) {
    return {
      ...final,
      permission: preliminary.permission === "STAND_DOWN" ? "STAND_DOWN" : preliminary.permission || "REDUCE",
      sizeMultiplier:
        preliminary.permission === "STAND_DOWN"
          ? 0
          : Number(preliminary.sizeMultiplier ?? 0.5),
      executable: preliminary.permission !== "STAND_DOWN",
      watchOnly: false,
      reasonCodes: [
        "ENGINE15_READY_CONFIRMED",
        ...baseReasonCodes,
      ].filter(Boolean),
    };
  }

  return {
    ...final,
    permission: "REDUCE",
    sizeMultiplier: Number(preliminary.sizeMultiplier ?? 0.5),
    executable: false,
    watchOnly: true,
    reasonCodes: [
      "ENGINE15_UNCLEAR_DEFAULT_WATCH_ONLY",
      readiness ? `ENGINE15_${readiness}` : null,
      ...baseReasonCodes,
    ].filter(Boolean),
  };
}

function buildEngine5TimingContext({
  confluence,
  engine15Decision,
  engine22WaveStrategy,
  engine23Interpretation,
}) {
  const score = Number(confluence?.scores?.total ?? 0);
  const reactionScore = Number(confluence?.scores?.engine3 ?? 0);
  const volumeScore = Number(confluence?.scores?.engine4 ?? 0);

  const readiness = String(engine15Decision?.readinessLabel || "").toUpperCase();
  const action = String(engine15Decision?.action || "").toUpperCase();

  const chaseAllowed = engine23Interpretation?.chaseAllowed;
  const preferredEntry = String(engine23Interpretation?.preferredEntry || "").toUpperCase();
  const environment = String(engine23Interpretation?.environment || "").toUpperCase();
  const state = String(engine23Interpretation?.state || "").toUpperCase();

  const waveState = String(engine22WaveStrategy?.state || "").toUpperCase();
  const tradeDecisionAction = String(
    engine22WaveStrategy?.tradeDecision?.action ||
    engine22WaveStrategy?.tradeDecision?.decision ||
    ""
  ).toUpperCase();

  const reasonCodes = [];

  const strongIngredients =
    score >= 70 ||
    (reactionScore >= 10 && volumeScore >= 10);

  const extensionContext =
    environment.includes("EXTENSION") ||
    state.includes("EXTENSION") ||
    waveState.includes("EXTENSION");

  const noChaseContext =
    chaseAllowed === false ||
    preferredEntry.includes("NO_CHASE") ||
    preferredEntry.includes("WAIT") ||
    tradeDecisionAction.includes("WAIT");

  let entryTiming = "UNKNOWN";
  let moveAlreadyHappened = false;
  let chaseRisk = "UNKNOWN";
  let suggestedAction = "WAIT_FOR_MORE_DATA";

  if (extensionContext && noChaseContext) {
    entryTiming = "POST_EXTENSION";
    moveAlreadyHappened = true;
    chaseRisk = "HIGH";
    suggestedAction = "WAIT_FOR_PULLBACK_OR_RECLAIM";
    reasonCodes.push("EXTENSION_ALREADY_TAGGED");
    reasonCodes.push("NO_CHASE_CONTEXT");
  } else if (strongIngredients && readiness === "READY" && action === "WATCH") {
    entryTiming = "LATE_CHASE";
    moveAlreadyHappened = true;
    chaseRisk = "MODERATE_HIGH";
    suggestedAction = "WAIT_FOR_CONTROLLED_PULLBACK";
    reasonCodes.push("STRONG_INGREDIENTS_BUT_ACTION_WATCH");
  } else if (strongIngredients && (readiness === "READY" || action === "ENTER_OK")) {
    entryTiming = "TRIGGERING";
    moveAlreadyHappened = false;
    chaseRisk = "MODERATE";
    suggestedAction = "WATCH_FOR_VALID_TRIGGER";
    reasonCodes.push("STRONG_INGREDIENTS_READY_CONTEXT");
  } else if (score >= 50) {
    entryTiming = "CONFIRMED_MOVE";
    moveAlreadyHappened = true;
    chaseRisk = "MODERATE";
    suggestedAction = "WAIT_FOR_CONFIRMATION_OR_PULLBACK";
    reasonCodes.push("MODERATE_CONFLUENCE_CONFIRMED_MOVE");
  } else {
    entryTiming = "PRE_TRIGGER";
    moveAlreadyHappened = false;
    chaseRisk = "LOW_TO_MODERATE";
    suggestedAction = "WAIT_FOR_SETUP_TO_BUILD";
    reasonCodes.push("LOW_CONFLUENCE_PRE_TRIGGER");
  }

  return {
    ok: true,
    engine: "engine5.timingContext.v1",
    entryTiming,
    moveAlreadyHappened,
    chaseRisk,
    suggestedAction,
    score,
    reactionScore,
    volumeScore,
    readiness,
    action,
    extensionContext,
    noChaseContext,
    reasonCodes,
  };
}

function buildZoneContext(engine1ContextJson, confluenceLocation = null) {
  if (!engine1ContextJson || typeof engine1ContextJson !== "object") return null;

  const { zoneType, withinZone } = computeZoneTelemetryFromCtx(engine1ContextJson);

  return {
    meta: engine1ContextJson.meta || null,
    active: engine1ContextJson.active || null,
    nearest: engine1ContextJson.nearest || null,
    zoneType,
    withinZone,
    locationState: confluenceLocation?.state || null,
    nearAllowedZone: confluenceLocation?.nearAllowedZone === true,
    flags: engine1ContextJson.flags || null,
    render: {
      negotiated: Array.isArray(engine1ContextJson?.render?.negotiated)
        ? engine1ContextJson.render.negotiated
        : [],
      institutional: Array.isArray(engine1ContextJson?.render?.institutional)
        ? engine1ContextJson.render.institutional
        : [],
      shelves: Array.isArray(engine1ContextJson?.render?.shelves)
        ? engine1ContextJson.render.shelves
        : [],
    },
  };
}

/* -----------------------------
   Confluence route-equivalent helpers
------------------------------*/
function containsPrice(z, price) {
  if (!z || !Number.isFinite(price)) return false;
  const lo = Number(z.lo);
  const hi = Number(z.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return lo <= price && price <= hi;
}

function pickActiveExecutionZone(engine1Context, price) {
  const activeNegotiated = engine1Context?.active?.negotiated ?? null;
  const activeShelf = engine1Context?.active?.shelf ?? null;
  const activeInstitutional = engine1Context?.active?.institutional ?? null;

  const candidate = activeNegotiated || activeShelf || activeInstitutional || null;

  if (candidate && containsPrice(candidate, price)) return candidate;
  return null;
}

function modeFromStrategyId(strategyId) {
  const s = String(strategyId || "").toLowerCase();
  if (
    s.includes("subminute_scalp") ||
    s.includes("intraday_scalp")
  ) return "scalp";
  if (s.includes("minor_swing")) return "swing";
  if (s.includes("intermediate_long")) return "long";
  return "swing";
}

function volumeStateFromEngine4(engine4, zoneRef) {
  if (!zoneRef) return "NO_ACTIVE_ZONE";
  if (!engine4 || !engine4.flags) return "NO_SIGNAL";

  const f = engine4.flags;

  if (f.liquidityTrap) return "TRAP_SUSPECTED";
  if (engine4.volumeConfirmed && f.initiativeMoveConfirmed) return "INITIATIVE";
  if (f.absorptionDetected) return "ABSORPTION";
  if (f.distributionDetected) return "DISTRIBUTION";
  if (f.volumeDivergence) return "DIVERGENCE";
  if (f.pullbackContraction) return "PULLBACK_CONTRACTION";
  if (f.reversalExpansion) return "REVERSAL_EXPANSION";
  return "NEGOTIATING";
}

function keepAliveNoZone(out) {
  const rcs = Array.isArray(out?.reasonCodes) ? out.reasonCodes : [];
  const noZoneOnly =
    out?.invalid === true &&
    rcs.length === 1 &&
    rcs[0] === "NO_ZONE_NO_TRADE";

  if (noZoneOnly) {
    out.invalid = false;
    out.tradeReady = false;
    out.flags = out.flags || {};
    out.flags.tradeReady = false;
    out.flags.withinZone = false;
    out.reasonCodes = ["NOT_IN_ZONE_WAITING_FOR_SETUP"];

    out.scores = out.scores || {};
    out.scores.engine1 = 0;
    out.scores.engine2 = 0;
    out.scores.engine3 = 0;
    out.scores.engine4 = 0;
    out.scores.compression = 0;
    out.scores.total = 0;
    out.scores.label = "IGNORE";
  }

  return out;
}

/* -----------------------------
   Near allowed-zone display patch
------------------------------*/
const NEAR_ALLOWED_ZONE_WINDOW_PTS = 1.5;

function distToZone(price, z) {
  const p = toNum(price);
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (p == null || lo == null || hi == null) return null;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  if (p >= a && p <= b) return 0;
  return p < a ? a - p : p - b;
}

function nearestAllowedZone({ price, negotiated = [], institutional = [] }) {
  let best = null;

  const scan = (arr, zoneType) => {
    const list = Array.isArray(arr) ? arr : [];
    for (const z of list) {
      const d = distToZone(price, z);
      if (d == null) continue;
      if (!best || d < best.distancePts) {
        best = {
          zoneType,
          id: z?.id ?? null,
          lo: z?.lo ?? null,
          hi: z?.hi ?? null,
          mid: z?.mid ?? null,
          strength: z?.strength ?? null,
          distancePts: d,
        };
      }
    }
  };

  scan(negotiated, "NEGOTIATED");
  scan(institutional, "INSTITUTIONAL");

  return best;
}

function applyNearAllowedZoneDisplay({ confluence, ctx }) {
  if (!confluence || typeof confluence !== "object") return confluence;

  const price =
    toNum(confluence?.price) ??
    toNum(ctx?.meta?.current_price) ??
    toNum(ctx?.meta?.currentPrice);

  if (price == null) return confluence;

  const loc = confluence.location || {};
  const state = String(loc.state || "");

  if (state !== "NOT_IN_ZONE") return confluence;

  const negotiated = ctx?.render?.negotiated || [];
  const institutional = ctx?.render?.institutional || [];

  const nearest = nearestAllowedZone({ price, negotiated, institutional });

  if (!nearest || !Number.isFinite(nearest.distancePts)) return confluence;

  const near =
    nearest.distancePts > 0 &&
    nearest.distancePts <= NEAR_ALLOWED_ZONE_WINDOW_PTS;

  if (!near) {
    return {
      ...confluence,
      location: {
        ...loc,
        nearAllowedZone: false,
        nearestAllowed: {
          zoneType: nearest.zoneType,
          zoneId: nearest.id,
          lo: nearest.lo,
          hi: nearest.hi,
          distancePts: Number(nearest.distancePts.toFixed(2)),
        },
      },
    };
  }

  return {
    ...confluence,
    location: {
      ...loc,
      state: "NEAR_ALLOWED_ZONE",
      zoneType: nearest.zoneType,
      zoneId: nearest.id,
      nearAllowedZone: true,
      nearestAllowed: {
        zoneType: nearest.zoneType,
        zoneId: nearest.zoneId,
        lo: nearest.lo,
        hi: nearest.hi,
        distancePts: Number(nearest.distancePts.toFixed(2)),
      },
    },
  };
}

/* -----------------------------
   Engine 2 helpers
------------------------------*/
function bucketForStrategyId(strategyId) {
  const id = String(strategyId || "");
  if (id.startsWith("subminute_scalp")) return "subminute_scalp";
  if (id.startsWith("intraday_scalp")) return "intraday_scalp";
  if (id.startsWith("minor_swing")) return "minor_swing";
  if (id.startsWith("intermediate_long")) return "intermediate_long";
  return null;
}

async function fetchFibLevels({ symbol, tf, degree, wave }) {
  const u = new URL(`${CORE_BASE}/api/v1/fib-levels`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("degree", degree);
  u.searchParams.set("wave", wave);
  const r = await fetchJson(u.toString(), 15000);
  return r?.json || { ok: false };
}

async function fetchLastBarTimeSec({ symbol, tf }) {
  const path = ohlcPathForSymbol(symbol);
  const u = new URL(`${CORE_BASE}${path}`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", "1");

  const r = await fetchJson(u.toString(), 15000);
  const j = r?.json;

  const bar =
    Array.isArray(j) ? j[0] :
    Array.isArray(j?.bars) ? j.bars[0] :
    Array.isArray(j?.data) ? j.data[0] :
    null;

  const t = Number(bar?.time ?? bar?.t ?? bar?.tSec);
  return Number.isFinite(t) ? t : null;
}

async function fetchCurrentPriceForSymbol({ symbol, tf = "10m" }) {
  const path = ohlcPathForSymbol(symbol);
  const u = new URL(`${CORE_BASE}${path}`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", "1");

  const r = await fetchJson(u.toString(), 15000);
  const j = r?.json;

  const bar =
    Array.isArray(j) ? j[0] :
    Array.isArray(j?.bars) ? j.bars[0] :
    Array.isArray(j?.data) ? j.data[0] :
    null;

  const close = Number(bar?.close ?? bar?.c);
  return Number.isFinite(close) ? close : null;
} 
function calcEma(values = [], period = 10) {
  const nums = values
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  if (nums.length < period) return null;

  const k = 2 / (period + 1);

  // Seed EMA with SMA of first period.
  let ema =
    nums.slice(0, period).reduce((sum, x) => sum + x, 0) / period;

  for (let i = period; i < nums.length; i++) {
    ema = nums[i] * k + ema * (1 - k);
  }

  return Number(ema.toFixed(2));
}

function normalizeOhlcBars(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.bars)) return payload.bars;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function barClose(bar) {
  const close = Number(bar?.close ?? bar?.c);
  return Number.isFinite(close) ? close : null;
}

function barTime(bar) {
  const t = Number(bar?.time ?? bar?.t ?? bar?.tSec);
  return Number.isFinite(t) ? t : null;
}

async function buildEma10Posture({ symbol, tf, label, limit = 120 }) {
  const path = ohlcPathForSymbol(symbol);
  const u = new URL(`${CORE_BASE}${path}`);

  u.searchParams.set("symbol", symbol);
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", String(limit));

  const r = await fetchJson(u.toString(), 15000);
  const bars = normalizeOhlcBars(r?.json);

  const closes = bars
    .map(barClose)
    .filter((x) => Number.isFinite(x));

  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const close = lastBar ? barClose(lastBar) : null;
  const ema10 = calcEma(closes, 10);
  const ema20 = calcEma(closes, 20);

  const distancePts =
    Number.isFinite(close) && Number.isFinite(ema10)
      ? Number((close - ema10).toFixed(2))
      : null;

  const distancePct =
    Number.isFinite(close) && Number.isFinite(ema10) && ema10 !== 0
      ? Number((((close - ema10) / ema10) * 100).toFixed(2))
      : null;

const distanceToEma20 =
  Number.isFinite(close) && Number.isFinite(ema20)
    ? Number((close - ema20).toFixed(2))
    : null;

const distanceToEma20Pct =
  Number.isFinite(close) && Number.isFinite(ema20) && ema20 !== 0
    ? Number((((close - ema20) / ema20) * 100).toFixed(2))
    : null;

const aboveEma20 =
  Number.isFinite(close) && Number.isFinite(ema20)
    ? close > ema20
    : null;
  let state = "UNKNOWN";
  let aboveEma10 = null;

  if (Number.isFinite(close) && Number.isFinite(ema10)) {
    aboveEma10 = close > ema10;
    state = close > ema10 ? "ABOVE_EMA10" : close < ema10 ? "BELOW_EMA10" : "AT_EMA10";
  }

return {
  ok: r?.ok === true && Number.isFinite(close) && Number.isFinite(ema10),
  symbol,
  tf,
  label,
  close: Number.isFinite(close) ? close : null,
  ema10,
  ema20,
  aboveEma10,
  aboveEma20,
  distancePts,
  distancePct,
  distanceToEma20,
  distanceToEma20Pct,
  state,
  lastBarTime: lastBar ? barTime(lastBar) : null,
  barCount: bars.length,
  bars,
  source: path,
  error:
    r?.ok === true
      ? null
      : r?.text || "EMA10_POSTURE_FETCH_FAILED",
};
}

async function buildEmaPostureBlock(symbol) {
  const [tenMinute, oneHour, fourHour, daily] = await Promise.all([
    buildEma10Posture({
      symbol,
      tf: "10m",
      label: "10m EMA10 Trigger Layer",
      limit: 120,
    }).catch((err) => ({
      ok: false,
      symbol,
      tf: "10m",
      label: "10m EMA10 Trigger Layer",
      state: "UNKNOWN",
      error: String(err?.message || err),
    })),

    buildEma10Posture({
      symbol,
      tf: "1h",
      label: "1H EMA10 Trend Layer",
      limit: 120,
    }).catch((err) => ({
      ok: false,
      symbol,
      tf: "1h",
      label: "1H EMA10 Trend Layer",
      state: "UNKNOWN",
      error: String(err?.message || err),
    })),

    buildEma10Posture({
      symbol,
      tf: "4h",
      label: "4H EMA10 Trend Layer",
      limit: 120,
    }).catch((err) => ({
      ok: false,
      symbol,
      tf: "4h",
      label: "4H EMA10 Trend Layer",
      state: "UNKNOWN",
      error: String(err?.message || err),
    })),

    buildEma10Posture({
      symbol,
      tf: "1d",
      label: "Daily EMA10 Permission Layer",
      limit: 120,
    }).catch((err) => ({
      ok: false,
      symbol,
      tf: "1d",
      label: "Daily EMA10 Permission Layer",
      state: "UNKNOWN",
      error: String(err?.message || err),
    })),
  ]);

  return {
    symbol,
    source: isFuturesSymbol(symbol)
      ? "FUTURES_OHLC_EMA10_POSTURE"
      : "STOCK_OHLC_EMA10_POSTURE",
    tenMinute,
    oneHour,
    fourHour,
    daily,
  };
}

function calcFibScore(payloadW1, payloadW4) {
  const p =
    payloadW1 && payloadW1.ok
      ? payloadW1
      : payloadW4 && payloadW4.ok
        ? payloadW4
        : null;

  if (!p) return { fibScore: 0, invalidated: false, anchorTag: null };

  const invalidated = !!p?.signals?.invalidated;
  const anchorTag = p?.signals?.tag ?? null;

  if (invalidated) return { fibScore: 0, invalidated: true, anchorTag };

  let score = 0;
  if (p?.signals?.inRetraceZone) score += 10;
  if (p?.signals?.near50) score += 10;

  return { fibScore: score, invalidated: false, anchorTag };
}

function isRealMark(m) {
  if (!m || typeof m !== "object") return false;

  const p = Number(m.p);
  const tSec = m.tSec;

  if (!Number.isFinite(p) || p <= 0) return false;
  if (typeof tSec !== "number" || !Number.isFinite(tSec) || tSec <= 0) return false;

  return true;
}

function computeWavePhaseFromMarks(waveMarks, lastBarTimeSec, currentPrice) {
  const order = ["W1", "W2", "W3", "W4", "W5", "A", "B", "C"];
  const marksPresent = [];

  for (const k of order) {
    if (isRealMark(waveMarks?.[k])) marksPresent.push(k);
  }

  if (
    !marksPresent.length ||
    typeof lastBarTimeSec !== "number" ||
    !Number.isFinite(lastBarTimeSec)
  ) {
    return {
      phase: "UNKNOWN",
      confirmedPhase: "UNKNOWN",
      phaseReason: "NO_VALID_MARKS_OR_TIME",
      lastMark: null,
      nextMark: null,
      marksPresent,
    };
  }

  let lastKey = null;
  for (const k of order) {
    const m = waveMarks?.[k];
    if (!isRealMark(m)) continue;
    if (m.tSec <= lastBarTimeSec) lastKey = k;
  }

  if (!lastKey) {
    const nk = marksPresent[0] || null;
    return {
      phase: "PRE_W1",
      confirmedPhase: "PRE_W1",
      phaseReason: "NO_MARK_REACHED_BY_TIME",
      lastMark: null,
      nextMark: nk ? { key: nk, ...waveMarks[nk] } : null,
      marksPresent,
    };
  }

  const lastIdx = order.indexOf(lastKey);
  let nextKey = null;
  for (let i = lastIdx + 1; i < order.length; i++) {
    const k = order[i];
    if (marksPresent.includes(k)) {
      nextKey = k;
      break;
    }
  }

  let phase;

  if (lastKey === "W5") {
    phase = "COMPLETE_W5";

  } else if (lastKey === "W4") {
    const w4Price = Number(waveMarks?.W4?.p);
    const hasCurrentPrice =
      typeof currentPrice === "number" && Number.isFinite(currentPrice);

    if (hasCurrentPrice && Number.isFinite(w4Price) && currentPrice > w4Price) {
      phase = "IN_W5";
    } else {
      phase = "IN_W5";
    }

  } else if (lastKey === "W3") {
    phase = "IN_W4";

  } else if (lastKey === "W2") {
    phase = "IN_W3";

  } else if (lastKey === "W1") {
    phase = "IN_W2";

  } else if (lastKey === "C") {
    phase = "COMPLETE_C";

  } else if (lastKey === "B") {
    const bPrice = Number(waveMarks?.B?.p);
    const hasCurrentPrice =
      typeof currentPrice === "number" && Number.isFinite(currentPrice);

    if (hasCurrentPrice && Number.isFinite(bPrice) && currentPrice > bPrice) {
      phase = "IN_C";
    } else {
      phase = "IN_C";
    }

  } else if (lastKey === "A") {
    phase = "IN_B";

  } else {
    phase = `IN_${lastKey}`;
  }

  let confirmedPhase;

  if (lastKey === "W5") {
    confirmedPhase = "COMPLETE_W5";
  } else if (lastKey === "C") {
    confirmedPhase = "IN_C";
  } else {
    confirmedPhase = `IN_${lastKey}`;
  }

  let phaseReason = "TIME_CONFIRMED_MARK";

  if (lastKey === "W1") {
    phaseReason = "W1_CONFIRMED_WAITING_FOR_W2";

  } else if (lastKey === "W2") {
    phaseReason = "W2_CONFIRMED_WAITING_FOR_W3";

  } else if (lastKey === "W3") {
    phaseReason = "W3_CONFIRMED_WAITING_FOR_W4";

  } else if (lastKey === "W4") {
    const w4Price = Number(waveMarks?.W4?.p);
    const hasCurrentPrice =
      typeof currentPrice === "number" && Number.isFinite(currentPrice);

    if (hasCurrentPrice && Number.isFinite(w4Price) && currentPrice > w4Price) {
      phaseReason = "PRICE_ABOVE_W4";
    } else {
      phaseReason = "W4_CONFIRMED_WAITING_FOR_W5";
    }

  } else if (lastKey === "A") {
    phaseReason = "A_CONFIRMED_WAITING_FOR_B";

  } else if (lastKey === "B") {
    const bPrice = Number(waveMarks?.B?.p);
    const hasCurrentPrice =
      typeof currentPrice === "number" && Number.isFinite(currentPrice);

    if (hasCurrentPrice && Number.isFinite(bPrice) && currentPrice > bPrice) {
      phaseReason = "PRICE_ABOVE_B";
    } else {
      phaseReason = "B_CONFIRMED_WAITING_FOR_C";
    }

  } else if (lastKey === "C") {
    phaseReason = "C_CONFIRMED_COMPLETE";
  }

  return {
    phase,
    confirmedPhase,
    phaseReason,
    lastMark: { key: lastKey, ...waveMarks[lastKey] },
    nextMark: nextKey ? { key: nextKey, ...waveMarks[nextKey] } : null,
    marksPresent,
  };
}

function detectCInternalStructure(waveMarks, phase, currentPrice) {
  if (phase !== "IN_C") return null;

  const markA = waveMarks?.A;
  const markB = waveMarks?.B;

  if (!isRealMark(markA) || !isRealMark(markB)) return null;

  const aPrice = Number(markA.p);
  const bPrice = Number(markB.p);
  const p = Number(currentPrice);

  if (!Number.isFinite(aPrice) || !Number.isFinite(bPrice)) return null;
  if (!Number.isFinite(p)) return "FORMING";

  if (p > aPrice) return "FORMING";

  return "FORMING";
}

// 👇 ADD HERE (LINE ~831)
function detectCExtensionZone(fib, currentPrice) {
  if (!fib || typeof fib !== "object") return "NONE";

  const r50 = Number(fib?.r500);
  const r618 = Number(fib?.r618);
  const p = Number(currentPrice);

  if (!Number.isFinite(p)) return "NONE";

  if (Number.isFinite(r618) && p > r618) return "ABOVE_618";
  if (Number.isFinite(r50) && p > r50) return "ABOVE_50";

  return "NONE";
}

async function buildEngine2Block({ symbol, degree, tf, currentPrice = null }) {
  const [w1, w4, lastBarTimeSec] = await Promise.all([
    fetchFibLevels({ symbol, tf, degree, wave: "W1" }).catch(() => ({ ok: false })),
    fetchFibLevels({ symbol, tf, degree, wave: "W4" }).catch(() => ({ ok: false })),
    fetchLastBarTimeSec({ symbol, tf }).catch(() => null),
  ]);

  const ok = !!(w1?.ok || w4?.ok);

  const { fibScore, invalidated, anchorTag } = calcFibScore(w1, w4);

  const waveMarks =
    (w1?.ok ? w1?.anchors?.waveMarks : null) ||
    (w4?.ok ? w4?.anchors?.waveMarks : null) ||
    null;

  const { phase, confirmedPhase, phaseReason, lastMark, nextMark, marksPresent } = computeWavePhaseFromMarks(
   waveMarks,
   lastBarTimeSec,
   currentPrice
 );
  const fibSource = w1?.ok ? w1?.fib : w4?.ok ? w4?.fib : null;

  const cExtensionZone =
    phase === "IN_C"
      ? detectCExtensionZone(fibSource, currentPrice)
      : "NONE";
  
   const cInternalStructure = detectCInternalStructure(
    waveMarks,
    phase,
    currentPrice
  );
 
  const cShortWatch =
    cInternalStructure === "FORMING" &&
    cExtensionZone === "ABOVE_618"; 

  const wave3Retrace = computeWave3RetraceMap({
    waveMarks,
    currentPrice,
    phase,
  });
  
  const waveMode =
   ["IN_A", "IN_B", "IN_C"].includes(phase) ? "CORRECTIVE" : "IMPULSE";
   
  const isCorrective = waveMode === "CORRECTIVE";
  const isImpulse = waveMode === "IMPULSE";
  const isFinalCorrectionLeg = phase === "IN_C";

  let correctionDirection = null;
  if (waveMode === "CORRECTIVE") {
    correctionDirection = "UP";
  }

  // Engine 2D:
  // Save the W1 anchor payload so W2 -> W3 forward extensions
  // can use W1 low/high projected from W2.
  const w1Payload =
    w1?.ok
      ? {
          ok: true,
          anchors: {
            low: toNum(w1?.anchors?.low),
            high: toNum(w1?.anchors?.high),
            a: toNum(w1?.anchors?.a),
            b: toNum(w1?.anchors?.b),
          },
        }
      : null;

  return {
    degree,
    tf,
    ok,
    waveRequested: w4?.ok ? "W4" : w1?.ok ? "W1" : null,
    fibScore,
    invalidated,
    phase,
    confirmedPhase,
    phaseReason,

    // Engine 2D diagnostic:
    // Shows the latest candle time used by computeWavePhaseFromMarks().
    lastBarTimeSec,

    cExtensionZone,
    lastMark,
    nextMark,
    marksPresent,
    anchorTag: anchorTag ?? null,
    waveMode,
    isCorrective,
    isImpulse,
    isFinalCorrectionLeg,
    correctionDirection,
    cInternalStructure,
    cShortWatch,

    // Existing pullback/retracement map.
    wave3Retrace,

    // Engine 2D:
    // Expose full Elliott marks so forward extension maps can be built
    // after manual LEVEL rows are attached.
    waveMarks,

    // Engine 2D:
    // Expose W1 anchor payload for W2 -> W3 forward extensions.
    w1Payload,
  };
}
    
function getWaveMarkPrice(waveMarks, key) {
  const p = Number(waveMarks?.[key]?.p);
  return Number.isFinite(p) && p > 0 ? p : null;
}

function computeWave3RetraceMap({ waveMarks, currentPrice, phase }) {
  const wave3Start = getWaveMarkPrice(waveMarks, "W2");
  const wave3End = getWaveMarkPrice(waveMarks, "W3");
  const price = Number(currentPrice);

  if (!wave3Start || !wave3End || !Number.isFinite(price)) {
    return {
      active: false,
      source: "MINUTE_W2_TO_W3",
      reason: "MISSING_W2_W3_OR_PRICE",
      wave3Start,
      wave3End,
      currentPrice: Number.isFinite(price) ? Number(price.toFixed(2)) : null,
      levels: null,
      zone: null,
      timeline: {
        label: "Wave 3 retracement map unavailable",
        message: "Missing W2, W3, or current price.",
      },
    };
  }

  const range = wave3End - wave3Start;

  if (!Number.isFinite(range) || range <= 0) {
    return {
      active: false,
      source: "MINUTE_W2_TO_W3",
      reason: "INVALID_WAVE3_RANGE",
      wave3Start,
      wave3End,
      currentPrice: Number(price.toFixed(2)),
      levels: null,
      zone: null,
      timeline: {
        label: "Wave 3 retracement map invalid",
        message: "Wave 3 start/end range is invalid.",
      },
    };
  }

  const levels = {
    r236: wave3End - range * 0.236,
    r382: wave3End - range * 0.382,
    r500: wave3End - range * 0.5,
    r618: wave3End - range * 0.618,
    r786: wave3End - range * 0.786,
  };

  const roundLevels = Object.fromEntries(
    Object.entries(levels).map(([k, v]) => [k, Number(v.toFixed(2))])
  );

  const zone50To618 = {
    lo: Math.min(levels.r500, levels.r618),
    hi: Math.max(levels.r500, levels.r618),
  };

  const inZone50To618 =
    price >= zone50To618.lo &&
    price <= zone50To618.hi;

  const aboveZone =
    price > zone50To618.hi;

  const belowZone =
    price < zone50To618.lo;

  let zoneState = "NOT_IN_ZONE";
  let message = "Price is not yet inside the 0.5–0.618 Wave 3 retracement zone. Wait for price action.";

  if (inZone50To618) {
    zoneState = "IN_50_618_ZONE";
    message = "Price is inside the 0.5–0.618 Wave 3 retracement zone. Watch for Wave A low / B bounce. No trade yet.";
  } else if (aboveZone) {
    zoneState = "ABOVE_50_618_ZONE";
    message = "Price is above the 0.5–0.618 Wave 3 retracement zone. Wave A may still be shallow or still forming.";
  } else if (belowZone) {
    zoneState = "BELOW_50_618_ZONE";
    message = "Price has moved below the 0.5–0.618 Wave 3 retracement zone. Watch deeper W4 support such as 0.786.";
  }

  const active =
    phase === "IN_W4" ||
    phase === "IN_W2";

  return {
    active,
    source: "MINUTE_W2_TO_W3",
    reason: active ? "CORRECTION_PHASE_ACTIVE" : "NOT_IN_W2_W4",
    wave3Start: Number(wave3Start.toFixed(2)),
    wave3End: Number(wave3End.toFixed(2)),
    currentPrice: Number(price.toFixed(2)),
    range: Number(range.toFixed(2)),
    levels: roundLevels,
    zone: {
      name: "WAVE_A_WATCH_ZONE_50_618",
      state: zoneState,
      lo: Number(zone50To618.lo.toFixed(2)),
      hi: Number(zone50To618.hi.toFixed(2)),
      inZone: inZone50To618,
      aboveZone,
      belowZone,
    },
    timeline: {
      label:
        phase === "IN_W4"
          ? "Minute W4 active — watching Wave A pullback zone"
          : phase === "IN_W2"
          ? "Minute W2 active — watching correction pullback zone"
          : "Wave 3 retracement map",
      message,
      nextFocus:
        phase === "IN_W4"
          ? "Wait for A low, B bounce, then W5 trigger structure."
          : phase === "IN_W2"
          ? "Wait for A low, B bounce, then W3 trigger structure."
          : "No correction action needed.",
    },
  };
}

/* -----------------------------
   Engine 2D forward wave extensions
------------------------------*/
function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Number(x.toFixed(2)) : null;
}

function tickSizeForSymbol(sym) {
  const s = String(sym || "").toUpperCase();

  if (["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"].includes(s)) {
    return 0.25;
  }

  return null;
}

function roundToTick(price, tick = 0.25) {
  const n = Number(price);
  if (!Number.isFinite(n)) return null;

  return Number((Math.round(n / tick) * tick).toFixed(2));
}

function roundPriceForSymbol(price, sym) {
  const tick = tickSizeForSymbol(sym);

  if (tick) {
    return roundToTick(price, tick);
  }

  return round2(price);
}

function toPriceOrNull(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function getExtensionZoneBuffer(degree) {
  const d = String(degree || "").toLowerCase();

  if (d === "minute") return 0.5;
  if (d === "minor") return 1.0;
  if (d === "intermediate") return 2.0;
  if (d === "primary") return 3.0;

  return 1.0;
}

function inferExtensionDirection({ start, end, direction = null }) {
  const explicit = String(direction || "").toUpperCase();

  if (explicit === "BEARISH") return "BEARISH";
  if (explicit === "BULLISH") return "BULLISH";

  const s = Number(start);
  const e = Number(end);

  if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
    return "BEARISH";
  }

  return "BULLISH";
}

function inactiveWaveExtension({
  degree,
  tf,
  wave,
  phase,
  confirmedPhase,
  source,
  reason,
}) {
  return {
    active: false,
    source: source || "UNKNOWN",
    degree: degree || null,
    tf: tf || null,
    wave: wave || null,
    phase: phase || "UNKNOWN",
    confirmedPhase: confirmedPhase || "UNKNOWN",
    anchors: {
      start: null,
      end: null,
      projectionBase: null,
      startKey: null,
      endKey: null,
      projectionBaseKey: null,
    },
    levels: {
      e100: null,
      e1168: null,
      e1272: null,
      e1618: null,
      e200: null,
      e2618: null,
    },
    targetZone: {
      name: `${wave || "WAVE"}_EXTENSION_1618_ZONE`,
      level: 1.618,
      price: null,
      lo: null,
      hi: null,
    },
    targetZones: {
      e1618: {
        name: `${wave || "WAVE"}_EXTENSION_1618_ZONE`,
        level: 1.618,
        price: null,
        lo: null,
        hi: null,
      },
      e200: {
        name: `${wave || "WAVE"}_EXTENSION_200_ZONE`,
        level: 2.0,
        price: null,
        lo: null,
        hi: null,
      },
      e2618: {
        name: `${wave || "WAVE"}_EXTENSION_2618_ZONE`,
        level: 2.618,
        price: null,
        lo: null,
        hi: null,
      },
    },
    reason: reason || "INACTIVE",
  };
}

function buildExtensionMap({
  symbol, 
  degree,
  tf,
  wave,
  source,
  phase,
  confirmedPhase,
  start,
  end,
  projectionBase,
  startKey,
  endKey,
  projectionBaseKey,
  direction = null,
  reason = "ACTIVE_EXTENSION",
}) {
  const s = Number(start);
  const e = Number(end);
  const base = Number(projectionBase);

  if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(base)) {
    return inactiveWaveExtension({
      degree,
      tf,
      wave,
      phase,
      confirmedPhase,
      source,
      reason: "MISSING_EXTENSION_ANCHORS",
    });
  }

  const range = Math.abs(e - s);

  if (!Number.isFinite(range) || range <= 0) {
    return inactiveWaveExtension({
      degree,
      tf,
      wave,
      phase,
      confirmedPhase,
      source,
      reason: "INVALID_EXTENSION_RANGE",
    });
  }

  const dir = inferExtensionDirection({ start: s, end: e, direction });
  const sign = dir === "BEARISH" ? -1 : 1;

  const calc = (fib) => roundPriceForSymbol(base + sign * range * fib, symbol);
   
  const levels = {
    e100: calc(1.0),
    e1168: calc(1.168),
    e1272: calc(1.272),
    e1618: calc(1.618),
    e200: calc(2.0),
    e2618: calc(2.618),
  };

  const zoneBuffer = getExtensionZoneBuffer(degree);
  const e1618 = levels.e1618;
  const e200 = levels.e200;
  const e2618 = levels.e2618;

  const makeTargetZone = ({ key, level, price }) => {
    const p = Number(price);

    if (!Number.isFinite(p)) {
      return {
        name: `${wave}_EXTENSION_${key}_ZONE`,
        level,
        price: null,
        lo: null,
        hi: null,
      };
    }

    return {
      name: `${wave}_EXTENSION_${key}_ZONE`,
      level,
      price: roundPriceForSymbol(p, symbol),
      lo: roundPriceForSymbol(p - zoneBuffer, symbol),
      hi: roundPriceForSymbol(p + zoneBuffer, symbol),
    };
  };

  const targetZones = {
    e1618: makeTargetZone({
      key: "1618",
      level: 1.618,
      price: e1618,
    }),
    e200: makeTargetZone({
      key: "200",
      level: 2.0,
      price: e200,
    }),
    e2618: makeTargetZone({
      key: "2618",
      level: 2.618,
      price: e2618,
    }),
  };

  return {
    active: true,
    source,
    degree,
    tf,
    wave,
    phase,
    confirmedPhase,
    direction: dir,
    anchors: {
      start: round2(s),
      end: round2(e),
      projectionBase: round2(base),
      startKey: startKey || null,
      endKey: endKey || null,
      projectionBaseKey: projectionBaseKey || null,
    },
    levels,
    // Default targetZone remains 1.618 for backward compatibility.
    targetZone: targetZones.e1618,

    // Engine 2D:
    // Full forward runner target zones for Engine 22.
    targetZones,

    reason,
  };
}

function computeW2ToW3Extension({ symbol, degree, tf, phase, confirmedPhase, waveMarks, w1Payload }) {
  const w1Low =
    toPriceOrNull(w1Payload?.anchors?.low) ??
    toPriceOrNull(w1Payload?.anchors?.a);

  const w1High =
    toPriceOrNull(w1Payload?.anchors?.high) ??
    toPriceOrNull(w1Payload?.anchors?.b);

  const w2 = getWaveMarkPrice(waveMarks, "W2");

  if (w1Low == null || w1High == null || w2 == null) {
    return inactiveWaveExtension({
      degree,
      tf,
      wave: "W3",
      phase,
      confirmedPhase,
      source: "W2_TO_W3",
      reason: "MISSING_W1_OR_W2",
    });
  }

  return buildExtensionMap({
    symbol,
    degree,
    tf,
    wave: "W3",
    source: "W2_TO_W3",
    phase,
    confirmedPhase,
    start: w1Low,
    end: w1High,
    projectionBase: w2,
    startKey: "W1_LOW",
    endKey: "W1_HIGH",
    projectionBaseKey: "W2",
    reason:
      phase === "IN_W3"
        ? "ACTIVE_W3_EXTENSION"
        : "W3_EXTENSION_AVAILABLE",
  });
}

function computeW4ToW5Extension({ symbol, degree, tf, phase, confirmedPhase, waveMarks, block }) {
  const w2 = getWaveMarkPrice(waveMarks, "W2");
  const w3 = getWaveMarkPrice(waveMarks, "W3");

  const cLow = toPriceOrNull(block?.cLow);
  const w4Low = toPriceOrNull(block?.w4Low);
  const markedW4 = getWaveMarkPrice(waveMarks, "W4");

  const projectionBase =
   markedW4 ??
   cLow ??
   w4Low;

 const projectionBaseKey =
   markedW4 != null
     ? "MARK_W4"
     : cLow != null
     ? "C_LOW_LEVEL"
     : w4Low != null
     ? "W4_LOW_FIELD"
     : null;

  if (w2 == null || w3 == null) {
    return inactiveWaveExtension({
      degree,
      tf,
      wave: "W5",
      phase,
      confirmedPhase,
      source: "W4_TO_W5",
      reason: "MISSING_W2_OR_W3",
    });
  }

  if (projectionBase == null) {
    return inactiveWaveExtension({
      degree,
      tf,
      wave: "W5",
      phase,
      confirmedPhase,
      source: "W4_TO_W5",
      reason: "MISSING_W4_LOW",
    });
  }

  let reason = "W5_EXTENSION_AVAILABLE";

  if (phase === "IN_W5") {
    reason = "ACTIVE_W5_EXTENSION";
  } else if (phase === "IN_W4" && cLow != null) {
    reason = "PROJECTING_W5_FROM_C_LOW";
  } else if (phase === "IN_W4" && w4Low != null) {
    reason = "PROJECTING_W5_FROM_W4_LOW";
  } else if (phase === "IN_W4" && markedW4 != null) {
    reason = "PROJECTING_W5_FROM_MARKED_W4";
  }

  return buildExtensionMap({
    symbol, 
    degree,
    tf,
    wave: "W5",
    source: "W4_TO_W5",
    phase,
    confirmedPhase,
    start: w2,
    end: w3,
    projectionBase,
    startKey: "W2",
    endKey: "W3",
    projectionBaseKey,
    reason,
  });
}

function computeWaveExtensionsForBlock(block) {
  const symbol = block?.symbol ?? null;
  const degree = block?.degree ?? null;
  const tf = block?.tf ?? null;
  const phase = block?.phase ?? "UNKNOWN";
  const confirmedPhase = block?.confirmedPhase ?? "UNKNOWN";
  const waveMarks = block?.waveMarks ?? null;
  const w1Payload = block?.w1Payload ?? null;

  const w3 = computeW2ToW3Extension({
    symbol,
    degree,
    tf,
    phase,
    confirmedPhase,
    waveMarks,
    w1Payload,
  });

  const w5 = computeW4ToW5Extension({
    symbol,
    degree,
    tf,
    phase,
    confirmedPhase,
    waveMarks,
    block,
  });

  let active = inactiveWaveExtension({
    degree,
    tf,
    wave: null,
    phase,
    confirmedPhase,
    source: "NO_ACTIVE_EXTENSION",
    reason: "NO_ACTIVE_EXTENSION_FOR_PHASE",
  });

  if (phase === "IN_W3" && w3?.active) {
    active = w3;
  } else if (phase === "IN_W5" && w5?.active) {
    active = w5;
  } else if (phase === "IN_W4" && toPriceOrNull(block?.cLow) != null && w5?.active) {
    active = {
      ...w5,
      active: true,
      reason: "PROJECTING_W5_FROM_C_LOW",
    };
  }

  return {
    w3,
    w5,
    active,
  };
}

function enrichEngine2BlockWithExtensions(block) {
  if (!block || typeof block !== "object") {
    const fallback = inactiveWaveExtension({
      degree: null,
      tf: null,
      wave: null,
      phase: "UNKNOWN",
      confirmedPhase: "UNKNOWN",
      source: "ENGINE2_BLOCK_MISSING",
      reason: "ENGINE2_BLOCK_MISSING",
    });

    return {
      ok: false,
      phase: "UNKNOWN",
      confirmedPhase: "UNKNOWN",
      waveExtensions: {
        w3: fallback,
        w5: fallback,
        active: fallback,
      },
      waveExtension: fallback,
    };
  }

  const waveExtensions = computeWaveExtensionsForBlock(block);

  return {
    ...block,
    waveExtensions,
    waveExtension: waveExtensions.active,
  };
}

function pickActiveExtension(primaryChoice, fallbackChoice) {
  if (primaryChoice?.active) return primaryChoice;

  if (fallbackChoice) return fallbackChoice;

  if (primaryChoice) return primaryChoice;

  return inactiveWaveExtension({
    degree: null,
    tf: null,
    wave: null,
    phase: "UNKNOWN",
    confirmedPhase: "UNKNOWN",
    source: "NO_EXTENSION_AVAILABLE",
    reason: "NO_EXTENSION_AVAILABLE",
  });
}

/* -----------------------------
   Reaction / Volume
------------------------------*/
function normalizeEsReaction(esJson) {
  const reaction = esJson?.reaction || {};

  const rawScore = Number(
    reaction?.qualityScore ??
    esJson?.qualityScore ??
    esJson?.reactionScore ??
    0
  );

  const state =
    reaction?.state ||
    reaction?.position ||
    esJson?.state ||
    "UNKNOWN";

  const quality =
    reaction?.quality ||
    esJson?.quality ||
    null;

  const bias =
    reaction?.bias ||
    esJson?.bias ||
    null;

  const stateText = String(state || "").toUpperCase();
  const biasText = String(bias || "").toUpperCase();

  let direction = "NEUTRAL";

  if (
    biasText.includes("BULL") ||
    stateText.includes("BREAKING_ABOVE") ||
    stateText.includes("DEFENDING_LOWER") ||
    stateText.includes("HELD_ACCUMULATION")
  ) {
    direction = "LONG";
  } else if (
    biasText.includes("BEAR") ||
    stateText.includes("BREAKING_BELOW") ||
    stateText.includes("REJECTING_UPPER")
  ) {
    direction = "SHORT";
  }

  const evidence = Array.isArray(esJson?.evidence) ? esJson.evidence : [];
  const reasonCodes = [
    "ES_REACTION_SCORE",
    esJson?.zoneType ? `ZONE_TYPE_${String(esJson.zoneType).toUpperCase()}` : null,
    stateText || null,
    quality ? `QUALITY_${String(quality).toUpperCase()}` : null,
    ...evidence,
  ].filter(Boolean);

  return {
    ok: esJson?.ok !== false,
    stage: reaction?.stage || "IDLE",
    armed: false,

    // ES score-first contract
    reactionScore: Number.isFinite(rawScore) ? rawScore : 0,
    confirmed: Number.isFinite(rawScore) ? rawScore >= 75 : false,

    state,
    structureState: state,
    direction,
    quality,

    reasonCodes,
    waveReaction: null,

    // Preserve full ES route for debug / future Engine 5 components
    esReaction: esJson,
  };
}

async function fetchReaction({ symbol, tf, strategyId, zoneId, zoneLo, zoneHi }) {
  if (isFuturesSymbol(symbol)) {
    const u = new URL(`${CORE_BASE}/api/v1/es-reaction-score`);
    u.searchParams.set("symbol", symbol);
    u.searchParams.set("tf", tf);

    const r = await fetchJson(u.toString(), 30000);

    if (r.ok && r.json) return normalizeEsReaction(r.json);

    return {
      ok: true,
      invalid: false,
      reactionScore: 0,
      structureState: "HOLD",
      reasonCodes: ["ES_ENGINE3_UNAVAILABLE"],
      zone: { id: zoneId, lo: zoneLo, hi: zoneHi },
      armed: false,
      stage: "IDLE",
      mode: modeFromStrategyId(strategyId),
      diagnostics: { error: r?.text || "ES_ENGINE3_FETCH_FAILED" },
    };
  }
   
  const u = new URL(`${CORE_BASE}/api/v1/reaction-score`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("strategyId", strategyId);

  if (zoneId) u.searchParams.set("zoneId", zoneId);
  if (zoneLo != null) u.searchParams.set("lo", String(zoneLo));
  if (zoneHi != null) u.searchParams.set("hi", String(zoneHi));

  const r = await fetchJson(u.toString(), 30000);

  if (r.ok && r.json) return r.json;

  return {
    ok: true,
    invalid: false,
    reactionScore: 0,
    structureState: "HOLD",
    reasonCodes: ["ENGINE3_UNAVAILABLE"],
    zone: { id: zoneId, lo: zoneLo, hi: zoneHi },
    armed: false,
    stage: "IDLE",
    mode: modeFromStrategyId(strategyId),
    diagnostics: { error: r?.text || "ENGINE3_FETCH_FAILED" },
  };
}

function normalizeEsVolume(esJson) {
  const v = esJson?.engine4EsVolume || esJson?.raw || esJson || {};

  return {
    ok: esJson?.ok !== false,
    volumeScore: Number(v?.volumeScore ?? 0),
    volumeConfirmed: v?.volumeConfirmed === true,
    flags: {
      volumeExpansion: v?.volumeExpansion === true,
      absorptionRisk: v?.absorptionRisk === true,
      climacticVolume: v?.climacticVolume === true,
      highVolumeCandles: Number(v?.highVolumeCandles ?? 0),
      relativeVolume: Number(v?.relativeVolume ?? 0),
      volumeTrend: v?.volumeTrend || null,
      participationState: v?.participationState || null,
      participationQuality: v?.participationQuality || null,
    },
    state:
      v?.participationState ||
      v?.participationQuality ||
      "NO_SIGNAL",
    reasonCodes: Array.isArray(v?.reasonCodes) ? v.reasonCodes : [],
    esVolume: esJson,
  };
}

async function fetchVolume({ symbol, tf, zoneLo, zoneHi, mode }) {
  if (isFuturesSymbol(symbol)) {
    const u = new URL(`${CORE_BASE}/api/v1/es-volume-behavior`);
    u.searchParams.set("symbol", symbol);
    u.searchParams.set("tf", tf);

    const r = await fetchJson(u.toString(), 30000);

    if (r.ok && r.json) return normalizeEsVolume(r.json);

    return {
      ok: true,
      volumeScore: 0,
      volumeConfirmed: false,
      reasonCodes: ["ES_ENGINE4_UNAVAILABLE"],
      flags: {},
      diagnostics: { error: r?.text || "ES_ENGINE4_FETCH_FAILED" },
    };
  }

  if (zoneLo == null || zoneHi == null) {
    return {
      ok: true,
      volumeScore: 0,
      volumeConfirmed: false,
      reasonCodes: ["NO_ACTIVE_ZONE"],
      flags: {},
      diagnostics: { note: "NO_ACTIVE_ZONE" },
    };
  }

  const stockUrl = new URL(`${CORE_BASE}/api/v1/volume-behavior`);
  stockUrl.searchParams.set("symbol", symbol);
  stockUrl.searchParams.set("tf", tf);
  stockUrl.searchParams.set("zoneLo", String(zoneLo));
  stockUrl.searchParams.set("zoneHi", String(zoneHi));
  if (mode) stockUrl.searchParams.set("mode", mode);

  const r = await fetchJson(stockUrl.toString(), 30000);

  if (r.ok && r.json) return r.json?.raw || r.json;

  return {
    ok: true,
    volumeScore: 0,
    volumeConfirmed: false,
    reasonCodes: ["ENGINE4_UNAVAILABLE"],
    flags: {},
    diagnostics: { error: r?.text || "ENGINE4_FETCH_FAILED" },
  };
}

function buildEngine22CurrentLifecycleStateContract(engine22WaveStrategy) {
  const lifecycle = engine22WaveStrategy?.waveFibState?.lifecycle || null;
  const postAbcReset = lifecycle?.postAbcReset || null;
  const possibleW5Up = postAbcReset?.possibleW5Up || null;
  const postDownImpulseBounce = postAbcReset?.postDownImpulseBounce || null;
  const waveOpportunity = engine22WaveStrategy?.waveOpportunity || null;

  if (
    possibleW5Up?.w5Complete === true ||
    possibleW5Up?.state === "POSSIBLE_MINOR_W5_UP_COMPLETE_POST_W5_PULLBACK_WATCH"
  ) {
    return {
      key: "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
      headline:
        engine22WaveStrategy?.tradeContextSummary?.headline ||
        engine22WaveStrategy?.timelineRead?.headline ||
        "POSSIBLE MINOR W5 UP COMPLETE — WATCH PULLBACK ENTRY ZONES",
      sourcePath: "waveFibState.lifecycle.postAbcReset.possibleW5Up",
      priority: 1,

      action: "WATCH_POST_W5_PULLBACK_ENTRY_ZONES",
      direction: "NONE",
      active: false,
      readOnly: true,
      noExecution: true,
      tradeableOpportunityBlocked: true,

      currentPrice: possibleW5Up?.currentPrice ?? null,
      pullbackLevelsFromW5: possibleW5Up?.pullbackLevelsFromW5 ?? null,
      entryZones: possibleW5Up?.entryZones ?? null,
      priceProgress: possibleW5Up?.priceProgress ?? null,

      needs: possibleW5Up?.needs ?? [],
      reasonCodes: [
        "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
        "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
        "READ_ONLY",
        "NO_EXECUTION",
        "DIRECTION_NONE",
      ],
    };
  }

  if (
    postDownImpulseBounce?.possibleW5UpReclassification === true ||
    postDownImpulseBounce?.state ===
      "POST_MINOR_5_BOUNCE_EXCEEDED_C2618_POSSIBLE_W5_UP"
  ) {
    return {
      key: "POSSIBLE_W5_UP_RECLASSIFICATION_WATCH",
      headline:
        postDownImpulseBounce?.headline ||
        engine22WaveStrategy?.tradeContextSummary?.headline ||
        "C 2.618 EXCEEDED — POSSIBLE WAVE 5 UP WATCH",
      sourcePath: "waveFibState.lifecycle.postAbcReset.postDownImpulseBounce",
      priority: 2,

      action: postDownImpulseBounce?.action || "WAIT_FOR_CONFIRMATION",
      direction: "NONE",
      active: false,
      readOnly: true,
      noExecution: true,
      tradeableOpportunityBlocked: true,

      currentPrice: postDownImpulseBounce?.currentPrice ?? null,
      reasonCodes: [
        "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
        "POSSIBLE_W5_UP_RECLASSIFICATION_WATCH",
        "READ_ONLY",
        "NO_EXECUTION",
        "DIRECTION_NONE",
      ],
    };
  }

  if (postAbcReset?.state === "POST_ABC_W2_BOUNCE_WATCH") {
    return {
      key: "POST_ABC_W2_BOUNCE_WATCH",
      headline:
        postAbcReset?.headline ||
        engine22WaveStrategy?.tradeContextSummary?.headline ||
        "POST ABC COMPLETE — WATCH WAVE 2 BOUNCE",
      sourcePath: "waveFibState.lifecycle.postAbcReset",
      priority: 3,

      action: postAbcReset?.action || "WAIT_FOR_RECLAIM_CONFIRMATION",
      direction: "NONE",
      active: false,
      readOnly: true,
      noExecution: true,
      tradeableOpportunityBlocked: true,

      currentPrice: postAbcReset?.currentPrice ?? null,
      reasonCodes: [
        "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
        "POST_ABC_W2_BOUNCE_WATCH",
        "READ_ONLY",
        "NO_EXECUTION",
        "DIRECTION_NONE",
      ],
    };
  }

  return {
    key:
      waveOpportunity?.setupType ||
      engine22WaveStrategy?.state ||
      "UNKNOWN_ENGINE22_LIFECYCLE_STATE",
    headline:
      engine22WaveStrategy?.tradeContextSummary?.headline ||
      engine22WaveStrategy?.headline ||
      "Engine 22 lifecycle state unavailable",
    sourcePath: "waveOpportunity",
    priority: 99,

    action:
      engine22WaveStrategy?.tradeContextSummary?.action ||
      waveOpportunity?.action ||
      null,
    direction: waveOpportunity?.direction || "NONE",
    active: waveOpportunity?.active === true,
    readOnly: true,
    noExecution: true,
    tradeableOpportunityBlocked: true,

    reasonCodes: [
      "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
      "FALLBACK_WAVE_OPPORTUNITY_STATE",
      "READ_ONLY",
      "NO_EXECUTION",
    ],
  };
}

function applyEngine22CurrentLifecycleStateContract(engine22WaveStrategy) {
  if (!engine22WaveStrategy || typeof engine22WaveStrategy !== "object") {
    return engine22WaveStrategy;
  }

  // Engine 22 wave strategy owns currentLifecycleState.
  // Snapshot builder should only transport it, not override it.
  if (
    engine22WaveStrategy.currentLifecycleState &&
    typeof engine22WaveStrategy.currentLifecycleState === "object"
  ) {
    return engine22WaveStrategy;
  }

  const currentLifecycleState =
    buildEngine22CurrentLifecycleStateContract(engine22WaveStrategy);

  const shouldMirrorW5Complete =
    currentLifecycleState?.key === "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH";

  const waveOpportunity = shouldMirrorW5Complete
    ? {
        ...(engine22WaveStrategy.waveOpportunity || {}),
        setupType: "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
        readiness: "WATCH",
        direction: "NONE",
        active: false,
        noExecution: true,
        tradeableOpportunityBlocked: true,
      }
    : engine22WaveStrategy.waveOpportunity || null;

  return {
    ...engine22WaveStrategy,

    currentLifecycleState,

    ...(shouldMirrorW5Complete
      ? {
          setupType: "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
          readiness: "WATCH",
          direction: "NONE",
          active: false,
          noExecution: true,
          tradeableOpportunityBlocked: true,
        }
      : {}),

    waveOpportunity,

    reasonCodes: [
      ...(Array.isArray(engine22WaveStrategy.reasonCodes)
        ? engine22WaveStrategy.reasonCodes
        : []),
      "ENGINE22_CURRENT_LIFECYCLE_STATE_CONTRACT_APPLIED",
    ],
  };
}

function barPartsForPullbackReaction(bar) {
  const open = toNum(bar?.open ?? bar?.o);
  const high = toNum(bar?.high ?? bar?.h);
  const low = toNum(bar?.low ?? bar?.l);
  const close = toNum(bar?.close ?? bar?.c);
  const volume = toNum(bar?.volume ?? bar?.v);
  const time = bar?.time ?? bar?.t ?? bar?.tSec ?? null;

  return { open, high, low, close, volume, time };
}

function normalizePullbackZone(name, zone) {
  if (!zone) return null;

  if (Array.isArray(zone)) {
    const a = toNum(zone[0]);
    const b = toNum(zone[1]);
    if (a == null || b == null) return null;

    return {
      name,
      lo: Math.min(a, b),
      hi: Math.max(a, b),
    };
  }

  const lo = toNum(zone?.lo ?? zone?.low ?? zone?.from);
  const hi = toNum(zone?.hi ?? zone?.high ?? zone?.to);

  if (lo == null || hi == null) return null;

  return {
    name,
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
  };
}

function buildEngine22PullbackReaction({
  patchedConfluence = null,
  engine22WaveStrategy,
  bars = [],
} = {}) {
  const current = engine22WaveStrategy?.currentLifecycleState || null;

  if (current?.key !== "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH") {
    return null;
  }

  const reactionContext = patchedConfluence?.context?.reaction || null;

  const fastReaction =
    reactionContext?.engine3FastImbalanceReaction || null;

  const paperReaction =
    reactionContext?.paperScalpReaction || null;

  const currentLevelAction =
    reactionContext?.currentLevelAction ||
    paperReaction?.currentLevelAction ||
    null;

  const sourceReaction =
    fastReaction?.active === true
      ? fastReaction
      : paperReaction?.active === true
      ? paperReaction
      : currentLevelAction?.active === true
      ? currentLevelAction
      : null;

  const last = barPartsForPullbackReaction(
    sourceReaction?.lastCandle ||
      sourceReaction?.currentLevelAction?.lastCandle ||
      currentLevelAction?.lastCandle ||
      bars[bars.length - 1] ||
      {}
  );

  const prev = barPartsForPullbackReaction(
    sourceReaction?.priorCandle ||
      sourceReaction?.currentLevelAction?.priorCandle ||
      currentLevelAction?.priorCandle ||
      bars[bars.length - 2] ||
      {}
  );

  const currentPrice =
    validPrice(sourceReaction?.currentPrice) ??
    validPrice(sourceReaction?.fastImbalanceReaction?.currentPrice) ??
    validPrice(sourceReaction?.fastImbalanceReaction?.lastCandle?.close) ??
    validPrice(sourceReaction?.currentLevelAction?.currentPrice) ??
    validPrice(sourceReaction?.currentLevelAction?.lastCandle?.close) ??
    validPrice(currentLevelAction?.currentPrice) ??
    validPrice(currentLevelAction?.lastCandle?.close) ??
    validPrice(last.close) ??
    validPrice(patchedConfluence?.price) ??
    validPrice(patchedConfluence?.currentPrice) ??
    null;

  const pullbackLevelsFromW5 = current?.pullbackLevelsFromW5 || null;
  const entryZones = current?.entryZones || null;
  const priceProgress = current?.priceProgress || null;

  const reasonCodes = [
    "ENGINE3_ENGINE22_PULLBACK_REACTION_CONTEXT",
    "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
    "NO_PERMISSION_CREATED",
    "NO_EXECUTION",
  ];

  const levelEntries = Object.entries(pullbackLevelsFromW5 || {})
    .map(([name, value]) => ({
      name,
      value: toNum(value),
    }))
    .filter((x) => x.value != null);

  const zoneEntries = Object.entries(entryZones || {})
    .map(([name, zone]) => normalizePullbackZone(name, zone))
    .filter(Boolean);

  const barTouchedLevel = (level) =>
    last.low != null &&
    last.high != null &&
    last.low <= level.value &&
    last.high >= level.value;

  const priceNearLevel = (level) =>
    currentPrice != null &&
    Math.abs(currentPrice - level.value) <= 0.5;

  const touchedLevel =
    levelEntries
      .filter((level) => barTouchedLevel(level) || priceNearLevel(level))
      .sort((a, b) => {
        const da = Math.abs(Number(currentPrice ?? a.value) - a.value);
        const db = Math.abs(Number(currentPrice ?? b.value) - b.value);
        return da - db;
      })[0] || null;

  const barTouchedZone = (zone) =>
    last.low != null &&
    last.high != null &&
    last.low <= zone.hi &&
    last.high >= zone.lo;

  const priceInsideZone = (zone) =>
    currentPrice != null &&
    currentPrice >= zone.lo &&
    currentPrice <= zone.hi;

  const touchedZone =
    zoneEntries
      .filter((zone) => barTouchedZone(zone) || priceInsideZone(zone))
      .sort((a, b) => {
        const amid = (a.lo + a.hi) / 2;
        const bmid = (b.lo + b.hi) / 2;
        const da = Math.abs(Number(currentPrice ?? amid) - amid);
        const db = Math.abs(Number(currentPrice ?? bmid) - bmid);
        return da - db;
      })[0] || null;

  if (!touchedLevel && !touchedZone) {
    return {
      active: true,
      engine: "engine3.engine22PullbackReaction.v1",
      source: "engine22WaveStrategy.currentLifecycleState",
      sourceReactionUsed: sourceReaction ? true : false,
      lifecycleKey: current.key,

      reactionState: "PENDING",
      reaction: "NO_REACTION_YET",
      confirmed: false,
      direction: "NEUTRAL",

      currentPrice,
      pullbackLevelsFromW5,
      entryZones,
      priceProgress,

      touchedLevel: null,
      touchedZone: null,

      defended: false,
      reclaimed: false,
      failedReclaim: false,
      closeBelowLevel: false,
      priorCandleHighReclaimed: false,

      reasonCodes: [
        ...reasonCodes,
        "WAITING_FOR_PULLBACK_ZONE_REACTION",
      ],
    };
  }

  const referenceLo =
    touchedZone?.lo ??
    touchedLevel?.value ??
    null;

  const referenceHi =
    touchedZone?.hi ??
    touchedLevel?.value ??
    null;

  const closeBelowLevel =
    last.close != null &&
    referenceLo != null &&
    last.close < referenceLo;

  const defended =
    last.close != null &&
    referenceLo != null &&
    referenceHi != null &&
    last.low != null &&
    last.low <= referenceHi &&
    last.close >= referenceLo;

  const reclaimed =
    last.low != null &&
    last.close != null &&
    referenceLo != null &&
    last.low < referenceLo &&
    last.close >= referenceLo;

  const priorCandleHighReclaimed =
    prev.high != null &&
    last.close != null &&
    last.close > prev.high;

  const failedReclaim =
    touchedZone || touchedLevel
      ? (
          prev.high != null &&
          last.high != null &&
          last.close != null &&
          last.high <= prev.high &&
          last.close < prev.high &&
          !priorCandleHighReclaimed
        )
      : false;

  let reactionState = "LEVEL_TOUCHED";
  let reaction = "LEVEL_TOUCHED";
  let confirmed = false;
  let direction = "NEUTRAL";

  if (closeBelowLevel) {
    reactionState = "CLOSE_BELOW_LEVEL";
    reaction = "CLOSE_BELOW_LEVEL";
    reasonCodes.push("CLOSE_BELOW_PULLBACK_LEVEL");
  } else if (failedReclaim) {
    reactionState = "FAILED_RECLAIM";
    reaction = "FAILED_RECLAIM";
    reasonCodes.push("FAILED_TO_RECLAIM_PRIOR_CANDLE_HIGH");
  } else if (reclaimed) {
    reactionState = "WICK_BELOW_AND_RECLAIM";
    reaction = "WICK_BELOW_AND_RECLAIM";
    direction = "LONG";
    reasonCodes.push("WICK_BELOW_LEVEL_AND_RECLAIMED");
  } else if (defended && priorCandleHighReclaimed) {
    reactionState = "GOOD_REACTION";
    reaction = "GOOD_REACTION";
    confirmed = true;
    direction = "LONG";
    reasonCodes.push("LEVEL_DEFENDED");
    reasonCodes.push("PRIOR_CANDLE_HIGH_RECLAIMED");
  } else if (defended) {
    reactionState = "LEVEL_DEFENDED";
    reaction = "LEVEL_DEFENDED";
    direction = "LONG";
    reasonCodes.push("LEVEL_DEFENDED");
  } else {
    reasonCodes.push("LEVEL_TOUCHED_WAITING_FOR_REACTION");
  }

  return {
    active: true,
    engine: "engine3.engine22PullbackReaction.v1",
    source: "engine22WaveStrategy.currentLifecycleState",
    sourceReactionUsed: sourceReaction ? true : false,
    lifecycleKey: current.key,

    reactionState,
    reaction,
    confirmed,
    direction,

    currentPrice,
    pullbackLevelsFromW5,
    entryZones,
    priceProgress,

    touchedLevel: touchedLevel
      ? {
          name: touchedLevel.name,
          value: touchedLevel.value,
        }
      : null,

    touchedZone: touchedZone
      ? {
          name: touchedZone.name,
          lo: touchedZone.lo,
          hi: touchedZone.hi,
        }
      : null,

    defended,
    reclaimed,
    failedReclaim,
    closeBelowLevel,
    priorCandleHighReclaimed,

    lastCandle: last,
    priorCandle: prev,

    reasonCodes,
  };
}
function attachEngine22PullbackReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars = [],
}) {
  const pullbackReaction = buildEngine22PullbackReaction({
    patchedConfluence,
    engine22WaveStrategy,
    bars,
  });

  if (!pullbackReaction) return patchedConfluence;

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    engine22PullbackReaction: pullbackReaction,
  };

  return patchedConfluence;
}

function attachEngine22LifecycleReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars = [],
}) {
  const lifecycleReaction = buildEngine22LifecycleReaction({
    currentLifecycleState: engine22WaveStrategy?.currentLifecycleState || null,
    bars,
    currentPrice:
      engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.reference?.currentPrice ??
      engine22WaveStrategy?.currentLifecycleState?.currentPrice ??
      null,
    reactionContext: patchedConfluence?.context?.reaction || null,
  });

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    engine22LifecycleReaction: lifecycleReaction,
  };

  return patchedConfluence;
}

function buildPaperScalpParticipation({
  confirmationDirection,
  participationFocus,
  participationState,
  participationQuality,
  strictParticipationConfirmed,
  volumeScore,
  volumeConfirmed,
  relativeVolume,
  volumeTrend,
  highVolumeCandles,
  volumeExpansion,
  absorptionRisk,
  climacticVolume,
  volumeRisk,
  focusSatisfied,
  reclaimLike,
  cleanParticipation,
  greenCandle,
  redCandle,
  higherClose,
  lowerClose,
} = {}) {
  const intendedDirection = String(confirmationDirection || "NEUTRAL").toUpperCase();
  const focus = String(participationFocus || "UNKNOWN").toUpperCase();
  const state = String(participationState || "WEAK").toUpperCase();
  const quality = String(participationQuality || "WEAK").toUpperCase();
  const trend = String(volumeTrend || "UNKNOWN").toUpperCase();

  const score = Number(volumeScore);
  const relVol = Number(relativeVolume);
  const hvCandles = Number(highVolumeCandles);

  const safeScore = Number.isFinite(score) ? score : 0;
  const safeRelVol = Number.isFinite(relVol) ? relVol : 0;
  const safeHighVolumeCandles = Number.isFinite(hvCandles) ? hvCandles : 0;

  const strongRedVolumeAgainstLong =
    intendedDirection === "LONG" &&
    redCandle === true &&
    lowerClose === true &&
    (
      volumeExpansion === true ||
      safeHighVolumeCandles >= 2 ||
      safeScore >= 10 ||
      safeRelVol >= 1.35
    );

  const strongGreenRejectionAgainstShort =
    intendedDirection === "SHORT" &&
    greenCandle === true &&
    higherClose === true &&
    (
      volumeExpansion === true ||
      safeHighVolumeCandles >= 2 ||
      safeScore >= 10 ||
      safeRelVol >= 1.35
    );

  const failedReclaimWithVolume =
    focus === "VOLUME_ON_RECLAIM" &&
    reclaimLike !== true &&
    (redCandle === true || lowerClose === true) &&
    (
      volumeExpansion === true ||
      safeHighVolumeCandles >= 2 ||
      safeScore >= 10 ||
      safeRelVol >= 1.35
    );

  const highVolumeNoProgressAgainstTrade =
    focusSatisfied !== true &&
    (
      volumeExpansion === true ||
      safeHighVolumeCandles >= 2 ||
      safeScore >= 10 ||
      safeRelVol >= 1.35
    ) &&
    (
      trend === "FADING" ||
      failedReclaimWithVolume
    );

  const absorptionRiskAgainstTrade =
    absorptionRisk === true &&
    focusSatisfied !== true;

  const climacticAgainstTrade =
    climacticVolume === true &&
    focusSatisfied !== true;

  const hardBlocked =
    volumeRisk === true ||
    strongRedVolumeAgainstLong ||
    strongGreenRejectionAgainstShort ||
    failedReclaimWithVolume ||
    highVolumeNoProgressAgainstTrade ||
    absorptionRiskAgainstTrade ||
    climacticAgainstTrade;

  const weakFading =
    state === "WEAK" &&
    (
      trend === "FADING" ||
      safeRelVol < 0.75
    );

  const weakImproving =
    state === "WEAK" &&
    reclaimLike === true &&
    trend !== "FADING" &&
    safeRelVol >= 0.8 &&
    hardBlocked !== true;

  const mixedAcceptable =
    state === "MIXED" &&
    hardBlocked !== true;

  const expandingAcceptable =
    state === "EXPANDING" &&
    hardBlocked !== true;

  const confirmedAcceptable =
    strictParticipationConfirmed === true ||
    state === "CONFIRMED" ||
    volumeConfirmed === true;

  let allowed = false;
  let grade = "D";
  let risk = "WAIT_FOR_PARTICIPATION";
  let downgradeOnly = false;

  const reasonCodes = [
    "PAPER_ONLY_RESEARCH_LANE",
    "ENGINE4_PAPER_SCALP_PARTICIPATION_READ",
    "NO_REAL_EXECUTION_PERMISSION_CREATED",
  ];

  if (hardBlocked) {
    allowed = false;
    grade = "F";
    risk = "DANGEROUS_PARTICIPATION";
    downgradeOnly = false;

    reasonCodes.push("PAPER_TRADE_BLOCKED_BY_ENGINE4");

    if (volumeRisk) reasonCodes.push("VOLUME_RISK_PRESENT");
    if (strongRedVolumeAgainstLong) reasonCodes.push("STRONG_RED_VOLUME_AGAINST_LONG");
    if (strongGreenRejectionAgainstShort) reasonCodes.push("STRONG_GREEN_REJECTION_AGAINST_SHORT");
    if (failedReclaimWithVolume) reasonCodes.push("FAILED_RECLAIM_WITH_VOLUME");
    if (highVolumeNoProgressAgainstTrade) reasonCodes.push("HIGH_VOLUME_NO_PROGRESS_AGAINST_TRADE");
    if (absorptionRiskAgainstTrade) reasonCodes.push("ABSORPTION_RISK_AGAINST_TRADE");
    if (climacticAgainstTrade) reasonCodes.push("CLIMACTIC_AGAINST_TRADE");
  } else if (confirmedAcceptable) {
    allowed = true;
    grade = "A";
    risk = "CLEAN_FOR_PAPER";
    downgradeOnly = false;

    reasonCodes.push("STRICT_PARTICIPATION_CONFIRMED");
    reasonCodes.push("PAPER_ALLOWED_ENGINE4_A_GRADE");
  } else if (expandingAcceptable) {
    allowed = true;
    grade = "B";
    risk = "ACCEPTABLE_FOR_PAPER";
    downgradeOnly = true;

    reasonCodes.push("EXPANDING_PARTICIPATION_ACCEPTABLE_FOR_PAPER");
    reasonCodes.push("ENGINE4_STRICT_CONFIRMATION_NOT_REQUIRED_FOR_PAPER");
  } else if (mixedAcceptable) {
    allowed = true;
    grade = "C";
    risk = "MIXED_PARTICIPATION_REQUIRES_STRONG_ENGINE3";
    downgradeOnly = true;

    reasonCodes.push("MIXED_PARTICIPATION_ACCEPTABLE_FOR_PAPER");
    reasonCodes.push("ENGINE3_REACTION_REQUIRED_FOR_PAPER");
  } else if (weakImproving) {
    allowed = true;
    grade = "C";
    risk = "THIN_PARTICIPATION_PAPER_ONLY";
    downgradeOnly = true;

    reasonCodes.push("WEAK_BUT_IMPROVING_PARTICIPATION");
    reasonCodes.push("RECLAIM_LIKE_PRICE_ACTION_DETECTED");
  } else if (weakFading) {
    allowed = false;
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    downgradeOnly = false;

    reasonCodes.push("WEAK_FADING_PARTICIPATION");
    reasonCodes.push("RELATIVE_VOLUME_TOO_LOW");
    reasonCodes.push("WAIT_FOR_RECLAIM_VOLUME");
  } else {
    allowed = false;
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    downgradeOnly = false;

    reasonCodes.push("PARTICIPATION_NOT_READY_FOR_PAPER");
  }

  return {
    active: true,
    engine: "engine4.paperScalpParticipation.v1",
    mode: "PAPER_ONLY",

    allowed,
    hardBlocked,
    downgradeOnly,

    grade,
    risk,

    intendedDirection,
    direction: allowed ? intendedDirection : "NEUTRAL",

    participationState: state,
    participationQuality: quality,

    volumeScore: safeScore,
    relativeVolume: safeRelVol,
    volumeTrend: trend,
    highVolumeCandles: safeHighVolumeCandles,
    volumeExpansion: volumeExpansion === true,
    volumeConfirmed: volumeConfirmed === true,

    strictParticipationConfirmed: strictParticipationConfirmed === true,

    focusSatisfied: focusSatisfied === true,
    reclaimLike: reclaimLike === true,
    cleanParticipation: cleanParticipation === true,

    noRealExecutionPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    reasonCodes,
  };
}

function buildEngine22LifecycleParticipation({
  engine22WaveStrategy,
  volumeContext,
  bars = [],
} = {}) {
  const currentLifecycleState =
    engine22WaveStrategy?.currentLifecycleState || null;

  const confirmation =
    currentLifecycleState?.confirmationContext || null;

  if (confirmation?.participationRequired !== true) {
    return null;
  }

  const last = barPartsForPullbackReaction(bars[bars.length - 1] || {});
  const prev = barPartsForPullbackReaction(bars[bars.length - 2] || {});
  const flags = volumeContext?.flags || {};
  const volumeReasonCodes = Array.isArray(volumeContext?.reasonCodes)
    ? volumeContext.reasonCodes
    : [];

  const volumeScore = Number(volumeContext?.volumeScore ?? 0);
  const volumeConfirmed = volumeContext?.volumeConfirmed === true;

  const highVolumeCandles = Number(flags?.highVolumeCandles ?? 0);
  const relativeVolume = Number(flags?.relativeVolume ?? 0);
  const volumeTrend = flags?.volumeTrend || null;

  const volumeExpansion =
    flags?.volumeExpansion === true ||
    volumeReasonCodes.includes("BURST_VOLUME_ABOVE_1_35_AVG") ||
    volumeScore >= 10 ||
    relativeVolume >= 1.35;

  const absorptionRisk = flags?.absorptionRisk === true;
  const climacticVolume = flags?.climacticVolume === true;

  const greenCandle =
    last.open != null &&
    last.close != null &&
    last.close > last.open;

  const redCandle =
    last.open != null &&
    last.close != null &&
    last.close < last.open;

  const higherClose =
    prev.close != null &&
    last.close != null &&
    last.close > prev.close;

  const lowerClose =
    prev.close != null &&
    last.close != null &&
    last.close < prev.close;

  const priorHighReclaimed =
    prev.high != null &&
    last.close != null &&
    last.close > prev.high;

  const reclaimLike =
    greenCandle &&
    (
      higherClose ||
      priorHighReclaimed
    );

  const volumeRisk =
    absorptionRisk ||
    climacticVolume ||
    (
      redCandle &&
      lowerClose &&
      (
        volumeExpansion ||
        highVolumeCandles >= 2 ||
        volumeScore >= 10 ||
        relativeVolume >= 1.35
      )
    );

  const cleanParticipation =
    !volumeRisk &&
    volumeTrend !== "FADING" &&
    (
      volumeConfirmed ||
      volumeExpansion ||
      highVolumeCandles >= 2 ||
      volumeScore >= 10 ||
      relativeVolume >= 1.35
    );

  const participationFocus = String(
    confirmation?.participationFocus || "UNKNOWN"
  ).toUpperCase();

  let focusSatisfied = false;
  const focusReasonCodes = [];

  if (participationFocus === "VOLUME_ON_RECLAIM") {
    focusSatisfied = reclaimLike && cleanParticipation;
    focusReasonCodes.push("FOCUS_VOLUME_ON_RECLAIM");

    if (reclaimLike) {
      focusReasonCodes.push("RECLAIM_LIKE_PRICE_ACTION");
    } else {
      focusReasonCodes.push("RECLAIM_PRICE_ACTION_NOT_CONFIRMED");
    }
  } else if (participationFocus === "VOLUME_ON_PULLBACK_DEFENSE") {
    focusSatisfied =
      cleanParticipation &&
      greenCandle &&
      (
        higherClose ||
        priorHighReclaimed ||
        last.close >= last.open
      );

    focusReasonCodes.push("FOCUS_VOLUME_ON_PULLBACK_DEFENSE");

    if (focusSatisfied) {
      focusReasonCodes.push("PULLBACK_DEFENSE_WITH_PARTICIPATION");
    } else {
      focusReasonCodes.push("PULLBACK_DEFENSE_PARTICIPATION_NOT_CONFIRMED");
    }
  } else if (participationFocus === "CLEAN_EXPANSION") {
    focusSatisfied = cleanParticipation;
    focusReasonCodes.push("FOCUS_CLEAN_EXPANSION");
  } else if (participationFocus === "NO_FADING_VOLUME") {
    focusSatisfied =
      volumeTrend !== "FADING" &&
      relativeVolume >= 1.0 &&
      !volumeRisk;

    focusReasonCodes.push("FOCUS_NO_FADING_VOLUME");
  } else if (participationFocus === "NO_ABSORPTION_RISK") {
    focusSatisfied = !absorptionRisk && !climacticVolume;
    focusReasonCodes.push("FOCUS_NO_ABSORPTION_RISK");
  } else {
    focusSatisfied = cleanParticipation;
    focusReasonCodes.push("FOCUS_GENERIC_PARTICIPATION");
  }

  let participationState = "WEAK";
  let participationQuality = "WEAK";
  let confirmed = false;
  let direction = "NEUTRAL";

  if (volumeRisk) {
    participationState = "RISK";
    participationQuality = "RISK";
    confirmed = false;
    direction = "NEUTRAL";
  } else if (focusSatisfied && volumeConfirmed) {
    participationState = "CONFIRMED";
    participationQuality = "CLEAN";
    confirmed = true;
    direction = confirmation?.direction || "NEUTRAL";
  } else if (focusSatisfied) {
    participationState = "EXPANDING";
    participationQuality = "CLEAN";
    confirmed = true;
    direction = confirmation?.direction || "NEUTRAL";
  } else if (
    reclaimLike &&
    (
      relativeVolume >= 1.0 ||
      volumeScore >= 5 ||
      highVolumeCandles >= 1
    )
  ) {
    participationState = "MIXED";
    participationQuality = "MIXED";
    confirmed = false;
    direction = "NEUTRAL";
  } else if (volumeTrend === "FADING") {
    participationState = "WEAK";
    participationQuality = "WEAK";
    confirmed = false;
    direction = "NEUTRAL";
  }

  const paperScalpParticipation = buildPaperScalpParticipation({
    confirmationDirection: confirmation?.direction,
    participationFocus,
    participationState,
    participationQuality,
    strictParticipationConfirmed: confirmed,
    volumeScore,
    volumeConfirmed,
    relativeVolume,
    volumeTrend,
    highVolumeCandles,
    volumeExpansion,
    absorptionRisk,
    climacticVolume,
    volumeRisk,
    focusSatisfied,
    reclaimLike,
    cleanParticipation,
    greenCandle,
    redCandle,
    higherClose,
    lowerClose,
  });

  const reasonCodes = [
    "ENGINE4_READ_ENGINE22_CONFIRMATION_CONTEXT",
    "PARTICIPATION_REQUIRED",
    currentLifecycleState?.key || null,
    confirmation?.mode || null,
    participationFocus ? `PARTICIPATION_FOCUS_${participationFocus}` : null,

    volumeExpansion ? "VOLUME_EXPANSION" : "VOLUME_EXPANSION_NOT_CONFIRMED",
    volumeConfirmed ? "VOLUME_CONFIRMED" : "VOLUME_NOT_CONFIRMED",
    volumeTrend ? `VOLUME_TREND_${String(volumeTrend).toUpperCase()}` : null,

    absorptionRisk ? "ABSORPTION_RISK" : null,
    climacticVolume ? "CLIMACTIC_VOLUME" : null,
    volumeRisk ? "VOLUME_RISK_PRESENT" : null,

    focusSatisfied
      ? "PARTICIPATION_FOCUS_CONFIRMED"
      : "PARTICIPATION_FOCUS_NOT_CONFIRMED",

    confirmed
      ? "ENGINE4_PARTICIPATION_CONFIRMATION"
      : "ENGINE4_PARTICIPATION_NOT_CONFIRMED",

    confirmation?.noExecution === true ? "NO_EXECUTION" : null,
    confirmation?.noPermissionCreated === true ? "NO_PERMISSION_CREATED" : null,
    confirmation?.noChase === true ? "NO_CHASE" : null,

    ...focusReasonCodes,
  ].filter(Boolean);

  return {
    active: confirmation?.participationRequired === true,
    engine: "engine4.engine22LifecycleParticipation.v1",
    source: "engine22WaveStrategy.currentLifecycleState.confirmationContext",

    lifecycleKey: currentLifecycleState?.key || null,
    mode: confirmation?.mode || null,
    direction,

    participationFocus: confirmation?.participationFocus || null,
    participationState,
    participationQuality,
    volumeState: participationState,
    volumeRisk,
    confirmed,
    paperScalpParticipation,

    currentPrice:
      toNum(confirmation?.reference?.currentPrice) ??
      toNum(currentLifecycleState?.currentPrice) ??
      last.close ??
      null,

    reference: confirmation?.reference || {},

    volumeScore,
    volumeConfirmed,
    relativeVolume: Number.isFinite(relativeVolume) ? relativeVolume : 0,
    volumeTrend,
    highVolumeCandles,
    volumeExpansion,
    absorptionRisk,
    climacticVolume,

    focusSatisfied,
    cleanParticipation,
    reclaimLike,

    noPermissionCreated: true,
    noExecution: true,

    lastCandle: last,
    priorCandle: prev,

    reasonCodes,
  };
}

function attachEngine22LifecycleParticipationToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars = [],
}) {
  const volumeContext = patchedConfluence?.context?.volume || null;

  const lifecycleParticipation = buildEngine22LifecycleParticipation({
    engine22WaveStrategy,
    volumeContext,
    bars,
  });

  if (!lifecycleParticipation) return patchedConfluence;

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.volume = {
    ...(patchedConfluence.context.volume || {}),
    engine22LifecycleParticipation: lifecycleParticipation,
  };

  return patchedConfluence;
}

function buildEngine4FastImbalanceParticipation({
  patchedConfluence,
  engine22WaveStrategy = null,
  bars = [],
} = {}) {
  const reactionContext = patchedConfluence?.context?.reaction || null;
  const volumeContext = patchedConfluence?.context?.volume || null;
  const waveContext = buildEngine4WaveContextFromDegreeStates(engine22WaveStrategy);

  const fastReaction =
    reactionContext?.engine3FastImbalanceReaction || null;

  if (!fastReaction || fastReaction.active !== true) {
    return null;
  }

  const fastLastCandle = fastReaction?.lastCandle || null;
  const fastPriorCandle = fastReaction?.priorCandle || null;

  const last = barPartsForPullbackReaction(
    fastLastCandle || bars[bars.length - 1] || {}
  );

  const prev = barPartsForPullbackReaction(
    fastPriorCandle || bars[bars.length - 2] || {}
  );

  const usedFastReactionCandles =
    fastLastCandle != null || fastPriorCandle != null;

  const usedTenMinuteFallback = usedFastReactionCandles !== true;

  const flags = volumeContext?.flags || {};
  const volumeReasonCodes = Array.isArray(volumeContext?.reasonCodes)
    ? volumeContext.reasonCodes
    : [];

  const volumeScore = Number(volumeContext?.volumeScore ?? 0);
  const volumeConfirmed = volumeContext?.volumeConfirmed === true;

  const relativeVolume = Number(flags?.relativeVolume ?? 0);
  const highVolumeCandles = Number(flags?.highVolumeCandles ?? 0);
  const volumeTrend = flags?.volumeTrend || null;

  const volumeExpansion =
    flags?.volumeExpansion === true ||
    volumeReasonCodes.includes("BURST_VOLUME_ABOVE_1_35_AVG") ||
    volumeScore >= 10 ||
    relativeVolume >= 1.35;

  const absorptionRisk = flags?.absorptionRisk === true;
  const climacticRisk = flags?.climacticVolume === true;

  const intendedDirection = String(
    fastReaction.direction || fastReaction.fastReactionDirection || "NEUTRAL"
  ).toUpperCase();

  const fastReactionState = String(
    fastReaction.state || fastReaction.fastReactionState || "UNKNOWN"
  ).toUpperCase();

  const fastReactionQuality = String(
    fastReaction.quality || fastReaction.fastReactionQuality || "UNKNOWN"
  ).toUpperCase();

  const currentPrice =
    validPrice(fastReaction?.currentPrice) ??
    validPrice(fastReaction?.lastCandle?.close) ??
    validPrice(fastReaction?.current) ??
    validPrice(fastReaction?.price) ??
    validPrice(fastReaction?.imbalance?.currentPrice) ??
    validPrice(patchedConfluence?.price) ??
    validPrice(patchedConfluence?.currentPrice) ??
    null;

  const rawImbalance =
    fastReaction.imbalance ||
    fastReaction.zone ||
    fastReaction.activeImbalance ||
    null;

  const imbalanceLo = toNum(rawImbalance?.lo);
  const imbalanceHi = toNum(rawImbalance?.hi);
  const imbalanceMid =
    toNum(rawImbalance?.mid) ??
    (
      imbalanceLo != null && imbalanceHi != null
        ? Number(((imbalanceLo + imbalanceHi) / 2).toFixed(2))
        : null
    );

  const insideImbalance =
    fastReaction.insideImbalance === true ||
    fastReaction.inside === true ||
    (
      currentPrice != null &&
      imbalanceLo != null &&
      imbalanceHi != null &&
      currentPrice >= Math.min(imbalanceLo, imbalanceHi) &&
      currentPrice <= Math.max(imbalanceLo, imbalanceHi)
    );

  const nearImbalance =
    insideImbalance ||
    fastReaction.nearImbalance === true ||
    fastReaction.near === true;

  const distancePts =
    insideImbalance
      ? 0
      : currentPrice != null && imbalanceLo != null && imbalanceHi != null
      ? currentPrice < Math.min(imbalanceLo, imbalanceHi)
        ? Number((Math.min(imbalanceLo, imbalanceHi) - currentPrice).toFixed(2))
        : Number((currentPrice - Math.max(imbalanceLo, imbalanceHi)).toFixed(2))
      : null;

  const greenCandle =
    last.open != null &&
    last.close != null &&
    last.close > last.open;

  const redCandle =
    last.open != null &&
    last.close != null &&
    last.close < last.open;

  const higherClose =
    prev.close != null &&
    last.close != null &&
    last.close > prev.close;

  const lowerClose =
    prev.close != null &&
    last.close != null &&
    last.close < prev.close;

  const priorHighReclaimed =
    prev.high != null &&
    last.close != null &&
    last.close > prev.high;

  const reclaimLike =
    greenCandle &&
    (
      higherClose ||
      priorHighReclaimed ||
      fastReactionState.includes("RECLAIM") ||
      fastReactionState.includes("BREAKING_ABOVE")
    );

  const supportsFastReactionDirection =
    intendedDirection === "LONG"
      ? (
          greenCandle &&
          (higherClose || priorHighReclaimed || fastReactionState === "HELD_LEVEL")
        )
      : intendedDirection === "SHORT"
      ? (
          redCandle &&
          lowerClose
        )
      : false;

  const participationImproving =
    volumeTrend === "EXPANDING" ||
    relativeVolume >= 1.25 ||
    volumeExpansion === true ||
    highVolumeCandles >= 1;

  const reclaimVolumeConfirmed =
    intendedDirection === "LONG" &&
    reclaimLike &&
    participationImproving &&
    volumeTrend !== "FADING" &&
    absorptionRisk !== true &&
    climacticRisk !== true;

  const holdVolumeConfirmed =
    intendedDirection === "LONG" &&
    fastReactionState === "HELD_LEVEL" &&
    insideImbalance &&
    fastReactionQuality === "STRONG" &&
    participationImproving &&
    volumeTrend !== "FADING" &&
    absorptionRisk !== true &&
    climacticRisk !== true;

  const rejectionVolumeConfirmed =
    intendedDirection === "SHORT" &&
    redCandle &&
    lowerClose &&
    participationImproving &&
    volumeTrend !== "FADING";

  const strongRedVolumeAgainstLong =
    intendedDirection === "LONG" &&
    redCandle &&
    lowerClose &&
    (
      volumeExpansion ||
      highVolumeCandles >= 2 ||
      volumeScore >= 10 ||
      relativeVolume >= 1.35
    );

  const strongGreenRejectionAgainstShort =
    intendedDirection === "SHORT" &&
    greenCandle &&
    higherClose &&
    (
      volumeExpansion ||
      highVolumeCandles >= 2 ||
      volumeScore >= 10 ||
      relativeVolume >= 1.35
    );

  const highVolumeNoProgress =
    (
      volumeExpansion ||
      highVolumeCandles >= 2 ||
      volumeScore >= 10 ||
      relativeVolume >= 1.35
    ) &&
    supportsFastReactionDirection !== true &&
    reclaimVolumeConfirmed !== true &&
    holdVolumeConfirmed !== true;

  const absorptionRiskAgainstTrade =
    absorptionRisk === true &&
    supportsFastReactionDirection !== true;

  const climacticAgainstTrade =
    climacticRisk === true &&
    supportsFastReactionDirection !== true;

  const hardBlocked =
    strongRedVolumeAgainstLong ||
    strongGreenRejectionAgainstShort ||
    highVolumeNoProgress ||
    absorptionRiskAgainstTrade ||
    climacticAgainstTrade;

  let allowed = false;
  let downgradeOnly = true;
  let participationState = "NO_FAST_IMBALANCE_PARTICIPATION";
  let participationQuality = "WEAK";
  let grade = "D";
  let risk = "WAIT_FOR_PARTICIPATION";
  let direction = "NEUTRAL";

  const blockers = [];
  const reasonCodes = [
    "PAPER_ONLY_RESEARCH_LANE",
    "ENGINE4_FAST_IMBALANCE_PARTICIPATION",
    "FAST_IMBALANCE_WATCH",
    "ENGINE3_FAST_REACTION_CONSUMED",
    "NO_REAL_PERMISSION_CREATED",
    "NO_EXECUTION",
    "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
  ];

  if (hardBlocked) {
    allowed = false;
    downgradeOnly = false;
    participationState = "VOLUME_RISK_PRESENT";
    participationQuality = "RISK";
    grade = "F";
    risk = "DANGEROUS_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("FAST_IMBALANCE_PARTICIPATION_HARD_BLOCKED");
    reasonCodes.push("PAPER_TRADE_BLOCKED_BY_ENGINE4");

    if (strongRedVolumeAgainstLong) reasonCodes.push("STRONG_RED_VOLUME_AGAINST_LONG");
    if (strongGreenRejectionAgainstShort) reasonCodes.push("STRONG_GREEN_REJECTION_AGAINST_SHORT");
    if (highVolumeNoProgress) reasonCodes.push("HIGH_VOLUME_NO_PROGRESS_AGAINST_TRADE");
    if (absorptionRiskAgainstTrade) reasonCodes.push("ABSORPTION_RISK_AGAINST_TRADE");
    if (climacticAgainstTrade) reasonCodes.push("CLIMACTIC_AGAINST_TRADE");
  } else if (rejectionVolumeConfirmed) {
    allowed = true;
    downgradeOnly = true;
    participationState = "SHORT_REJECTION_VOLUME_CONFIRMED";
    participationQuality = "MIXED";
    grade = "B";
    risk = climacticRisk === true
      ? "CLIMACTIC_BUT_DIRECTIONAL_PAPER_ONLY"
      : "ACCEPTABLE_FOR_FAST_PAPER";
    direction = intendedDirection;

    reasonCodes.push("SHORT_REJECTION_VOLUME_CONFIRMED");
    reasonCodes.push("FAST_REJECTION_VOLUME_CONFIRMED");
    reasonCodes.push("ENGINE3_SHORT_REJECTION_CONFIRMED_BY_FAST_VOLUME");
    reasonCodes.push("PAPER_ONLY_ENGINE6_STILL_DECIDES");
  } else if (reclaimVolumeConfirmed) {
    allowed = true;
    downgradeOnly = false;
    participationState = "RECLAIM_VOLUME_CONFIRMED";
    participationQuality = "CLEAN";
    grade = "A";
    risk = "ACCEPTABLE_FOR_FAST_PAPER";
    direction = intendedDirection;

    reasonCodes.push("RECLAIM_VOLUME_CONFIRMED");
    reasonCodes.push("FAST_IMBALANCE_PAPER_ALLOWED");
  } else if (holdVolumeConfirmed) {
    allowed = true;
    downgradeOnly = true;
    participationState = "PULLBACK_HOLD_VOLUME_OK";
    participationQuality = "CLEAN";
    grade = "B";
    risk = "ACCEPTABLE_FOR_FAST_PAPER";
    direction = intendedDirection;

    reasonCodes.push("PULLBACK_HOLD_VOLUME_OK");
    reasonCodes.push("FAST_IMBALANCE_PAPER_ALLOWED");
  } else if (
    participationImproving &&
    supportsFastReactionDirection &&
    fastReactionQuality === "STRONG"
  ) {
    allowed = true;
    downgradeOnly = true;
    participationState = "PARTICIPATION_IMPROVING";
    participationQuality = "MIXED";
    grade = "B";
    risk = "ACCEPTABLE_FOR_FAST_PAPER";
    direction = intendedDirection;

    reasonCodes.push("PARTICIPATION_IMPROVING");
    reasonCodes.push("FAST_IMBALANCE_PAPER_ALLOWED");
  } else if (
    fastReactionState === "HELD_LEVEL" &&
    fastReactionQuality === "GOOD"
  ) {
    allowed = false;
    downgradeOnly = true;
    participationState = "LOW_VOLUME_HOLD";
    participationQuality = "MIXED";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("FAST_IMBALANCE_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("ENGINE3_HELD_LEVEL_CONDITIONAL");
    reasonCodes.push("WAIT_FOR_RECLAIM_VOLUME");
  } else if (volumeTrend === "FADING") {
    allowed = false;
    downgradeOnly = false;
    participationState = "WEAK_FADING_PARTICIPATION";
    participationQuality = "WEAK";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("FAST_IMBALANCE_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("WEAK_FADING_PARTICIPATION");
    reasonCodes.push("PARTICIPATION_NOT_READY_FOR_PAPER");
  } else if (relativeVolume < 0.9) {
    allowed = false;
    downgradeOnly = true;
    participationState = "WEAK_LOW_VOLUME_PARTICIPATION";
    participationQuality = "WEAK";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("FAST_IMBALANCE_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("LOW_RELATIVE_VOLUME_FAST_MODE_BACKGROUND");
    reasonCodes.push("PARTICIPATION_NOT_READY_FOR_PAPER");
  } else {
    allowed = false;
    downgradeOnly = true;
    participationState = "NO_FAST_IMBALANCE_PARTICIPATION";
    participationQuality = "WEAK";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("FAST_IMBALANCE_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("PARTICIPATION_NOT_READY_FOR_PAPER");
  }

  return {
    active: true,
    engine: "engine4.fastImbalanceParticipation.v1",
    mode: "FAST_IMBALANCE_WATCH",
    fastMode: true,
    paperOnly: true,
    researchOnly: true,

    source: "confluence.context.reaction.engine3FastImbalanceReaction",
    waveContext,
    allowed,
    hardBlocked,
    downgradeOnly,

    intendedDirection,
    direction,

    participationState,
    participationQuality,
    grade,
    risk,

    currentPrice,

    imbalance: {
      lo: imbalanceLo,
      hi: imbalanceHi,
      mid: imbalanceMid,
      distancePts,
      near: nearImbalance,
      inside: insideImbalance,
    },

    volumeScore,
    relativeVolume: Number.isFinite(relativeVolume) ? relativeVolume : 0,
    volumeTrend,
    highVolumeCandles,
    volumeExpansion,
    volumeConfirmed,

    currentBarVolume: last.volume ?? null,
    priorBarVolume: prev.volume ?? null,
    currentVsPriorVolumeRatio:
      last.volume != null && prev.volume != null && Number(prev.volume) > 0
        ? Number((Number(last.volume) / Number(prev.volume)).toFixed(2))
        : null,
    volumeIncreasing:
      last.volume != null && prev.volume != null
        ? Number(last.volume) > Number(prev.volume)
        : false,
    recentBarsUsed: Array.isArray(bars) ? bars.length : null,
    usedFastReactionCandles,
    usedTenMinuteFallback,

    fastReactionState,
    fastReactionQuality,
    fastReactionDirection: intendedDirection,

    supportsFastReactionDirection,
    participationImproving,
    reclaimVolumeConfirmed,
    rejectionVolumeConfirmed,
    highVolumeNoProgress,
    absorptionRisk,
    climacticRisk,

    requiresEngine6PaperApproval: true,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers,
    reasonCodes,
  };
}

function attachEngine4FastImbalanceParticipationToConfluence({
  patchedConfluence,
  engine22WaveStrategy = null,
  bars = [],
}) {
 const fastImbalanceParticipation = buildEngine4FastImbalanceParticipation({
   patchedConfluence,
   engine22WaveStrategy,
   bars,
 });

  if (!fastImbalanceParticipation) return patchedConfluence;

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.volume = {
    ...(patchedConfluence.context.volume || {}),
    engine4FastImbalanceParticipation: fastImbalanceParticipation,
  };

  return patchedConfluence;
}

function buildEngine4CurrentScalpParticipation({
  patchedConfluence,
  engine22WaveStrategy = null,
  engine26StructuralContext = null,
  bars = [],
} = {}) {
  const reactionContext = patchedConfluence?.context?.reaction || null;
  const volumeContext = patchedConfluence?.context?.volume || null;
  const waveContext = buildEngine4WaveContextFromDegreeStates(engine22WaveStrategy);
  const locationContext = engine26StructuralContext?.locationContext || null;

  const insideShortWatchZoneAcceptanceTest =
    locationContext?.active === true &&
    locationContext?.locationRead === "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST" &&
    locationContext?.handoff?.engine4ShouldTreatInsideShortZoneAs ===
      "WAIT_FOR_DIRECTIONAL_PARTICIPATION";

  const shortTriggerLevel = validPrice(locationContext?.shortTriggerLevel);
  const locationInvalidationLevel = validPrice(locationContext?.invalidationLevel);

  const fastReaction =
    reactionContext?.engine3FastImbalanceReaction || null;

  const paperReaction =
    reactionContext?.paperScalpReaction || null;

  const currentLevelAction =
    reactionContext?.currentLevelAction ||
    paperReaction?.currentLevelAction ||
    null;

  const sourceReaction =
    fastReaction?.active === true
      ? fastReaction
      : paperReaction?.active === true
      ? paperReaction
      : currentLevelAction?.active === true
      ? currentLevelAction
      : null;

  const sourceName =
    fastReaction?.active === true
      ? "confluence.context.reaction.engine3FastImbalanceReaction"
      : paperReaction?.active === true
      ? "confluence.context.reaction.paperScalpReaction"
      : currentLevelAction?.active === true
      ? "confluence.context.reaction.currentLevelAction"
      : "marketMeter.layers.emaPosture.tenMinute.bars";

  const lastRaw =
    sourceReaction?.lastCandle ||
    sourceReaction?.currentLevelAction?.lastCandle ||
    currentLevelAction?.lastCandle ||
    bars[bars.length - 1] ||
    {};

  const prevRaw =
    sourceReaction?.priorCandle ||
    sourceReaction?.currentLevelAction?.priorCandle ||
    currentLevelAction?.priorCandle ||
    bars[bars.length - 2] ||
    {};

  const last = barPartsForPullbackReaction(lastRaw);
  const prev = barPartsForPullbackReaction(prevRaw);

  const flags = volumeContext?.flags || {};
  const volumeReasonCodes = Array.isArray(volumeContext?.reasonCodes)
    ? volumeContext.reasonCodes
    : [];

  const volumeScore = Number(volumeContext?.volumeScore ?? 0);
  const volumeConfirmed = volumeContext?.volumeConfirmed === true;

  const relativeVolume = Number(flags?.relativeVolume ?? 0);
  const highVolumeCandles = Number(flags?.highVolumeCandles ?? 0);
  const volumeTrend = flags?.volumeTrend || null;

  const currentBarVolume = last.volume ?? null;
  const priorBarVolume = prev.volume ?? null;

  const currentVsPriorVolumeRatio =
    currentBarVolume != null &&
    priorBarVolume != null &&
    Number(priorBarVolume) > 0
      ? Number((Number(currentBarVolume) / Number(priorBarVolume)).toFixed(2))
      : null;

  const volumeIncreasing =
    currentBarVolume != null &&
    priorBarVolume != null
      ? Number(currentBarVolume) > Number(priorBarVolume)
      : false;

  const volumeExpansion =
    flags?.volumeExpansion === true ||
    volumeReasonCodes.includes("BURST_VOLUME_ABOVE_1_35_AVG") ||
    volumeScore >= 10 ||
    relativeVolume >= 1.35 ||
    currentVsPriorVolumeRatio >= 1.25;

  const absorptionRisk = flags?.absorptionRisk === true;
  const climacticRisk = flags?.climacticVolume === true;

  const intendedDirection = String(
    sourceReaction?.direction ||
      paperReaction?.direction ||
      currentLevelAction?.direction ||
      "NEUTRAL"
  ).toUpperCase();

  const reactionState = String(
    sourceReaction?.state ||
      currentLevelAction?.state ||
      "NO_SCALP_REACTION"
  ).toUpperCase();

  const reactionQuality = String(
    sourceReaction?.quality ||
      currentLevelAction?.quality ||
      "WEAK"
  ).toUpperCase();

  const currentPrice =
    validPrice(sourceReaction?.currentPrice) ??
    validPrice(sourceReaction?.fastImbalanceReaction?.currentPrice) ??
    validPrice(sourceReaction?.fastImbalanceReaction?.lastCandle?.close) ??
    validPrice(sourceReaction?.currentLevelAction?.currentPrice) ??
    validPrice(sourceReaction?.currentLevelAction?.lastCandle?.close) ??
    validPrice(currentLevelAction?.currentPrice) ??
    validPrice(currentLevelAction?.lastCandle?.close) ??
    validPrice(last.close) ??
    validPrice(patchedConfluence?.price) ??
    validPrice(patchedConfluence?.currentPrice) ??
    null;

  const greenCandle =
    last.open != null &&
    last.close != null &&
    last.close > last.open;

  const redCandle =
    last.open != null &&
    last.close != null &&
    last.close < last.open;

  const higherClose =
    prev.close != null &&
    last.close != null &&
    last.close > prev.close;

  const lowerClose =
    prev.close != null &&
    last.close != null &&
    last.close < prev.close;

const longSupportingState =
  reactionState.includes("ACCEPTING") ||
  reactionState.includes("RECLAIM") ||
  reactionState.includes("HELD") ||
  reactionState.includes("DIP_BOUGHT") ||
  reactionState.includes("SELLERS_TRAPPED");

const shortSupportingState =
  reactionState.includes("REJECTING") ||
  reactionState.includes("FAILING") ||
  reactionState.includes("FAILED_RECLAIM") ||
  reactionState.includes("LOST") ||
  reactionState.includes("BREAKOUT_FAILING");

const supportsDirection =
  intendedDirection === "LONG"
    ? longSupportingState || (greenCandle && higherClose)
    : intendedDirection === "SHORT"
    ? shortSupportingState || (redCandle && lowerClose)
    : false;

const againstDirection =
  intendedDirection === "LONG"
    ? redCandle && lowerClose && !longSupportingState
    : intendedDirection === "SHORT"
    ? greenCandle && higherClose && !shortSupportingState
    : false;

  const participationImproving =
    volumeIncreasing === true ||
    volumeExpansion === true ||
    currentVsPriorVolumeRatio >= 1.15 ||
    relativeVolume >= 1.0 ||
    highVolumeCandles >= 1;

  const highVolumeNoProgress =
    volumeExpansion === true &&
    supportsDirection !== true;

  const shortRejectionState =
    reactionState.includes("BREAKOUT_FAILING") ||
    reactionState.includes("REJECTING") ||
    reactionState.includes("FAILED_RECLAIM") ||
    reactionState.includes("LOST");

  const shortDirectionalClimax =
    intendedDirection === "SHORT" &&
    shortRejectionState === true &&
    supportsDirection === true &&
    againstDirection !== true &&
    volumeExpansion === true &&
    (
      volumeConfirmed === true ||
      relativeVolume >= 1.35 ||
      currentVsPriorVolumeRatio >= 1.5
    ) &&
    absorptionRisk !== true;
  const reclaimedAboveShortInvalidation =
    locationContext?.active === true &&
    locationContext?.locationRead === "SHORT_WATCH_RECLAIM_INVALIDATION_RISK" &&
    locationContext?.recentBehavior?.reclaimedAboveZone === true &&
    intendedDirection === "LONG" &&
    locationInvalidationLevel != null &&
    currentPrice != null &&
    currentPrice > locationInvalidationLevel &&
    supportsDirection === true &&
    againstDirection !== true &&
    absorptionRisk !== true;

  const longBounceInsideShortWatchZone =
    insideShortWatchZoneAcceptanceTest === true &&
    intendedDirection === "LONG" &&
    reclaimedAboveShortInvalidation !== true;  

  const climacticHardBlock =
    climacticRisk === true &&
    shortDirectionalClimax !== true &&
    longBounceInsideShortWatchZone !== true &&
    reclaimedAboveShortInvalidation !== true;

  const hardBlocked =
    absorptionRisk === true ||
    climacticHardBlock === true ||
    highVolumeNoProgress === true ||
    (
      againstDirection === true &&
      (
        volumeExpansion === true ||
        currentVsPriorVolumeRatio >= 1.25 ||
        relativeVolume >= 1.25 ||
        highVolumeCandles >= 1
      )
    );
  let allowed = false;
  let downgradeOnly = true;
  let participationState = "WAIT_FOR_PARTICIPATION";
  let participationQuality = "WEAK";
  let grade = "D";
  let risk = "WAIT_FOR_PARTICIPATION";
  let direction = "NEUTRAL";

  const blockers = [];
  const reasonCodes = [
    "PAPER_ONLY_RESEARCH_LANE",
    "ENGINE4_CURRENT_SCALP_PARTICIPATION",
    "CURRENT_SCALP_VOLUME_READ",
    "NO_REAL_PERMISSION_CREATED",
    "NO_EXECUTION",
    "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
  ];

  if (hardBlocked) {
    allowed = false;
    downgradeOnly = false;
    participationState = "CURRENT_SCALP_VOLUME_RISK";
    participationQuality = "RISK";
    grade = "F";
    risk = "DANGEROUS_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("ENGINE4_CURRENT_SCALP_VOLUME_HARD_BLOCKED");
    reasonCodes.push("CURRENT_SCALP_VOLUME_RISK_PRESENT");

    if (absorptionRisk) reasonCodes.push("ABSORPTION_RISK");
    if (climacticRisk) reasonCodes.push("CLIMACTIC_RISK");
    if (highVolumeNoProgress) reasonCodes.push("HIGH_VOLUME_NO_PROGRESS");
    if (againstDirection) reasonCodes.push("VOLUME_AGAINST_TRADE_DIRECTION");
  } else if (longBounceInsideShortWatchZone) {
    allowed = false;
    downgradeOnly = true;
    participationState = "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST";
    participationQuality = "MIXED";
    grade = "D";
    risk = "WAIT_FOR_DIRECTIONAL_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("ENGINE26_SHORT_WATCH_ZONE_ACCEPTANCE_TEST");
    reasonCodes.push("ENGINE26_LOCATION_CONTEXT_CONSUMED");
    reasonCodes.push("INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST");
    reasonCodes.push("BOUNCE_INSIDE_SHORT_WATCH_ZONE_NOT_LONG_PERMISSION");
    reasonCodes.push("WAIT_FOR_FAILED_ACCEPTANCE_OR_LEVEL_LOSS");
    if (shortTriggerLevel != null) {
      reasonCodes.push("SHORT_TRIGGER_LEVEL_DEFINED");
    }
    if (locationInvalidationLevel != null) {
      reasonCodes.push("SHORT_INVALIDATION_LEVEL_DEFINED");
    }
  } else if (reclaimedAboveShortInvalidation) {
    allowed = false;
    downgradeOnly = true;
    participationState = "BUYER_RECLAIM_ABOVE_SHORT_INVALIDATION";
    participationQuality = "MIXED";
    grade = "C";
    risk = "SHORT_WATCH_INVALIDATION_WAIT_FOR_HOLD";
    direction = "NEUTRAL";

    blockers.push("ENGINE26_SHORT_WATCH_RECLAIM_INVALIDATION_RISK");
    reasonCodes.push("ENGINE26_LOCATION_CONTEXT_CONSUMED");
    reasonCodes.push("BUYER_RECLAIM_ABOVE_SHORT_INVALIDATION");
    reasonCodes.push("SHORT_WATCH_WEAKENING_WAIT_FOR_HOLD");
    reasonCodes.push("CLIMACTIC_VOLUME_NOT_HARD_BLOCKED_DIRECTIONAL_RECLAIM");
  } else if (shortDirectionalClimax) {
    allowed = true;
    downgradeOnly = true;
    participationState = "SHORT_REJECTION_VOLUME_CONFIRMED";
    participationQuality = "MIXED";
    grade = "B";
    risk = climacticRisk === true
      ? "CLIMACTIC_BUT_DIRECTIONAL_PAPER_ONLY"
      : "ACCEPTABLE_FOR_PAPER_REVIEW";
    direction = intendedDirection;

    reasonCodes.push("SHORT_REJECTION_VOLUME_CONFIRMED");
    reasonCodes.push("CLIMACTIC_VOLUME_DIRECTIONALLY_CONFIRMED");
    reasonCodes.push("ENGINE3_SHORT_REJECTION_CONFIRMED_BY_VOLUME");
    reasonCodes.push("PAPER_ONLY_ENGINE6_STILL_DECIDES");
  } else if (
    supportsDirection &&
    participationImproving &&
    ["GOOD", "STRONG"].includes(reactionQuality)
  ) {
    allowed = true;
    downgradeOnly = true;
    participationState = "CURRENT_SCALP_PARTICIPATION_OK";
    participationQuality = "MIXED";
    grade = reactionQuality === "STRONG" ? "B" : "C";
    risk = "ACCEPTABLE_FOR_PAPER_REVIEW";
    direction = intendedDirection;

    reasonCodes.push("CURRENT_SCALP_PARTICIPATION_SUPPORTS_DIRECTION");
    reasonCodes.push("PARTICIPATION_IMPROVING");
  } else if (supportsDirection) {
    allowed = false;
    downgradeOnly = true;
    participationState = "PRICE_ACTION_OK_VOLUME_NOT_READY";
    participationQuality = "WEAK";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("ENGINE4_CURRENT_SCALP_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("PRICE_ACTION_SUPPORTS_DIRECTION");
    reasonCodes.push("VOLUME_NOT_READY");
  } else if (currentVsPriorVolumeRatio != null && currentVsPriorVolumeRatio < 0.9) {
    allowed = false;
    downgradeOnly = true;
    participationState = "WEAK_LOW_VOLUME_PARTICIPATION";
    participationQuality = "WEAK";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("ENGINE4_CURRENT_SCALP_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("CURRENT_VOLUME_BELOW_PRIOR_VOLUME");
  } else {
    allowed = false;
    downgradeOnly = true;
    participationState = "NO_CURRENT_SCALP_PARTICIPATION";
    participationQuality = "WEAK";
    grade = "D";
    risk = "WAIT_FOR_PARTICIPATION";
    direction = "NEUTRAL";

    blockers.push("ENGINE4_CURRENT_SCALP_PARTICIPATION_NOT_CONFIRMED");
    reasonCodes.push("PARTICIPATION_NOT_READY_FOR_PAPER");
  }

  return {
    active: true,
    engine: "engine4.currentScalpParticipation.v1",
    mode: "CURRENT_SCALP_VOLUME",
    paperOnly: true,
    researchOnly: true,

    source: sourceName,
    waveContext,
    allowed,
    hardBlocked,
    downgradeOnly,

    intendedDirection,
    direction,

    participationState,
    participationQuality,
    grade,
    risk,

    currentPrice,

    currentBarVolume,
    priorBarVolume,
    currentVsPriorVolumeRatio,
    volumeIncreasing,

    volumeScore,
    relativeVolume: Number.isFinite(relativeVolume) ? relativeVolume : 0,
    volumeTrend,
    highVolumeCandles,
    volumeExpansion,
    volumeConfirmed,

    fastImbalanceActive: fastReaction?.active === true,
    paperScalpActive: paperReaction?.active === true,
    currentLevelActionActive: currentLevelAction?.active === true,

    reactionState,
    reactionQuality,
    reactionDirection: intendedDirection,

    supportsDirection,
    againstDirection,
    participationImproving,
    highVolumeNoProgress,
    shortRejectionState,
    shortDirectionalClimax,
    climacticHardBlock,

    locationContext,
    insideShortWatchZoneAcceptanceTest,
    shortTriggerLevel,
    locationInvalidationLevel,
    reclaimedAboveShortInvalidation,
    longBounceInsideShortWatchZone,

    absorptionRisk,
    climacticRisk,

    lastCandle: last,
    priorCandle: prev,

    requiresEngine6PaperApproval: true,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers,
    reasonCodes,
  };
}

function attachEngine4CurrentScalpParticipationToConfluence({
  patchedConfluence,
  engine22WaveStrategy = null,
  engine26StructuralContext = null,
  bars = [],
}) {
  const currentScalpParticipation = buildEngine4CurrentScalpParticipation({
    patchedConfluence,
    engine22WaveStrategy,
    engine26StructuralContext,
    bars,
  });

  if (!currentScalpParticipation) return patchedConfluence;

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.volume = {
    ...(patchedConfluence.context.volume || {}),
    engine4CurrentScalpParticipation: currentScalpParticipation,
  };

  return patchedConfluence;
}

/* -----------------------------
   Build one strategy
------------------------------*/
async function processStrategy(
  s,
  momentum,
  marketMind,
  marketMeter,
  marketRegime,
  engine16,
  engine2State,
  spyReactionQuality = null,
  spyVolumeBehavior = null,
  engine25Context = null
) {

let contextResp = null;
let engine1Context = null;

if (isFuturesSymbol(symbol)) {
  contextResp = await fetchJson(
    `${CORE_BASE}/api/v1/es-smz-shelves?symbol=${encodeURIComponent(symbol)}`,
    30000
  );

  engine1Context = normalizeEsEngine1Context(
    contextResp?.json || {
      ok: false,
      symbol,
      levels: [],
      meta: {},
      error: contextResp?.text || "no_es_context",
    }
  );
} else {
  contextResp = await fetchJson(
    `${CORE_BASE}/api/v1/engine5-context?symbol=${symbol}&tf=${s.tf}`,
    30000
  );

  engine1Context =
    contextResp?.json ||
    { ok: false, status: contextResp?.status || 0, error: contextResp?.text || "no_context" };
}

  const price = Number(engine1Context?.meta?.current_price ?? NaN);
  const strategyMode = modeFromStrategyId(s.strategyId);

  let execZoneRef = Number.isFinite(price)
    ? pickActiveExecutionZone(engine1Context, price)
    : null;

  let execZoneRefSource = "ACTIVE";

  if (!execZoneRef && strategyMode === "scalp") {
    const ns = engine1Context?.nearest?.shelf ?? null;
    if (ns && ns.lo != null && ns.hi != null) {
      execZoneRef = ns;
      execZoneRefSource = "NEAREST_SHELF_SCALP_REF";
    }
  }

  const zoneId = execZoneRef?.id ?? null;
  const zoneLo = execZoneRef?.lo ?? null;
  const zoneHi = execZoneRef?.hi ?? null;

  const fib = await fetchFibLevels({
    symbol,
    tf: s.tf,
    degree: s.degree,
    wave: s.wave,
  }).catch(() => ({
    ok: false,
    reason: "ENGINE2_UNAVAILABLE",
    message: "builder_fib_fetch_failed",
    meta: { symbol, tf: s.tf, degree: s.degree, wave: s.wave, generated_at_utc: null },
    anchors: null,
    signals: { invalidated: false, inRetraceZone: false, near50: false, tag: null },
  }));

  const reaction = await fetchReaction({
    symbol,
    tf: s.tf,
    strategyId: s.strategyId,
    zoneId,
    zoneLo,
    zoneHi,
  });

  const volume = await fetchVolume({
    symbol,
    tf: s.tf,
    zoneLo,
    zoneHi,
    mode: strategyMode,
  });

  let confluence = computeConfluenceScore({
    symbol,
    tf: s.tf,
    degree: s.degree,
    wave: s.wave,
    price: Number.isFinite(price) ? price : null,
    engine1Context,
    fib,
    reaction,
    volume,
    strategyId: s.strategyId,
    mode: strategyMode,
    zoneRefOverride: execZoneRef
      ? {
          id: execZoneRef.id ?? null,
          lo: execZoneRef.lo ?? null,
          hi: execZoneRef.hi ?? null,
          mid: execZoneRef.mid ?? null,
          strength: execZoneRef.strength ?? null,
          type: execZoneRef.type ?? null,
          zoneType:
            execZoneRefSource === "ACTIVE"
              ? (
                  engine1Context?.active?.negotiated ? "NEGOTIATED" :
                  engine1Context?.active?.shelf ? "SHELF" :
                  engine1Context?.active?.institutional ? "INSTITUTIONAL" :
                  null
                )
              : "SHELF",
        }
      : null,
    zoneRefSource: execZoneRefSource,
  });

  keepAliveNoZone(confluence);

  confluence.strategyId = confluence.strategyId ?? s.strategyId;
  confluence.mode = confluence.mode ?? strategyMode;
  confluence.zoneRefSource = confluence.zoneRefSource ?? execZoneRefSource;
  confluence.volumeState = confluence.volumeState ?? volumeStateFromEngine4(volume, execZoneRef);

  confluence.engine2 = confluence.engine2 || {};
  confluence.engine2.anchorTag = fib?.signals?.tag ?? null;
  confluence.engine2.invalidated = fib?.signals?.invalidated ?? false;
  confluence.engine2.inRetraceZone = fib?.signals?.inRetraceZone ?? false;
  confluence.engine2.near50 = fib?.signals?.near50 ?? false;
  confluence.engine2.request = { tf: s.tf, degree: s.degree, wave: s.wave };

  confluence.context = confluence.context || {};
  confluence.context.activeZone =
    confluence.context.activeZone ||
    (execZoneRef
      ? {
          id: execZoneRef.id ?? null,
          zoneType:
            execZoneRefSource === "ACTIVE"
              ? (
                  engine1Context?.active?.negotiated ? "NEGOTIATED" :
                  engine1Context?.active?.shelf ? "SHELF" :
                  engine1Context?.active?.institutional ? "INSTITUTIONAL" :
                  null
                )
              : "SHELF",
          lo: execZoneRef.lo ?? null,
          hi: execZoneRef.hi ?? null,
          mid: execZoneRef.mid ?? null,
          strength: execZoneRef.strength ?? null,
          source: execZoneRefSource,
        }
      : null);

  confluence.context.fib = {
    meta: fib?.meta ?? null,
    anchors: fib?.anchors?.waveMarks ?? fib?.anchors ?? null,
    signals: fib?.signals ?? null,
  };

  confluence.context.reaction = {
  stage: reaction?.stage ?? "IDLE",
  armed: reaction?.armed ?? false,
  reactionScore: Number(reaction?.reactionScore ?? 0),
  confirmed: reaction?.confirmed === true,
  structureState: reaction?.structureState ?? "HOLD",
  reasonCodes: Array.isArray(reaction?.reasonCodes) ? reaction.reasonCodes : [],
  waveReaction: reaction?.waveReaction || null,
};

  confluence.context.volume = {
    volumeScore: Number(volume?.volumeScore ?? 0),
    volumeConfirmed: volume?.volumeConfirmed === true,
    flags: volume?.flags ?? {},
    state: confluence.volumeState,
    reasonCodes: Array.isArray(volume?.reasonCodes) ? volume.reasonCodes : [],
  };

  confluence.context.engine1 = {
    meta: engine1Context?.meta ?? null,
    active: engine1Context?.active ?? null,
    nearest: engine1Context?.nearest ?? null,
    render: engine1Context?.render ?? null,
  };

const patchedConfluence =
  contextResp?.ok !== false && engine1Context
    ? applyNearAllowedZoneDisplay({ confluence, ctx: engine1Context })
    : confluence;

const engine5Analytics = buildEngine5Analytics(patchedConfluence);

const analytics = {
  engine5: engine5Analytics,
};

const zoneContext = buildZoneContext(
    engine1Context,
    patchedConfluence?.location || null
  );

  const permissionBody = {
    symbol,
    tf: s.tf,
    strategyType:
      patchedConfluence?.strategyType ||
      engine16?.strategyType ||
      "UNKNOWN",
    engine5: normalizeEngine5ForEngine6(patchedConfluence),
    marketMeter: null,
    marketRegime,
    zoneContext,
    intent: { action: "NEW_ENTRY" },
    };

  const permissionResp = await postJson(
    `${CORE_BASE}/api/v1/trade-permission`,
    permissionBody,
    30000
  );

  const permissionPreliminary =
  permissionResp?.json || {
    ok: false,
    status: permissionResp?.status || 0,
    error: permissionResp?.text || "no_permission",
  };

  const permissionV2Body = {
    symbol,
    strategyId: s.strategyId,
    market: marketMind,
    setup: {
      setupScore: Number(patchedConfluence?.scores?.total) || Number(patchedConfluence?.total) || 0,
      label: patchedConfluence?.scores?.label || patchedConfluence?.label || "D",
      invalid: Boolean(patchedConfluence?.invalid),
    },
  };

  const permissionV2Resp = await postJson(
    `${CORE_BASE}/api/v1/trade-permission-v2`,
    permissionV2Body,
    30000
  );

  const bucket = bucketForStrategyId(s.strategyId);
  const map = bucket ? ENGINE2_MAP[bucket] : null;

  let engine2 = null;
  if (map) {
    try {
      engine2 = await buildEngine2Block({
        symbol,
        degree: map.degree,
        tf: map.tf,
      });
    } catch {
      engine2 = {
        degree: map.degree,
        tf: map.tf,
        ok: false,
        waveRequested: null,
        fibScore: 0,
        invalidated: false,
        phase: "UNKNOWN",
        lastMark: null,
        nextMark: null,
        marksPresent: [],
        anchorTag: null,
        error: "ENGINE2_ATTACH_FAILED",
      };
    }
  }

  let engine22Scalp = null;
  let engine22WaveStrategy = null;
  let engine23Interpretation = null;

  let engine26LocationCandidate = null;
  let engine26ReactionHandoff = null;

  const isEsSubminuteScalp =
    String(symbol || "").toUpperCase() === "ES" &&
    s.strategyId === "subminute_scalp@10m";

  const isEsIntradayScalp =
    String(symbol || "").toUpperCase() === "ES" &&
    s.strategyId === "intraday_scalp@10m";

  if (s.strategyId === "intraday_scalp@10m" && s.tf === "10m") {
    // Engine 22 Lifecycle source-of-truth handoff:
    // Build the FULL Engine 2 state here and pass that same object into
    // both the legacy scalp compatibility read and the new wave strategy.
    //
    // Do not rely on the per-strategy Engine 2 block named `engine2`.
    // Engine 22 lifecycle needs the full degree stack:
    // primary / intermediate / minor / minute / micro.
    let engine22Engine2State = null;

    try {
      engine22Engine2State = await buildEngine2State(symbol);
    } catch (err) {
      console.error("[E22 ENGINE2 STATE BUILD ERROR]", err);
      engine22Engine2State = null;
    }

    try {
      engine22Scalp = computeEngine22ScalpOpportunity({
        symbol,
        strategyId: s.strategyId,
        tf: s.tf,
        engine16,
        reaction: patchedConfluence?.context?.reaction || null,
        waveReaction: reaction?.waveReaction || null,
        engine2State: engine22Engine2State,
        marketMind,
        marketMeter,

        reactionContext:
          patchedConfluence?.context?.reaction ||
          spyReactionQuality?.engine3Reaction ||
          spyReactionQuality ||
          null,

        volumeContext:
          patchedConfluence?.context?.volume ||
          spyVolumeBehavior?.engine4Volume ||
          spyVolumeBehavior ||
          null,

        engine1Context,
      });
    } catch (err) {
      console.error("[E22 PRE-ENGINE15 SCALP ERROR]", err);

      engine22Scalp = {
        ok: false,
        engine: "engine22.scalpOpportunity.v5.2",
        active: false,
        mode: "OBSERVATION_ONLY",
        symbol,
        strategyId: s.strategyId,
        tf: s.tf,
        state: "ENGINE22_PRE_ENGINE15_ERROR",
        status: "NO_SCALP",
        readiness: "WAIT",
        setupType: "ENGINE22_PRE_ENGINE15_ERROR",
        type: "ENGINE22_PRE_ENGINE15_ERROR",
        direction: "NONE",
        needs: "FIX_ENGINE22_PRE_ENGINE15_ERROR",
        allowLongEntry: false,
        allowShort: false,
        allowShortEntry: false,
        triggerConfirmed: false,
        reasonCodes: ["ENGINE22_PRE_ENGINE15_SCALP_FAILED"],
        debug: {
          error: String(err?.message || err),
          stack: String(err?.stack || ""),
        },
      };
    }

    try {
      engine22WaveStrategy = buildEngine22WaveStrategy({
        symbol,
        strategyId: s.strategyId,
        tf: s.tf,
        engine2State: engine22Engine2State,

        // IMPORTANT:
        // Pre-Engine15 build. Engine 22 waveOpportunity must be independent
        // from Engine 15. TradeDecision/timeline can be enriched later.
        engine15: null,

        engine16,
        marketMeter,
        regimeLayers: engine22Scalp?.regimeLayers || null,

        // Engine 22F read-only supportive context.
        // Used only for WATCH -> ARMING lifecycle.
        // Must not create READY, GO, ALLOW, or execution.
        engine25Context,
        marketRegime,
        marketMeterContext: marketMind || null,
        engine5: engine5Analytics || patchedConfluence || null,

        reactionContext:
          patchedConfluence?.context?.reaction ||
          spyReactionQuality?.engine3Reaction ||
          spyReactionQuality ||
          null,

        volumeContext:
          patchedConfluence?.context?.volume ||
          spyVolumeBehavior?.engine4Volume ||
          spyVolumeBehavior ||
          null,

        breakoutContext: engine22Scalp?.breakoutContext || null,

        barsByTf: {
          "10m": marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
          "1h": marketMeter?.layers?.emaPosture?.oneHour?.bars || [],
          "4h": marketMeter?.layers?.emaPosture?.fourHour?.bars || [],
          "1d": marketMeter?.layers?.emaPosture?.daily?.bars || [],
        },
      });

      engine22WaveStrategy =
        applyEngine22CurrentLifecycleStateContract(engine22WaveStrategy);
attachEngine22PullbackReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
});

attachEngine22LifecycleReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
});

attachCurrentLevelActionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine25Context,
  engine1Context,
  bars10m: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
  bars30m: [],
});

attachFastImbalanceReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars10m: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
});

attachEngine4FastImbalanceParticipationToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
});

attachPaperScalpReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine26ReactionHandoff,
  paperShortResearchEnabled: isEsIntradayScalp,
});

attachEngine4CurrentScalpParticipationToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
});

engine22WaveStrategy = {
  ...engine22WaveStrategy,
  currentLifecycleState: enrichCurrentLifecycleWithLivePriceAction({
    currentLifecycleState: engine22WaveStrategy?.currentLifecycleState || null,
    currentLevelAction:
      patchedConfluence?.context?.reaction?.currentLevelAction || null,
  }),
};

attachEngine22LifecycleParticipationToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
});
attachEngine4AuthorizedReactionParticipation({
  patchedConfluence,
});      
    } catch (err) {
      console.error("[E22 PRE-ENGINE15 WAVE ERROR]", err);

      engine22WaveStrategy = {
        ok: false,
        engine: "engine22.waveStrategy.v1",
        mode: "READ_ONLY",
        symbol,
        strategyId: s.strategyId,
        tf: s.tf,
        state: "ENGINE22_PRE_ENGINE15_WAVE_ERROR",
        reasonCodes: ["ENGINE22_PRE_ENGINE15_WAVE_FAILED"],
        waveOpportunity: {
          ok: false,
          engine: "engine22.waveOpportunity.v1",
          symbol,
          strategyId: s.strategyId,
          active: false,
          setupFamily: "ELLIOTT_WAVE",
          setupType: "NONE",
          rawSetup: "ENGINE22_PRE_ENGINE15_WAVE_ERROR",
          degree: "unknown",
          direction: "NONE",
          readiness: "NO_SETUP",
          timing: "UNKNOWN",
          chaseRisk: "UNKNOWN",
          needs: ["FIX_ENGINE22_PRE_ENGINE15_WAVE_ERROR"],
          reasonCodes: ["ENGINE22_PRE_ENGINE15_WAVE_FAILED"],
          summary: "Engine 22 pre-Engine15 waveOpportunity failed.",
        },
        debug: {
          error: String(err?.message || err),
          stack: String(err?.stack || ""),
        },
      };
    }
  } 

  /*
   * Engine 26A — reaction-independent location discovery.
   *
   * This runs after Engine 22 structure exists and before the later
   * Engine 26 planner/permission stages.
   *
   * Engine 26A must not consume:
   * - Engine 3 reaction
   * - Engine 4 participation
   * - Engine 6 permission
   * - Engine 15 readiness
   */
  if (isEsIntradayScalp) {
    try {
      const engine26A = buildEngine26A({
        symbol,

        strategyId: s.strategyId,

        timeframe: s.tf,

        currentPrice:
          validPrice(price) ??
          validPrice(patchedConfluence?.price) ??
          validPrice(patchedConfluence?.currentPrice) ??
          validPrice(
            engine1Context?.meta?.current_price
          ) ??
          validPrice(
            engine1Context?.meta?.currentPrice
          ) ??
          validPrice(
            marketMeter?.layers?.emaPosture
              ?.tenMinute?.close
          ) ??
          validPrice(
            marketMeter?.layers?.tenMinute?.close
          ) ??
          null,

        snapshotTime: nowIso(),

        engine22WaveStrategy,

        engine25Context,

        engine1Context,

        tickSize: 0.25,
      });

      engine26LocationCandidate =
        engine26A?.engine26LocationCandidate ||
        null;

      engine26ReactionHandoff =
        engine26A?.engine26ReactionHandoff ||
        null;
    } catch (err) {
      console.error(
        "[ENGINE26A LOCATION DISCOVERY ERROR]",
        err
      );

      engine26LocationCandidate = {
        active: false,
        engine: "engine26.locationCandidate.v1",
        status: "WAITING_FOR_LOCATION",

        candidateId: null,
        zoneId: null,

        symbol,
        strategyId: s.strategyId,
        timeframe: s.tf,

        currentPrice:
          validPrice(price) ??
          validPrice(patchedConfluence?.price) ??
          validPrice(patchedConfluence?.currentPrice) ??
          validPrice(
            marketMeter?.layers?.emaPosture
              ?.tenMinute?.close
          ) ??
          validPrice(
            marketMeter?.layers?.tenMinute?.close
          ) ??
          null,
        snapshotTime: nowIso(),

        directionBias: "NEUTRAL",
        setupType: null,

        location: null,

        triggerLevel: null,
        acceptanceBoundary: null,
        reclaimBoundary: null,
        locationInvalidationBoundary: null,

        expectedReactions: [],

        reasonCodes: [
          "ENGINE26A_LOCATION_DISCOVERY_FAILED",
        ],

        warnings: [
          String(err?.message || err),
        ],

        noPermissionCreated: true,
        noExecution: true,
      };

      engine26ReactionHandoff = {
        active: false,
        engine: "engine26.reactionHandoff.v1",
        status: "WAITING_FOR_LOCATION",

        candidateId: null,
        zoneId: null,

        symbol,
        strategyId: s.strategyId,
        timeframe: s.tf,

        snapshotTime:
          engine26LocationCandidate.snapshotTime,

        tradeDirectionBias: "NEUTRAL",
        expectedReactionDirection: "NEUTRAL",
        setupType: null,

        expectedReactions: [],
        zone: null,

        triggerLevel: null,
        acceptanceBoundary: null,
        reclaimBoundary: null,
        locationInvalidationBoundary: null,

        authorizeEngine3Evaluation: false,

        reasonCodes: [
          "ENGINE26A_LOCATION_DISCOVERY_FAILED",
          "WAITING_FOR_ENGINE26_LOCATION",
        ],

        noPermissionCreated: true,
        noExecution: true,
      };
    }
  }

/*
 * Build the explicit authorized Engine 3 and Engine 4 contracts
 * after Engine 26A exists and before Engine 6 calculates permission.
 *
 * Existing Engine 3/4 algorithms and thresholds remain unchanged.
 */
if (isEsIntradayScalp) {
  attachPaperScalpReactionToConfluence({
    patchedConfluence,
    engine22WaveStrategy,
    engine26ReactionHandoff,
    paperShortResearchEnabled: isEsIntradayScalp,
  });

  attachEngine4AuthorizedReactionParticipation({
    patchedConfluence,
  });
}

  // Engine 23 preliminary behavior context.
  // IMPORTANT:
  // This must run BEFORE Engine 15ES so Engine 15ES can consume
  // behavior damage / no-chase / extension rejection context.
  // Engine 23 is read-only here. It must not create executable shorts.
  if (isEsIntradayScalp) {
    try {
      engine23Interpretation = interpretWaveEnvironment({
        symbol,
        price: Number.isFinite(price) ? price : null,
        engine22WaveStrategy,
        fib,
        engine2State,
        barsByTf: {
          "10m": marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
          "1h": marketMeter?.layers?.emaPosture?.oneHour?.bars || [],
          "4h": marketMeter?.layers?.emaPosture?.fourHour?.bars || [],
          "1d": marketMeter?.layers?.emaPosture?.daily?.bars || [],
        },
      });
    } catch (err) {
      console.error("[E23 PRE-ENGINE15 ERROR]", err);

      engine23Interpretation = {
        ok: false,
        engine: "engine23.waveBehaviorInterpreter.v1",
        mode: "READ_ONLY",
        symbol,
        environment: "UNKNOWN",
        state: "W5_UNKNOWN",
        health: "UNKNOWN",
        directionBias: "NEUTRAL",
        activeDegree: null,
        higherDegreeContext: null,
        chaseAllowed: false,
        preferredEntry: "WAIT_FOR_ENGINE23_PRE_ENGINE15_FIX",
        activeTargets: null,
        higherTargets: null,
        needs: ["FIX_ENGINE23_PRE_ENGINE15_ERROR"],
        reasonCodes: ["ENGINE23_PRE_ENGINE15_COMPUTE_FAILED"],
        summary: "Engine 23 failed while reading pre-Engine15 wave behavior.",
        debug: {
          error: String(err?.message || err),
          stack: String(err?.stack || ""),
        },
      };
    }
  } 

  // Engine 5 preliminary timing context.
  // This must exist before Engine 15ES runs.
  // Later, after Engine 22 / Engine 23 are built, the builder can enrich/replace
  // patchedConfluence.timingContext for final display.
  const preliminaryEngine5TimingContext = buildEngine5TimingContext({
    confluence: patchedConfluence,
    engine15Decision: null,
    engine22WaveStrategy: null,
    engine23Interpretation: null,
    engine16,
    permissionPreliminary,
    marketRegime,
    engine2State,
  });

  patchedConfluence.timingContext = preliminaryEngine5TimingContext;

  if (analytics?.engine5) {
    analytics.engine5.timingContext = preliminaryEngine5TimingContext;
  }

let engine26PrePermissionWatch = null;
let engine26StructuralContext = null;

if (isEsIntradayScalp) {
  try {
    engine26PrePermissionWatch = buildEngine26ImbalanceWatch({
      symbol,
      strategyId: s.strategyId,
      tf: s.tf,
      permission: null,
      engine22WaveStrategy,
      confluence: patchedConfluence,
      engine15Decision: null,
    });

    engine26StructuralContext =
      buildEngine26StructuralContext(engine26PrePermissionWatch);
  } catch (err) {
    console.error("[E26 PRE-ENGINE15 STRUCTURAL CONTEXT ERROR]", err);
    engine26PrePermissionWatch = null;
    engine26StructuralContext = null;
  }
}

  const engine15BaseInputs = {
    symbol,
    strategyId: s.strategyId,
    engine16,
    engine5: patchedConfluence || null,
    momentum,
    permission: permissionPreliminary,
    engine3: patchedConfluence?.context?.reaction || null,
    engine4: patchedConfluence?.context?.volume || null,
    waveReaction: reaction?.waveReaction || null,
    zoneContext,
  };
  const engine15Decision =
    String(symbol || "").toUpperCase() === "ES" &&
    s.strategyId === "intraday_scalp@10m"
      ? buildEngine15EsDecision({
          symbol,
          strategyId: s.strategyId,
           snapshotContext: {
             emaPosture: marketMeter?.layers?.emaPosture || null,
             engine2State,
             marketMind,
             marketMeter,
             marketRegime,

             // Pre-Engine15 wave opportunity from Engine 22.
             engine22WaveStrategy,
             waveOpportunity: engine22WaveStrategy?.waveOpportunity || null,

             // Pre-Engine15 Engine 23 behavior / no-chase context.
             // This is downgrade/context only. It must not create shorts.
             engine23Interpretation,
           },
          snapshotContext: {
            emaPosture: marketMeter?.layers?.emaPosture || null,
            engine2State,
            marketMind,
            marketMeter,
            marketRegime,

            // Pre-Engine15 wave opportunity from Engine 22.
            engine22WaveStrategy,
            waveOpportunity: engine22WaveStrategy?.waveOpportunity || null,

            // Pre-Engine15 Engine 23 behavior / no-chase context.
            // This is downgrade/context only. It must not create shorts.
            engine23Interpretation,

            // Pre-Engine15 Engine 26 structural context.
            // Canonical source for short structural watch / no-chase-long context.
            engine26StructuralContext,
          }, 
          engine16,
          engine5: patchedConfluence || null,
          momentum,
          permission: engine15BaseInputs.permission,
          engine3: patchedConfluence?.context?.reaction || null,
          engine4: patchedConfluence?.context?.volume || null,
          zoneContext,
        })
      : computeEngine15DecisionReferee(engine15BaseInputs);
if (isEsIntradayScalp) {
  try {
    engine26PrePermissionWatch = buildEngine26ImbalanceWatch({
      symbol,
      strategyId: s.strategyId,
      tf: s.tf,
      permission: null,
      engine22WaveStrategy,
      confluence: patchedConfluence,
      engine15Decision,
    });

    engine26StructuralContext =
      buildEngine26StructuralContext(engine26PrePermissionWatch) ||
      engine26StructuralContext;
  } catch (err) {
    console.error("[E26 PRE-PERMISSION WATCH ERROR]", err);
  }
}

 
const finalPermissionRaw =
  isEsIntradayScalp
    ? buildFinalPermissionFromEngine15({
        symbol,
        strategyId: s.strategyId,
        tf: s.tf,
        preliminaryPermission: permissionPreliminary,
        engine15Decision,
        marketRegime,
        zoneContext,
        engine5Analytics,
        engine25Context,
        engine22WaveStrategy,
        confluence: patchedConfluence,
        engine26ImbalanceWatch: engine26PrePermissionWatch,

        engine3AuthorizedReaction:
          patchedConfluence?.context?.reaction
            ?.paperScalpReaction || null,

        engine4AuthorizedParticipation:
          patchedConfluence?.context?.volume
            ?.engine4AuthorizedReactionParticipation || null,
      })
    : permissionPreliminary;

const finalPermission =
  isEsIntradayScalp
    ? preserveEngine6CandidateIdentity({
        permission: finalPermissionRaw,

        engine26LocationCandidate,

        engine3AuthorizedReaction:
          patchedConfluence?.context?.reaction
            ?.paperScalpReaction || null,

        engine4AuthorizedParticipation:
          patchedConfluence?.context?.volume
            ?.engine4AuthorizedReactionParticipation || null,
      })
    : finalPermissionRaw;

let engine26ImbalanceWatch = null;
let engine26PaperTradePlan = null;
let engine26PaperTradeTicket = null;
let engine26PaperTradeExecution = null;
let engine26TradePlanPreview = null;
let engine26ReplayMarker = null;
let engine26ProposedGeometry = null; 
let engine7SizingPreview = null;
let engine7PositionSizing = null; 

if (isEsIntradayScalp) {
  try {
    let openPaperTrades = [];

    try {
      const openPaperResp = await listTrades({
        symbol,
        strategyId: s.strategyId,
        status: "OPEN",
        accountMode: "PAPER",
      });

      openPaperTrades = Array.isArray(openPaperResp?.trades)
        ? openPaperResp.trades
        : [];
    } catch (err) {
      console.error("[E26 OPEN PAPER TRADE CHECK ERROR]", err);

      openPaperTrades = [];
    }

    const engine26 = buildEngine26PaperTradePlan({
      symbol,
      strategyId: s.strategyId,
      tf: s.tf,
      permission: finalPermission,
      engine22WaveStrategy,
      engine25Context,
      confluence: patchedConfluence,
      engine15Decision,

      // Engine 26A is the authoritative selected-location identity.
      engine26LocationCandidate,

      openPaperTrades,
      dailyBars:
        marketMeter?.layers?.emaPosture?.daily?.bars || [],
    });

    engine26ImbalanceWatch = engine26.engine26ImbalanceWatch || null;
    engine26StructuralContext = engine26.engine26StructuralContext || null;
    engine26PaperTradePlan = engine26.engine26PaperTradePlan || null;
    engine26PaperTradeTicket = engine26.engine26PaperTradeTicket || null;
    engine26TradePlanPreview = engine26.engine26TradePlanPreview || null;
    engine26TradePlanPreview = engine26.engine26TradePlanPreview || null;
    engine26ProposedGeometry =
      engine26.engine26ProposedGeometry || null;
    engine7SizingPreview =
      buildEngine7ProposedSizingPreview({
        engine26ProposedGeometry,

    engine6PaperPermission:
      finalPermission?.paper || null,

    engine27MinuteReadiness: null,

    riskConfig:
      ES_PAPER_RISK_CONFIG,

    snapshotTime:
      engine26ProposedGeometry?.snapshotTime ||
      nowIso(),
  });
    // V1 planner-only. Do not call Engine 8 from snapshot builder.
    engine26PaperTradeExecution = null;
    engine26ReplayMarker = buildEngine26ReplayMarker({
      symbol,
      strategyId: s.strategyId,
      engine26ImbalanceWatch,
      engine26StructuralContext,
      engine26PaperTradeTicket,
      engine26PaperTradeExecution,
      permission: finalPermission,
      confluence: patchedConfluence,
      engine15Decision,
    });
  } catch (err) {
    console.error("[E26 PAPER TRADE PLANNER ERROR]", err);

    engine26PaperTradePlan = {
      active: false,
      engine: "engine26.paperTradePlanner.v1",
      mode: "PAPER_ONLY",
      researchOnly: true,
      symbol,
      strategyId: s.strategyId,
      tf: s.tf,
      allowed: false,
      status: "NO_PAPER_TRADE",
      blockers: ["ENGINE26_PLANNER_FAILED"],
      reasonCodes: [
        "ENGINE26_PLANNER_FAILED",
        "NO_REAL_EXECUTION",
        "NO_ENGINE8_CALL_IN_SNAPSHOT_BUILD",
      ],
      debug: {
        error: String(err?.message || err),
        stack: String(err?.stack || ""),
      },
      noRealExecution: true,
      realExecutionAllowed: false,
      brokerExecutionAllowed: false,
      schwabExecutionAllowed: false,
      createdAt: new Date().toISOString(),
    };
    
    engine26StructuralContext = null;
    engine26PaperTradeTicket = null;
    engine26PaperTradeExecution = null;
  }
}

 const lockedSignal = updateSignalLock({
  symbol,
  strategyId: s.strategyId,
  signalEvent: engine15Decision?.signalEvent,
});
   
  const engine15 = computeEngine15Readiness({
    symbol,
    strategyId: s.strategyId,
    engine16,
    engine3: patchedConfluence?.context?.reaction || null,
    engine4: patchedConfluence?.context?.volume || null,
    engine5: patchedConfluence || null,
    engine15Decision: engine15Decision || null,
  });

  let executionBias = "NORMAL";

  if (engine15?.readiness === "EXHAUSTION_READY") {
    if (engine15?.direction === "SHORT") {
      executionBias = "SHORT_PRIORITY";
    } else if (engine15?.direction === "LONG") {
      executionBias = "LONG_PRIORITY";
    }
  }
      console.log("[E22 DEBUG]", {
        strategyId: s.strategyId,
        tf: s.tf,
        condition: s.strategyId === "intraday_scalp@10m" && s.tf === "10m",
      });

      if (s.strategyId === "intraday_scalp@10m" && s.tf === "10m") {
        try {
          engine22Scalp = computeEngine22ScalpOpportunity({
            symbol,
            strategyId: s.strategyId,
            tf: s.tf,
            engine16,
            reaction: patchedConfluence?.context?.reaction || null,
            waveReaction: reaction?.waveReaction || null,
            engine2State,
            marketMind,
            marketMeter,

           // Engine 3 reaction-quality route for Engine 22 timeline.
           reactionContext: spyReactionQuality?.engine3Reaction || spyReactionQuality || null,

           // Engine 4 volume-participation route for Engine 22 timeline.
          volumeContext: spyVolumeBehavior?.engine4Volume || spyVolumeBehavior || null,

          // Engine 1 negotiated-zone truth for Engine 22 zone absorption.
          engine1Context,
        });
       } catch (err) {
         console.error("[E22 ERROR]", err);

         engine22Scalp = {
           ok: false,
           engine: "engine22.scalpOpportunity.v5.2",
           active: false,
           mode: "OBSERVATION_ONLY",
           symbol,
           strategyId: s.strategyId,
           tf: s.tf,
           state: "ENGINE22_ERROR",
           status: "NO_SCALP",
           readiness: "WAIT",
           setupType: "ENGINE22_ERROR",
           type: "ENGINE22_ERROR",
           direction: "NONE",
           needs: "FIX_ENGINE22_ERROR",
           allowLongEntry: false,
           allowShort: false,
           allowShortEntry: false,
           triggerConfirmed: false,
           trendVsWave: null,
           zoneAbsorption: null,
           runnerMode: null,
           reasonCodes: ["ENGINE22_COMPUTE_FAILED"],
           debug: {
             error: String(err?.message || err),
             stack: String(err?.stack || ""),
           },
         };
        }
      }

     const engine15ForEngine22 =
       String(symbol || "").toUpperCase() === "ES" &&
       s.strategyId === "intraday_scalp@10m"
         ? engine15Decision
         : engine15;

    const reactionContextForEngine22 =
      patchedConfluence?.context?.reaction ||
      spyReactionQuality?.engine3Reaction ||
      spyReactionQuality ||
      null;

    const volumeContextForEngine22 =
      patchedConfluence?.context?.volume ||
      spyVolumeBehavior?.engine4Volume ||
      spyVolumeBehavior ||
      null;
   
if (s.strategyId === "intraday_scalp@10m" && s.tf === "10m") {
  try {
    // Do NOT rebuild Engine 22 wave strategy here.
    // The pre-Engine15 waveOpportunity is already built above and must remain source of truth.
    // Only enrich post-Engine15 / paper-only tradeDecision.
    if (engine22WaveStrategy && typeof engine22WaveStrategy === "object") {
      engine22WaveStrategy.tradeDecision = buildWaveTradeDecision({
        engine22WaveStrategy,
        engine15: engine15ForEngine22,
        engine16,
        reactionContext: reactionContextForEngine22,
        volumeContext: volumeContextForEngine22,
        symbol,
        strategyId: s.strategyId,
      });

      engine22WaveStrategy =
        applyEngine22CurrentLifecycleStateContract(engine22WaveStrategy);
     attachEngine22PullbackReactionToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
     }); 
     attachEngine22LifecycleReactionToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
     });
     attachCurrentLevelActionToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       engine25Context,
       engine1Context,
       bars10m: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
       bars30m: [],
     });

     attachFastImbalanceReactionToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       engine26StructuralContext,
       paperShortResearchEnabled: isEsIntradayScalp,
       bars10m: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
     });

     attachEngine4FastImbalanceParticipationToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
     });
     attachPaperScalpReactionToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       engine26ReactionHandoff,
       engine26StructuralContext,
       paperShortResearchEnabled: isEsIntradayScalp,
     });
     attachEngine4CurrentScalpParticipationToConfluence({
       patchedConfluence,
       engine22WaveStrategy,
       engine26StructuralContext,
       bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
     });
     engine22WaveStrategy = {
       ...engine22WaveStrategy,
       currentLifecycleState: enrichCurrentLifecycleWithLivePriceAction({
         currentLifecycleState: engine22WaveStrategy?.currentLifecycleState || null,
         currentLevelAction:
           patchedConfluence?.context?.reaction?.currentLevelAction || null,
      }),
    };

    attachEngine22LifecycleParticipationToConfluence({
      patchedConfluence,
      engine22WaveStrategy,
      bars: marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
    }); 
    attachEngine4AuthorizedReactionParticipation({
      patchedConfluence,
    });
      
    }
  } catch (err) {
    console.error("[E22G TRADE DECISION ERROR]", err);

    if (engine22WaveStrategy && typeof engine22WaveStrategy === "object") {
      engine22WaveStrategy.tradeDecision = {
        mode: "PAPER_ONLY",
        engine: "engine22.tradeDecision.safeFallback.v1",
        symbol,
        strategyId: s.strategyId,
        decision: "WAIT",
        direction: "NONE",
        setupType: engine22WaveStrategy?.waveOpportunity?.setupType || "NO_SETUP",
        grade: "NO_TRADE",
        entryAllowed: false,
        chaseAllowed: false,
        reason: "Trade decision enrichment failed safely.",
        needs: ["TRADE_DECISION_REVIEW"],
        reasonCodes: ["TRADE_DECISION_SAFE_FALLBACK"],
        debug: {
          error: String(err?.message || err),
          stack: String(err?.stack || ""),
        },
      };
    }
  }
}
      if (
        String(symbol || "").toUpperCase() === "ES" &&
        s.strategyId === "intraday_scalp@10m" &&
        s.tf === "10m"
      ) {
        try {

                  
          engine23Interpretation = interpretWaveEnvironment({
            symbol,
            price: Number.isFinite(price) ? price : null,
            engine22WaveStrategy,
            fib,
            engine2State,
            barsByTf: {
              "10m": marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
              "1h": marketMeter?.layers?.emaPosture?.oneHour?.bars || [],
              "4h": marketMeter?.layers?.emaPosture?.fourHour?.bars || [],
              "1d": marketMeter?.layers?.emaPosture?.daily?.bars || [],
            },
          });
                      
        } catch (err) {
          console.error("[E23 ERROR]", err);

          engine23Interpretation = {
            ok: false,
            engine: "engine23.waveBehaviorInterpreter.v1",
            mode: "READ_ONLY",
            symbol,
            environment: "UNKNOWN",
            state: "W5_UNKNOWN",
            health: "UNKNOWN",
            directionBias: "NEUTRAL",
            activeDegree: null,
            higherDegreeContext: null,
            chaseAllowed: false,
            preferredEntry: "WAIT_FOR_ENGINE23_FIX",
            activeTargets: null,
            higherTargets: null,
            needs: ["FIX_ENGINE23_ERROR"],
            reasonCodes: ["ENGINE23_COMPUTE_FAILED"],
            summary: "Engine 23 failed while reading Engine 22 wave behavior.",
            debug: {
              error: String(err?.message || err),
              stack: String(err?.stack || ""),
            },
          };
        }
      }

   const engine5TimingContext = buildEngine5TimingContext({
    confluence: patchedConfluence,
    engine15Decision,
    engine22WaveStrategy,
    engine23Interpretation,
  });

  patchedConfluence.timingContext = engine5TimingContext;

  if (analytics?.engine5) {
    analytics.engine5.timingContext = engine5TimingContext;
  }
     
   return {
    strategyId: s.strategyId,
    lockedSignal, 
    tf: s.tf,
    degree: s.degree,
    wave: s.wave,
    marketRegime,
    engine25Context,
    confluence: patchedConfluence,
    analytics,

    permissionPreliminary,

    permission: finalPermission,
     
    engine26LocationCandidate,
    engine26ReactionHandoff,

    engine26ImbalanceWatch,
    engine26StructuralContext,
    engine26TradePlanPreview,
    engine26PaperTradePlan,
    engine26PaperTradeTicket,
    engine26ProposedGeometry,
    engine7SizingPreview,
    engine26PaperTradeExecution,
    engine26ReplayMarker,

    engine6v2:
      isEsIntradayScalp
        ? {
            ...(permissionV2Resp?.json || {
              ok: false,
              status: permissionV2Resp?.status || 0,
              error: permissionV2Resp?.text || "no_v2",
            }),
            experimental: true,
            ignoredForES: true,
            authority: false,
            reason: "ENGINE6_V2_STALE_USES_ENGINE5_SCORE_NOT_ENGINE15",
          }
        : permissionV2Resp?.json || {
            ok: false,
            status: permissionV2Resp?.status || 0,
            error: permissionV2Resp?.text || "no_v2",
          },
    engine2,
    fibLevels: fib,
    engine16,
    engine22Scalp,
    engine22WaveStrategy,
    engine23Interpretation,
    engine15,
    engine15Decision,
    executionBias,
    momentum,
    context: engine1Context,
  };
}

async function buildEngine2State(symbol) {
  const contextResp = await fetchJson(
    `${CORE_BASE}/api/v1/engine5-context?symbol=${symbol}&tf=1h`,
    30000
  );

  const engine1Context = contextResp?.json || {};

  const contextPrice = Number(engine1Context?.meta?.current_price ?? NaN);

  const futuresPrice = isFuturesSymbol(symbol)
    ? await fetchCurrentPriceForSymbol({
        symbol,
        tf: "10m",
      }).catch(() => null)
    : null;

  const currentPrice =
    futuresPrice != null
      ? futuresPrice
      : Number.isFinite(contextPrice)
      ? contextPrice
      : null;

  const [primaryRaw, intermediateRaw, minorRaw, minuteRaw, microRaw] = await Promise.all([
    buildEngine2Block({ symbol, degree: "primary", tf: "1d", currentPrice }).catch(() => null),
    buildEngine2Block({ symbol, degree: "intermediate", tf: "1h", currentPrice }).catch(() => null),
    buildEngine2Block({ symbol, degree: "minor", tf: "1h", currentPrice }).catch(() => null),
    buildEngine2Block({ symbol, degree: "minute", tf: "10m", currentPrice }).catch(() => null),
    buildEngine2Block({ symbol, degree: "micro", tf: "10m", currentPrice }).catch(() => null),
  ]); 

  const intermediateLevelRows = getManualLevelRowsFor({
    symbol,
    degree: "intermediate",
  });

  const minorLevelRows = getManualLevelRowsFor({
    symbol,
    degree: "minor",
  });

  const minuteLevelRows = getManualLevelRowsFor({
    symbol,
    degree: "minute",
    tf: "10m",
  });

  const microLevelRows = getManualLevelRowsFor({
    symbol,
    degree: "micro",
    tf: "10m",
  });

  const intermediateWithLevels = attachManualLevelsToEngine2Block(
    intermediateRaw,
    intermediateLevelRows
  );

  const minorWithLevels = attachManualLevelsToEngine2Block(
    minorRaw,
    minorLevelRows
  );

  const minuteWithLevels = attachManualLevelsToEngine2Block(
    minuteRaw,
    minuteLevelRows
  );

  const microWithLevels = attachManualLevelsToEngine2Block(
    microRaw,
    microLevelRows
  );

  const primary = enrichEngine2BlockWithExtensions(primaryRaw);
  const intermediate = enrichEngine2BlockWithExtensions(intermediateWithLevels);
  const minor = enrichEngine2BlockWithExtensions(minorWithLevels);
  const minute = enrichEngine2BlockWithExtensions(minuteWithLevels);
  const micro = enrichEngine2BlockWithExtensions(microWithLevels);
   
  const activeExtensions = {
    scalp: pickActiveExtension(
      micro?.waveExtension,
      pickActiveExtension(minute?.waveExtension, minor?.waveExtension)
    ),
    swing: pickActiveExtension(
      minor?.waveExtension,
      intermediate?.waveExtension
    ),
    position: pickActiveExtension(
      intermediate?.waveExtension,
      primary?.waveExtension
    ),
  };
  let correctionDirection = null;

  if (intermediate?.waveMode === "CORRECTIVE") {
    correctionDirection = "UP";
  }

  return {
    primary,
    intermediate,
    minor,
    minute,
    micro,

    activeExtensions,

    primaryPhase: primary?.phase ?? "UNKNOWN",
    intermediatePhase: intermediate?.phase ?? "UNKNOWN",
    minorPhase: minor?.phase ?? "UNKNOWN",
    minutePhase: minute?.phase ?? "UNKNOWN",
    microPhase: micro?.phase ?? "UNKNOWN",

    intermediateWaveMode: intermediate?.waveMode ?? null,
    correctionDirection,
  };
}
/* -----------------------------
   Build snapshot
------------------------------*/
async function buildSnapshot() {
  console.log("Starting strategy snapshot build...");

  const previousSnapshot = loadPreviousSnapshotSafe();
  const engine25Context = loadEngine25Context();

  const momentum = await fetchMomentumContext(symbol);
  const engine2State = await buildEngine2State(symbol);
  console.log("Momentum fetched");

const [
  marketMind,
  engine21TenMin,
  engine21ThirtyMin,
  tenMinuteLayer,
  emaPosture,
  spyReactionQuality,
  spyVolumeBehavior,
] = await Promise.all([
  fetchLiveMarketMeter(),
   
  fetchEngine21Alignment("10m"),
   
  fetchEngine21Alignment("30m"),
   
  buildTenMinuteLayer({   
    symbol,
    coreBase: CORE_BASE,
    fetchJson,
    limit: 120,
  }).catch((err) => ({
    label: "10m Trigger Layer",
    close: null,
    ema10: null,
    ema20: null,
    distanceToEma10: null,
    distanceToEma10Pct: null,
    distanceToEma20: null,
    distanceToEma20Pct: null,
    state: "UNKNOWN",
    lastBarTime: null,
    barCount: 0,
    source: "/api/v1/ohlc",
    error: String(err?.message || err),
  })),
   buildEmaPostureBlock(symbol).catch((err) => ({
    symbol,
    source: "EMA10_POSTURE_FAILED",
    tenMinute: {
      ok: false,
      tf: "10m",
      state: "UNKNOWN",
      error: String(err?.message || err),
    },
    oneHour: {
      ok: false,
      tf: "1h",
      state: "UNKNOWN",
      error: String(err?.message || err),
    },
    fourHour: {
      ok: false,
      tf: "4h",
      state: "UNKNOWN",
      error: String(err?.message || err),
    },
    daily: {
      ok: false,
      tf: "1d",
      state: "UNKNOWN",
      error: String(err?.message || err),
    },
  })),
  fetchSpyReactionQuality(symbol, "10m").catch((err) => ({
    ok: false,
    error: "SPY_REACTION_QUALITY_FETCH_FAILED",
    detail: String(err?.message || err),
  })),
  fetchSpyVolumeBehavior(symbol, "10m").catch((err) => ({
    ok: false,
    error: "SPY_VOLUME_BEHAVIOR_FETCH_FAILED",
    detail: String(err?.message || err),
  })),
]);
console.log("Live Market Meter fetched");
console.log("Engine21 alignment fetched");

  const marketRegime = computeMarketRegime({
    score10m: marketMind?.score10m,
    score30m: marketMind?.score30m,
    score1h: marketMind?.score1h,
    score4h: marketMind?.score4h,
    scoreEOD: marketMind?.scoreEOD,
    state10m: marketMind?.state10m,
    state30m: marketMind?.state30m,
    state1h: marketMind?.state1h,
    state4h: marketMind?.state4h,
    stateEOD: marketMind?.stateEOD,
  });

  console.log(
    "Market regime computed:",
    marketRegime?.regime,
    marketRegime?.directionBias,
    marketRegime?.strictness
  );

  const marketMeter = buildMarketMeterLayers(marketMind);

  marketMeter.layers = marketMeter.layers || {};
  marketMeter.layers.tenMinute = {
    ...tenMinuteLayer,
    score: marketMind?.score10m ?? null,
    trendState: marketMind?.state10m ?? null,
  };

  marketMeter.layers.emaPosture = emaPosture;
  marketMeter.layers.tenMinuteEma10 = emaPosture?.tenMinute || null;
  marketMeter.layers.oneHourEma10 = emaPosture?.oneHour || null;
  marketMeter.layers.fourHourEma10 = emaPosture?.fourHour || null;
  marketMeter.layers.dailyEma10 = emaPosture?.daily || null; 
  const result = {
  ok: true,
  symbol,
  now: nowIso(),
  includeContext: true,
  marketMind,
  marketMeter,
  emaPosture,
  marketRegime,
  engine25Context,
  momentum,
  engine2State,
  engine21Alignment: {
    tenMin: engine21TenMin,
    thirtyMin: engine21ThirtyMin,
  },
  engine16: null,
  strategies: {},
};

  for (const s of STRATEGIES) {
    let engine16ForStrategy = null;
  try {
  let engine2Context = {
    primary: engine2State?.primary ?? null,
    intermediate: engine2State?.intermediate ?? null,
    minor: engine2State?.minor ?? null,
  };

  if (isFuturesSymbol(symbol)) {
    if (
      s.strategyId === "subminute_scalp@10m" ||
      s.strategyId === "intraday_scalp@10m"
    ) {
      engine16ForStrategy = await computeEngine16EsRegimeLayers({
        symbol,
        emaPosture,
        engine2State,
        reaction: null,
        volume: null,
      });

      console.log(`Engine16ES regime layers built for ${s.strategyId} @ ${s.tf}`);
    } else {
      engine16ForStrategy = skippedEngine16(
        symbol,
        s.tf,
        marketRegime,
        engine2Context
      );

      console.log(`Engine16ES skipped for ${s.strategyId} @ ${s.tf}`);
    }
  } else if (isEngine16EnabledForStrategy(s.strategyId)) {
    engine16ForStrategy = await buildEngine16Direct(
      symbol,
      s.tf,
      marketRegime,
      engine2Context
    );

    console.log(`Engine16 built directly for ${s.strategyId} @ ${s.tf}`);
  } else {
    engine16ForStrategy = skippedEngine16(
      symbol,
      s.tf,
      marketRegime,
      engine2Context
    );

    console.log(`Engine16 skipped for ${s.strategyId} @ ${s.tf}`);
  }
  const strategy = await processStrategy(
  s,
  momentum,
  marketMind,
  marketMeter,
  marketRegime,
  engine16ForStrategy,
  engine2State,
  spyReactionQuality,
  spyVolumeBehavior,
  engine25Context
);

const executionSymbol =
  strategy?.symbol ||
  strategy?.instrument ||
  strategy?.underlyingSymbol ||
  strategy?.confluence?.context?.symbol ||
  strategy?.confluence?.context?.instrument ||
  (String(s.strategyId || "") === "intraday_scalp@10m" ? "ES" : symbol);

const executionState = getExecutionState(executionSymbol, s.strategyId);

result.strategies[s.strategyId] = {
  ...strategy,
  executionState,
};
} catch (err) {
  
      result.strategies[s.strategyId] = {
        strategyId: s.strategyId,
        tf: s.tf,
        degree: s.degree,
        wave: s.wave,
        marketRegime,
        confluence: { ok: false, error: String(err?.message || err) },
        permission: { ok: false, error: "builder_strategy_failed" },
        engine6v2: { ok: false, error: "builder_strategy_failed" },
        engine2: null,
        engine16: engine16ForStrategy || fallbackEngine16(symbol, s.tf, marketRegime),
        engine15: {
          ok: false,
          error: "builder_strategy_failed",
          readiness: "NO_SETUP",
          strategyType: "NONE",
          direction: "NONE",
          active: false,
          freshEntryNow: false,
        },
        engine15Decision: {
          ok: false,
          engine: "engine15.decisionReferee.v8.3",
          error: "builder_strategy_failed",
          strategyType: "NONE",
          direction: "NONE",
          readinessLabel: "WAIT",
          executionBias: "NONE",
          action: "NO_ACTION",
          priority: 0,
          entryStyle: "NONE",
          reasonCodes: ["BUILDER_STRATEGY_FAILED"],
          blockers: [String(err?.message || err)],
          conflicts: [],
          qualityGatePassed: false,
          momentumGatePassed: false,
          permissionGatePassed: false,
          qualityScore: 0,
          qualityGrade: "IGNORE",
          qualityBand: "INVALID",
          qualityBreakdown: {
            engine1: 0,
            engine2: 0,
            engine3: 0,
            engine4: 0,
            compression: 0,
          },
          permission: "UNKNOWN",
          sizeMultiplier: null,
          lifecycle: {
            lifecycleStage: "BUILDING",
            isFreshSetup: false,
            entryWindowOpen: false,
            freshEntryNow: false,
            signalPrice: null,
            currentPrice: null,
            barsSinceSignal: null,
            moveFromSignalPts: null,
            moveFromSignalAtr: null,
            zonesInPath: [],
            zonesHit: 0,
            targetCount: 0,
            targetProgress01: 0,
            firstTargetHit: false,
            secondTargetHit: false,
            runnerActive: false,
            setupCompleted: false,
            edgeRemainingPct: 100,
            nextFocus: "LOOK_FOR_NEXT_SETUP",
          },
          debug: {},
        },
        executionBias: "NORMAL",
        momentum,
        context: { ok: false, error: "builder_strategy_failed" },
      };
    }
  }

  // Subminute read-only Engine 26A.
  // Reuses the canonical Minute Engine 22 wave model,
  // but creates independent Subminute candidate and zone identity.
  if (String(symbol || "").toUpperCase() === "ES") {
    const subminute =
      result.strategies?.["subminute_scalp@10m"] || null;

    const minute =
      result.strategies?.["intraday_scalp@10m"] || null;

    if (subminute && minute?.engine22WaveStrategy) {
      const engine26A = buildEngine26A({
        symbol,
        strategyId: "subminute_scalp@10m",
        timeframe: "10m",

        currentPrice:
          validPrice(subminute?.confluence?.price) ??
          validPrice(subminute?.context?.meta?.current_price) ??
          validPrice(minute?.engine26LocationCandidate?.currentPrice) ??
          null,

        snapshotTime: result?.now || nowIso(),

        engine22WaveStrategy:
          minute.engine22WaveStrategy,

        engine25Context:
          subminute.engine25Context || result.engine25Context || null,

        engine1Context:
          subminute.context || null,

        tickSize: 0.25,

        zoneIdentityScope:
          "subminute_scalp@10m",
      });

      subminute.engine22SharedWaveSource = {
        mode: "READ_ONLY_SHARED_SOURCE",
        sourceStrategyId: "intraday_scalp@10m",
        selectedDegree: "subminute",
        strategyId: "subminute_scalp@10m",
        noExecution: true,
      };

      subminute.engine26LocationCandidate =
        engine26A?.engine26LocationCandidate || null;

      subminute.engine26ReactionHandoff =
        engine26A?.engine26ReactionHandoff || null;

      attachPaperScalpReactionToConfluence({
        patchedConfluence:
          subminute.confluence,
        engine22WaveStrategy:
          minute.engine22WaveStrategy,
        engine26ReactionHandoff:
          subminute.engine26ReactionHandoff,
        engine26StructuralContext:
          null,
        paperShortResearchEnabled:
          true,
      });

      attachEngine4AuthorizedReactionParticipation({
        patchedConfluence:
          subminute.confluence,
      });

      const subminutePaperPermission =
        buildEngine6PaperPermission({
          symbol,
          strategyId:
            "subminute_scalp@10m",
          confluence:
            subminute.confluence,
          engine15Decision:
            null,
          engine22WaveStrategy:
            minute.engine22WaveStrategy,
          engine25Context:
            subminute.engine25Context ||
            result.engine25Context ||
            null,
          engine26ImbalanceWatch:
            null,
          engine3AuthorizedReaction:
            subminute.confluence
              ?.context
              ?.reaction
              ?.paperScalpReaction ||
            null,
          engine4AuthorizedParticipation:
            subminute.confluence
              ?.context
              ?.volume
              ?.engine4AuthorizedReactionParticipation ||
            null,
        });

      subminute.permission = {
        ...(subminute.permission || {}),
        paper: {
          ...subminutePaperPermission,
          executable: false,
          realExecutionAllowed: false,
          brokerExecutionAllowed: false,
          schwabExecutionAllowed: false,
          subminuteReadOnlyPhase: true,
        },
      };

      const subminuteEngine26 =
        buildEngine26PaperTradePlan({
          symbol,
          strategyId:
            "subminute_scalp@10m",
          tf:
            "10m",
          permission:
            subminute.permission,
          engine22WaveStrategy:
            minute.engine22WaveStrategy,
          engine25Context:
            subminute.engine25Context ||
            result.engine25Context ||
            null,
          confluence:
            subminute.confluence,
          engine15Decision:
            null,
          engine26LocationCandidate:
            subminute.engine26LocationCandidate,
          openPaperTrades:
            [],
          dailyBars:
            result.marketMeter
              ?.layers
              ?.emaPosture
              ?.daily
              ?.bars ||
            [],
        });

      subminute.engine26ImbalanceWatch =
        subminuteEngine26?.engine26ImbalanceWatch || null;

      subminute.engine26StructuralContext =
        subminuteEngine26?.engine26StructuralContext || null;

      subminute.engine26TradePlanPreview =
        subminuteEngine26?.engine26TradePlanPreview || null;

      subminute.engine26ProposedGeometry =
        subminuteEngine26?.engine26ProposedGeometry || null;

      subminute.engine26PaperTradePlan = null;
      subminute.engine26PaperTradeTicket = null;
      subminute.engine26PaperTradeExecution = null;
    }
  }

  preserveLastGoodEngine22Timeline(result, previousSnapshot);

  // Engine 27 — five independent read-only strategy decisions.
  // Reads completed Engine 22, Engine 3, Engine 4, Engine 6, and Engine 26 context.
  // Does not create permission, sizing, tickets, execution, or journal records.
  result.engine27Strategies = buildEngine27Strategies({
    snapshot: result,
  });
  // Subminute Engine 7A read-only sizing preview.
  if (String(symbol || "").toUpperCase() === "ES") {
    const subminute =
      result.strategies?.["subminute_scalp@10m"] || null;

    const subminuteDecision =
      result.engine27Strategies
        ?.engine27TraderDecision
        ?.decisions
        ?.subminute ||
      null;

    if (subminute) {
      subminute.engine7SizingPreview =
        buildEngine7ProposedSizingPreview({
          engine26ProposedGeometry:
            subminute.engine26ProposedGeometry || null,

          engine6PaperPermission:
            subminute.permission?.paper || null,

          engine27MinuteReadiness:
            subminuteDecision,

          riskConfig:
            ES_PAPER_RISK_CONFIG,

          snapshotTime:
            subminute.engine26LocationCandidate
              ?.snapshotTime ||
            result?.now ||
            nowIso(),
        });

      subminute.engine7SizingPreview = {
        ...(subminute.engine7SizingPreview || {}),
        executable: false,
        executableSizing: false,
        finalContracts: 0,
        subminuteReadOnlyPhase: true,
        noOrderAuthority: true,
        noFinalSizingAuthority: true,
      };
    }
  }

  /*
 * Engine 9 — Official Management Plan
 *
 * Runs after Engine 27E so it can read the final Minute readiness
 * and the validated Minute Fibonacci target ladder.
 *
 * Engine 9:
 * - validates official entry / stop / targets
 * - preserves candidate identity
 * - creates planId
 * - remains non-executing
 *
 * Engine 9 does not:
 * - create permission
 * - create quantity
 * - create tradeId
 * - create idempotencyKey
 * - create orders
 * - call Engine 8
 */
if (
  String(symbol || "").toUpperCase() === "ES"
) {
  const scalp =
    result.strategies?.[
      "intraday_scalp@10m"
    ] || null;

  if (scalp) {
    const engine27MinuteDecision =
      result
        ?.engine27Strategies
        ?.engine27TraderDecision
        ?.decisions
        ?.minute ||
      null;

    const engine27MinuteFib =
      result
        ?.engine27Strategies
        ?.engine27FibIntelligence
        ?.minute ||
      null;

    /*
     * Rebuild Engine 7A once after Engine 27E exists.
     *
     * The earlier per-strategy pass currently supplies:
     * engine27MinuteReadiness: null
     *
     * This second deterministic build replaces it with the completed
     * Engine 27E Minute readiness object.
     */
    scalp.engine7SizingPreview =
      buildEngine7ProposedSizingPreview({
        engine26ProposedGeometry:
          scalp.engine26ProposedGeometry ||
          null,

        engine6PaperPermission:
          scalp.permission?.paper ||
          null,

        engine27MinuteReadiness:
          engine27MinuteDecision,

        riskConfig:
          ES_PAPER_RISK_CONFIG,

        snapshotTime:
          scalp
            .engine26ProposedGeometry
            ?.snapshotTime ||
          result?.now ||
          nowIso(),
      });

scalp.engine9OfficialManagementPlan =
  buildEngine9OfficialManagementPlan({
    engine26ProposedGeometry:
      scalp.engine26ProposedGeometry || null,

    engine7SizingPreview:
      scalp.engine7SizingPreview || null,

    engine6PaperPermission:
      scalp.permission?.paper || null,

    engine27MinuteDecision,

    engine27MinuteFib,

    snapshotTime:
      scalp.engine26ProposedGeometry?.snapshotTime ||
      result?.now ||
      nowIso(),
  });

scalp.engine7PositionSizing =
  buildEngine7FinalPositionSizing({
    engine6PaperPermission:
      scalp.permission?.paper || null,

    engine27MinuteReadiness:
      engine27MinuteDecision || null,

    engine9OfficialManagementPlan:
      scalp.engine9OfficialManagementPlan || null,

    riskConfig:
      ES_PAPER_RISK_CONFIG,

    tradeState: {
      duplicateBlocked: false,
      candidateAlreadySized: false,
      candidateAlreadyOrdered: false,
      openTradeForStrategy: false,
      idempotencyKeyAlreadyUsed: false,
    },

    snapshotTime:
      scalp.engine9OfficialManagementPlan?.snapshotTime ||
      result?.now ||
      nowIso(),
  });

const engine8DuplicateState =
  getEngine8DuplicateState({
    strategyId:
      scalp.engine9OfficialManagementPlan
        ?.strategyId ||
      scalp.engine7PositionSizing
        ?.strategyId ||
      s.strategyId,

    candidateId:
      scalp.engine9OfficialManagementPlan
        ?.candidateId ||
      scalp.engine7PositionSizing
        ?.candidateId ||
      null,

    planId:
      scalp.engine9OfficialManagementPlan
        ?.planId ||
      scalp.engine7PositionSizing
        ?.planId ||
      null,
  });

  scalp.engine8PaperOrder =
    buildEngine8CanonicalPaperAdapter({
      engine6PaperPermission:
        scalp.permission?.paper || null,

      engine9OfficialManagementPlan:
        scalp.engine9OfficialManagementPlan || null,

      engine7PositionSizing:
        scalp.engine7PositionSizing || null,

      duplicateState:
        engine8DuplicateState,

      paperExecutionEnabled:
        process.env.ENGINE8_PAPER_ONLY === "1",

      liveTradingEnabled:
        process.env.ENGINE8_LIVE_TRADING_ENABLED === "1",

      allowLiveFutures:
        process.env.ENGINE8_ALLOW_LIVE_FUTURES === "1",
    });
  }
}

  if (String(symbol || "").toUpperCase() === "ES") {
    const scalp = result.strategies?.["intraday_scalp@10m"];

    if (scalp?.engine22WaveStrategy) {
      try {
       
        scalp.engine23Interpretation = interpretWaveEnvironment({
          symbol,
          price:
            Number.isFinite(Number(scalp.engine22WaveStrategy?.currentPrice))
            ? Number(scalp.engine22WaveStrategy.currentPrice)
            : null,
          engine22WaveStrategy: scalp.engine22WaveStrategy,
          fib: scalp.fibLevels || null,
          engine2State,
          barsByTf: {
            "10m": result.marketMeter?.layers?.emaPosture?.tenMinute?.bars || [],
            "1h": result.marketMeter?.layers?.emaPosture?.oneHour?.bars || [],
            "4h": result.marketMeter?.layers?.emaPosture?.fourHour?.bars || [],
            "1d": result.marketMeter?.layers?.emaPosture?.daily?.bars || [],
          },
        });

        scalp.aiTradeCopilot = buildAiTradeCopilotRead({
          symbol,
          strategy: scalp,
          marketRegime: result.marketRegime || null,
          marketMeter: result.marketMeter || null,
        });
         
      } catch (err) {
        console.error("[E23 FINAL ERROR]", err);

        scalp.engine23Interpretation = {
          ok: false,
          engine: "engine23.waveBehaviorInterpreter.v1",
          mode: "READ_ONLY",
          symbol,
          environment: "UNKNOWN",
          state: "W5_UNKNOWN",
          health: "UNKNOWN",
          directionBias: "NEUTRAL",
          activeDegree: null,
          higherDegreeContext: null,
          chaseAllowed: false,
          preferredEntry: "WAIT_FOR_ENGINE23_FINAL_FIX",
          activeTargets: null,
          higherTargets: null,
          needs: ["FIX_ENGINE23_FINAL_ERROR"],
          reasonCodes: ["ENGINE23_FINAL_COMPUTE_FAILED"],
          summary: "Engine 23 failed while reading the final Engine 22 wave behavior.",
          debug: {
            error: String(err?.message || err),
            stack: String(err?.stack || ""),
          },
        };

        scalp.aiTradeCopilot = {
          ok: false,
          engine: "aiTradeCopilot.v1",
          mode: "READ_ONLY",
          symbol,
          headline: "AI Trade Copilot unavailable",
          bias: "UNKNOWN",
          action: "WAIT",
          confidence: "LOW",
          shouldChase: false,
          reasonCodes: ["ENGINE23_FINAL_ERROR"],
          summary:
            "AI Trade Copilot could not run because the final Engine 23 interpretation failed.",
        }; 
      }
    }
  } 

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(result, null, 2));
  console.log("Strategy snapshot written:", SNAPSHOT_FILE);
}

/* -----------------------------
   Run builder
------------------------------*/
buildSnapshot()
  .then(() => {
    console.log("Snapshot build completed successfully");
  })
  .catch((err) => {
    console.error("Snapshot builder failed:", err);
  });
