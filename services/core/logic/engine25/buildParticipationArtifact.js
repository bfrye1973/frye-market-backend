// services/core/logic/engine25/buildParticipationArtifact.js
// Engine 25 canonical participation artifact packager.
//
// PACKAGER != CALCULATOR.
// This module packages already-computed Engine 25 participation truth.
// It must not recalculate Breadth, Distribution Pressure, stock-volume
// aggregation, sector participation, momentum, NH/NL, or UP/DOWN.

export const ENGINE25_PARTICIPATION_SCHEMA = "engine25.participation@1";
export const DEFAULT_INTRADAY_MAX_AGE_MS = 15 * 60 * 1000;
export const EQUITY_TIME_ZONE = "America/New_York";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function marketParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EQUITY_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));

  const pick = (type) => parts.find((p) => p.type === type)?.value || null;

  return {
    weekday: pick("weekday"),
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: Number(pick("hour")),
    minute: Number(pick("minute")),
  };
}

function ymdFromMarketParts(parts) {
  if (
    !Number.isFinite(parts?.year) ||
    !Number.isFinite(parts?.month) ||
    !Number.isFinite(parts?.day)
  ) {
    return null;
  }

  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function weekdayIndex(shortName) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(shortName);
}

function shiftYmd(ymd, days) {
  const ms = Date.parse(`${ymd}T12:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + days * 86400000);
  return d.toISOString().slice(0, 10);
}

function previousWeekday(ymd, weekday) {
  let idx = weekdayIndex(weekday);
  if (idx < 0) return null;

  let candidate = ymd;
  do {
    candidate = shiftYmd(candidate, -1);
    idx = (idx + 6) % 7;
  } while (idx === 0 || idx === 6);

  return candidate;
}

export function resolveEquityScannerSession(now = Date.now()) {
  const p = marketParts(now);
  const weekday = weekdayIndex(p.weekday);
  const minutes = p.hour * 60 + p.minute;
  const weekdayOpen = weekday >= 1 && weekday <= 5;
  const active = weekdayOpen && minutes >= 9 * 60 + 30 && minutes < 16 * 60;

  return {
    active,
    timeZone: EQUITY_TIME_ZONE,
    weekday: p.weekday,
    hour: p.hour,
    minute: p.minute,
    date: ymdFromMarketParts(p),
    session: active ? "REGULAR_EQUITY_SESSION" : "OUTSIDE_EQUITY_SCANNER_SESSION",
  };
}

export function expectedCompletedEquitySessionDate(now = Date.now()) {
  const p = marketParts(now);
  const today = ymdFromMarketParts(p);
  const weekday = weekdayIndex(p.weekday);
  const minutes = p.hour * 60 + p.minute;

  if (!today || weekday < 0) return null;

  if (weekday >= 1 && weekday <= 5 && minutes >= 16 * 60) {
    return today;
  }

  return previousWeekday(today, p.weekday);
}

function sourceSessionDate(timestamp) {
  const ms = parseMs(timestamp);
  if (!Number.isFinite(ms)) return null;
  return ymdFromMarketParts(marketParts(ms));
}

function buildIntradayFreshness({
  sectorHealth,
  now,
  intradayMaxAgeMs,
  session,
}) {
  const source = sectorHealth?.sources?.intraday || null;
  const sourceTimestamp = source?.updatedAt || null;
  const sourceMs = parseMs(sourceTimestamp);
  const ageMs = Number.isFinite(sourceMs)
    ? Math.max(0, Number(now) - sourceMs)
    : null;

  const volume =
    sectorHealth?.distributionPressure?.inputs?.volumeEvidence?.intraday || null;

  const sourcePresent = Boolean(source);
  const sourceHealthy =
    sectorHealth?.ok === true &&
    source?.ok === true &&
    Number(source?.sectorCardsCount || 0) > 0;

  const volumeCoverageValid = volume?.available === true;
  const sourceCurrent =
    Number.isFinite(ageMs) && ageMs <= Number(intradayMaxAgeMs);

  let state = "FRESH";
  let reason = "ACTIVE_EQUITY_SESSION_CURRENT_VALID_SOURCE";

  if (!session.active) {
    state = "OUTSIDE_EQUITY_SCANNER_SESSION";
    reason = "CURRENT_INTRADAY_CONFIRMATION_UNAVAILABLE_OUTSIDE_EQUITY_SESSION";
  } else if (!sourcePresent || !sourceTimestamp) {
    state = "MISSING_INTRADAY_SOURCE";
    reason = "INTRADAY_SOURCE_OR_TIMESTAMP_MISSING";
  } else if (!sourceHealthy) {
    state = "INVALID_INTRADAY_SOURCE";
    reason = "INTRADAY_SOURCE_UNHEALTHY_OR_EMPTY";
  } else if (!sourceCurrent) {
    state = "STALE_INTRADAY_SOURCE";
    reason = "INTRADAY_SOURCE_OLDER_THAN_MAX_AGE";
  } else if (!volumeCoverageValid) {
    state = "INSUFFICIENT_VOLUME_COVERAGE";
    reason =
      volume?.reason || "INTRADAY_VOLUME_EVIDENCE_DOES_NOT_MEET_VALIDITY_CONTRACT";
  }

  return {
    sourceTimestamp,
    ageMs,
    fresh: state === "FRESH",
    sourceHealthy,
    sourceCurrent,
    volumeCoverageValid,
    maxAgeMs: Number(intradayMaxAgeMs),
    state,
    reason,
  };
}

function buildEodFreshness({ sectorHealth, now }) {
  const source = sectorHealth?.sources?.eod || null;
  const sourceTimestamp = source?.updatedAt || null;
  const sessionDate = sourceSessionDate(sourceTimestamp);
  const expectedSessionDate = expectedCompletedEquitySessionDate(now);

  const sourceHealthy =
    sectorHealth?.ok === true &&
    source?.ok === true &&
    Number(source?.sectorCardsCount || 0) > 0;

  let valid = true;
  let reason = "EXPECTED_COMPLETED_EQUITY_SESSION_PRESENT";

  if (!sourceTimestamp || !sessionDate) {
    valid = false;
    reason = "EOD_SESSION_DATE_MISSING";
  } else if (!sourceHealthy) {
    valid = false;
    reason = "EOD_SOURCE_UNHEALTHY_OR_EMPTY";
  } else if (!expectedSessionDate || sessionDate !== expectedSessionDate) {
    valid = false;
    reason = "EOD_SESSION_DATE_MISMATCH";
  }

  return {
    sourceTimestamp,
    sessionDate,
    expectedSessionDate,
    valid,
    sourceHealthy,
    reason,
  };
}

function packageParticipationTruth(sectorHealth) {
  const breadth = sectorHealth?.breadthParticipation || null;
  const distribution = sectorHealth?.distributionPressure || null;
  const volumeEvidence = distribution?.inputs?.volumeEvidence || null;
  const intradaySummary = sectorHealth?.intradaySummary || null;
  const eodSummary = sectorHealth?.eodSummary || null;

  return {
    breadth,
    sectorParticipation: {
      intraday: {
        count: finite(intradaySummary?.count),
        bullishCount: finite(intradaySummary?.bullishCount),
        neutralCount: finite(intradaySummary?.neutralCount),
        bearishCount: finite(intradaySummary?.bearishCount),
        bullishRatio: finite(intradaySummary?.bullishRatio),
        bearishRatio: finite(intradaySummary?.bearishRatio),
      },
      eod: {
        count: finite(eodSummary?.count),
        bullishCount: finite(eodSummary?.bullishCount),
        neutralCount: finite(eodSummary?.neutralCount),
        bearishCount: finite(eodSummary?.bearishCount),
        bullishRatio: finite(eodSummary?.bullishRatio),
        bearishRatio: finite(eodSummary?.bearishRatio),
      },
    },
    momentum: {
      intradayAvgMomentum: finite(intradaySummary?.avgMomentum),
      eodAvgMomentum: finite(eodSummary?.avgMomentum),
    },
    newHighsNewLows: {
      intradayNetHighsLows: finite(intradaySummary?.totalNetHighsLows),
      eodNetHighsLows: finite(eodSummary?.totalNetHighsLows),
    },
    upDown: {
      intradayUp: finite(intradaySummary?.totalUp),
      intradayDown: finite(intradaySummary?.totalDown),
      eodUp: finite(eodSummary?.totalUp),
      eodDown: finite(eodSummary?.totalDown),
    },
    distributionPressure: distribution,
    stockVolume: volumeEvidence,
  };
}

export function buildEngine25ParticipationArtifact({
  sectorHealth,
  now = Date.now(),
  intradayMaxAgeMs = DEFAULT_INTRADAY_MAX_AGE_MS,
} = {}) {
  const generatedAt = new Date(now).toISOString();
  const session = resolveEquityScannerSession(now);
  const intraday = buildIntradayFreshness({
    sectorHealth,
    now,
    intradayMaxAgeMs,
    session,
  });
  const eod = buildEodFreshness({ sectorHealth, now });

  const usableForTrapConfirmation =
    session.active === true &&
    intraday.state === "FRESH";

  return {
    ok: sectorHealth?.ok === true,
    engine: "engine25.participation.v1",
    schema: ENGINE25_PARTICIPATION_SCHEMA,
    generatedAt,

    authority: {
      owner: "ENGINE25",
      scannerBreadth: "PRIMARY",
      sectorParticipation: "PRIMARY",
      stockVolume: "PRIMARY",
      distributionPressure: "PRIMARY",
      packagerRole: "PACKAGE_VALIDATE_TIMESTAMP_PERSIST_EXPOSE_ONLY",
    },

    participation: packageParticipationTruth(sectorHealth),

    sources: {
      intraday: {
        ...(sectorHealth?.sources?.intraday || {}),
        sourceTimestamp: intraday.sourceTimestamp,
      },
      eod: {
        ...(sectorHealth?.sources?.eod || {}),
        sourceTimestamp: eod.sourceTimestamp,
        sessionDate: eod.sessionDate,
      },
    },

    freshness: {
      equityScannerSession: session,
      intraday,
      eod,
      usableForTrapConfirmation,
      state: intraday.state,
      reason: intraday.reason,
    },

    compatibility: {
      legacyArtifact: "engine25-sector-health-test.json",
      underlyingTruthSource: "buildEngine25SectorHealth()",
      packagerRecalculatesParticipation: false,
    },
  };
}

export default buildEngine25ParticipationArtifact;
