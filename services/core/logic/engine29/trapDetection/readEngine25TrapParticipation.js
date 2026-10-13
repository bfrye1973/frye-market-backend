// services/core/logic/engine29/trapDetection/readEngine25TrapParticipation.js
// Engine 29 — read-only Engine 25 participation handoff for trap confirmation.
//
// Reads the shared normalized Engine 25 participation adapter.
// Does NOT run Engine 25, another stock scanner, or any participation calculation.
// Engine 25 owns participation truth and whether current evidence is usable.

import { ENGINE29_TRAP_SIDES } from "./trapConstants.js";
import {
  DEFAULT_ENGINE25_PARTICIPATION_FILE,
  readEngine25Participation,
} from "../participation/readEngine25Participation.js";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function breadthRead(adapter) {
  const breadth = adapter?.participation?.breadth || null;
  const score = finite(breadth?.score);
  const label = breadth?.label || null;

  return {
    available:
      adapter?.contractValid === true &&
      adapter?.currentTrapConfirmationUsable === true &&
      Number.isFinite(score) &&
      Boolean(label),
    score,
    label,
    intraday: breadth?.inputs?.intraday || null,
    eod: breadth?.inputs?.eod || null,
  };
}

function volumeRead(adapter) {
  const distribution =
    adapter?.participation?.distributionPressure || null;
  const evidence =
    adapter?.participation?.stockVolume || null;

  const intraday = evidence?.intraday || null;
  const eod = evidence?.eod || null;

  return {
    available:
      adapter?.contractValid === true &&
      adapter?.currentTrapConfirmationUsable === true &&
      evidence?.available === true,

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
  filePath = DEFAULT_ENGINE25_PARTICIPATION_FILE,
  now = Date.now(),
} = {}) {
  // Keep `now` in the public call shape for downstream compatibility.
  // Freshness itself is canonical Engine 25 truth and is not recomputed here.
  void now;

  const adapter = readEngine25Participation({ filePath });
  const breadth = breadthRead(adapter);
  const stockVolume = volumeRead(adapter);

  const breadthAlignment =
    classifyBreadthForTrap(breadth, trapSide);

  const volumeAlignment =
    classifyVolumeForTrap(stockVolume, trapSide);

  const available =
    adapter?.contractValid === true &&
    adapter?.currentTrapConfirmationUsable === true &&
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
    version: "engine29.engine25TrapParticipation.v2",
    authority:
      "ENGINE25_SCANNER_PRIMARY_READ_ONLY",

    available,
    filePath,

    sourceUpdatedAt:
      adapter?.sources?.intraday?.sourceTimestamp ||
      adapter?.freshness?.intraday?.sourceTimestamp ||
      null,

    sourceAgeMinutes:
      adapter?.sourceAgeMinutes ?? null,

    artifactGeneratedAt:
      adapter?.generatedAt || null,

    trapSide,

    breadth,
    stockVolume,

    breadthAlignment,
    volumeAlignment,

    primaryParticipationSupportsTrap,
    primaryParticipationOpposesTrap,

    freshness: adapter?.freshness || null,
    source: {
      schema: adapter?.schema || null,
      contractValid: adapter?.contractValid === true,
      currentTrapConfirmationUsable:
        adapter?.currentTrapConfirmationUsable === true,
      diagnostics: adapter?.diagnostics || null,
    },

    reasonCodes: [
      ...(adapter?.reasonCodes || []),
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
