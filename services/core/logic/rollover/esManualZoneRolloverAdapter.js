// services/core/logic/rollover/esManualZoneRolloverAdapter.js
// Read-only ES manual zone rollover adapter.
//
// SAFETY RULES:
// - NEVER writes to es-smz-manual-zones.txt.
// - NEVER overwrites manual zone prices.
// - Preserves original manual zone prices.
// - Creates adjusted DISPLAY/TRADING VIEW only.
//
// Example:
// source contract:  ESU26
// display contract: ESZ26
// adjustment:       +67.50
//
// Original ESU26 manual zone:
// 7590.50-7611.50
//
// Adjusted ESZ26 display view:
// 7658.00-7679.00

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// __dirname = services/core/logic/rollover
// ../..     = services/core
const CORE_DIR = path.resolve(__dirname, "../..");

const DEFAULT_MANUAL_ZONE_FILE = path.resolve(
  CORE_DIR,
  "data/es-smz-manual-zones.txt"
);

const ES_TICK_SIZE = 0.25;

function nowIso() {
  return new Date().toISOString();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanText(v) {
  return String(v ?? "").trim();
}

function cleanUpper(v, fallback = "") {
  const s = cleanText(v).toUpperCase();
  return s || fallback;
}

function roundToTick(value, tickSize = ES_TICK_SIZE) {
  const n = Number(value);
  const tick = Number(tickSize);

  if (!Number.isFinite(n)) return null;
  if (!Number.isFinite(tick) || tick <= 0) return n;

  return Math.round(n / tick) * tick;
}

function readRollAdjustmentPoints() {
  const raw =
    process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT ??
    process.env.ES_ROLL_ADJUSTMENT_POINTS ??
    "0";

  const n = Number(raw);

  if (!Number.isFinite(n)) {
    throw new Error(
      `Invalid ES_MANUAL_ZONE_ROLL_ADJUSTMENT value: ${String(raw)}`
    );
  }

  return n;
}

function readSourceContract() {
  return cleanUpper(
    process.env.ES_MANUAL_ZONE_SOURCE_CONTRACT,
    "ESU26"
  );
}

function readDisplayContract() {
  return cleanUpper(
    process.env.ES_MANUAL_ZONE_DISPLAY_CONTRACT ||
      process.env.ES_CONTRACT_OVERRIDE ||
      process.env.FUTURES_ES_CONTRACT_OVERRIDE,
    "ESZ26"
  );
}

function parseExplicitFuturesContract(v) {
  const raw = cleanUpper(v);
  const noSlash = raw.startsWith("/") ? raw.slice(1) : raw;
  const noSuffix = noSlash.split(":")[0];

  const match = noSuffix.match(/^([A-Z0-9]+?)([FGHJKMNQUVXZ])(\d{1,2})$/);

  if (!match) return null;

  return {
    raw,
    futuresContractCode: noSuffix,
    normalizedInstrumentRoot: match[1],
    contractMonthCode: match[2],
    contractYearCode: match[3],
  };
}

function toPolygonFuturesTicker(contractCode) {
  const parsed = parseExplicitFuturesContract(contractCode);

  if (!parsed) {
    return cleanUpper(contractCode, "UNKNOWN");
  }

  const year =
    parsed.contractYearCode.length === 2
      ? parsed.contractYearCode.slice(-1)
      : parsed.contractYearCode;

  return `${parsed.normalizedInstrumentRoot}${parsed.contractMonthCode}${year}`;
}

function parseZoneRange(text) {
  const s = cleanText(text);

  const match = s.match(
    /(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/
  );

  if (!match) return null;

  const a = toNum(match[1]);
  const b = toNum(match[2]);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const mid = (lo + hi) / 2;

  return { lo, hi, mid };
}

function adjustRange(range, adjustment, tickSize = ES_TICK_SIZE) {
  if (!range) return null;

  const lo = roundToTick(Number(range.lo) + adjustment, tickSize);
  const hi = roundToTick(Number(range.hi) + adjustment, tickSize);
  const mid = roundToTick(Number(range.mid) + adjustment, tickSize);

  return { lo, hi, mid };
}

function parseManualZoneLine(line, index) {
  const rawLine = String(line ?? "");
  const trimmed = rawLine.trim();

  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;

  const commentParts = trimmed.split("#");
  const body = cleanText(commentParts[0]);
  const comment = cleanText(commentParts.slice(1).join("#"));

  if (!body) return null;

  const pipeParts = body.split("|").map((p) => cleanText(p));

  const leftSide = pipeParts[0] || "";
  const rightSide = pipeParts.slice(1).join(" | ");

  let zoneType = "NEG";
  let nestedText = "";

  if (rightSide) {
    const typeMatch = rightSide.match(/^([A-Z_]+)\s*(.*)$/i);

    if (typeMatch) {
      zoneType = cleanUpper(typeMatch[1], "NEG");
      nestedText = cleanText(typeMatch[2]);
    } else {
      nestedText = rightSide;
    }
  }

  let mainRange = parseZoneRange(leftSide);
  const nestedRange = parseZoneRange(nestedText);

  // Some manual-zone lines are intentionally formatted with the main
  // range on the right side:
  //
  // | NEG 7548.00-7568.00
  //
  // For those, use the right-side range as the main zone range.
  if (!mainRange && nestedRange) {
    mainRange = nestedRange;
  }

  if (!mainRange) {
    return {
      ok: false,
      skipped: true,
      reason: "NO_PRICE_RANGE_FOUND",
      lineNumber: index + 1,
      rawLine,
    };
  }

  return {
    ok: true,
    skipped: false,
    lineNumber: index + 1,
    rawLine,
    comment: comment || null,
    type: zoneType || "NEG",
    original: {
      lo: mainRange.lo,
      hi: mainRange.hi,
      mid: mainRange.mid,
    },
    nestedOriginal: nestedRange
      ? {
          lo: nestedRange.lo,
          hi: nestedRange.hi,
          mid: nestedRange.mid,
        }
      : null,
  };
}

export function buildEsManualZoneRolloverPreview(options = {}) {
  const filePath = options.filePath || DEFAULT_MANUAL_ZONE_FILE;

  const tickSize = Number(options.tickSize || ES_TICK_SIZE);

  const sourceFuturesContractCode = cleanUpper(
    options.sourceFuturesContractCode ||
      options.sourceContract ||
      readSourceContract(),
    "ESU26"
  );

  const displayFuturesContractCode = cleanUpper(
    options.displayFuturesContractCode ||
      options.displayContract ||
      readDisplayContract(),
    "ESZ26"
  );

  const sourceParsed = parseExplicitFuturesContract(sourceFuturesContractCode);
  const displayParsed = parseExplicitFuturesContract(displayFuturesContractCode);

  const normalizedInstrumentRoot =
    sourceParsed?.normalizedInstrumentRoot ||
    displayParsed?.normalizedInstrumentRoot ||
    "ES";

  const polygonSourceTicker = toPolygonFuturesTicker(sourceFuturesContractCode);
  const polygonDisplayTicker = toPolygonFuturesTicker(displayFuturesContractCode);

  const rollAdjustmentPoints =
    options.rollAdjustmentPoints !== undefined
      ? Number(options.rollAdjustmentPoints)
      : readRollAdjustmentPoints();

  if (!Number.isFinite(rollAdjustmentPoints)) {
    throw new Error(
      "Invalid rollAdjustmentPoints. Expected numeric point adjustment."
    );
  }

  const adjustmentTimestamp =
    options.adjustmentTimestamp ||
    process.env.ES_MANUAL_ZONE_ROLL_ADJUSTMENT_TIMESTAMP ||
    null;

  const text = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "";

  const parsed = text
    .split(/\r?\n/)
    .map((line, index) => parseManualZoneLine(line, index))
    .filter(Boolean);

  const zones = parsed
    .filter((z) => z.ok && !z.skipped)
    .map((z, idx) => {
      const adjusted = adjustRange(z.original, rollAdjustmentPoints, tickSize);
      const nestedAdjusted = adjustRange(
        z.nestedOriginal,
        rollAdjustmentPoints,
        tickSize
      );

      const zoneId = `ES_MANUAL_NEGOTIATED_${idx + 1}`;

      return {
        zoneId,
        source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",

        protectedOriginal: true,
        readOnly: true,

        normalizedInstrumentRoot,

        sourceFuturesContractCode,
        displayFuturesContractCode,

        polygonSourceTicker,
        polygonDisplayTicker,

        rollAdjustmentPoints,
        adjustmentMethod: "MANUAL_VERIFIED_SAME_MINUTE_CONTRACT_SPREAD",
        adjustmentTimestamp,

        priceBasis: {
          originalContract: sourceFuturesContractCode,
          displayContract: displayFuturesContractCode,
          polygonOriginalTicker: polygonSourceTicker,
          polygonDisplayTicker,
          rollAdjusted: rollAdjustmentPoints !== 0,
          rollAdjustmentPoints,
          tickSize,
          adjustmentMethod: "MANUAL_VERIFIED_SAME_MINUTE_CONTRACT_SPREAD",
          adjustmentTimestamp,
        },

        lineNumber: z.lineNumber,
        rawLine: z.rawLine,
        comment: z.comment,

        type: z.type,
        side: z.type,

        original: z.original,
        adjusted,

        nestedOriginal: z.nestedOriginal,
        nestedAdjusted,

        // Compatibility fields for chart overlays / Engine 26 preview.
        lo: adjusted.lo,
        hi: adjusted.hi,
        mid: adjusted.mid,

        originalLo: z.original.lo,
        originalHi: z.original.hi,
        originalMid: z.original.mid,

        adjustedLo: adjusted.lo,
        adjustedHi: adjusted.hi,
        adjustedMid: adjusted.mid,
      };
    });

  const skipped = parsed.filter((z) => z.skipped || !z.ok);

  return {
    ok: true,
    readOnly: true,
    protectedOriginal: true,

    source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",

    filePath,

    normalizedInstrumentRoot,

    sourceFuturesContractCode,
    displayFuturesContractCode,

    polygonSourceTicker,
    polygonDisplayTicker,

    rollAdjustmentPoints,
    adjustmentMethod: "MANUAL_VERIFIED_SAME_MINUTE_CONTRACT_SPREAD",
    adjustmentTimestamp,

    tickSize,

    zoneCount: zones.length,
    skippedCount: skipped.length,

    zones,
    skipped,

    generatedAt: nowIso(),

    warning:
      "READ ONLY PREVIEW. Original manual zone file was not modified. Do not overwrite source zones with adjusted values.",
  };
}

export default buildEsManualZoneRolloverPreview;
