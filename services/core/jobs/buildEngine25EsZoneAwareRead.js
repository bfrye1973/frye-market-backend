// services/core/jobs/buildEngine25EsZoneAwareRead.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MANUAL_ZONES_FILE = path.join(DATA_DIR, "es-smz-manual-zones.txt");

const CONTEXT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-distribution-breadth-6mo.json"
);

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-es-zone-aware-read.json");

const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const ES_1H_URL = `${BACKEND_BASE}/api/v1/futures/ohlc?symbol=ES&timeframe=1h&limit=120`;

const ENGINE_NAME = "engine25.esZoneAwareRead.v0.1";
const MODEL_TYPE = "ES_ZONE_AWARE_PERMISSION_READ";

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

async function fetchJsonWithRetry(url, label) {
  const maxAttempts = 4;
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
      console.warn(`[${ENGINE_NAME}] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`);

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
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

function buildZoneState({ price, zone, shortTermRead, latestContext }) {
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

  let state = "NO_ZONE_CONTEXT";
  let permission = finalPermission;
  let tone = "neutral";

  if (insideInstitutional && insideNegotiated && shortTermRead.downsidePressure) {
    state = "NEGOTIATED_ZONE_DECISION_POINT_WEAK";
    permission = "A_PLUS_ONLY_RECLAIM_REQUIRED";
    tone = "caution";
  } else if (insideInstitutional && belowNegotiated) {
    state = "WEAK_BELOW_NEGOTIATED_VALUE";
    permission = "A_PLUS_ONLY_RECLAIM_REQUIRED";
    tone = "caution";
  } else if (belowInstitutional) {
    state = "INSTITUTIONAL_SUPPORT_AT_RISK";
    permission = "NO_BLIND_LONGS_ZONE_AT_RISK";
    tone = "defensive";
  } else if (insideInstitutional) {
    state = "INSIDE_INSTITUTIONAL_VALUE_DECISION_POINT";
    permission = "WATCH_FOR_RECLAIM_CONFIRMATION";
    tone = "watch";
  } else if (aboveNegotiated && aboveInstitutional) {
    state = "ABOVE_INSTITUTIONAL_VALUE";
    permission = "SELECTIVE_LONGS_IF_PULLBACK_HOLDS";
    tone = "constructive";
  }

  if (
    distributionLabel === "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE" &&
    breadthLabel === "BREADTH_PARTICIPATION_WEAK"
  ) {
    if (tone === "constructive") {
      tone = "selective";
    }

    if (
      permission === "SELECTIVE_LONGS_IF_PULLBACK_HOLDS" ||
      permission === "WATCH_FOR_RECLAIM_CONFIRMATION"
    ) {
      permission = "A_PLUS_ONLY_WEAK_BREADTH";
    }
  }

  return {
    state,
    permission,
    tone,
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
  };
}

function buildPlainEnglish({ price, zone, zoneState, latestContext, shortTermRead }) {
  const lines = [];

  const institutional = zone?.institutional;
  const negotiated = zone?.negotiated;

  const distributionLabel =
    latestContext?.distributionPressure?.label || "DISTRIBUTION_UNKNOWN";
  const breadthLabel =
    latestContext?.breadthParticipation?.label || "BREADTH_UNKNOWN";

  if (zoneState.state === "WEAK_BELOW_NEGOTIATED_VALUE") {
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
    lines.push("ES is not currently giving a clean zone-aware signal.");
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

  lines.push("Longs remain A+ only and reduced size until ES reclaims value.");

  if (zoneState.reclaimNegotiated !== null) {
    lines.push(`First reclaim level: ${zoneState.reclaimNegotiated}.`);
  }

  if (zoneState.reclaimInstitutional !== null) {
    lines.push(`Stronger confirmation above institutional value: ${zoneState.reclaimInstitutional}.`);
  }

  if (zoneState.failureInstitutional !== null) {
    lines.push(`Failure below ${zoneState.failureInstitutional} keeps the zone at risk.`);
  }

  if (zone?.id === "MANUAL_ES_ZONE_02" || zone?.id === "MANUAL_ES_ZONE_03") {
    lines.push("If this zone fails, watch the lower negotiated shelf near 7350.25–7337.25.");
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
      contextFile:
        "engine25-historical-replay-macro-distribution-breadth-6mo.json",
      esOhlcUrl: ES_1H_URL,
      outputFile: "engine25-es-zone-aware-read.json",
    },
    current: null,
    nearestZone: null,
    context: null,
    zoneState: null,
    plainEnglish: null,
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 ES Zone-Aware Read");
    console.log("========================================");

    const zoneText = readTextFile(MANUAL_ZONES_FILE);
    const zones = parseManualZones(zoneText);

    if (!zones.length) {
      throw new Error("No manual ES zones parsed.");
    }

    const rawBars = await fetchJsonWithRetry(ES_1H_URL, "ES 1H OHLC");
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
    const nearestZone = chooseNearestZone(price, zones);

    if (!nearestZone) {
      throw new Error("Unable to identify nearest manual ES zone.");
    }

    const zoneState = buildZoneState({
      price,
      zone: nearestZone,
      shortTermRead,
      latestContext,
    });

    const plainEnglish = buildPlainEnglish({
      price,
      zone: nearestZone,
      zoneState,
      latestContext,
      shortTermRead,
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
    };
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
    };
    output.zoneState = zoneState;
    output.plainEnglish = plainEnglish;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 ES Zone-Aware Read Complete");
    console.log("OK:", output.ok);
    console.log("Price:", output.current.price);
    console.log("Zone:", output.nearestZone.id);
    console.log("State:", output.zoneState.state);
    console.log("Permission:", output.zoneState.permission);
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
          context: output.context,
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

    console.error("Engine 25 ES Zone-Aware Read Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
