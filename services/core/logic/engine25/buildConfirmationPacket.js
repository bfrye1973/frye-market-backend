// Engine 25 read-only cross-engine confirmation packet.
// No trading authority. No Engine 22/27 mutation.

export const ENGINE25_CONFIRMATION_PACKET_SCHEMA = "engine25.confirmationPacket.v1";
export const ENGINE25_CONFIRMATION_FORMULA_VERSION = "tradePermissionShadow.65_20_15.v1";

export const TRADE_PERMISSION_WEIGHTS = Object.freeze({
  esMaster: 0.65,
  fourHour: 0.20,
  reconstructedEod: 0.15,
});

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function iso(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function lastBarTime(light) {
  const raw = finite(light?.lastBar?.time);
  if (raw === null) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  return new Date(ms).toISOString();
}

const TF_MS = Object.freeze({
  "10m": 10 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
});

export function completedBarStatus(light, timeframe, asOfUtc) {
  const startRaw = finite(light?.lastBar?.time);
  const asOfMs = Date.parse(String(asOfUtc || ""));
  const durationMs = TF_MS[timeframe] || null;
  if (startRaw === null || !Number.isFinite(asOfMs) || !durationMs) {
    return {
      known: false,
      completed: null,
      barStartUtc: lastBarTime(light),
      expectedEndUtc: null,
      reason: "BAR_COMPLETION_UNVERIFIABLE",
    };
  }
  const startMs = startRaw > 1e12 ? startRaw : startRaw * 1000;
  const expectedEndMs = startMs + durationMs;
  return {
    known: true,
    completed: expectedEndMs <= asOfMs,
    barStartUtc: new Date(startMs).toISOString(),
    expectedEndUtc: new Date(expectedEndMs).toISOString(),
    reason: expectedEndMs <= asOfMs ? "BAR_COMPLETED_BY_ASOF" : "BAR_NOT_COMPLETED_BY_ASOF",
  };
}

export function classifyTradePermission(score) {
  const x = finite(score);
  if (x === null) {
    return { state: "INSUFFICIENT_DATA", sizing: "NO_DECISION_SCORE", directionalBias: "UNKNOWN" };
  }
  if (x >= 65) return { state: "LONG_BIAS", sizing: "NORMAL_LONG_PERMISSION", directionalBias: "BULLISH" };
  if (x >= 55) return { state: "LONG_ALLOWED_REDUCED_SIZE", sizing: "NO_AGGRESSIVE_SIZE_UP", directionalBias: "BULLISH_SELECTIVE" };
  if (x >= 50) return { state: "NEUTRAL_WAIT", sizing: "DO_NOT_SIZE_UP", directionalBias: "MIXED" };
  if (x >= 45) return { state: "AVOID_NEW_LONGS_SHORT_WATCH", sizing: "NO_SIZE_UP_LONG", directionalBias: "BEARISH_WARNING" };
  if (x >= 35) return { state: "BEARISH_SHORTS_FAVORED", sizing: "DEFENSIVE", directionalBias: "BEARISH" };
  return { state: "STRONG_DEFENSIVE_BEARISH", sizing: "NO_NORMAL_LONGS", directionalBias: "STRONGLY_BEARISH" };
}

function sourceTimeFromLight(light) {
  return iso(light?.updated_at_utc) || lastBarTime(light);
}

function provenanceBlock(provenance, fallback) {
  return {
    kind: provenance?.kind || fallback,
    reconstructed: provenance?.reconstructed === true,
    originallyPublished: provenance?.originallyPublished === true,
    archiveReference: provenance?.archiveReference || null,
  };
}

function afterCutoff(timestamp, asOfUtc) {
  const t = Date.parse(String(timestamp || ""));
  const c = Date.parse(String(asOfUtc || ""));
  return Number.isFinite(t) && Number.isFinite(c) && t > c;
}

function warningPush(list, code, detail = null) {
  if (!list.some((x) => x.code === code)) list.push({ code, detail });
}

export function buildEngine25ConfirmationPacket({
  marketMeter,
  reconstructedEod,
  participationArtifact,
  asOfUtc = new Date().toISOString(),
  provenance = {},
  mode = "LIVE",
} = {}) {
  const generatedAtUtc = new Date().toISOString();
  const warnings = [];

  const masterScore = finite(marketMeter?.master?.score);
  const fourHour = marketMeter?.lights?.["4h"] || null;
  const fourHourScore = finite(fourHour?.score);
  const eodScore = finite(reconstructedEod?.score);

  const masterSourceTimestamp = iso(marketMeter?.updated_at_utc);
  const fourHourSourceTimestamp = sourceTimeFromLight(fourHour);
  const eodSourceTimestamp = iso(reconstructedEod?.updated_at_utc);

  const required = {
    esMaster: masterScore !== null,
    fourHour: fourHourScore !== null,
    reconstructedEod: eodScore !== null,
  };

  if (!required.esMaster) warningPush(warnings, "ES_MASTER_UNAVAILABLE");
  if (!required.fourHour) warningPush(warnings, "ES_4H_UNAVAILABLE");
  if (!required.reconstructedEod) warningPush(warnings, "RECONSTRUCTED_EOD_UNAVAILABLE");

  const timestamps = {
    ES_MASTER: masterSourceTimestamp,
    ES_4H: fourHourSourceTimestamp,
    RECONSTRUCTED_EOD: eodSourceTimestamp,
  };
  for (const [name, ts] of Object.entries(timestamps)) {
    if (afterCutoff(ts, asOfUtc)) warningPush(warnings, name + "_AFTER_ASOF_CUTOFF", ts);
  }

  const fourHourCompletion = completedBarStatus(fourHour, "4h", asOfUtc);
  if (fourHourCompletion.completed === false) {
    warningPush(warnings, "ES_4H_LAST_BAR_INCOMPLETE", fourHourCompletion.expectedEndUtc);
  }

  const allRequiredPresent = Object.values(required).every(Boolean);
  const cutoffViolation = warnings.some((w) => w.code.endsWith("_AFTER_ASOF_CUTOFF"));

  const score =
    allRequiredPresent && !cutoffViolation
      ? masterScore * TRADE_PERMISSION_WEIGHTS.esMaster +
        fourHourScore * TRADE_PERMISSION_WEIGHTS.fourHour +
        eodScore * TRADE_PERMISSION_WEIGHTS.reconstructedEod
      : null;

  const classification = classifyTradePermission(score);

  const fast = participationArtifact?.fastParticipation || null;
  const blended = participationArtifact?.blendedParticipation || null;
  const diagnostics = participationArtifact?.sourceDiagnostics || null;
  const stockVolume = participationArtifact?.participation?.stockVolume || null;
  const distribution = participationArtifact?.participation?.distributionPressure || null;
  const participationFreshness = participationArtifact?.freshness || null;

  if (blended?.state === "INSUFFICIENT_DATA") warningPush(warnings, "BLENDED_PARTICIPATION_INSUFFICIENT_DATA");
  for (const code of Array.isArray(blended?.reasonCodes) ? blended.reasonCodes : []) warningPush(warnings, code);
  for (const flag of Array.isArray(blended?.conflictFlags) ? blended.conflictFlags : []) warningPush(warnings, flag);
  if (participationFreshness?.state === "LAST_VALID_EQUITY_READ") warningPush(warnings, "EQUITY_DATA_LAST_VALID_ONLY");
  if (participationFreshness?.state === "STALE_INTRADAY_SOURCE") warningPush(warnings, "EQUITY_INTRADAY_SOURCE_STALE");

  const masterState = String(marketMeter?.master?.state || "").toLowerCase();
  const fourHourState = String(fourHour?.state || "").toLowerCase();
  const eodState = String(reconstructedEod?.state || "").toUpperCase();
  if (masterState === "bear") warningPush(warnings, "ES_MASTER_BEARISH");
  if (fourHourState === "bear") warningPush(warnings, "ES_4H_BEARISH");
  if (["MIXED", "WEAK", "BEARISH"].includes(eodState)) warningPush(warnings, "EOD_STRUCTURE_" + eodState);

  return {
    ok: true,
    schema: ENGINE25_CONFIRMATION_PACKET_SCHEMA,
    formulaVersion: ENGINE25_CONFIRMATION_FORMULA_VERSION,
    generatedAtUtc,
    asOfUtc: iso(asOfUtc),
    mode,
    authority: {
      owner: "ENGINE25",
      role: "INDEPENDENT_MARKET_CONFIRMATION",
      changesTradingPermission: false,
      changesWaveStructure: false,
      changesBrokerExecution: false,
      provisional: true,
    },
    calibration: {
      historicallyCalibrated: false,
      weightsProvisional: true,
      thresholdsProvisional: true,
    },
    sources: {
      esMaster: {
        available: masterScore !== null,
        score: masterScore,
        state: marketMeter?.master?.state || null,
        tone: marketMeter?.master?.tone || null,
        sourceTimestamp: masterSourceTimestamp,
        timeframeWeights: marketMeter?.master?.weights || null,
        provenance: provenanceBlock(provenance.esMaster, mode === "LIVE" ? "LIVE_PUBLISHED" : "RETROSPECTIVE_RECONSTRUCTION"),
      },
      fourHour: {
        available: fourHourScore !== null,
        score: fourHourScore,
        state: fourHour?.state || null,
        reason: fourHour?.reason || null,
        formula: fourHour?.formula || null,
        sourceTimestamp: fourHourSourceTimestamp,
        lastBar: fourHour?.lastBar || null,
        completedBar: fourHourCompletion,
        provenance: provenanceBlock(provenance.fourHour, mode === "LIVE" ? "LIVE_PUBLISHED" : "RETROSPECTIVE_RECONSTRUCTION"),
      },
      reconstructedEod: {
        available: eodScore !== null,
        score: eodScore,
        state: reconstructedEod?.state || null,
        breadthScore: finite(reconstructedEod?.breadthScore),
        momentumScore: finite(reconstructedEod?.momentumScore),
        completedSessionDate: reconstructedEod?.completedSessionDate || null,
        sourceTimestamp: eodSourceTimestamp,
        shadowOnly: true,
        productionAuthority: reconstructedEod?.productionAuthority === true,
        provenance: provenanceBlock(provenance.reconstructedEod, "RETROSPECTIVE_RECONSTRUCTION"),
      },
      fastParticipation: fast,
      blendedParticipation: blended,
      sourceDiagnostics: diagnostics,
      stockVolume,
      distributionPressure: distribution,
    },
    freshness: {
      participation: participationFreshness,
      diagnostics,
    },
    tradePermissionShadow: {
      score: score === null ? null : Number(score.toFixed(2)),
      state: classification.state,
      sizing: classification.sizing,
      directionalBias: classification.directionalBias,
      weights: TRADE_PERMISSION_WEIGHTS,
      requiredInputs: required,
      insufficientData: !allRequiredPresent || cutoffViolation,
      provisional: true,
    },
    warnings,
  };
}

export default buildEngine25ConfirmationPacket;
