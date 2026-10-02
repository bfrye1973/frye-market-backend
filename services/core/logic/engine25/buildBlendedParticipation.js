// services/core/logic/engine25/buildBlendedParticipation.js
// Engine25 / Engine26E deterministic blended participation synthesis.
// Consumer-only: reads normalized canonical timeframe payloads supplied by caller.
// No file I/O, no producer mutation, no trading authority.

import {
  buildEngine25SectorGroups,
  CANONICAL_ENGINE25_SECTORS,
} from "./buildSectorCardGroups.js";
import { expectedCompletedEquitySessionDate } from "../buildParticipationArtifact.js";

export const ENGINE25_BLENDED_PARTICIPATION_SCHEMA =
  "engine25.blendedParticipation@1";

export const BLENDED_PARTICIPATION_CONFIG = Object.freeze({
  baseWeights: Object.freeze({
    "10m": 0.25,
    "1h": 0.35,
    "4h": 0.25,
    eod: 0.15,
  }),
  freshness: Object.freeze({
    "10m": Object.freeze({ fullMs: 10 * 60 * 1000, zeroMs: 15 * 60 * 1000 }),
    "1h": Object.freeze({ fullMs: 15 * 60 * 1000, zeroMs: 75 * 60 * 1000 }),
    "4h": Object.freeze({ fullMs: 60 * 60 * 1000, zeroMs: 300 * 60 * 1000 }),
    eod: Object.freeze({ sessionDateValidated: true }),
  }),
  evidenceGate: Object.freeze({
    minUsableEffectiveWeight: 0.5,
    minUsableTimeframes: 2,
  }),
  thresholds: Object.freeze({
    strongScore: 0.35,
    weakScore: -0.35,
    fastExtremeWeak: -0.65,
    fastExtremeStrong: 0.65,
    higherHealthyMin: 0.1,
    higherWeakMax: -0.2,
    recoveringFastMin: 0.0,
    broadWeakMinWeakTimeframes: 3,
    broadStrongMinStrongTimeframes: 3,
  }),
});

const TF_ORDER = ["10m", "1h", "4h", "eod"];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, places = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function parseTimestampMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function timestampDate(value) {
  const ms = parseTimestampMs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function marketDate(now, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(now));
  const pick = (type) => parts.find((p) => p.type === type)?.value || null;
  return {
    date: `${pick("year")}-${pick("month")}-${pick("day")}`,
    weekday: pick("weekday"),
  };
}

function timestampMarketDate(value, timeZone = "America/New_York") {
  const ms = parseTimestampMs(value);
  if (!Number.isFinite(ms)) return null;
  return marketDate(ms, timeZone).date;
}

export function extractCanonicalSourceTimestamp(payload) {
  return (
    payload?.updated_at_utc ||
    payload?.generated_at_utc ||
    payload?.sectorsUpdatedAt ||
    payload?.meta?.ts_utc ||
    payload?.meta?.last_full_run_utc ||
    payload?.meta?.last_run_utc ||
    null
  );
}

export function computeLinearFreshnessMultiplier(ageMs, fullMs, zeroMs) {
  const age = finite(ageMs);
  if (age === null || age < 0) return 0;
  if (age <= fullMs) return 1;
  if (age >= zeroMs) return 0;
  return round((zeroMs - age) / (zeroMs - fullMs));
}

function countClassifications(groups) {
  return {
    strongCount: Array.isArray(groups?.strong) ? groups.strong.length : 0,
    neutralCount: Array.isArray(groups?.neutral) ? groups.neutral.length : 0,
    weakCount: Array.isArray(groups?.weak) ? groups.weak.length : 0,
  };
}

function timeframeStateFromScore(score) {
  if (score === null) return "UNAVAILABLE";
  if (score >= BLENDED_PARTICIPATION_CONFIG.thresholds.strongScore) return "STRONG";
  if (score <= BLENDED_PARTICIPATION_CONFIG.thresholds.weakScore) return "WEAK";
  return "MIXED";
}

function buildTimeframeDiagnostic({ timeframe, payload, now }) {
  const baseWeight = BLENDED_PARTICIPATION_CONFIG.baseWeights[timeframe];
  const timestamp = extractCanonicalSourceTimestamp(payload);
  const timestampMs = parseTimestampMs(timestamp);
  const ageMs = Number.isFinite(timestampMs)
    ? Math.max(0, Number(now) - timestampMs)
    : null;

  const cards = Array.isArray(payload?.sectorCards) ? payload.sectorCards : [];
  const groups = buildEngine25SectorGroups(cards);
  const complete = groups?.available === true && groups?.complete === true;
  const counts = countClassifications(groups);
  const canonicalSectorCount = complete
    ? CANONICAL_ENGINE25_SECTORS.length
    : groups?.receivedCanonicalCount ?? 0;

  const score = complete
    ? round(
        (counts.strongCount - counts.weakCount) /
          CANONICAL_ENGINE25_SECTORS.length
      )
    : null;

  let freshnessMultiplier = 0;
  let freshnessState = "UNAVAILABLE";
  let freshnessReason = "SOURCE_OR_TIMESTAMP_MISSING";

  if (!payload || !timestamp) {
    freshnessMultiplier = 0;
  } else if (!complete) {
    freshnessMultiplier = 0;
    freshnessState = "UNUSABLE_INCOMPLETE_CANONICAL_SECTORS";
    freshnessReason = groups?.reason || "INCOMPLETE_CANONICAL_SECTOR_CARDS";
  } else if (timeframe === "eod") {
    const sourceSessionDate = timestampMarketDate(timestamp);
    const expectedSessionDate = expectedCompletedEquitySessionDate(now);
    const currentMarket = marketDate(now);
    const weekdayOpen = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(
      currentMarket.weekday
    );
    const validDates = new Set(
      [expectedSessionDate, weekdayOpen ? currentMarket.date : null].filter(Boolean)
    );
    const valid = Boolean(sourceSessionDate) && validDates.has(sourceSessionDate);
    freshnessMultiplier = valid ? 1 : 0;
    freshnessState = valid ? "FRESH" : "STALE";
    freshnessReason = valid
      ? sourceSessionDate === currentMarket.date
        ? "CURRENT_EQUITY_SESSION_DATE_PRESENT"
        : "EXPECTED_COMPLETED_EQUITY_SESSION_PRESENT"
      : "EOD_SESSION_DATE_MISMATCH";
  } else if (Number.isFinite(ageMs)) {
    const { fullMs, zeroMs } = BLENDED_PARTICIPATION_CONFIG.freshness[timeframe];
    freshnessMultiplier = computeLinearFreshnessMultiplier(ageMs, fullMs, zeroMs);
    if (freshnessMultiplier === 1) {
      freshnessState = "FRESH";
      freshnessReason = "WITHIN_FULL_WEIGHT_WINDOW";
    } else if (freshnessMultiplier > 0) {
      freshnessState = "DECAYING";
      freshnessReason = "WITHIN_DECAY_WINDOW";
    } else {
      freshnessState = "STALE";
      freshnessReason = "BEYOND_ZERO_WEIGHT_BOUNDARY";
    }
  }

  const effectiveWeight = round(baseWeight * freshnessMultiplier);

  return {
    timeframe,
    sourceTimestamp: timestamp,
    sourceSessionDate:
      timeframe === "eod" ? timestampMarketDate(timestamp) : timestampDate(timestamp),
    ageMs,
    freshnessState,
    freshnessReason,
    baseWeight,
    freshnessMultiplier,
    effectiveWeight,
    completeCanonicalSet: complete,
    expectedSectorCount: CANONICAL_ENGINE25_SECTORS.length,
    sectorCount: canonicalSectorCount,
    missingNames: groups?.missingNames || [],
    duplicateNames: groups?.duplicateNames || [],
    unknownNames: groups?.unknownNames || [],
    incompleteCards: groups?.incompleteCards || [],
    ...counts,
    timeframeScore: score,
    timeframeState: timeframeStateFromScore(score),
  };
}

function normalizedWeightsFromDiagnostics(sourceDiagnostics) {
  const total = TF_ORDER.reduce(
    (sum, tf) => sum + Number(sourceDiagnostics[tf]?.effectiveWeight || 0),
    0
  );
  const normalized = {};
  for (const tf of TF_ORDER) {
    const w = Number(sourceDiagnostics[tf]?.effectiveWeight || 0);
    normalized[tf] = total > 0 ? round(w / total) : 0;
  }
  return { totalEffectiveWeight: round(total), normalizedWeights: normalized };
}

function weightedScore(sourceDiagnostics, normalizedWeights) {
  let sum = 0;
  let seen = false;
  for (const tf of TF_ORDER) {
    const score = finite(sourceDiagnostics[tf]?.timeframeScore);
    const weight = finite(normalizedWeights[tf]) || 0;
    if (score !== null && weight > 0) {
      sum += score * weight;
      seen = true;
    }
  }
  return seen ? round(Math.max(-1, Math.min(1, sum))) : null;
}

function higherTimeframeWeightedScore(sourceDiagnostics) {
  const tfs = ["1h", "4h", "eod"];
  let weighted = 0;
  let total = 0;
  for (const tf of tfs) {
    const d = sourceDiagnostics[tf];
    if (d?.timeframeScore === null || Number(d?.effectiveWeight || 0) <= 0) continue;
    weighted += d.timeframeScore * d.effectiveWeight;
    total += d.effectiveWeight;
  }
  return total > 0 ? round(weighted / total) : null;
}

function classifyBlendedParticipation({ sourceDiagnostics }) {
  const reasons = [];
  const conflictFlags = [];
  const t = BLENDED_PARTICIPATION_CONFIG.thresholds;
  const fast = sourceDiagnostics["10m"];
  const higherScore = higherTimeframeWeightedScore(sourceDiagnostics);

  const usable = TF_ORDER.filter(
    (tf) => Number(sourceDiagnostics[tf]?.effectiveWeight || 0) > 0
  );
  const strongTfs = usable.filter(
    (tf) => sourceDiagnostics[tf]?.timeframeScore >= t.strongScore
  );
  const weakTfs = usable.filter(
    (tf) => sourceDiagnostics[tf]?.timeframeScore <= t.weakScore
  );

  if (
    Number(fast?.effectiveWeight || 0) > 0 &&
    fast.timeframeScore <= t.fastExtremeWeak &&
    higherScore !== null &&
    higherScore >= t.higherHealthyMin
  ) {
    reasons.push("FAST_WEAK_HIGHER_TF_HEALTHY");
    conflictFlags.push("FAST_VS_HIGHER_TIMEFRAME_DIVERGENCE");
    return {
      state: "SHORT_TERM_DETERIORATION",
      agreementState: "TIMEFRAME_DIVERGENCE",
      conflictFlags,
      reasonCodes: reasons,
      higherTimeframeScore: higherScore,
    };
  }

  if (
    Number(fast?.effectiveWeight || 0) > 0 &&
    fast.timeframeScore >= t.recoveringFastMin &&
    higherScore !== null &&
    higherScore <= t.higherWeakMax
  ) {
    reasons.push("FAST_RECOVERY_BROADER_WEAK");
    conflictFlags.push("FAST_RECOVERY_VS_BROADER_WEAKNESS");
    return {
      state: "RECOVERING",
      agreementState: "TIMEFRAME_DIVERGENCE",
      conflictFlags,
      reasonCodes: reasons,
      higherTimeframeScore: higherScore,
    };
  }

  if (weakTfs.length >= t.broadWeakMinWeakTimeframes) {
    reasons.push("BROAD_MULTI_TF_WEAKNESS");
    return {
      state: "BROAD_WEAKNESS",
      agreementState: "BROAD_AGREEMENT_WEAK",
      conflictFlags,
      reasonCodes: reasons,
      higherTimeframeScore: higherScore,
    };
  }

  if (strongTfs.length >= t.broadStrongMinStrongTimeframes) {
    reasons.push("BROAD_MULTI_TF_STRENGTH");
    return {
      state: "STRONG",
      agreementState: "BROAD_AGREEMENT_STRONG",
      conflictFlags,
      reasonCodes: reasons,
      higherTimeframeScore: higherScore,
    };
  }

  const hasStrong = strongTfs.length > 0;
  const hasWeak = weakTfs.length > 0;
  if (hasStrong && hasWeak) {
    reasons.push("HIGH_TIMEFRAME_DISAGREEMENT");
    conflictFlags.push("MIXED_STRONG_AND_WEAK_TIMEFRAMES");
  } else {
    reasons.push("MIXED_PARTICIPATION_EVIDENCE");
  }

  return {
    state: "MIXED",
    agreementState: hasStrong && hasWeak ? "TIMEFRAME_DISAGREEMENT" : "MIXED",
    conflictFlags,
    reasonCodes: reasons,
    higherTimeframeScore: higherScore,
  };
}

function sourceReasonCodes(sourceDiagnostics) {
  const codes = [];
  const map = {
    "10m": "SOURCE_10M_STALE",
    "1h": "SOURCE_1H_STALE",
    "4h": "SOURCE_4H_STALE",
    eod: "SOURCE_EOD_STALE",
  };
  for (const tf of TF_ORDER) {
    const d = sourceDiagnostics[tf];
    if (!d) continue;
    if (d.freshnessState === "STALE") codes.push(map[tf]);
    if (d.freshnessState === "UNUSABLE_INCOMPLETE_CANONICAL_SECTORS") {
      codes.push(`SOURCE_${tf.toUpperCase()}_INCOMPLETE`);
    }
    if (d.freshnessState === "UNAVAILABLE") {
      codes.push(`SOURCE_${tf.toUpperCase()}_UNAVAILABLE`);
    }
  }
  return codes;
}

export function buildEngine25BlendedParticipation({
  intraday,
  hourly,
  fourHour,
  eod,
  now = Date.now(),
} = {}) {
  const payloadByTf = { "10m": intraday, "1h": hourly, "4h": fourHour, eod };
  const sourceDiagnostics = {};

  for (const tf of TF_ORDER) {
    sourceDiagnostics[tf] = buildTimeframeDiagnostic({
      timeframe: tf,
      payload: payloadByTf[tf],
      now,
    });
  }

  const { totalEffectiveWeight, normalizedWeights } =
    normalizedWeightsFromDiagnostics(sourceDiagnostics);
  const usableTimeframeCount = TF_ORDER.filter(
    (tf) => Number(sourceDiagnostics[tf]?.effectiveWeight || 0) > 0
  ).length;

  const evidenceSufficient =
    totalEffectiveWeight >=
      BLENDED_PARTICIPATION_CONFIG.evidenceGate.minUsableEffectiveWeight &&
    usableTimeframeCount >=
      BLENDED_PARTICIPATION_CONFIG.evidenceGate.minUsableTimeframes;

  const blendScore = evidenceSufficient
    ? weightedScore(sourceDiagnostics, normalizedWeights)
    : null;

  const sourceCodes = sourceReasonCodes(sourceDiagnostics);
  const blendClassification = evidenceSufficient
    ? classifyBlendedParticipation({ sourceDiagnostics })
    : {
        state: "INSUFFICIENT_DATA",
        agreementState: "INSUFFICIENT_DATA",
        conflictFlags: [],
        reasonCodes: ["INSUFFICIENT_USABLE_PARTICIPATION_EVIDENCE"],
        higherTimeframeScore: higherTimeframeWeightedScore(sourceDiagnostics),
      };

  const fast = sourceDiagnostics["10m"];
  const fastParticipation = {
    timeframe: "10m",
    sourceTimestamp: fast.sourceTimestamp,
    ageMs: fast.ageMs,
    freshnessState: fast.freshnessState,
    strongCount: fast.strongCount,
    neutralCount: fast.neutralCount,
    weakCount: fast.weakCount,
    sectorCount: fast.sectorCount,
    timeframeScore: fast.timeframeScore,
    state: fast.timeframeState,
    advancingStocks: Array.isArray(intraday?.sectorCards)
      ? intraday.sectorCards.reduce((s, c) => s + Number(c?.up || 0), 0)
      : null,
    decliningStocks: Array.isArray(intraday?.sectorCards)
      ? intraday.sectorCards.reduce((s, c) => s + Number(c?.down || 0), 0)
      : null,
    advancingVolume: Array.isArray(intraday?.sectorCards)
      ? round(intraday.sectorCards.reduce((s, c) => s + Number(c?.advancingVolume || 0), 0), 3)
      : null,
    decliningVolume: Array.isArray(intraday?.sectorCards)
      ? round(intraday.sectorCards.reduce((s, c) => s + Number(c?.decliningVolume || 0), 0), 3)
      : null,
  };

  const av = finite(fastParticipation.advancingVolume);
  const dv = finite(fastParticipation.decliningVolume);
  fastParticipation.volumeImbalance =
    av !== null && dv !== null && av + dv > 0
      ? round((av - dv) / (av + dv))
      : null;

  const blendedParticipation = {
    state: blendClassification.state,
    blendedScore: blendScore,
    higherTimeframeScore: blendClassification.higherTimeframeScore,
    usableEffectiveWeight: totalEffectiveWeight,
    usableTimeframeCount,
    normalizedWeights,
    agreementState: blendClassification.agreementState,
    conflictFlags: blendClassification.conflictFlags,
    reasonCodes: [...sourceCodes, ...blendClassification.reasonCodes],
  };

  return {
    ok: evidenceSufficient,
    engine: "engine25.blendedParticipation.v1",
    schema: ENGINE25_BLENDED_PARTICIPATION_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    authority: {
      mode: "DISPLAY_NARRATION_MARKET_CONTEXT_ONLY",
      tradingAuthorityChanged: false,
      producerMutation: false,
    },
    config: BLENDED_PARTICIPATION_CONFIG,
    fastParticipation,
    blendedParticipation,
    sourceDiagnostics,
  };
}

export default buildEngine25BlendedParticipation;
