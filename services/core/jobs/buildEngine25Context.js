// services/core/jobs/buildEngine25Context.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-context.json");

const CORE_BASE =
  process.env.CORE_BASE || `http://127.0.0.1:${process.env.PORT || 10000}`;

const ES_MARKET_METER_URL =
  `${CORE_BASE}/api/v1/futures/market-meter?symbol=ES`;

const MARKET_INTERNALS_FRESHNESS_MINUTES = {
  es: {
    tenMinute: 30,
    thirtyMinute: 90,
    oneHour: 180,
    fourHour: 720,
    eod: 4320,
  },
  sectors: {
    oneHour: 180,
    fourHour: 720,
    eod: 4320,
  },
};

const SOURCE_FILES = {
  marketHealth: "engine25-market-health.json",
  compositeOverlay: "engine25-composite-overlay-6mo.json",
  zoneAwareRead: "engine25-es-zone-aware-read.json",
  sectorBreadth: "engine25-sector-card-breadth-snapshots.json",
  zoneClassification: "engine25-zone-classification.json",
  intradayMacro: "engine25-intraday-macro.json",
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function upper(value) {
  return safeString(value).toUpperCase();
}

function includesToken(value, token) {
  return upper(value).includes(token);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readJsonSource(key, fileName, warnings) {
  const filePath = path.join(DATA_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    warnings.push(`Missing Engine 25 source file: ${fileName}`);
    return {
      ok: false,
      key,
      fileName,
      filePath,
      data: null,
      modifiedAt: null,
      sizeBytes: 0,
      error: "MISSING_FILE",
    };
  }

  try {
    const stat = fs.statSync(filePath);

    if (!stat.size || stat.size <= 0) {
      warnings.push(`Empty Engine 25 source file: ${fileName}`);
      return {
        ok: false,
        key,
        fileName,
        filePath,
        data: null,
        modifiedAt: stat.mtime.toISOString(),
        sizeBytes: stat.size,
        error: "EMPTY_FILE",
      };
    }

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

    return {
      ok: true,
      key,
      fileName,
      filePath,
      data,
      modifiedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      error: null,
    };
  } catch (err) {
    warnings.push(
      `Invalid Engine 25 source file: ${fileName} (${err?.message || String(err)})`
    );

    return {
      ok: false,
      key,
      fileName,
      filePath,
      data: null,
      modifiedAt: null,
      sizeBytes: 0,
      error: err?.message || String(err),
    };
  }
}

function latestCompositeRow(compositeOverlay) {
  const rows = Array.isArray(compositeOverlay?.rows) ? compositeOverlay.rows : [];
  if (!rows.length) return null;

  return rows[rows.length - 1] || null;
}

function latestTimestampFromObject(obj) {
  return firstDefined(
    obj?.updatedAt,
    obj?.generatedAtUtc,
    obj?.generatedAt,
    obj?.finishedAt,
    obj?.startedAt,
    obj?.date,
    obj?.modelDate
  );
}

function newestTimestamp(sources) {
  const candidates = [];

  for (const source of Object.values(sources)) {
    if (!source?.ok) continue;

    const dataTs = latestTimestampFromObject(source.data);
    if (dataTs) candidates.push(dataTs);

    if (source.modifiedAt) candidates.push(source.modifiedAt);
  }

  const valid = candidates
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));

  if (!valid.length) return null;

  return new Date(Math.max(...valid)).toISOString();
}

function hoursOld(iso) {
  if (!iso) return null;

  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;

  return (Date.now() - t) / (1000 * 60 * 60);
}

function buildSourceFiles(sources) {
  return Object.fromEntries(
    Object.entries(sources).map(([key, source]) => [key, source.ok === true])
  );
}

function buildComponents({ marketHealth, compositeRow, compositeOverlay }) {
  const components =
    marketHealth?.components ||
    compositeRow?.components ||
    compositeOverlay?.components ||
    {};

  return {
    macroAwareScore: toNumberOrNull(
      firstDefined(
        components.macroAwareScore,
        components.macroAware,
        components.macro
      )
    ),
    breadthParticipation: toNumberOrNull(components.breadthParticipation),
    distributionPressure: toNumberOrNull(components.distributionPressure),
    marketTrend: toNumberOrNull(components.marketTrend),
    creditFragility: toNumberOrNull(components.creditFragility),
    aiLeadership: toNumberOrNull(components.aiLeadership),
  };
}

function buildFreshness({ sources, warnings }) {
  const anyUsefulSource = Object.values(sources).some((source) => source.ok);
  const missingAnySource = Object.values(sources).some((source) => !source.ok);

  const updatedAt = newestTimestamp(sources);
  const ageHours = hoursOld(updatedAt);

  const hasTrustedLiveFallback =
    sources.marketHealth?.ok === true || sources.zoneAwareRead?.ok === true;

  let status = "FRESH";

  if (!anyUsefulSource) {
    status = "MISSING";
  } else if (
    Number.isFinite(ageHours) &&
    ageHours > 3 &&
    !hasTrustedLiveFallback
  ) {
    status = "STALE";
    warnings.push(
      `Engine 25 context latest useful timestamp is older than 3 hours: ${updatedAt}`
    );
  } else if (missingAnySource) {
    status = "DEGRADED";
  }

  const composite = sources.compositeOverlay?.data || {};
  const marketHealth = sources.marketHealth?.data || {};
  const zoneAwareRead = sources.zoneAwareRead?.data || {};
  const compositeRow = latestCompositeRow(composite);

  return {
    status,
    modelDate: firstDefined(
      composite.modelDate,
      compositeRow?.modelDate,
      compositeRow?.date,
      marketHealth.modelDate,
      null
    ),
    updatedAt: updatedAt || nowIso(),
    zoneContextSource: firstDefined(
      zoneAwareRead?.context?.contextSource,
      zoneAwareRead?.contextSource,
      null
    ),
    dailyCompositeAvailable: Boolean(
      sources.compositeOverlay?.ok &&
        Array.isArray(composite.rows) &&
        composite.rows.length
    ),
    compositeFallbackActive: !Boolean(
      sources.compositeOverlay?.ok &&
        Array.isArray(composite.rows) &&
        composite.rows.length
    ),
    warnings,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
    hasTrustedLiveFallback,
  };
}

function buildEsPermission(zoneAwareRead, marketHealth, sizeMultiplier) {
  const zoneState = zoneAwareRead?.zoneState || {};
  const marketEsPermission = marketHealth?.esPermission || {};

  return {
    permission: firstDefined(
      zoneState.permission,
      marketEsPermission.permission,
      marketEsPermission.mode,
      "UNKNOWN"
    ),
    sizeMultiplier: toNumberOrNull(
      firstDefined(
        zoneState.sizeMultiplier,
        marketEsPermission.sizeMultiplier,
        sizeMultiplier
      )
    ),
    zoneState: firstDefined(zoneState.state, marketEsPermission.zoneState, null),
    nearestZone: zoneAwareRead?.nearestZone || zoneState.nearestZone || {},
    reclaimNegotiated: firstDefined(zoneState.reclaimNegotiated, null),
    reclaimInstitutional: firstDefined(zoneState.reclaimInstitutional, null),
    failureInstitutional: firstDefined(zoneState.failureInstitutional, null),
    lowerShelf: firstDefined(zoneState.lowerShelf, null),
  };
}

function buildFlags({
  freshnessStatus,
  hasTrustedLiveFallback,
  permission,
  zoneState,
  sectorPermissionImpact,
  finalPermissionImpact,
  finalZoneState,
}) {
  const finalImpactText = upper(finalPermissionImpact);
  const permissionText = upper(permission);
  const zoneStateText = upper(zoneState);
  const sectorImpactText = upper(sectorPermissionImpact);
  const finalZoneStateText = upper(finalZoneState);

  const watchOnly =
    finalImpactText.includes("WATCH_ONLY") ||
    permissionText.includes("WATCH_ONLY");

  const noAccumulationSignal =
    zoneStateText.includes("NO_ACCUMULATION_SIGNAL");

  const hardBlock =
    freshnessStatus === "MISSING" ||
    (freshnessStatus === "STALE" && !hasTrustedLiveFallback) ||
    permissionText.includes("NO_TRADE") ||
    permissionText.includes("STAND_DOWN") ||
    finalZoneStateText.includes("DISTRIBUTION_ACTIVE");

  const noBlindLongs =
    permissionText.includes("NO_BLIND_LONGS") ||
    zoneStateText.includes("INSTITUTIONAL_SUPPORT_AT_RISK") ||
    noAccumulationSignal ||
    watchOnly ||
    sectorImpactText.includes("NO_BLIND_LONGS_OR_A_PLUS_ONLY") ||
    finalImpactText.includes("NO_BLIND_LONGS");

  const noBlindShorts = true;

  const requireReclaim =
    zoneStateText.includes("INSTITUTIONAL_SUPPORT_AT_RISK") ||
    noAccumulationSignal ||
    watchOnly ||
    finalImpactText.includes("RECLAIM") ||
    permissionText.includes("A_PLUS_ONLY");

  const qualityText = `${permissionText} ${finalImpactText} ${sectorImpactText}`;

  const requiredSetupQuality =
    qualityText.includes("A_PLUS") ||
    watchOnly ||
    noBlindLongs ||
    requireReclaim
      ? "A_PLUS_ONLY"
      : qualityText.includes("A_ONLY")
        ? "A_ONLY"
        : "B_OR_BETTER";

  return {
    hardBlock,
    noBlindLongs,
    noBlindShorts,
    requireReclaim,
    requiredSetupQuality,
  };
}

function timestampToIso(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ageMinutesFromTimestamp(value) {
  const iso = timestampToIso(value);
  if (!iso) return null;

  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;

  return (Date.now() - ms) / (1000 * 60);
}

function buildFreshnessRead(value, staleAfterMinutes) {
  const asOfUtc = timestampToIso(value);
  const ageMinutes = ageMinutesFromTimestamp(value);

  if (!asOfUtc || !Number.isFinite(ageMinutes)) {
    return {
      status: "STALE",
      asOfUtc,
      ageMinutes: null,
      staleAfterMinutes,
      reason: "SOURCE_TIMESTAMP_UNAVAILABLE",
    };
  }

  const stale = ageMinutes > staleAfterMinutes;

  return {
    status: stale ? "STALE" : "FRESH",
    asOfUtc,
    ageMinutes: Number(ageMinutes.toFixed(2)),
    staleAfterMinutes,
    reason: stale ? "SOURCE_OLDER_THAN_V1_THRESHOLD" : null,
  };
}

async function fetchJsonWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 250)}`);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 250)}`);
    }

    return json;
  } finally {
    clearTimeout(timer);
  }
}

function unavailableEsTimeframe(key, staleAfterMinutes, maturity = null) {
  return {
    available: false,
    key,
    score: null,
    state: null,
    tone: null,
    formula: null,
    maturity,
    freshness: {
      status: "UNAVAILABLE",
      asOfUtc: null,
      ageMinutes: null,
      staleAfterMinutes,
      reason: "ES_TIMEFRAME_UNAVAILABLE",
    },
  };
}

function normalizeEsTimeframe(light, key, staleAfterMinutes, maturity = null) {
  if (
    !light ||
    light.ok === false ||
    !Number.isFinite(Number(light.score))
  ) {
    return unavailableEsTimeframe(key, staleAfterMinutes, maturity);
  }

  const sourceBarTime = firstDefined(
    light?.lastBar?.time,
    light?.lastBar?.timestamp,
    light?.lastBar?.t,
    null
  );

  return {
    available: true,
    key,
    score: Number(light.score),
    state: light.state || null,
    tone: light.tone || null,
    formula: light.formula || null,
    maturity,
    freshness: buildFreshnessRead(sourceBarTime, staleAfterMinutes),
  };
}

function unavailableSectorLayer(key, staleAfterMinutes) {
  return {
    available: false,
    key,
    sourceType: "sectorCardProxyBreadth",
    sourceKind: null,
    sourcePath: null,
    generatedAtUtc: null,
    cardCount: 0,
    summary: null,
    classification: null,
    freshness: {
      status: "UNAVAILABLE",
      asOfUtc: null,
      ageMinutes: null,
      staleAfterMinutes,
      reason: "SECTOR_LAYER_UNAVAILABLE",
    },
  };
}

function normalizeSectorLayer(layer, key, staleAfterMinutes) {
  if (!layer || layer.available !== true) {
    return unavailableSectorLayer(key, staleAfterMinutes);
  }

  return {
    available: true,
    key,
    sourceType: layer.sourceType || "sectorCardProxyBreadth",
    sourceKind: layer.sourceKind || null,
    sourcePath: layer.sourcePath || null,
    generatedAtUtc: layer.generatedAtUtc || null,
    cardCount: Number.isFinite(Number(layer.cardCount))
      ? Number(layer.cardCount)
      : 0,
    summary: layer.summary || null,
    classification: layer.classification || null,
    freshness: buildFreshnessRead(
      layer.generatedAtUtc,
      staleAfterMinutes
    ),
  };
}

function classifyMarketInternalsAlignment(esLayer, sectorLayer) {
  if (!esLayer?.available || !sectorLayer?.available) {
    return "DATA_UNAVAILABLE";
  }

  if (
    esLayer?.freshness?.status === "STALE" ||
    sectorLayer?.freshness?.status === "STALE"
  ) {
    return "DATA_STALE";
  }

  const esState = upper(esLayer.state);
  const sectorLabel = upper(sectorLayer?.classification?.label);

  const esWeak = esState === "BEAR";
  const esStrong = esState === "BULL";

  const sectorsWeak =
    sectorLabel.includes("WEAK") ||
    sectorLabel.includes("RISK_OFF");

  const sectorsStrong =
    sectorLabel.includes("EXPANDING") ||
    sectorLabel.includes("RISK_ON");

  if (esWeak && sectorsWeak) {
    return "ES_AND_SECTORS_ALIGNED_WEAK";
  }

  if (esStrong && sectorsStrong) {
    return "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE";
  }

  if (esStrong && !sectorsStrong) {
    return "ES_STRONG_BUT_SECTORS_NOT_CONFIRMING";
  }

  if (!esStrong && sectorsStrong) {
    return "BROADER_PARTICIPATION_DIVERGENCE";
  }

  return "MIXED";
}

function buildOverallMarketInternalsAlignment({
  oneHour,
  fourHour,
  eod,
}) {
  const blockedByData = [oneHour, fourHour, eod].some(
    (value) => value === "DATA_UNAVAILABLE" || value === "DATA_STALE"
  );

  if (blockedByData) {
    return "MIXED";
  }

  if (
    oneHour === "ES_AND_SECTORS_ALIGNED_WEAK" &&
    (
      eod === "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE" ||
      eod === "BROADER_PARTICIPATION_DIVERGENCE"
    )
  ) {
    return "TACTICAL_WEAKNESS_INSIDE_BETTER_DAILY_STRUCTURE";
  }

  if (
    oneHour === "ES_AND_SECTORS_ALIGNED_WEAK" &&
    fourHour === "ES_AND_SECTORS_ALIGNED_WEAK" &&
    (
      eod === "ES_AND_SECTORS_ALIGNED_WEAK" ||
      eod === "MIXED"
    )
  ) {
    return "ES_AND_SECTORS_ALIGNED_WEAK";
  }

  if (oneHour === "ES_AND_SECTORS_ALIGNED_WEAK") {
    return "TACTICAL_WEAKNESS_CONFIRMED";
  }

  if (
    oneHour === "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE" &&
    fourHour === "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE" &&
    eod === "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE"
  ) {
    return "ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE";
  }

  const values = [oneHour, fourHour, eod];

  if (
    values.filter(
      (value) => value === "ES_STRONG_BUT_SECTORS_NOT_CONFIRMING"
    ).length >= 2
  ) {
    return "ES_STRONG_BUT_SECTORS_NOT_CONFIRMING";
  }

  if (
    values.filter(
      (value) => value === "BROADER_PARTICIPATION_DIVERGENCE"
    ).length >= 2
  ) {
    return "BROADER_PARTICIPATION_DIVERGENCE";
  }

  return "MIXED";
}

function marketInternalsSummary(overall) {
  const summaries = {
    TACTICAL_WEAKNESS_INSIDE_BETTER_DAILY_STRUCTURE:
      "ES tactical weakness is confirmed on 1H while the daily sector structure remains materially healthier.",
    TACTICAL_WEAKNESS_CONFIRMED:
      "ES tactical weakness is confirmed by 1H sector participation, while broader structural confirmation remains mixed.",
    ES_AND_SECTORS_ALIGNED_WEAK:
      "ES and broader sector participation are aligned weak across the important tactical and regime layers.",
    ES_AND_SECTORS_ALIGNED_CONSTRUCTIVE:
      "ES strength is confirmed by broader sector participation across tactical, regime, and daily structure.",
    ES_STRONG_BUT_SECTORS_NOT_CONFIRMING:
      "ES is technically strong, but broader sector participation is not confirming that strength.",
    BROADER_PARTICIPATION_DIVERGENCE:
      "Broader sector participation is materially healthier than ES technical condition.",
    MIXED:
      "ES technical condition and broader sector participation are mixed or partially divergent.",
  };

  return summaries[overall] || summaries.MIXED;
}

async function buildMarketInternals({ sectorBreadth, warnings }) {
  let meter = null;

  try {
    meter = await fetchJsonWithTimeout(ES_MARKET_METER_URL, 15000);
  } catch (err) {
    warnings.push(
      `Engine 25 marketInternals ES Market Meter unavailable: ${
        err?.message || String(err)
      }`
    );
  }

  const sourceSymbol = upper(meter?.symbol);

  const meterIdentityOk =
    meter?.ok === true &&
    sourceSymbol === "ES";

  if (meter && !meterIdentityOk) {
    warnings.push(
      `Engine 25 marketInternals rejected Market Meter identity: ${
        sourceSymbol || "UNKNOWN"
      }`
    );
  }

  const lights = meterIdentityOk ? meter?.lights || {} : {};

  const tenMinute = normalizeEsTimeframe(
    lights["10m"],
    "tenMinute",
    MARKET_INTERNALS_FRESHNESS_MINUTES.es.tenMinute
  );

  const thirtyMinute = normalizeEsTimeframe(
    lights["30m"],
    "thirtyMinute",
    MARKET_INTERNALS_FRESHNESS_MINUTES.es.thirtyMinute
  );

  const oneHour = normalizeEsTimeframe(
    lights["1h"],
    "oneHour",
    MARKET_INTERNALS_FRESHNESS_MINUTES.es.oneHour
  );

  const fourHour = normalizeEsTimeframe(
    lights["4h"],
    "fourHour",
    MARKET_INTERNALS_FRESHNESS_MINUTES.es.fourHour,
    "BASIC_PENDING_TUNE"
  );

  const eod = normalizeEsTimeframe(
    lights["1d"],
    "eod",
    MARKET_INTERNALS_FRESHNESS_MINUTES.es.eod,
    "BASIC_PENDING_TUNE"
  );

  const masterAvailable =
    meterIdentityOk &&
    Number.isFinite(Number(meter?.master?.score));

  const sectorLatest = sectorBreadth?.latest || {};

  const sectorOneHour = normalizeSectorLayer(
    sectorLatest?.tactical1h,
    "oneHour",
    MARKET_INTERNALS_FRESHNESS_MINUTES.sectors.oneHour
  );

  const sectorFourHour = normalizeSectorLayer(
    sectorLatest?.regime4h,
    "fourHour",
    MARKET_INTERNALS_FRESHNESS_MINUTES.sectors.fourHour
  );

  const sectorEod = normalizeSectorLayer(
    sectorLatest?.structuralEod,
    "eod",
    MARKET_INTERNALS_FRESHNESS_MINUTES.sectors.eod
  );

  const alignmentOneHour = classifyMarketInternalsAlignment(
    oneHour,
    sectorOneHour
  );

  const alignmentFourHour = classifyMarketInternalsAlignment(
    fourHour,
    sectorFourHour
  );

  const alignmentEod = classifyMarketInternalsAlignment(
    eod,
    sectorEod
  );

  const alignmentOverall = buildOverallMarketInternalsAlignment({
    oneHour: alignmentOneHour,
    fourHour: alignmentFourHour,
    eod: alignmentEod,
  });

  const marketInternalsWarnings = [];

  if (!masterAvailable) {
    marketInternalsWarnings.push("ES_MASTER_SCORE_UNAVAILABLE");
  }

  for (const [key, layer] of Object.entries({
    tenMinute,
    thirtyMinute,
    oneHour,
    fourHour,
    eod,
  })) {
    if (!layer.available) {
      marketInternalsWarnings.push(
        `ES_${key.toUpperCase()}_UNAVAILABLE`
      );
    } else if (layer.freshness?.status === "STALE") {
      marketInternalsWarnings.push(
        `ES_${key.toUpperCase()}_STALE`
      );
    }
  }

  for (const [key, layer] of Object.entries({
    oneHour: sectorOneHour,
    fourHour: sectorFourHour,
    eod: sectorEod,
  })) {
    if (!layer.available) {
      marketInternalsWarnings.push(
        `SECTOR_${key.toUpperCase()}_UNAVAILABLE`
      );
    } else if (layer.freshness?.status === "STALE") {
      marketInternalsWarnings.push(
        `SECTOR_${key.toUpperCase()}_STALE`
      );
    }
  }

  return {
    ok:
      meterIdentityOk &&
      (
        oneHour.available ||
        fourHour.available ||
        eod.available ||
        sectorOneHour.available ||
        sectorFourHour.available ||
        sectorEod.available
      ),

    symbol: "ES",
    generatedAtUtc: nowIso(),

    esMarketMeter: {
      available: meterIdentityOk && masterAvailable,
      source: "/api/v1/futures/market-meter?symbol=ES",
      sourceSymbol: meterIdentityOk ? "ES" : null,
      updatedAtUtc: meterIdentityOk ? meter?.updated_at_utc || null : null,
      masterScore: masterAvailable ? Number(meter.master.score) : null,
      masterState: masterAvailable ? meter?.master?.state || null : null,
      masterTone: masterAvailable ? meter?.master?.tone || null : null,
      weights: masterAvailable ? meter?.master?.weights || null : null,

      timeframes: {
        tenMinute,
        thirtyMinute,
        oneHour,
        fourHour,
        eod,
      },
    },

    sectorParticipation: {
      oneHour: sectorOneHour,
      fourHour: sectorFourHour,
      eod: sectorEod,
    },

    alignment: {
      oneHour: alignmentOneHour,
      fourHour: alignmentFourHour,
      eod: alignmentEod,
      overall: alignmentOverall,
    },

    summary: marketInternalsSummary(alignmentOverall),
    warnings: unique(marketInternalsWarnings),
  };
}

function buildSummary({ label, permission, flags }) {
  if (flags.hardBlock) {
    return `${label || "Engine 25"}: hard block active. Permission: ${
      permission || "UNKNOWN"
    }.`;
  }

  if (flags.noBlindLongs || flags.requireReclaim) {
    return `${
      label || "Engine 25"
    }: selective context, but no blind longs until reclaim / A+ confirmation.`;
  }

  return `${
    label || "Engine 25"
  }: context available. Engine 6 remains final permission.`;
}

async function buildContext() {
  ensureDataDir();

  const warnings = [];
  const sources = {};

  for (const [key, fileName] of Object.entries(SOURCE_FILES)) {
    sources[key] = readJsonSource(key, fileName, warnings);
  }

  const marketHealth = sources.marketHealth.data || {};
  const compositeOverlay = sources.compositeOverlay.data || {};
  const zoneAwareRead = sources.zoneAwareRead.data || {};
  const sectorBreadth = sources.sectorBreadth.data || {};
  const zoneClassification = sources.zoneClassification.data || {};
  const intradayMacro = sources.intradayMacro.data || {};
  const compositeRow = latestCompositeRow(compositeOverlay);

  const marketInternals = await buildMarketInternals({
    sectorBreadth,
    warnings,
  });

  const freshness = buildFreshness({ sources, warnings });

  const score = toNumberOrNull(
    firstDefined(
      marketHealth.score,
      marketHealth.engine25CompositeScore,
      compositeRow?.engine25CompositeScore,
      compositeOverlay.score
    )
  );

  const regime = firstDefined(
    marketHealth.regime,
    compositeRow?.overlayState,
    compositeOverlay.regime,
    "UNKNOWN"
  );

  const label = firstDefined(
    marketHealth.label,
    marketHealth.bias,
    marketHealth.riskLevel,
    compositeRow?.overlayLabel,
    compositeOverlay.label,
    "Unknown"
  );

  const permission = firstDefined(
    marketHealth.permission,
    marketHealth.esPermission?.mode,
    marketHealth.tradePermission?.engine22Mode,
    compositeRow?.permissions?.finalPermission,
    compositeOverlay.permission,
    "UNKNOWN"
  );

  const sizeMultiplier =
    toNumberOrNull(
      firstDefined(
        marketHealth.sizeMultiplier,
        marketHealth.esPermission?.sizeMultiplier,
        marketHealth.tradePermission?.sizeMultiplier,
        compositeRow?.permissions?.finalSize,
        compositeOverlay.sizeMultiplier
      )
    ) ?? 1.0;

  const latestSectorRead = sectorBreadth?.latest || {};
  const combinedRead = latestSectorRead?.combinedRead || null;
  const sectorPermissionImpact = combinedRead?.permissionImpact || null;

  const finalZoneClassification =
    zoneClassification?.finalZoneClassification || null;

  const finalPermissionImpact =
    finalZoneClassification?.permissionImpact || null;

  const finalZoneState = firstDefined(
    finalZoneClassification?.state,
    zoneAwareRead?.zoneState?.state,
    null
  );

  const zoneState = zoneAwareRead?.zoneState?.state || null;

  const flags = buildFlags({
    freshnessStatus: freshness.status,
    hasTrustedLiveFallback: freshness.hasTrustedLiveFallback,
    permission,
    zoneState,
    sectorPermissionImpact,
    finalPermissionImpact,
    finalZoneState,
  });

  const esPermission = buildEsPermission(
    zoneAwareRead,
    marketHealth,
    sizeMultiplier
  );

  const reasonCodes = unique([
    ...asArray(marketHealth.reasonCodes),
    ...asArray(zoneAwareRead.reasonCodes),
    ...asArray(zoneAwareRead?.zoneState?.reasonCodes),
    ...asArray(sectorBreadth.reasonCodes),
    ...asArray(zoneClassification.reasonCodes),
    ...(flags.hardBlock ? ["ENGINE25_CONTEXT_HARD_BLOCK"] : []),
    ...(flags.noBlindLongs ? ["ENGINE25_CONTEXT_NO_BLIND_LONGS"] : []),
    ...(flags.requireReclaim ? ["ENGINE25_CONTEXT_RECLAIM_REQUIRED"] : []),
    "ENGINE25_CONTEXT_BRIDGE_BUILT",
  ]);

  const output = {
    ok: freshness.status !== "MISSING",
    engine: "engine25.context.v1",
    source: "engine25-context.json",
    generatedAtUtc: nowIso(),

    sourceFiles: buildSourceFiles(sources),

    freshness: {
      status: freshness.status,
      modelDate: freshness.modelDate,
      updatedAt: freshness.updatedAt,
      zoneContextSource: freshness.zoneContextSource,
      dailyCompositeAvailable: freshness.dailyCompositeAvailable,
      compositeFallbackActive: freshness.compositeFallbackActive,
      warnings: freshness.warnings,
    },

    score,
    regime,
    label,
    permission,
    sizeMultiplier,

    components: buildComponents({
      marketHealth,
      compositeRow,
      compositeOverlay,
    }),

    esPermission,

    sectorBreadth: sectorBreadth || {},
    zoneClassification: zoneClassification || {},
    zoneAwareRead: zoneAwareRead || {},
    marketHealth: marketHealth || {},
    intradayMacro: intradayMacro || {},
    marketInternals: marketInternals || {},

    flags: {
      hardBlock: flags.hardBlock,
      noBlindLongs: flags.noBlindLongs,
      noBlindShorts: flags.noBlindShorts,
      requireReclaim: flags.requireReclaim,
      engine6FinalPermissionRequired: true,
    },

    quality: {
      requiredSetupQuality: flags.requiredSetupQuality,
    },

    hardBlock: flags.hardBlock,
    noBlindLongs: flags.noBlindLongs,
    noBlindShorts: flags.noBlindShorts,
    requireReclaim: flags.requireReclaim,
    requiredSetupQuality: flags.requiredSetupQuality,

    summary: buildSummary({ label, permission, flags }),
    warnings,
    reasonCodes,
  };

  return output;
}

async function main() {
  const context = await buildContext();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(context, null, 2));

  console.log(
    `[Engine25Context] Wrote data/engine25-context.json | ok=${context.ok} | freshness=${context.freshness.status} | score=${context.score} | permission=${context.permission}`
  );

  if (!context.ok) {
    process.exitCode = 1;
  }
}

main();
