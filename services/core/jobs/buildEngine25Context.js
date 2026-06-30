// services/core/jobs/buildEngine25Context.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-context.json");

const SOURCE_FILES = {
  marketHealth: "engine25-market-health.json",
  compositeOverlay: "engine25-composite-overlay-6mo.json",
  zoneAwareRead: "engine25-es-zone-aware-read.json",
  sectorBreadth: "engine25-sector-card-breadth-snapshots.json",
  zoneClassification: "engine25-zone-classification.json",
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

function buildContext() {
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
  const compositeRow = latestCompositeRow(compositeOverlay);

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

function main() {
  const context = buildContext();

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(context, null, 2));

  console.log(
    `[Engine25Context] Wrote data/engine25-context.json | ok=${context.ok} | freshness=${context.freshness.status} | score=${context.score} | permission=${context.permission}`
  );

  if (!context.ok) {
    process.exitCode = 1;
  }
}

main();
