// services/core/jobs/buildEngine25EsZoneAwareRead.js
//
// Engine 25G — ES Zone-Aware Permission Read v0.2
//
// Purpose:
// Combine:
//   Engine 1 = manual ES zones / shelves
//   Engine 3 = ES price reaction around zones
//   Engine 4 = general ES futures volume participation
//   Engine 25 = breadth / distribution / market health context
//
// Important ownership rules:
// - Engine 25G does NOT own raw zone creation.
// - Engine 25G does NOT own full price-reaction modeling.
// - Engine 25G does NOT own true volume-in-zone confirmation yet.
// - Engine 4 does not currently expose ES zone-specific volume.
// - Historical ES zone-aware logic remains disabled/null because historical zone snapshots do not exist.
//
// Writes:
//   services/core/data/engine25-es-zone-aware-read.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MANUAL_ZONES_FILE = path.join(DATA_DIR, "es-smz-manual-zones.txt");
const MANUAL_STRUCTURES_FILE = path.join(DATA_DIR, "es-smz-manual-structures.json");
const SHELVES_FILE = path.join(DATA_DIR, "es-smz-shelves.json");

const CONTEXT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-distribution-breadth-6mo.json"
);

const DAILY_TECHNICAL_FILE = path.join(
  DATA_DIR,
  "engine25-es-replay-daily-technical-6mo.json"
);

const MARKET_HEALTH_FILE = path.join(DATA_DIR, "engine25-market-health.json");

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-es-zone-aware-read.json");

const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const ES_1H_URL = `${BACKEND_BASE}/api/v1/futures/ohlc?symbol=ES&timeframe=1h&limit=120`;
const ES_REACTION_URL = `${BACKEND_BASE}/api/v1/es-reaction-score?symbol=ES&tf=10m`;
const ES_VOLUME_URL = `${BACKEND_BASE}/api/v1/es-volume-behavior?symbol=ES&tf=10m`;

const ENGINE_NAME = "engine25.esZoneAwareRead.v0.2";
const MODEL_TYPE = "ES_ZONE_AWARE_PERMISSION_READ";

const CONSTRUCTIVE_ENGINE3_STATES = new Set([
  "HELD_ACCUMULATION",
  "DEFENDING_LOWER_ZONE",
  "BREAKING_ABOVE_NEGOTIATED_VALUE",
  "BREAKING_ABOVE_DISTRIBUTION",
]);

const RISK_ENGINE3_STATES = new Set([
  "REJECTING_UPPER_ZONE",
  "REJECTED_FROM_DISTRIBUTION",
  "BREAKING_BELOW_NEGOTIATED_VALUE",
  "BREAKING_BELOW_ACCUMULATION",
  "BELOW_INSTITUTIONAL_ZONE",
]);

const NEUTRAL_ENGINE3_STATES = new Set([
  "ACCEPTING_INSIDE_ZONE",
  "INSIDE_INSTITUTIONAL_ZONE",
  "NEUTRAL_CHOP",
  "NO_ACTIVE_ZONE",
]);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readTextFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return fs.readFileSync(filePath, "utf8");
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonFileOptional(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`[${ENGINE_NAME}] Optional JSON read failed: ${filePath}: ${err.message}`);
    return null;
  }
}

function normalizeRows(block, label) {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block?.rows)) return block.rows;
  throw new Error(`${label} does not contain rows.`);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function normalizeRange(a, b) {
  const n1 = safeNumber(a);
  const n2 = safeNumber(b);

  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return null;

  return {
    lo: Math.min(n1, n2),
    hi: Math.max(n1, n2),
    raw: `${a}-${b}`,
  };
}

function parseRangeText(text) {
  const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return normalizeRange(match[1], match[2]);
}

function rangeFromPriceRange(priceRange) {
  if (!Array.isArray(priceRange) || priceRange.length < 2) return null;
  return normalizeRange(priceRange[0], priceRange[1]);
}

function parseManualZones(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const zones = [];
  let currentInstitutional = null;
  let zoneIndex = 0;

  for (const rawLine of lines) {
    const commentSplit = rawLine.split("#");
    const lineWithoutComment = commentSplit[0] || "";
    const note = commentSplit.slice(1).join("#").trim() || null;

    const parts = lineWithoutComment.split("|");
    const left = (parts[0] || "").trim();
    const right = (parts[1] || "").trim();

    const institutionalRange = parseRangeText(left);
    const negotiatedRange = right.toUpperCase().includes("NEG")
      ? parseRangeText(right)
      : null;

    if (institutionalRange) {
      currentInstitutional = {
        lo: institutionalRange.lo,
        hi: institutionalRange.hi,
        raw: institutionalRange.raw,
      };
    }

    const effectiveInstitutional =
      currentInstitutional ||
      (negotiatedRange
        ? {
            lo: negotiatedRange.lo,
            hi: negotiatedRange.hi,
            raw: negotiatedRange.raw,
          }
        : null);

    if (!effectiveInstitutional && !negotiatedRange) continue;

    zoneIndex += 1;

    zones.push({
      id: `MANUAL_ES_ZONE_${String(zoneIndex).padStart(2, "0")}`,
      source: "data/es-smz-manual-zones.txt",
      institutional: effectiveInstitutional,
      negotiated: negotiatedRange
        ? {
            lo: negotiatedRange.lo,
            hi: negotiatedRange.hi,
            raw: negotiatedRange.raw,
          }
        : null,
      note,
      rawLine,
    });
  }

  return zones;
}

function buildManualStructureSummary() {
  const payload = readJsonFileOptional(MANUAL_STRUCTURES_FILE);
  const structures = Array.isArray(payload?.structures) ? payload.structures : [];

  return {
    available: !!payload?.ok,
    sourceFile: "es-smz-manual-structures.json",
    schema: payload?.meta?.schema || null,
    updatedUtc: payload?.meta?.updatedUtc || null,
    totalStructures: structures.length,
    negotiatedCount: structures.filter((s) => s?.isNegotiated === true).length,
    institutionalCount: structures.filter((s) => s?.isNegotiated !== true).length,
  };
}

function distanceToRange(price, range) {
  if (!range || !Number.isFinite(price)) return null;
  if (price >= range.lo && price <= range.hi) return 0;
  if (price < range.lo) return round2(range.lo - price);
  return round2(price - range.hi);
}

function priceInsideRange(price, range) {
  if (!range || !Number.isFinite(price)) return false;
  return price >= range.lo && price <= range.hi;
}

function priceAboveRange(price, range) {
  if (!range || !Number.isFinite(price)) return false;
  return price > range.hi;
}

function priceBelowRange(price, range) {
  if (!range || !Number.isFinite(price)) return false;
  return price < range.lo;
}

function rangeMid(range) {
  if (!range) return null;
  return round2((range.lo + range.hi) / 2);
}

function chooseNearestZone(price, zones) {
  const candidates = zones.map((zone) => {
    const instDistance = distanceToRange(price, zone.institutional);
    const negDistance = distanceToRange(price, zone.negotiated);

    const bestDistance = Math.min(
      instDistance ?? Number.POSITIVE_INFINITY,
      negDistance ?? Number.POSITIVE_INFINITY
    );

    return {
      ...zone,
      distanceToInstitutional: instDistance,
      distanceToNegotiated: negDistance,
      bestDistance,
      insideInstitutional: priceInsideRange(price, zone.institutional),
      insideNegotiated: priceInsideRange(price, zone.negotiated),
      aboveInstitutional: priceAboveRange(price, zone.institutional),
      aboveNegotiated: priceAboveRange(price, zone.negotiated),
      belowInstitutional: priceBelowRange(price, zone.institutional),
      belowNegotiated: priceBelowRange(price, zone.negotiated),
    };
  });

  return candidates.sort((a, b) => a.bestDistance - b.bestDistance)[0] || null;
}

function chooseNearestShelf(price) {
  const payload = readJsonFileOptional(SHELVES_FILE);
  const levels = Array.isArray(payload?.levels) ? payload.levels : [];

  if (!levels.length || !Number.isFinite(price)) {
    return null;
  }

  const candidates = levels
    .map((level) => {
      const range =
        Number.isFinite(safeNumber(level?.lo)) && Number.isFinite(safeNumber(level?.hi))
          ? {
              lo: Math.min(safeNumber(level.lo), safeNumber(level.hi)),
              hi: Math.max(safeNumber(level.lo), safeNumber(level.hi)),
              raw: `${level.lo}-${level.hi}`,
            }
          : rangeFromPriceRange(level?.priceRange);

      const distance = distanceToRange(price, range);

      return {
        id: level?.id || null,
        symbol: level?.symbol || "ES",
        type: level?.type || null,
        price: safeNumber(level?.price),
        lo: range?.lo ?? null,
        hi: range?.hi ?? null,
        mid: range ? rangeMid(range) : null,
        strength: safeNumber(level?.strength),
        confidence: safeNumber(level?.confidence),
        active: level?.active === true,
        rangeSource: level?.rangeSource || "auto",
        diagnostic: level?.diagnostic || null,
        distance,
        inside: priceInsideRange(price, range),
        above: priceAboveRange(price, range),
        below: priceBelowRange(price, range),
      };
    })
    .filter((x) => x.lo !== null && x.hi !== null && x.distance !== null);

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return (b.strength || 0) - (a.strength || 0);
  });

  return candidates[0] || null;
}

async function fetchJsonWithRetry(url, label, options = {}) {
  const maxAttempts = options.maxAttempts || 4;
  const optional = options.optional === true;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url);
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          `${label} invalid JSON attempt ${attempt}: ${text.slice(0, 300)}`
        );
      }

      if (!res.ok) {
        throw new Error(
          `${label} HTTP ${res.status} attempt ${attempt}: ${text.slice(0, 500)}`
        );
      }

      return json;
    } catch (err) {
      lastError = err;
      console.warn(
        `[${ENGINE_NAME}] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`
      );

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  if (optional) {
    return {
      ok: false,
      unavailable: true,
      sourceUrl: url,
      error: `${label} failed after ${maxAttempts} attempts: ${lastError?.message}`,
    };
  }

  throw new Error(`${label} failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

function normalizeBars(rawBars) {
  if (!Array.isArray(rawBars)) {
    throw new Error("ES 1H OHLC response was not an array.");
  }

  return rawBars
    .map((bar) => ({
      time: bar.time,
      open: safeNumber(bar.open),
      high: safeNumber(bar.high),
      low: safeNumber(bar.low),
      close: safeNumber(bar.close),
      volume: safeNumber(bar.volume),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close)
    );
}

function candleCloseLocation(bar) {
  if (!bar || bar.high === bar.low) return null;
  return round2(((bar.close - bar.low) / (bar.high - bar.low)) * 100);
}

function computeShortTermRead(bars) {
  const last = bars[bars.length - 1] || null;
  const prev = bars[bars.length - 2] || null;
  const recent = bars.slice(-6);

  const lowerHighs =
    recent.length >= 4 &&
    recent[recent.length - 1].high < recent[recent.length - 3].high;

  const lowerLows =
    recent.length >= 4 &&
    recent[recent.length - 1].low < recent[recent.length - 3].low;

  const redCount = recent.filter((bar) => bar.close < bar.open).length;
  const weakClose =
    last && Number.isFinite(candleCloseLocation(last))
      ? candleCloseLocation(last) < 40
      : false;

  const downsidePressure =
    redCount >= 3 || lowerHighs || lowerLows || weakClose;

  return {
    last,
    prev,
    recentBarsUsed: recent.length,
    redCount,
    lowerHighs,
    lowerLows,
    weakClose,
    closeLocationPct: candleCloseLocation(last),
    downsidePressure,
  };
}

function getLatestContext(contextFile) {
  const context = readJsonFile(contextFile);
  const rows = normalizeRows(context, "Macro + distribution + breadth replay");
  return rows[rows.length - 1] || null;
}

function getLatestDailyTechnical() {
  const payload = readJsonFileOptional(DAILY_TECHNICAL_FILE);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return rows[rows.length - 1] || null;
}

function getMarketHealth() {
  return readJsonFileOptional(MARKET_HEALTH_FILE);
}

function normalizeEngine3Reaction(raw) {
  const reaction = raw?.reaction || null;

  if (!reaction) {
    return {
      available: false,
      source: "ENGINE3_ES_REACTION",
      route: "/api/v1/es-reaction-score?symbol=ES&tf=10m",
      state: null,
      qualityScore: null,
      bias: null,
      quality: null,
      position: null,
      zone: raw?.zone || null,
      zoneType: raw?.zoneType || null,
      zoneSource: raw?.zoneSource || null,
      evidence: raw?.evidence || null,
      unavailableReason: raw?.error || "Engine 3 reaction object missing.",
    };
  }

  return {
    available: true,
    source: "ENGINE3_ES_REACTION",
    route: "/api/v1/es-reaction-score?symbol=ES&tf=10m",
    state: reaction.state || null,
    qualityScore: safeNumber(reaction.qualityScore),
    bias: reaction.bias || null,
    quality: reaction.quality || null,
    position: reaction.position || null,
    zone: raw?.zone || null,
    zoneType: raw?.zoneType || null,
    zoneSource: raw?.zoneSource || null,
    evidence: raw?.evidence || null,
  };
}

function normalizeEngine4Volume(raw) {
  const v = raw?.engine4EsVolume || null;

  if (!v) {
    return {
      available: false,
      source: "ENGINE4_ES_GENERAL_VOLUME",
      route: "/api/v1/es-volume-behavior?symbol=ES&tf=10m",
      zoneAwareVolumeAvailable: false,
      zoneAwareVolumeSource: "ENGINE4_ZONE_VOLUME_NOT_AVAILABLE",
      unavailableReason: raw?.error || "Engine 4 ES volume object missing.",
    };
  }

  return {
    available: true,
    source: "ENGINE4_ES_GENERAL_VOLUME",
    route: "/api/v1/es-volume-behavior?symbol=ES&tf=10m",
    zoneAwareVolumeAvailable: false,
    zoneAwareVolumeSource: "ENGINE4_ZONE_VOLUME_NOT_AVAILABLE",
    volumeScore: safeNumber(v.volumeScore),
    volumeConfirmed: v.volumeConfirmed === true,
    relativeVolume: safeNumber(v.relativeVolume),
    volumeTrend: v.volumeTrend || null,
    direction: v.direction || null,
    participationState: v.participationState || null,
    participationQuality: v.participationQuality || null,
    absorptionRisk: v.absorptionRisk || null,
    climacticVolume: v.climacticVolume || null,
    reasonCodes: Array.isArray(v.reasonCodes) ? v.reasonCodes : [],
  };
}

function isConstructiveEngine3Reaction(engine3Reaction) {
  const state = engine3Reaction?.state;
  const bias = String(engine3Reaction?.bias || "").toUpperCase();

  if (CONSTRUCTIVE_ENGINE3_STATES.has(state)) return true;

  if (state === "ACCEPTING_VALUE" && bias.includes("BULL")) {
    return true;
  }

  return false;
}

function isRiskEngine3Reaction(engine3Reaction) {
  const state = engine3Reaction?.state;
  return RISK_ENGINE3_STATES.has(state);
}

function isNeutralEngine3Reaction(engine3Reaction) {
  const state = engine3Reaction?.state;
  return NEUTRAL_ENGINE3_STATES.has(state) || !state;
}

function isBreakingAboveReaction(engine3Reaction) {
  return (
    engine3Reaction?.state === "BREAKING_ABOVE_NEGOTIATED_VALUE" ||
    engine3Reaction?.state === "BREAKING_ABOVE_DISTRIBUTION"
  );
}

function isRejectingReaction(engine3Reaction) {
  return (
    engine3Reaction?.state === "REJECTING_UPPER_ZONE" ||
    engine3Reaction?.state === "REJECTED_FROM_DISTRIBUTION"
  );
}

function buildZoneState({
  price,
  zone,
  nearestShelf,
  shortTermRead,
  latestContext,
  latestDailyTechnical,
  marketHealth,
  engine3Reaction,
  engine4VolumeContext,
}) {
  const institutional = zone?.institutional || null;
  const negotiated = zone?.negotiated || null;

  const insideInstitutional = priceInsideRange(price, institutional);
  const insideNegotiated = priceInsideRange(price, negotiated);
  const aboveInstitutional = priceAboveRange(price, institutional);
  const aboveNegotiated = priceAboveRange(price, negotiated);
  const belowInstitutional = priceBelowRange(price, institutional);
  const belowNegotiated = priceBelowRange(price, negotiated);

  const reclaimNegotiated = negotiated?.hi ?? null;
  const reclaimInstitutional = institutional?.hi ?? null;
  const failureInstitutional = institutional?.lo ?? null;
  const lowerShelf = negotiated?.lo ?? null;

  const distributionLabel =
    latestContext?.distributionPressure?.label || "DISTRIBUTION_UNKNOWN";
  const breadthLabel =
    latestContext?.breadthParticipation?.label || "BREADTH_UNKNOWN";
  const finalPermission =
    latestContext?.historicalEsPermissionMacroDistributionBreadthAware ||
    "A_PLUS_ONLY";

  const esVolumeDistribution =
    latestDailyTechnical?.esVolumeDistribution ||
    latestDailyTechnical?.daily?.esVolumeDistribution ||
    null;

  const esVolumeState = esVolumeDistribution?.state || null;
  const esHighVolumeWeakClose = esVolumeDistribution?.highVolumeWeakClose === true;
  const esVolumeExpansionIntoSelloff =
    esVolumeDistribution?.volumeExpansionIntoSelloff === true ||
    esVolumeState === "ES_VOLUME_EXPANSION_SELLOFF";

  const intradayDamageLabel =
    marketHealth?.intradayProxyDamage?.label ||
    marketHealth?.intradayProxyDamage?.intradayProxyDamage?.label ||
    null;

  const intradayDistributionActive =
    intradayDamageLabel === "INTRADAY_DISTRIBUTION_ACTIVE";

  const engine3Risk = isRiskEngine3Reaction(engine3Reaction);
  const engine3Constructive = isConstructiveEngine3Reaction(engine3Reaction);
  const engine3Neutral = isNeutralEngine3Reaction(engine3Reaction);
  const engine3Rejecting = isRejectingReaction(engine3Reaction);

  const engine4VolumeConfirmed = engine4VolumeContext?.volumeConfirmed === true;
  const engine4ParticipationState = engine4VolumeContext?.participationState || null;

  const weakCloseProvisional =
    shortTermRead?.weakClose === true ||
    esHighVolumeWeakClose ||
    (Number.isFinite(shortTermRead?.closeLocationPct) &&
      shortTermRead.closeLocationPct < 40);

  const failedReclaimProvisional =
    engine3Risk &&
    weakCloseProvisional &&
    (belowNegotiated || belowInstitutional || engine3Rejecting);

  const highVolumeRejectionProvisional =
    engine3Rejecting &&
    (esHighVolumeWeakClose || esVolumeExpansionIntoSelloff || engine4VolumeConfirmed);

  const sellerExhaustionWatchProvisional =
    engine3Constructive &&
    (engine4ParticipationState === "ABSORPTION" ||
      engine4VolumeContext?.absorptionRisk === true ||
      String(engine4VolumeContext?.absorptionRisk || "").toUpperCase().includes("HIGH_VOLUME_POOR_PROGRESS"));

const engine3ShelfDefense =
  engine3Constructive &&
  engine3Reaction?.zoneSource === "ENGINE_1B_ES_SMZ_SHELVES" &&
  engine3Reaction?.zoneType === "accumulation";

const secondaryShelfDefense =
  engine3ShelfDefense &&
  belowInstitutional &&
  nearestShelf?.inside === true;

const accumulationWatch =
  engine3Constructive &&
  !secondaryShelfDefense &&
  !belowInstitutional &&
  !intradayDistributionActive;

  const distributionRejection =
    engine3Risk || highVolumeRejectionProvisional || intradayDistributionActive;

  const reasonCodes = [];
  const requiredConfirmation = [];

  let state = "NO_ACCUMULATION_SIGNAL";
  let permission = finalPermission;
  let tone = "neutral";
  let provisional = false;

  reasonCodes.push("ENGINE25G_LIVE_ZONE_AWARE_READ");
  reasonCodes.push("HISTORICAL_ZONE_LOGIC_DISABLED_NO_ZONE_SNAPSHOTS");

  if (engine3Reaction?.available) {
    reasonCodes.push(`ENGINE3_REACTION_${engine3Reaction.state || "UNKNOWN"}`);
  } else {
    reasonCodes.push("ENGINE3_REACTION_UNAVAILABLE");
  }

  if (engine4VolumeContext?.available) {
    reasonCodes.push(`ENGINE4_GENERAL_VOLUME_${engine4ParticipationState || "UNKNOWN"}`);
  } else {
    reasonCodes.push("ENGINE4_VOLUME_UNAVAILABLE");
  }

  if (engine4VolumeContext?.zoneAwareVolumeAvailable === false) {
    reasonCodes.push("ENGINE4_ZONE_AWARE_VOLUME_NOT_AVAILABLE");
  }

  if (intradayDistributionActive) {
    reasonCodes.push("INTRADAY_DISTRIBUTION_ACTIVE");
  }

  if (esVolumeExpansionIntoSelloff) {
    reasonCodes.push("ES_VOLUME_EXPANSION_INTO_SELLOFF");
  }

  if (esHighVolumeWeakClose) {
    reasonCodes.push("ES_HIGH_VOLUME_WEAK_CLOSE");
  }

  if (weakCloseProvisional) {
    reasonCodes.push("WEAK_CLOSE_PROVISIONAL_ENGINE25");
  }

  if (failedReclaimProvisional) {
    reasonCodes.push("FAILED_RECLAIM_PROVISIONAL_ENGINE25");
  }

  if (insideNegotiated) {
    reasonCodes.push("PRICE_INSIDE_MANUAL_NEGOTIATED_ZONE");
  } else if (insideInstitutional) {
    reasonCodes.push("PRICE_INSIDE_MANUAL_INSTITUTIONAL_ZONE");
  } else if (belowInstitutional) {
    reasonCodes.push("PRICE_BELOW_MANUAL_INSTITUTIONAL_ZONE");
  } else if (aboveInstitutional) {
    reasonCodes.push("PRICE_ABOVE_MANUAL_INSTITUTIONAL_ZONE");
  }

  if (nearestShelf?.inside) {
    reasonCodes.push(`PRICE_INSIDE_AUTO_${String(nearestShelf.type || "SHELF").toUpperCase()}_SHELF`);
  }

  if (secondaryShelfDefense) {
    reasonCodes.push("SECONDARY_AUTO_SHELF_DEFENSE_ACTIVE");
    reasonCodes.push("MANUAL_INSTITUTIONAL_ZONE_PRIORITY_STILL_CONTROLS");
  }

  requiredConfirmation.push("Engine 3 must show reclaim / defense / acceptance improving.");
  requiredConfirmation.push("ES must reclaim negotiated or institutional value.");
  requiredConfirmation.push("Breadth and distribution must stop deteriorating.");
  requiredConfirmation.push("Engine 6 remains final permission referee.");

  if (
    engine3Risk &&
    weakCloseProvisional &&
    (esVolumeExpansionIntoSelloff || esHighVolumeWeakClose || intradayDistributionActive)
  ) {
    state = "FAILED_RECLAIM_WEAK_CLOSE";
    permission = "NO_NORMAL_LONGS_ZONE_REACTION_WEAK";
    tone = "defensive";
    provisional = true;
    requiredConfirmation.unshift("Failed-reclaim / weak-close read is provisional until Engine 3 exposes stable zoneCandleReaction.");
  } else if (
    engine3Risk &&
    (insideNegotiated || insideInstitutional || belowNegotiated || belowInstitutional)
  ) {
    state = insideNegotiated || insideInstitutional
      ? "DISTRIBUTION_REJECTION_AT_NEGOTIATED_ZONE"
      : "INSTITUTIONAL_SUPPORT_AT_RISK";
    permission = "NO_NORMAL_LONGS_ZONE_REACTION_WEAK";
    tone = "defensive";
    provisional = true;
    requiredConfirmation.unshift("Need reclaim back above value before long permission can improve.");
  } else if (belowInstitutional && (shortTermRead.downsidePressure || intradayDistributionActive)) {
    state = "INSTITUTIONAL_SUPPORT_AT_RISK";
    permission = "NO_BLIND_LONGS_ZONE_AT_RISK";
    tone = "defensive";
    provisional = false;
  } else if (engine3Constructive && isBreakingAboveReaction(engine3Reaction) && engine4VolumeConfirmed) {
    state = "CONFIRMED_RECLAIM_LONG_PERMISSION";
    permission = "LONG_PERMISSION_IMPROVING_CONFIRMATION_REQUIRED";
    tone = "constructive";
    provisional = false;
    requiredConfirmation.unshift("Engine 6 must confirm final trade permission before execution.");
  } else if (engine3Constructive) {
    state = "ACCUMULATION_RECLAIM_WATCH";
    permission = "A_PLUS_RECLAIM_ONLY";
    tone = "watch";
    provisional = false;
    requiredConfirmation.unshift("Need reclaim confirmation before treating this as a long setup.");
  } else if (insideInstitutional && insideNegotiated && shortTermRead.downsidePressure) {
    state = "NEGOTIATED_ZONE_DECISION_POINT_WEAK";
    permission = "A_PLUS_ONLY_RECLAIM_REQUIRED";
    tone = "caution";
  } else if (insideInstitutional && belowNegotiated) {
    state = "WEAK_BELOW_NEGOTIATED_VALUE";
    permission = "A_PLUS_ONLY_RECLAIM_REQUIRED";
    tone = "caution";
  } else if (insideInstitutional) {
    state = "INSIDE_INSTITUTIONAL_VALUE_DECISION_POINT";
    permission = "WATCH_FOR_RECLAIM_CONFIRMATION";
    tone = "watch";
  } else if (aboveNegotiated && aboveInstitutional && !engine3Neutral) {
    state = "ABOVE_INSTITUTIONAL_VALUE";
    permission = "SELECTIVE_LONGS_IF_PULLBACK_HOLDS";
    tone = "constructive";
  }

  if (
    distributionLabel === "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE" &&
    breadthLabel === "BREADTH_PARTICIPATION_WEAK"
  ) {
    reasonCodes.push("WEAK_BREADTH_AND_FRAGILE_DISTRIBUTION");

    if (tone === "constructive") {
      tone = "selective";
    }

    if (
      permission === "SELECTIVE_LONGS_IF_PULLBACK_HOLDS" ||
      permission === "WATCH_FOR_RECLAIM_CONFIRMATION" ||
      permission === "LONG_PERMISSION_IMPROVING_CONFIRMATION_REQUIRED"
    ) {
      permission = "A_PLUS_ONLY_WEAK_BREADTH";
    }
  }

  if (distributionLabel === "DISTRIBUTION_PRESSURE_ELEVATED") {
    reasonCodes.push("DISTRIBUTION_PRESSURE_ELEVATED");
  }

  if (breadthLabel === "BREADTH_PARTICIPATION_WEAK") {
    reasonCodes.push("BREADTH_PARTICIPATION_WEAK");
  }

  return {
    state,
    permission,
    tone,

    reasonCodes,
    requiredConfirmation,

    failedReclaim: {
      value: failedReclaimProvisional,
      source: failedReclaimProvisional ? "ENGINE25_PROVISIONAL_FROM_ENGINE3_REACTION_AND_WEAK_CLOSE" : null,
      stable: false,
      note: "Engine 3 does not yet expose stable failedReclaim / zoneCandleReaction fields.",
    },

    weakClose: {
      value: weakCloseProvisional,
      source: weakCloseProvisional ? "ENGINE25_PROVISIONAL_FROM_1H_CLOSE_LOCATION_AND_ES_DAILY_VOLUME" : null,
      stable: false,
      closeLocationPct: shortTermRead?.closeLocationPct ?? null,
      note: "Engine 3 does not yet expose stable closeLocationWeak fields.",
    },

    highVolumeRejection: {
      value: highVolumeRejectionProvisional,
      source: highVolumeRejectionProvisional ? "ENGINE25_PROVISIONAL_ENGINE3_REJECTION_PLUS_GENERAL_VOLUME_CONTEXT" : null,
      stable: false,
      note: "Engine 4 does not yet expose true ES volume-in-zone labels.",
    },

    sellerExhaustionWatch: {
      value: sellerExhaustionWatchProvisional,
      source: sellerExhaustionWatchProvisional ? "ENGINE25_PROVISIONAL_ENGINE3_CONSTRUCTIVE_PLUS_ENGINE4_GENERAL_VOLUME" : null,
      stable: false,
    },

    accumulationWatch: {
      value: accumulationWatch,
      source: accumulationWatch ? "ENGINE3_CONSTRUCTIVE_REACTION" : null,
      stable: true,
    },

    secondaryShelfDefense: {
      value: secondaryShelfDefense,
      source: secondaryShelfDefense
        ? "ENGINE3_CONSTRUCTIVE_REACTION_ON_AUTO_ACCUMULATION_SHELF"
        : null,
      stable: true,
      note: "Secondary auto-shelf defense does not override higher-priority manual institutional support risk.",
    }, 

    distributionRejection: {
      value: distributionRejection,
      source: distributionRejection ? "ENGINE3_RISK_REACTION_OR_INTRADAY_DISTRIBUTION" : null,
      stable: engine3Risk,
    },

    provisional,
    zoneAwareVolumeAvailable: false,
    zoneAwareVolumeSource: "ENGINE4_ZONE_VOLUME_NOT_AVAILABLE",

    historicalZoneLogic: {
      enabled: false,
      reason: "Engine 1/3/4 do not currently write historical ES zone snapshots. Current zones are not applied to old candles.",
    },

    insideInstitutional,
    insideNegotiated,
    aboveInstitutional,
    aboveNegotiated,
    belowInstitutional,
    belowNegotiated,
    reclaimNegotiated,
    reclaimInstitutional,
    failureInstitutional,
    lowerShelf,

    engine3Reaction: {
      available: engine3Reaction?.available === true,
      state: engine3Reaction?.state || null,
      qualityScore: engine3Reaction?.qualityScore ?? null,
      bias: engine3Reaction?.bias || null,
      quality: engine3Reaction?.quality || null,
      position: engine3Reaction?.position || null,
      zoneType: engine3Reaction?.zoneType || null,
      zoneSource: engine3Reaction?.zoneSource || null,
    },

    engine4VolumeContext: {
      available: engine4VolumeContext?.available === true,
      zoneAwareVolumeAvailable: false,
      volumeScore: engine4VolumeContext?.volumeScore ?? null,
      volumeConfirmed: engine4VolumeConfirmed,
      relativeVolume: engine4VolumeContext?.relativeVolume ?? null,
      volumeTrend: engine4VolumeContext?.volumeTrend || null,
      direction: engine4VolumeContext?.direction || null,
      participationState: engine4ParticipationState,
      participationQuality: engine4VolumeContext?.participationQuality || null,
      reasonCodes: engine4VolumeContext?.reasonCodes || [],
    },
  };
}

function buildPlainEnglish({
  price,
  zone,
  nearestShelf,
  zoneState,
  latestContext,
  shortTermRead,
  engine3Reaction,
  engine4VolumeContext,
}) {
  const lines = [];

  const distributionLabel =
    latestContext?.distributionPressure?.label || "DISTRIBUTION_UNKNOWN";
  const breadthLabel =
    latestContext?.breadthParticipation?.label || "BREADTH_UNKNOWN";

  if (zoneState.state === "FAILED_RECLAIM_WEAK_CLOSE") {
    lines.push("ES has a provisional failed-reclaim / weak-close read near the active manual zone context.");
  } else if (zoneState.state === "DISTRIBUTION_REJECTION_AT_NEGOTIATED_ZONE") {
    lines.push("ES reaction is weak around negotiated or institutional value, so normal longs are blocked.");
  } else if (zoneState.state === "ACCUMULATION_RECLAIM_WATCH") {
    lines.push("ES reaction is constructive enough for an accumulation reclaim watch, but it still needs confirmation.");
  } else if (zoneState.state === "CONFIRMED_RECLAIM_LONG_PERMISSION") {
    lines.push("ES is showing a constructive reclaim reaction with general volume participation improving.");
  } else if (zoneState.state === "WEAK_BELOW_NEGOTIATED_VALUE") {
    lines.push("ES is below negotiated value and struggling to reclaim institutional support.");
  } else if (zoneState.state === "NEGOTIATED_ZONE_DECISION_POINT_WEAK") {
    lines.push("ES is sitting inside negotiated/institutional value, but short-term pressure is weak.");
  } else if (zoneState.state === "INSTITUTIONAL_SUPPORT_AT_RISK") {
    lines.push("ES is trading below institutional support and the zone is at risk.");
  } else if (zoneState.state === "INSIDE_INSTITUTIONAL_VALUE_DECISION_POINT") {
    lines.push("ES is inside institutional value. This is a decision zone, not a clean long yet.");
  } else if (zoneState.state === "ABOVE_INSTITUTIONAL_VALUE") {
    lines.push("ES is above institutional value, but longs still need confirmation from breadth and distribution pressure.");
  } else {
    lines.push("ES is not currently giving a clean zone-aware accumulation signal.");
  }

  if (engine3Reaction?.available) {
    lines.push(`Engine 3 reaction is ${engine3Reaction.state || "unknown"} with ${engine3Reaction.bias || "unknown"} bias.`);
  } else {
    lines.push("Engine 3 ES reaction is unavailable, so zone reaction confidence is reduced.");
  }

  if (engine4VolumeContext?.available) {
    lines.push(
      `Engine 4 shows general ES volume participation as ${engine4VolumeContext.participationState || "unknown"}, but true volume-in-zone is not available yet.`
    );
  } else {
    lines.push("Engine 4 ES volume context is unavailable.");
  }

  if (distributionLabel === "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE") {
    lines.push("Distribution pressure is fragile under the surface.");
  } else if (distributionLabel === "DISTRIBUTION_PRESSURE_ELEVATED") {
    lines.push("Distribution pressure is elevated.");
  } else if (distributionLabel === "DISTRIBUTION_PRESSURE_HIGH") {
    lines.push("Distribution pressure is high.");
  } else {
    lines.push(`Distribution pressure: ${distributionLabel}.`);
  }

  if (breadthLabel === "BREADTH_PARTICIPATION_WEAK") {
    lines.push("Breadth participation is weak.");
  } else if (breadthLabel === "BREADTH_PARTICIPATION_MIXED") {
    lines.push("Breadth participation is mixed.");
  } else if (breadthLabel === "BREADTH_PARTICIPATION_IMPROVING") {
    lines.push("Breadth participation is improving.");
  } else {
    lines.push(`Breadth participation: ${breadthLabel}.`);
  }

  if (shortTermRead.downsidePressure) {
    lines.push("The last several 1-hour candles show downside pressure or weak closes.");
  }

  if (zoneState.provisional) {
    lines.push("Some failed-reclaim or weak-close fields are provisional until Engine 3 adds stable zoneCandleReaction and Engine 4 adds zone-aware volume.");
  }

  if (
    zoneState.permission === "NO_NORMAL_LONGS_ZONE_REACTION_WEAK" ||
    zoneState.permission === "NO_BLIND_LONGS_ZONE_AT_RISK"
  ) {
    lines.push("No normal longs until ES reclaims value and Engine 6 confirms permission.");
  } else {
    lines.push("Longs remain A+ only and reduced size until ES reclaims value.");
  }

  if (zoneState.reclaimNegotiated !== null) {
    lines.push(`First reclaim level: ${zoneState.reclaimNegotiated}.`);
  }

  if (zoneState.reclaimInstitutional !== null) {
    lines.push(`Stronger confirmation above institutional value: ${zoneState.reclaimInstitutional}.`);
  }

  if (zoneState.failureInstitutional !== null) {
    lines.push(`Failure below ${zoneState.failureInstitutional} keeps the zone at risk.`);
  }

  if (nearestShelf?.id) {
    lines.push(`Nearest auto shelf is ${nearestShelf.type || "shelf"} ${nearestShelf.lo}–${nearestShelf.hi}.`);
  }

  return lines.join(" ");
}

async function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: ENGINE_NAME,
    modelType: MODEL_TYPE,
    symbol: "ES",
    timeframe: "1h",
    startedAt,
    finishedAt: null,
    generatedAtUtc: null,
    source: {
      manualZonesFile: "es-smz-manual-zones.txt",
      manualStructuresFile: "es-smz-manual-structures.json",
      shelvesFile: "es-smz-shelves.json",
      contextFile: "engine25-historical-replay-macro-distribution-breadth-6mo.json",
      dailyTechnicalFile: "engine25-es-replay-daily-technical-6mo.json",
      marketHealthFile: "engine25-market-health.json",
      esOhlcUrl: ES_1H_URL,
      engine3ReactionUrl: ES_REACTION_URL,
      engine4VolumeUrl: ES_VOLUME_URL,
      outputFile: "engine25-es-zone-aware-read.json",
    },
    ownership: {
      engine1: "manual ES zones / shelves",
      engine3: "ES price reaction around zones",
      engine4: "general ES futures volume participation only; zone-aware volume not available",
      engine25: "macro / breadth / distribution context layered on top",
      engine6: "final permission referee",
    },
    current: null,
    nearestZone: null,
    nearestShelf: null,
    context: null,
    engine3Reaction: null,
    engine4VolumeContext: null,
    zoneState: null,
    plainEnglish: null,
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25G ES Zone-Aware Read");
    console.log("========================================");

    const zoneText = readTextFile(MANUAL_ZONES_FILE);
    const zones = parseManualZones(zoneText);

    if (!zones.length) {
      throw new Error("No manual ES zones parsed.");
    }

    const [
      rawBars,
      rawEngine3Reaction,
      rawEngine4Volume,
    ] = await Promise.all([
      fetchJsonWithRetry(ES_1H_URL, "ES 1H OHLC"),
      fetchJsonWithRetry(ES_REACTION_URL, "Engine 3 ES reaction", {
        optional: true,
        maxAttempts: 2,
      }),
      fetchJsonWithRetry(ES_VOLUME_URL, "Engine 4 ES volume", {
        optional: true,
        maxAttempts: 2,
      }),
    ]);

    const bars = normalizeBars(rawBars);

    if (!bars.length) {
      throw new Error("No ES 1H bars returned.");
    }

    const shortTermRead = computeShortTermRead(bars);
    const lastBar = shortTermRead.last;

    const price = safeNumber(lastBar?.close);

    if (!Number.isFinite(price)) {
      throw new Error("Latest ES 1H close is missing.");
    }

    const latestContext = getLatestContext(CONTEXT_FILE);
    const latestDailyTechnical = getLatestDailyTechnical();
    const marketHealth = getMarketHealth();

    const nearestZone = chooseNearestZone(price, zones);

    if (!nearestZone) {
      throw new Error("Unable to identify nearest manual ES zone.");
    }

    const nearestShelf = chooseNearestShelf(price);
    const manualStructureSummary = buildManualStructureSummary();

    const engine3Reaction = normalizeEngine3Reaction(rawEngine3Reaction);
    const engine4VolumeContext = normalizeEngine4Volume(rawEngine4Volume);

    const zoneState = buildZoneState({
      price,
      zone: nearestZone,
      nearestShelf,
      shortTermRead,
      latestContext,
      latestDailyTechnical,
      marketHealth,
      engine3Reaction,
      engine4VolumeContext,
    });

    const plainEnglish = buildPlainEnglish({
      price,
      zone: nearestZone,
      nearestShelf,
      zoneState,
      latestContext,
      shortTermRead,
      engine3Reaction,
      engine4VolumeContext,
    });

    output.ok = true;
    output.current = {
      price,
      lastBar,
      shortTermRead,
    };

    output.nearestZone = {
      id: nearestZone.id,
      note: nearestZone.note,
      source: nearestZone.source,
      priorityRule: "manual negotiated > manual institutional > auto shelf",
      institutional: nearestZone.institutional
        ? {
            ...nearestZone.institutional,
            mid: rangeMid(nearestZone.institutional),
            distance: nearestZone.distanceToInstitutional,
          }
        : null,
      negotiated: nearestZone.negotiated
        ? {
            ...nearestZone.negotiated,
            mid: rangeMid(nearestZone.negotiated),
            distance: nearestZone.distanceToNegotiated,
          }
        : null,
      rawLine: nearestZone.rawLine,
      manualStructureSummary,
    };

    output.nearestShelf = nearestShelf;

    output.context = {
      latestContextDate: latestContext?.date || null,
      macroAwareScore: latestContext?.engine25HistoricalScoreMacroAware ?? null,
      distributionPressure: latestContext?.distributionPressure
        ? {
            score: latestContext.distributionPressure.score,
            label: latestContext.distributionPressure.label,
            interpretation: latestContext.distributionPressure.interpretation,
          }
        : null,
      breadthParticipation: latestContext?.breadthParticipation
        ? {
            score: latestContext.breadthParticipation.score,
            label: latestContext.breadthParticipation.label,
            interpretation: latestContext.breadthParticipation.interpretation,
          }
        : null,
      finalPermission:
        latestContext?.historicalEsPermissionMacroDistributionBreadthAware ||
        null,
      finalSize:
        latestContext?.macroDistributionBreadthAwareSizeMultiplier ?? null,
      esVolumeDistribution: latestDailyTechnical?.esVolumeDistribution || null,
      intradayProxyDamage: marketHealth?.intradayProxyDamage || null,
    };

    output.engine3Reaction = engine3Reaction;
    output.engine4VolumeContext = engine4VolumeContext;
    output.zoneState = zoneState;
    output.plainEnglish = plainEnglish;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25G ES Zone-Aware Read Complete");
    console.log("OK:", output.ok);
    console.log("Price:", output.current.price);
    console.log("Zone:", output.nearestZone.id);
    console.log("State:", output.zoneState.state);
    console.log("Permission:", output.zoneState.permission);
    console.log("Engine 3:", output.engine3Reaction.state);
    console.log("Engine 4:", output.engine4VolumeContext.participationState);
    console.log("Plain English:", output.plainEnglish);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          price: output.current.price,
          nearestZone: output.nearestZone,
          nearestShelf: output.nearestShelf,
          context: output.context,
          engine3Reaction: output.engine3Reaction,
          engine4VolumeContext: output.engine4VolumeContext,
          zoneState: output.zoneState,
          plainEnglish: output.plainEnglish,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.generatedAtUtc = output.finishedAt;
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25G ES Zone-Aware Read Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
