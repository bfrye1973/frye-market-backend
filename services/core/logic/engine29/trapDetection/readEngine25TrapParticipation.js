// services/core/logic/engine29/trapDetection/readEngine25TrapParticipation.js
// Engine 29 — read-only Engine 25 scanner participation handoff for trap detection.
//
// Reads only the already-built Engine 25 sector-health artifact.
// Does NOT run another stock scanner and does NOT change Engine 25 authority.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ENGINE29_TRAP_SIDES } from "./trapConstants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_SECTOR_HEALTH_FILE = path.resolve(
  __dirname,
  "../../../data/engine25-sector-health-test.json"
);

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function sourceTimestampMs(data) {
  const values = [
    data?.updatedAt,
    data?.sources?.intraday?.updatedAt,
    data?.sources?.eod?.updatedAt,
  ];

  for (const value of values) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms)) return ms;
  }

  return null;
}

function breadthRead(data) {
  const breadth = data?.breadthParticipation || null;
  const score = finite(breadth?.score);
  const label = breadth?.label || null;

  return {
    available:
      data?.ok === true &&
      Number.isFinite(score) &&
      Boolean(label) &&
      data?.sources?.intraday?.ok === true &&
      data?.sources?.eod?.ok === true,
    score,
    label,
    intraday:
      breadth?.inputs?.intraday || null,
    eod:
      breadth?.inputs?.eod || null,
  };
}

function volumeRead(data) {
  const distribution =
    data?.distributionPressure || null;

  const evidence =
    distribution?.inputs?.volumeEvidence || null;

  const intraday =
    evidence?.intraday || null;

  const eod =
    evidence?.eod || null;

  return {
    available: evidence?.available === true,
    distributionScore:
      finite(distribution?.score),
    distributionLabel:
      distribution?.label || null,
    rawPressure:
      finite(distribution?.rawPressure),
    combinedVolumePressure:
      finite(evidence?.combinedVolumePressure),

    intraday: intraday
      ? {
          available: intraday.available === true,
          stocksScanned: finite(intraday.stocksScanned),
          stocksWithVolume: finite(intraday.stocksWithVolume),
          coveragePct: finite(intraday.coveragePct),
          advancingVolumeShare:
            finite(intraday.advancingVolumeShare),
          decliningVolumeShare:
            finite(intraday.decliningVolumeShare),
          volumeImbalance:
            finite(intraday.volumeImbalance),
          volumePressure:
            finite(intraday.volumePressure),
          reason: intraday.reason || null,
        }
      : null,

    eod: eod
      ? {
          available: eod.available === true,
          stocksScanned: finite(eod.stocksScanned),
          stocksWithVolume: finite(eod.stocksWithVolume),
          coveragePct: finite(eod.coveragePct),
          advancingVolumeShare:
            finite(eod.advancingVolumeShare),
          decliningVolumeShare:
            finite(eod.decliningVolumeShare),
          volumeImbalance:
            finite(eod.volumeImbalance),
          volumePressure:
            finite(eod.volumePressure),
          reason: eod.reason || null,
        }
      : null,
  };
}

function classifyBreadthForTrap(breadth, trapSide) {
  if (!breadth?.available) return "UNAVAILABLE";

  const label = String(breadth.label || "").toUpperCase();

  if (trapSide === ENGINE29_TRAP_SIDES.BULL) {
    if (
      label === "BREADTH_PARTICIPATION_WEAK" ||
      label === "BREADTH_PARTICIPATION_MIXED_WEAKENING"
    ) {
      return "SUPPORTS_TRAP";
    }

    if (label === "BREADTH_PARTICIPATION_HEALTHY") {
      return "OPPOSES_TRAP";
    }

    return "NEUTRAL";
  }

  if (trapSide === ENGINE29_TRAP_SIDES.BEAR) {
    if (
      label === "BREADTH_PARTICIPATION_HEALTHY" ||
      label === "BREADTH_PARTICIPATION_MIXED"
    ) {
      return "SUPPORTS_TRAP";
    }

    if (label === "BREADTH_PARTICIPATION_WEAK") {
      return "OPPOSES_TRAP";
    }

    return "NEUTRAL";
  }

  return "NOT_APPLICABLE";
}

function classifyVolumeForTrap(volume, trapSide) {
  if (!volume?.available) return "UNAVAILABLE";

  const label =
    String(volume.distributionLabel || "").toUpperCase();

  if (trapSide === ENGINE29_TRAP_SIDES.BULL) {
    if (
      label === "DISTRIBUTION_PRESSURE_HIGH" ||
      label === "DISTRIBUTION_PRESSURE_ELEVATED"
    ) {
      return "SUPPORTS_TRAP";
    }

    if (label === "DISTRIBUTION_PRESSURE_LOW") {
      return "OPPOSES_TRAP";
    }

    return "NEUTRAL";
  }

  if (trapSide === ENGINE29_TRAP_SIDES.BEAR) {
    if (
      label === "DISTRIBUTION_PRESSURE_LOW" ||
      label === "DISTRIBUTION_PRESSURE_WATCH"
    ) {
      return "SUPPORTS_TRAP";
    }

    if (label === "DISTRIBUTION_PRESSURE_HIGH") {
      return "OPPOSES_TRAP";
    }

    return "NEUTRAL";
  }

  return "NOT_APPLICABLE";
}

export function readEngine25TrapParticipation({
  trapSide = ENGINE29_TRAP_SIDES.NONE,
  filePath = DEFAULT_SECTOR_HEALTH_FILE,
  now = Date.now(),
} = {}) {
  const data = readJson(filePath);

  if (!data) {
    return {
      version: "engine29.engine25TrapParticipation.v1",
      authority:
        "ENGINE25_SCANNER_PRIMARY_READ_ONLY",
      available: false,
      filePath,
      sourceUpdatedAt: null,
      sourceAgeMinutes: null,
      trapSide,
      breadth: null,
      stockVolume: null,
      breadthAlignment: "UNAVAILABLE",
      volumeAlignment: "UNAVAILABLE",
      primaryParticipationSupportsTrap: false,
      primaryParticipationOpposesTrap: false,
      reasonCodes: [
        "ENGINE25_SECTOR_HEALTH_UNAVAILABLE",
      ],
    };
  }

  const breadth = breadthRead(data);
  const stockVolume = volumeRead(data);

  const breadthAlignment =
    classifyBreadthForTrap(
      breadth,
      trapSide
    );

  const volumeAlignment =
    classifyVolumeForTrap(
      stockVolume,
      trapSide
    );

  const sourceMs = sourceTimestampMs(data);

  const sourceAgeMinutes =
    Number.isFinite(sourceMs)
      ? Math.max(
          0,
          Math.round(
            (Number(now) - sourceMs) / 60000
          )
        )
      : null;

  const available =
    breadth.available &&
    stockVolume.available;

  const primaryParticipationSupportsTrap =
    available &&
    breadthAlignment === "SUPPORTS_TRAP" &&
    volumeAlignment === "SUPPORTS_TRAP";

  const primaryParticipationOpposesTrap =
    available &&
    (
      breadthAlignment === "OPPOSES_TRAP" ||
      volumeAlignment === "OPPOSES_TRAP"
    );

  return {
    version: "engine29.engine25TrapParticipation.v1",
    authority:
      "ENGINE25_SCANNER_PRIMARY_READ_ONLY",

    available,
    filePath,
    sourceUpdatedAt:
      data?.updatedAt || null,
    sourceAgeMinutes,

    trapSide,

    breadth,
    stockVolume,

    breadthAlignment,
    volumeAlignment,

    primaryParticipationSupportsTrap,
    primaryParticipationOpposesTrap,

    reasonCodes: [
      breadthAlignment === "SUPPORTS_TRAP"
        ? "ENGINE25_SCANNER_BREADTH_SUPPORTS_TRAP"
        : null,
      breadthAlignment === "OPPOSES_TRAP"
        ? "ENGINE25_SCANNER_BREADTH_OPPOSES_TRAP"
        : null,
      volumeAlignment === "SUPPORTS_TRAP"
        ? "ENGINE25_STOCK_VOLUME_SUPPORTS_TRAP"
        : null,
      volumeAlignment === "OPPOSES_TRAP"
        ? "ENGINE25_STOCK_VOLUME_OPPOSES_TRAP"
        : null,
      !breadth.available
        ? "ENGINE25_SCANNER_BREADTH_UNAVAILABLE"
        : null,
      !stockVolume.available
        ? "ENGINE25_STOCK_VOLUME_UNAVAILABLE"
        : null,
    ].filter(Boolean),
  };
}

export default readEngine25TrapParticipation;
