// services/core/logic/engine26/readManualImbalanceZones.js
//
// Engine 26-owned, reaction-independent manual imbalance inventory.
// Canonical manual-zone read path.
//
// ROLLOVER SAFETY:
// - NEVER writes to es-smz-manual-zones.txt.
// - Preserves original source-contract prices.
// - Publishes rollover-adjusted display/trading prices through lo/hi/mid.
// - Keeps original + adjusted values and price-basis metadata together.
// - Uses the tested read-only ES manual-zone rollover adapter as the
//   single canonical adjustment source for Engine 26 and downstream readers.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildEsManualZoneRolloverPreview } from "../rollover/esManualZoneRolloverAdapter.js";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);
const DEFAULT_MANUAL_ZONES_FILE = path.resolve(
  CURRENT_DIR,
  "../../data/es-smz-manual-zones.txt"
);

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  const number = toFiniteNumber(value);
  return number === null ? null : Number(number.toFixed(2));
}

function normalizeRange(lo, hi) {
  const a = toFiniteNumber(lo);
  const b = toFiniteNumber(hi);
  if (a === null || b === null) return null;

  const lower = Math.min(a, b);
  const upper = Math.max(a, b);

  return {
    lo: round2(lower),
    hi: round2(upper),
    mid: round2((lower + upper) / 2),
  };
}

function parseRange(text) {
  const match = String(text || "").match(
    /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/
  );
  return match ? normalizeRange(match[1], match[2]) : null;
}

function parseNegotiatedRange(text) {
  const match = String(text || "").match(
    /NEG\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i
  );
  return match ? normalizeRange(match[1], match[2]) : null;
}

function getInlineComment(rawLine) {
  const index = rawLine.indexOf("#");
  if (index < 0) return null;
  return rawLine.slice(index + 1).trim() || null;
}

function stripInlineComment(rawLine) {
  const index = rawLine.indexOf("#");
  return index >= 0 ? rawLine.slice(0, index).trim() : rawLine.trim();
}

function parseManualZoneLine({ line, lineIndex }) {
  const raw = String(line || "").trim();
  if (!raw || raw.startsWith("#")) return null;

  const content = stripInlineComment(raw);
  if (!content) return null;

  const [primaryPart = "", metadataPart = ""] = content.split("|");
  const primaryZone = parseRange(primaryPart);
  const negotiatedZone = parseNegotiatedRange(metadataPart);
  const selectedRange = primaryZone || negotiatedZone;
  if (!selectedRange) return null;

  const id = `ES_MANUAL_IMBALANCE_${lineIndex + 1}`;

  return {
    id,
    symbol: "ES",
    source: "es-smz-manual-zones.txt",
    sourceLine: lineIndex + 1,
    raw,
    comment: getInlineComment(raw),
    side: "GREEN",
    zoneType: "MANUAL_IMBALANCE",
    timeframe: "10m",
    lo: selectedRange.lo,
    hi: selectedRange.hi,
    mid: selectedRange.mid,
    negotiatedZone,
    active: true,
    invalidated: false,
    expired: false,
    noPermissionCreated: true,
    noExecution: true,
  };
}

function buildRolloverLookup(preview) {
  const byLine = new Map();

  for (const zone of Array.isArray(preview?.zones) ? preview.zones : []) {
    const lineNumber = Number(zone?.lineNumber);
    if (!Number.isFinite(lineNumber)) continue;
    byLine.set(lineNumber, zone);
  }

  return byLine;
}

function applyRolloverToManualZone(zone, rolloverZone, preview) {
  if (!zone || !rolloverZone) return zone;

  const adjusted = rolloverZone.adjusted || null;
  const nestedAdjusted = rolloverZone.nestedAdjusted || null;

  if (
    !adjusted ||
    !Number.isFinite(Number(adjusted.lo)) ||
    !Number.isFinite(Number(adjusted.hi)) ||
    !Number.isFinite(Number(adjusted.mid))
  ) {
    return zone;
  }

  const originalLo = round2(zone.lo);
  const originalHi = round2(zone.hi);
  const originalMid = round2(zone.mid);

  const adjustedLo = round2(adjusted.lo);
  const adjustedHi = round2(adjusted.hi);
  const adjustedMid = round2(adjusted.mid);

  const originalNegotiatedZone = zone.negotiatedZone
    ? {
        lo: round2(zone.negotiatedZone.lo),
        hi: round2(zone.negotiatedZone.hi),
        mid: round2(zone.negotiatedZone.mid),
      }
    : null;

  const adjustedNegotiatedZone = nestedAdjusted
    ? {
        lo: round2(nestedAdjusted.lo),
        hi: round2(nestedAdjusted.hi),
        mid: round2(nestedAdjusted.mid),
      }
    : originalNegotiatedZone;

  return {
    ...zone,

    // Canonical adjusted trading/display values.
    source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
    lo: adjustedLo,
    hi: adjustedHi,
    mid: adjustedMid,

    // Engine 26's negotiated-zone normalizer reads this field, so it must
    // also use the adjusted contract basis.
    negotiatedZone: adjustedNegotiatedZone,

    // Protected source-contract truth.
    originalLo,
    originalHi,
    originalMid,
    originalNegotiatedZone,

    // Explicit adjusted values.
    adjustedLo,
    adjustedHi,
    adjustedMid,
    adjustedNegotiatedZone,

    protectedOriginal: true,
    readOnly: true,

    normalizedInstrumentRoot:
      rolloverZone.normalizedInstrumentRoot ??
      preview?.normalizedInstrumentRoot ??
      "ES",

    sourceFuturesContractCode:
      rolloverZone.sourceFuturesContractCode ??
      preview?.sourceFuturesContractCode ??
      null,

    displayFuturesContractCode:
      rolloverZone.displayFuturesContractCode ??
      preview?.displayFuturesContractCode ??
      null,

    polygonSourceTicker:
      rolloverZone.polygonSourceTicker ??
      preview?.polygonSourceTicker ??
      null,

    polygonDisplayTicker:
      rolloverZone.polygonDisplayTicker ??
      preview?.polygonDisplayTicker ??
      null,

    rollAdjustmentPoints:
      rolloverZone.rollAdjustmentPoints ??
      preview?.rollAdjustmentPoints ??
      0,

    adjustmentMethod:
      rolloverZone.adjustmentMethod ??
      preview?.adjustmentMethod ??
      null,

    adjustmentTimestamp:
      rolloverZone.adjustmentTimestamp ??
      preview?.adjustmentTimestamp ??
      null,

    priceBasis: {
      ...(rolloverZone.priceBasis || {}),
      originalContract:
        rolloverZone.priceBasis?.originalContract ??
        rolloverZone.sourceFuturesContractCode ??
        preview?.sourceFuturesContractCode ??
        null,
      displayContract:
        rolloverZone.priceBasis?.displayContract ??
        rolloverZone.displayFuturesContractCode ??
        preview?.displayFuturesContractCode ??
        null,
      rollAdjustmentPoints:
        rolloverZone.priceBasis?.rollAdjustmentPoints ??
        rolloverZone.rollAdjustmentPoints ??
        preview?.rollAdjustmentPoints ??
        0,
    },
  };
}

function toNegotiatedZone(zone, index) {
  const range = zone?.negotiatedZone;
  if (!range) return null;

  return {
    id: `ES_MANUAL_NEGOTIATED_${zone.sourceLine}`,
    upstreamId: `ES_MANUAL_NEGOTIATED_${zone.sourceLine}`,
    parentManualZoneId: zone.id,
    symbol: "ES",

    source: zone.source || "es-smz-manual-zones.txt",
    sourcePath: `manualImbalanceInventory.negotiatedZones[${index}]`,
    sourceLine: zone.sourceLine,
    raw: zone.raw,
    comment: zone.comment,

    type: "NEGOTIATED",
    zoneType: "NEGOTIATED",
    timeframe: "10m",

    // Canonical adjusted trading/display values.
    lo: range.lo,
    hi: range.hi,
    mid: range.mid,

    // Protected source-contract values.
    originalLo:
      zone.originalNegotiatedZone?.lo ??
      zone.originalLo ??
      null,
    originalHi:
      zone.originalNegotiatedZone?.hi ??
      zone.originalHi ??
      null,
    originalMid:
      zone.originalNegotiatedZone?.mid ??
      zone.originalMid ??
      null,

    // Explicit adjusted values.
    adjustedLo:
      zone.adjustedNegotiatedZone?.lo ??
      range.lo,
    adjustedHi:
      zone.adjustedNegotiatedZone?.hi ??
      range.hi,
    adjustedMid:
      zone.adjustedNegotiatedZone?.mid ??
      range.mid,

    protectedOriginal: zone.protectedOriginal === true,
    readOnly: zone.readOnly === true,

    normalizedInstrumentRoot:
      zone.normalizedInstrumentRoot ?? "ES",
    sourceFuturesContractCode:
      zone.sourceFuturesContractCode ?? null,
    displayFuturesContractCode:
      zone.displayFuturesContractCode ?? null,
    polygonSourceTicker:
      zone.polygonSourceTicker ?? null,
    polygonDisplayTicker:
      zone.polygonDisplayTicker ?? null,
    rollAdjustmentPoints:
      zone.rollAdjustmentPoints ?? 0,
    adjustmentMethod:
      zone.adjustmentMethod ?? null,
    adjustmentTimestamp:
      zone.adjustmentTimestamp ?? null,
    priceBasis:
      zone.priceBasis ?? null,

    active: zone.active !== false,
    invalidated: zone.invalidated === true,
    expired: zone.expired === true,

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function readEngine26ManualImbalanceZones({
  filePath = DEFAULT_MANUAL_ZONES_FILE,
} = {}) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      engine: "engine26.manualImbalanceInventory.v3",
      source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
      filePath,
      zones: [],
      negotiatedZones: [],
      reasonCodes: ["ENGINE26A_MANUAL_IMBALANCE_FILE_MISSING"],
      warnings: [`Manual imbalance file not found: ${filePath}`],
      noPermissionCreated: true,
      noExecution: true,
    };
  }

  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      engine: "engine26.manualImbalanceInventory.v3",
      source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
      filePath,
      zones: [],
      negotiatedZones: [],
      reasonCodes: ["ENGINE26A_MANUAL_IMBALANCE_FILE_READ_FAILED"],
      warnings: [String(error?.message || error)],
      noPermissionCreated: true,
      noExecution: true,
    };
  }

  const rawZones = text
    .split(/\r?\n/)
    .map((line, lineIndex) => parseManualZoneLine({ line, lineIndex }))
    .filter(Boolean);

  let rolloverPreview;

  try {
    rolloverPreview = buildEsManualZoneRolloverPreview({
      filePath,
    });
  } catch (error) {
    return {
      ok: false,
      engine: "engine26.manualImbalanceInventory.v3",
      source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
      filePath,
      zones: [],
      negotiatedZones: [],
      reasonCodes: [
        "ENGINE26A_MANUAL_ZONE_ROLLOVER_ADAPTER_FAILED",
      ],
      warnings: [String(error?.message || error)],
      noPermissionCreated: true,
      noExecution: true,
    };
  }

  if (rolloverPreview?.ok !== true) {
    return {
      ok: false,
      engine: "engine26.manualImbalanceInventory.v3",
      source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
      filePath,
      zones: [],
      negotiatedZones: [],
      reasonCodes: [
        "ENGINE26A_MANUAL_ZONE_ROLLOVER_ADAPTER_NOT_READY",
      ],
      warnings: [
        rolloverPreview?.warning ||
          "Manual-zone rollover adapter did not return ok=true.",
      ],
      noPermissionCreated: true,
      noExecution: true,
    };
  }

  const rolloverByLine = buildRolloverLookup(rolloverPreview);

  const zones = rawZones.map((zone) =>
    applyRolloverToManualZone(
      zone,
      rolloverByLine.get(zone.sourceLine),
      rolloverPreview
    )
  );

  // Fail closed if any parsed manual zone failed to receive a rollover view.
  // This prevents a mixed contract-basis inventory from reaching trading logic.
  const unadjustedZones = zones.filter(
    (zone) => zone?.source !== "ES_MANUAL_ZONE_ROLLOVER_ADAPTER"
  );

  if (unadjustedZones.length) {
    return {
      ok: false,
      engine: "engine26.manualImbalanceInventory.v3",
      source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
      filePath,
      zones: [],
      negotiatedZones: [],
      reasonCodes: [
        "ENGINE26A_MANUAL_ZONE_ROLLOVER_COVERAGE_INCOMPLETE",
      ],
      warnings: [
        `Rollover adapter did not cover ${unadjustedZones.length} parsed manual zone(s).`,
      ],
      noPermissionCreated: true,
      noExecution: true,
    };
  }

  const negotiatedZones = zones
    .map((zone, index) => toNegotiatedZone(zone, index))
    .filter(Boolean);

  return {
    ok: true,
    engine: "engine26.manualImbalanceInventory.v3",
    source: "ES_MANUAL_ZONE_ROLLOVER_ADAPTER",
    filePath,

    readOnly: true,
    protectedOriginal: true,

    normalizedInstrumentRoot:
      rolloverPreview.normalizedInstrumentRoot ?? "ES",

    sourceFuturesContractCode:
      rolloverPreview.sourceFuturesContractCode ?? null,

    displayFuturesContractCode:
      rolloverPreview.displayFuturesContractCode ?? null,

    polygonSourceTicker:
      rolloverPreview.polygonSourceTicker ?? null,

    polygonDisplayTicker:
      rolloverPreview.polygonDisplayTicker ?? null,

    rollAdjustmentPoints:
      rolloverPreview.rollAdjustmentPoints ?? 0,

    adjustmentMethod:
      rolloverPreview.adjustmentMethod ?? null,

    adjustmentTimestamp:
      rolloverPreview.adjustmentTimestamp ?? null,

    priceBasis: {
      originalContract:
        rolloverPreview.sourceFuturesContractCode ?? null,
      displayContract:
        rolloverPreview.displayFuturesContractCode ?? null,
      polygonOriginalTicker:
        rolloverPreview.polygonSourceTicker ?? null,
      polygonDisplayTicker:
        rolloverPreview.polygonDisplayTicker ?? null,
      rollAdjusted:
        Number(rolloverPreview.rollAdjustmentPoints || 0) !== 0,
      rollAdjustmentPoints:
        rolloverPreview.rollAdjustmentPoints ?? 0,
      tickSize:
        rolloverPreview.tickSize ?? 0.25,
      adjustmentMethod:
        rolloverPreview.adjustmentMethod ?? null,
      adjustmentTimestamp:
        rolloverPreview.adjustmentTimestamp ?? null,
    },

    zoneCount: zones.length,
    negotiatedZoneCount: negotiatedZones.length,
    skippedCount: rolloverPreview.skippedCount ?? 0,

    zones,
    negotiatedZones,

    reasonCodes: zones.length
      ? [
          "ENGINE26A_MANUAL_IMBALANCE_ZONES_LOADED",
          "ENGINE26A_MANUAL_NEGOTIATED_ZONES_NORMALIZED",
          "ENGINE26A_REACTION_INDEPENDENT_INVENTORY",
          "ENGINE26A_MANUAL_ZONE_ROLLOVER_ADAPTER_APPLIED",
          "ENGINE26A_MANUAL_ZONE_ORIGINAL_VALUES_PROTECTED",
          "ENGINE26A_MANUAL_ZONE_DISPLAY_BASIS_ADJUSTED",
        ]
      : ["ENGINE26A_MANUAL_IMBALANCE_ZONES_EMPTY"],

    warnings: rolloverPreview.warning
      ? [rolloverPreview.warning]
      : [],

    noPermissionCreated: true,
    noExecution: true,
  };
}

export default readEngine26ManualImbalanceZones;
