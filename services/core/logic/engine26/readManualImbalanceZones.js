// services/core/logic/engine26/readManualImbalanceZones.js
//
// Engine 26-owned, reaction-independent manual imbalance inventory.
//
// Reads:
//   services/core/data/es-smz-manual-zones.txt
//
// This helper does not consume:
// - Engine 3 reactions
// - Engine 4 participation
// - Engine 6 permission
// - Engine 15 readiness
//
// It creates no permission, execution, sizing, stop, target, or order.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const CURRENT_DIR = path.dirname(CURRENT_FILE);

const DEFAULT_MANUAL_ZONES_FILE = path.resolve(
  CURRENT_DIR,
  "../../data/es-smz-manual-zones.txt"
);

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function round2(value) {
  const number = toFiniteNumber(value);

  return number === null
    ? null
    : Number(number.toFixed(2));
}

function normalizeRange(lo, hi) {
  const a = toFiniteNumber(lo);
  const b = toFiniteNumber(hi);

  if (a === null || b === null) {
    return null;
  }

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

  if (!match) {
    return null;
  }

  return normalizeRange(
    match[1],
    match[2]
  );
}

function parseNegotiatedRange(text) {
  const match = String(text || "").match(
    /NEG\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/i
  );

  if (!match) {
    return null;
  }

  return normalizeRange(
    match[1],
    match[2]
  );
}

function getInlineComment(rawLine) {
  const commentIndex = rawLine.indexOf("#");

  if (commentIndex < 0) {
    return null;
  }

  const comment = rawLine
    .slice(commentIndex + 1)
    .trim();

  return comment || null;
}

function stripInlineComment(rawLine) {
  const commentIndex = rawLine.indexOf("#");

  return commentIndex >= 0
    ? rawLine.slice(0, commentIndex).trim()
    : rawLine.trim();
}

function parseManualZoneLine({
  line,
  lineIndex,
}) {
  const raw = String(line || "").trim();

  if (!raw || raw.startsWith("#")) {
    return null;
  }

  const content = stripInlineComment(raw);

  if (!content) {
    return null;
  }

  const [
    primaryPart = "",
    metadataPart = "",
  ] = content.split("|");

  const primaryZone =
    parseRange(primaryPart);

  const negotiatedZone =
    parseNegotiatedRange(metadataPart);

  const selectedRange =
    primaryZone ||
    negotiatedZone;

  if (!selectedRange) {
    return null;
  }

  return {
    id:
      `ES_MANUAL_IMBALANCE_${lineIndex + 1}`,

    symbol: "ES",

    source:
      "es-smz-manual-zones.txt",

    sourceLine:
      lineIndex + 1,

    raw,

    comment:
      getInlineComment(raw),

    side: "GREEN",

    zoneType:
      "MANUAL_IMBALANCE",

    timeframe: "10m",

    lo:
      selectedRange.lo,

    hi:
      selectedRange.hi,

    mid:
      selectedRange.mid,

    negotiatedZone,

    active: true,
    invalidated: false,
    expired: false,

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

      engine:
        "engine26.manualImbalanceInventory.v1",

      source:
        "es-smz-manual-zones.txt",

      filePath,

      zones: [],

      reasonCodes: [
        "ENGINE26A_MANUAL_IMBALANCE_FILE_MISSING",
      ],

      warnings: [
        `Manual imbalance file not found: ${filePath}`,
      ],

      noPermissionCreated: true,
      noExecution: true,
    };
  }

  let text;

  try {
    text = fs.readFileSync(
      filePath,
      "utf8"
    );
  } catch (error) {
    return {
      ok: false,

      engine:
        "engine26.manualImbalanceInventory.v1",

      source:
        "es-smz-manual-zones.txt",

      filePath,

      zones: [],

      reasonCodes: [
        "ENGINE26A_MANUAL_IMBALANCE_FILE_READ_FAILED",
      ],

      warnings: [
        String(error?.message || error),
      ],

      noPermissionCreated: true,
      noExecution: true,
    };
  }

  const lines =
    text.split(/\r?\n/);

  const zones = lines
    .map((line, lineIndex) =>
      parseManualZoneLine({
        line,
        lineIndex,
      })
    )
    .filter(Boolean);

  return {
    ok: true,

    engine:
      "engine26.manualImbalanceInventory.v1",

    source:
      "es-smz-manual-zones.txt",

    filePath,

    zoneCount:
      zones.length,

    zones,

    reasonCodes: zones.length
      ? [
          "ENGINE26A_MANUAL_IMBALANCE_ZONES_LOADED",
          "ENGINE26A_REACTION_INDEPENDENT_INVENTORY",
        ]
      : [
          "ENGINE26A_MANUAL_IMBALANCE_ZONES_EMPTY",
        ],

    warnings: [],

    noPermissionCreated: true,
    noExecution: true,
  };
}

export default readEngine26ManualImbalanceZones;
