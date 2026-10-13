// services/core/logic/engine29/participation/readEngine25Participation.js
// Engine 29 shared read-only adapter for canonical Engine 25 participation.
//
// Engine 25 owns participation truth and freshness/session usability.
// This adapter validates and normalizes the published artifact only.
// It does NOT run Engine 25, a stock scanner, or any participation calculation.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ENGINE25_PARTICIPATION_SCHEMA = "engine25.participation@1";

export const DEFAULT_ENGINE25_PARTICIPATION_FILE = path.resolve(
  __dirname,
  "../../../data/engine25-participation.json"
);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return { data: null, readState: "MISSING" };
  }

  try {
    return {
      data: JSON.parse(fs.readFileSync(filePath, "utf8")),
      readState: "READ",
    };
  } catch {
    return { data: null, readState: "MALFORMED" };
  }
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function contractErrors(data) {
  const errors = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return ["ENGINE25_PARTICIPATION_OBJECT_INVALID"];
  }

  if (data.schema !== ENGINE25_PARTICIPATION_SCHEMA) {
    errors.push("ENGINE25_PARTICIPATION_SCHEMA_INVALID");
  }

  if (data.engine !== "engine25.participation.v1") {
    errors.push("ENGINE25_PARTICIPATION_ENGINE_INVALID");
  }

  if (data.authority?.owner !== "ENGINE25") {
    errors.push("ENGINE25_PARTICIPATION_AUTHORITY_INVALID");
  }

  if (!data.participation || typeof data.participation !== "object") {
    errors.push("ENGINE25_PARTICIPATION_TRUTH_MISSING");
  }

  if (!data.participation?.breadth) {
    errors.push("ENGINE25_PARTICIPATION_BREADTH_MISSING");
  }

  if (!data.participation?.distributionPressure) {
    errors.push("ENGINE25_PARTICIPATION_DISTRIBUTION_MISSING");
  }

  if (!data.participation?.stockVolume) {
    errors.push("ENGINE25_PARTICIPATION_STOCK_VOLUME_MISSING");
  }

  if (!data.freshness || typeof data.freshness !== "object") {
    errors.push("ENGINE25_PARTICIPATION_FRESHNESS_MISSING");
  }

  if (typeof data.freshness?.usableForTrapConfirmation !== "boolean") {
    errors.push("ENGINE25_PARTICIPATION_USABILITY_MISSING");
  }

  return errors;
}

export function readEngine25Participation({
  filePath = DEFAULT_ENGINE25_PARTICIPATION_FILE,
} = {}) {
  const { data, readState } = readJson(filePath);

  if (!data) {
    const reasonCode =
      readState === "MALFORMED"
        ? "ENGINE25_PARTICIPATION_ARTIFACT_MALFORMED"
        : "ENGINE25_PARTICIPATION_ARTIFACT_MISSING";

    return {
      version: "engine29.engine25ParticipationAdapter.v1",
      authority: "ENGINE25_PARTICIPATION_READ_ONLY",
      filePath,
      contractValid: false,
      currentTrapConfirmationUsable: false,
      schema: null,
      generatedAt: null,
      participation: null,
      sources: null,
      freshness: {
        state: "UNAVAILABLE",
        reason: reasonCode,
        usableForTrapConfirmation: false,
        intraday: null,
        eod: null,
      },
      diagnostics: {
        lastKnownIntraday: null,
        eod: null,
      },
      reasonCodes: [reasonCode],
    };
  }

  const errors = contractErrors(data);
  const contractValid = errors.length === 0;
  const usableForTrapConfirmation =
    contractValid &&
    data?.freshness?.usableForTrapConfirmation === true;

  const intraday = data?.freshness?.intraday || null;
  const eod = data?.freshness?.eod || null;
  const stockVolume = data?.participation?.stockVolume || null;

  return {
    version: "engine29.engine25ParticipationAdapter.v1",
    authority: "ENGINE25_PARTICIPATION_READ_ONLY",
    filePath,

    contractValid,
    currentTrapConfirmationUsable: usableForTrapConfirmation,

    schema: data?.schema || null,
    generatedAt: data?.generatedAt || null,

    participation: {
      breadth: data?.participation?.breadth || null,
      sectorParticipation:
        data?.participation?.sectorParticipation || null,
      momentum: data?.participation?.momentum || null,
      newHighsNewLows:
        data?.participation?.newHighsNewLows || null,
      upDown: data?.participation?.upDown || null,
      distributionPressure:
        data?.participation?.distributionPressure || null,
      stockVolume,
    },

    sources: data?.sources || null,

    freshness: {
      state: data?.freshness?.state || "UNAVAILABLE",
      reason:
        data?.freshness?.reason ||
        (contractValid
          ? "ENGINE25_PARTICIPATION_NOT_USABLE"
          : "ENGINE25_PARTICIPATION_CONTRACT_INVALID"),
      usableForTrapConfirmation,
      equityScannerSession:
        data?.freshness?.equityScannerSession || null,
      intraday,
      eod,
    },

    diagnostics: {
      lastKnownIntraday: {
        sourceTimestamp:
          data?.sources?.intraday?.sourceTimestamp ||
          intraday?.sourceTimestamp ||
          null,
        sourceHealthy:
          intraday?.sourceHealthy === true,
        sourceCurrent:
          intraday?.sourceCurrent === true,
        volumeCoverageValid:
          intraday?.volumeCoverageValid === true,
        state: intraday?.state || null,
        reason: intraday?.reason || null,
        breadth:
          data?.participation?.breadth?.inputs?.intraday || null,
        stockVolume: stockVolume?.intraday || null,
      },
      eod: {
        sourceTimestamp:
          data?.sources?.eod?.sourceTimestamp ||
          eod?.sourceTimestamp ||
          null,
        sessionDate:
          data?.sources?.eod?.sessionDate ||
          eod?.sessionDate ||
          null,
        expectedSessionDate:
          eod?.expectedSessionDate || null,
        valid: eod?.valid === true,
        sourceHealthy: eod?.sourceHealthy === true,
        reason: eod?.reason || null,
        breadth:
          data?.participation?.breadth?.inputs?.eod || null,
        stockVolume: stockVolume?.eod || null,
      },
    },

    reasonCodes: [
      ...errors,
      contractValid && !usableForTrapConfirmation
        ? "ENGINE25_PARTICIPATION_CURRENT_TRAP_CONFIRMATION_UNAVAILABLE"
        : null,
      contractValid && usableForTrapConfirmation
        ? "ENGINE25_PARTICIPATION_CURRENT_TRAP_CONFIRMATION_USABLE"
        : null,
    ].filter(Boolean),

    sourceAgeMinutes:
      finite(intraday?.ageMs) === null
        ? null
        : Math.max(0, Math.round(Number(intraday.ageMs) / 60000)),
  };
}

export default readEngine25Participation;
