// services/core/jobs/buildEngine25ZoneReactionReplay6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const ZONE_FILE = path.join(DATA_DIR, "es-smz-manual-zones.txt");

const REPLAY_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-zone-reaction-replay-6mo.json"
);

const ENGINE_NAME = "engine25.zoneReactionReplay.v0.1";
const MODEL_TYPE = "MANUAL_ES_ZONE_REACTION_REPLAY";

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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
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

  if (!Number.isFinite(n1) || !Number.isFinite(n2)) {
    return null;
  }

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

    // If the line has no left-side institutional range and no prior institutional exists,
    // use the negotiated range as its own institutional/value zone.
    const effectiveInstitutional =
      currentInstitutional ||
      (negotiatedRange
        ? {
            lo: negotiatedRange.lo,
            hi: negotiatedRange.hi,
            raw: negotiatedRange.raw,
          }
        : null);

    if (!negotiatedRange && !effectiveInstitutional) {
      continue;
    }

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

function normalizeRows(block) {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block?.rows)) return block.rows;
  throw new Error("Replay file does not contain rows.");
}

function rangeMid(range) {
  if (!range) return null;
  return round2((range.lo + range.hi) / 2);
}

function rangeWidth(range) {
  if (!range) return null;
  return round2(range.hi - range.lo);
}

function candleRange(row) {
  const high = safeNumber(row.esHigh);
  const low = safeNumber(row.esLow);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  return Math.max(0, high - low);
}

function closeLocation(row) {
  const high = safeNumber(row.esHigh);
  const low = safeNumber(row.esLow);
  const close = safeNumber(row.esClose);

  if (
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    high === low
  ) {
    return null;
  }

  return round2(((close - low) / (high - low)) * 100);
}

function candleTouchesRange(row, range) {
  if (!range) return false;

  const high = safeNumber(row.esHigh);
  const low = safeNumber(row.esLow);

  if (!Number.isFinite(high) || !Number.isFinite(low)) return false;

  return low <= range.hi && high >= range.lo;
}

function closeInsideRange(row, range) {
  if (!range) return false;

  const close = safeNumber(row.esClose);
  if (!Number.isFinite(close)) return false;

  return close >= range.lo && close <= range.hi;
}

function closeAboveRange(row, range) {
  if (!range) return false;

  const close = safeNumber(row.esClose);
  if (!Number.isFinite(close)) return false;

  return close > range.hi;
}

function closeBelowRange(row, range) {
  if (!range) return false;

  const close = safeNumber(row.esClose);
  if (!Number.isFinite(close)) return false;

  return close < range.lo;
}

function distanceToRangePct(row, range) {
  if (!range) return null;

  const close = safeNumber(row.esClose);
  if (!Number.isFinite(close) || close === 0) return null;

  if (close >= range.lo && close <= range.hi) return 0;

  const distance =
    close < range.lo ? range.lo - close : close - range.hi;

  return round2((distance / close) * 100);
}

function buildZoneReaction(row, zone) {
  const institutional = zone.institutional;
  const negotiated = zone.negotiated;

  const touchedInstitutional = candleTouchesRange(row, institutional);
  const touchedNegotiated = candleTouchesRange(row, negotiated);

  const closeInsideInstitutional = closeInsideRange(row, institutional);
  const closeInsideNegotiated = closeInsideRange(row, negotiated);

  const closeAboveInstitutional = closeAboveRange(row, institutional);
  const closeAboveNegotiated = closeAboveRange(row, negotiated);

  const closeBelowInstitutional = closeBelowRange(row, institutional);
  const closeBelowNegotiated = closeBelowRange(row, negotiated);

  const loc = closeLocation(row);
  const range = candleRange(row);

  const closedOffLow = Number.isFinite(loc) ? loc >= 45 : false;
  const strongClose = Number.isFinite(loc) ? loc >= 65 : false;

  const marketTrend = safeNumber(row.componentScores?.marketTrend);
  const aiLeadership = safeNumber(row.componentScores?.aiLeadership);
  const creditFragility = safeNumber(row.componentScores?.creditFragility);
  const macroScoreSummary = safeNumber(row.componentScores?.macroScoreSummary);
  const macroAwareScore = safeNumber(row.engine25HistoricalScoreMacroAware);

  // v0.1 proxy until full breadth participation is built.
  const breadthProxyImproving =
    (Number.isFinite(marketTrend) && marketTrend >= 55) ||
    (Number.isFinite(aiLeadership) && aiLeadership >= 55);

  const macroSupportive =
    (Number.isFinite(macroAwareScore) && macroAwareScore >= 55) ||
    (Number.isFinite(macroScoreSummary) && macroScoreSummary >= 60);

  const creditFragilityRisk =
    Number.isFinite(creditFragility) && creditFragility < 45;

  const pulledIntoSupport = touchedInstitutional || touchedNegotiated;

  const sellingPressureFading =
    pulledIntoSupport &&
    closedOffLow &&
    !closeBelowInstitutional;

  const accumulationWatch =
    pulledIntoSupport &&
    sellingPressureFading &&
    macroSupportive;

  const accumulationBuilding =
    accumulationWatch &&
    breadthProxyImproving &&
    (closeInsideInstitutional || closeAboveInstitutional || closeInsideNegotiated);

  const confirmedReclaim =
    accumulationBuilding &&
    strongClose &&
    (closeAboveNegotiated || closeAboveInstitutional);

  const accumulationFailed =
    pulledIntoSupport &&
    closeBelowInstitutional &&
    !closedOffLow;

  let state = "NO_ZONE_REACTION";

  if (accumulationFailed) {
    state = "ACCUMULATION_FAILED";
  } else if (confirmedReclaim) {
    state = "CONFIRMED_RECLAIM_LONG_PERMISSION";
  } else if (accumulationBuilding) {
    state = "ACCUMULATION_BUILDING";
  } else if (accumulationWatch) {
    state = "ACCUMULATION_WATCH";
  } else if (sellingPressureFading) {
    state = "SELLING_PRESSURE_FADING";
  } else if (touchedNegotiated) {
    state = "NEGOTIATED_ZONE_TEST";
  } else if (touchedInstitutional) {
    state = "PULLED_INTO_INSTITUTIONAL_SUPPORT";
  }

  const score = (() => {
    let s = 0;

    if (touchedInstitutional) s += 20;
    if (touchedNegotiated) s += 20;
    if (closedOffLow) s += 15;
    if (strongClose) s += 10;
    if (macroSupportive) s += 15;
    if (breadthProxyImproving) s += 10;
    if (closeAboveNegotiated || closeAboveInstitutional) s += 10;
    if (accumulationFailed) s -= 30;
    if (creditFragilityRisk) s -= 10;

    return Math.max(0, Math.min(100, Math.round(s)));
  })();

  const permission =
    state === "CONFIRMED_RECLAIM_LONG_PERMISSION"
      ? "CONFIRMED_RECLAIM_LONG_ALLOWED"
      : state === "ACCUMULATION_BUILDING"
        ? "A_PLUS_LONG_WATCH_RECLAIM_NEEDED"
        : state === "ACCUMULATION_WATCH"
          ? "WATCH_FOR_RECLAIM_CONFIRMATION"
          : state === "ACCUMULATION_FAILED"
            ? "NO_LONG_ZONE_FAILED"
            : "NO_PERMISSION_CHANGE";

  const notes = [];

  if (touchedInstitutional) {
    notes.push("ES traded into manual institutional zone.");
  }

  if (touchedNegotiated) {
    notes.push("ES traded into manual negotiated/value zone.");
  }

  if (sellingPressureFading) {
    notes.push("Selling pressure faded: candle closed off the low while testing support.");
  }

  if (breadthProxyImproving) {
    notes.push("Breadth proxy supportive: market trend or AI leadership is holding.");
  }

  if (macroSupportive) {
    notes.push("Macro-aware context is supportive enough for selective long watch.");
  }

  if (confirmedReclaim) {
    notes.push("Confirmed reclaim: strong close above negotiated/institutional value.");
  }

  if (accumulationFailed) {
    notes.push("Zone failed: ES closed below institutional support and did not close off lows.");
  }

  if (creditFragilityRisk) {
    notes.push("Credit fragility risk remains elevated; keep size reduced.");
  }

  return {
    zoneId: zone.id,
    state,
    score,
    permission,
    touchedInstitutional,
    touchedNegotiated,
    closeInsideInstitutional,
    closeInsideNegotiated,
    closeAboveInstitutional,
    closeAboveNegotiated,
    closeBelowInstitutional,
    closeBelowNegotiated,
    closeLocationPct: loc,
    candleRange: round2(range),
    distanceToInstitutionalPct: distanceToRangePct(row, institutional),
    distanceToNegotiatedPct: distanceToRangePct(row, negotiated),
    macroSupportive,
    breadthProxyImproving,
    creditFragilityRisk,
    institutional: institutional
      ? {
          lo: institutional.lo,
          hi: institutional.hi,
          mid: rangeMid(institutional),
          width: rangeWidth(institutional),
          raw: institutional.raw,
        }
      : null,
    negotiated: negotiated
      ? {
          lo: negotiated.lo,
          hi: negotiated.hi,
          mid: rangeMid(negotiated),
          width: rangeWidth(negotiated),
          raw: negotiated.raw,
        }
      : null,
    note: zone.note,
    notes,
  };
}

function chooseBestReaction(reactions) {
  const active = reactions.filter((r) => r.state !== "NO_ZONE_REACTION");

  if (!active.length) {
    return null;
  }

  return [...active].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;

    const aDist = Math.min(
      a.distanceToNegotiatedPct ?? 999,
      a.distanceToInstitutionalPct ?? 999
    );

    const bDist = Math.min(
      b.distanceToNegotiatedPct ?? 999,
      b.distanceToInstitutionalPct ?? 999
    );

    return aDist - bDist;
  })[0];
}

function buildSummary(rows, zones) {
  const byState = {};
  const byPermission = {};
  const byZone = {};

  for (const row of rows) {
    const state = row.bestReaction?.state || "NO_ZONE_REACTION";
    const permission = row.bestReaction?.permission || "NO_PERMISSION_CHANGE";
    const zoneId = row.bestReaction?.zoneId || "none";

    byState[state] = (byState[state] || 0) + 1;
    byPermission[permission] = (byPermission[permission] || 0) + 1;
    byZone[zoneId] = (byZone[zoneId] || 0) + 1;
  }

  const activeRows = rows.filter((row) => row.bestReaction);
  const confirmedRows = rows.filter(
    (row) => row.bestReaction?.state === "CONFIRMED_RECLAIM_LONG_PERMISSION"
  );

  const workedConfirmed = confirmedRows.filter((row) => row.outcome5d === "WORKED");
  const failedConfirmed = confirmedRows.filter((row) => row.outcome5d === "FAILED");

  return {
    rows: rows.length,
    zonesParsed: zones.length,
    activeZoneReactionRows: activeRows.length,
    confirmedReclaimRows: confirmedRows.length,
    confirmedWorked: workedConfirmed.length,
    confirmedFailed: failedConfirmed.length,
    confirmedWinRatePct:
      confirmedRows.length > 0
        ? round2((workedConfirmed.length / confirmedRows.length) * 100)
        : null,
    byState,
    byPermission,
    byZone,
  };
}

async function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: ENGINE_NAME,
    modelType: MODEL_TYPE,
    symbol: "ES",
    timeframe: "1d",
    startedAt,
    finishedAt: null,
    generatedAtUtc: null,
    source: {
      manualZoneFile: "es-smz-manual-zones.txt",
      replayFile: "engine25-historical-replay-macro-6mo.json",
      outputFile: "engine25-zone-reaction-replay-6mo.json",
    },
    limitations: [
      "v0.1 validates manual ES institutional/negotiated zones only.",
      "Breadth participation is currently a proxy using marketTrend and AI leadership scores until full breadth engine is added.",
      "This job does not create new zones yet; it only grades reactions around manual zones.",
      "This does not change live trading permission or frontend behavior.",
    ],
    zones: [],
    summary: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Zone Reaction Replay");
    console.log("Manual ES institutional/negotiated zones");
    console.log("========================================");

    const zoneText = readTextFile(ZONE_FILE);
    const zones = parseManualZones(zoneText);

    if (!zones.length) {
      throw new Error("No manual ES zones parsed from es-smz-manual-zones.txt");
    }

    console.log("Manual zones parsed:", zones.length);

    const replay = readJsonFile(REPLAY_FILE);
    const replayRows = normalizeRows(replay);

    console.log("Replay rows loaded:", replayRows.length);

    const rows = replayRows.map((row) => {
      const reactions = zones.map((zone) => buildZoneReaction(row, zone));
      const bestReaction = chooseBestReaction(reactions);

      return {
        date: row.date,
        time: row.time,
        symbol: row.symbol || "ES",
        timeframe: row.timeframe || "1d",
        esOpen: row.esOpen,
        esHigh: row.esHigh,
        esLow: row.esLow,
        esClose: row.esClose,
        macroAwareScore: row.engine25HistoricalScoreMacroAware,
        macroAwarePermission: row.historicalEsPermissionMacroAware,
        macroAwareSizeMultiplier: row.macroAwareSizeMultiplier,
        componentScores: row.componentScores || {},
        next1dReturnPct: row.next1dReturnPct,
        next3dReturnPct: row.next3dReturnPct,
        next5dReturnPct: row.next5dReturnPct,
        maxDrawdownNext5dPct: row.maxDrawdownNext5dPct,
        maxRunupNext5dPct: row.maxRunupNext5dPct,
        outcome5d: row.outcome5d,
        bestReaction,
        reactions,
      };
    });

    output.zones = zones;
    output.rows = rows;
    output.summary = buildSummary(rows, zones);
    output.ok = true;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Zone Reaction Replay Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Zones parsed:", output.summary.zonesParsed);
    console.log("Active zone reaction rows:", output.summary.activeZoneReactionRows);
    console.log("Confirmed reclaim rows:", output.summary.confirmedReclaimRows);
    console.log("Confirmed win rate:", output.summary.confirmedWinRatePct);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          modelType: output.modelType,
          summary: output.summary,
          zones: output.zones,
          sampleActiveRows: output.rows
            .filter((row) => row.bestReaction)
            .slice(0, 5)
            .map((row) => ({
              date: row.date,
              esLow: row.esLow,
              esClose: row.esClose,
              state: row.bestReaction.state,
              score: row.bestReaction.score,
              permission: row.bestReaction.permission,
              zoneId: row.bestReaction.zoneId,
              outcome5d: row.outcome5d,
              next5dReturnPct: row.next5dReturnPct,
            })),
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

    console.error("Engine 25 Zone Reaction Replay Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
