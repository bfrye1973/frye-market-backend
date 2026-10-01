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
export const CME_TIME_ZONE = "America/Chicago";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function marketParts(now, timeZone = EQUITY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
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

export function resolveSystemOperatingSession(now = Date.now()) {
  const p = marketParts(now, CME_TIME_ZONE);
  const weekday = weekdayIndex(p.weekday);
  const minutes = p.hour * 60 + p.minute;

  let operating = false;
  let session = "CLOSED";

  if (weekday === 0) {
    operating = minutes >= 17 * 60;
    session = operating ? "ES_GLOBEX" : "CLOSED";
  } else if (weekday >= 1 && weekday <= 4) {
    if (minutes >= 16 * 60 && minutes < 17 * 60) {
      operating = false;
      session = "MAINTENANCE";
    } else {
      operating = true;
      session = "ES_GLOBEX";
    }
  } else if (weekday === 5) {
    operating = minutes < 16 * 60;
    session = operating ? "ES_GLOBEX" : "CLOSED";
  }

  return {
    operating,
    active: operating,
    timeZone: CME_TIME_ZONE,
    weekday: p.weekday,
    hour: p.hour,
    minute: p.minute,
    date: ymdFromMarketParts(p),
    session,
  };
}

export function resolveEquityScannerSession(now = Date.now()) {
  const p = marketParts(now, EQUITY_TIME_ZONE);
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
    session: active ? "REGULAR_EQUITY_SESSION" : "EQUITY_SESSION_CLOSED",
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
  return ymdFromMarketParts(marketParts(ms, EQUITY_TIME_ZONE));
}

function buildIntradayFreshness({
  sectorHealth,
  now,
  intradayMaxAgeMs,
  equitySession,
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

  const sourceDate = sourceSessionDate(sourceTimestamp);
  const expectedLastValidSessionDate = expectedCompletedEquitySessionDate(now);
  const validLastEquityObservation =
    sourceHealthy === true &&
    Boolean(sourceTimestamp) &&
    Boolean(sourceDate) &&
    Boolean(expectedLastValidSessionDate) &&
    sourceDate === expectedLastValidSessionDate;

  let state = "FRESH";
  let reason = "ACTIVE_EQUITY_SESSION_CURRENT_VALID_SOURCE";

  if (!sourcePresent || !sourceTimestamp) {
    state = "UNAVAILABLE";
    reason = "INTRADAY_SOURCE_OR_TIMESTAMP_MISSING";
  } else if (!sourceHealthy) {
    state = "UNAVAILABLE";
    reason = "INTRADAY_SOURCE_UNHEALTHY_OR_EMPTY";
  } else if (equitySession.active) {
    if (!sourceCurrent) {
      state = "STALE_INTRADAY_SOURCE";
      reason = "INTRADAY_SOURCE_OLDER_THAN_MAX_AGE";
    } else if (!volumeCoverageValid) {
      state = "INSUFFICIENT_VOLUME_COVERAGE";
      reason =
        volume?.reason || "INTRADAY_VOLUME_EVIDENCE_DOES_NOT_MEET_VALIDITY_CONTRACT";
    }
  } else if (validLastEquityObservation) {
    state = "LAST_VALID_EQUITY_READ";
    reason = "EQUITY_SESSION_CLOSED";
  } else {
    state = "UNAVAILABLE";
    reason = "NO_VALID_LAST_EQUITY_OBSERVATION";
  }

  return {
    sourceTimestamp,
    sourceSessionDate: sourceDate,
    expectedLastValidSessionDate,
    ageMs,
    fresh: state === "FRESH",
    lastValidEquityRead: state === "LAST_VALID_EQUITY_READ",
    currentForEquityConfirmation: state === "FRESH",
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
        cards: Array.isArray(intradaySummary?.cards)
          ? intradaySummary.cards
          : [],
      },
      eod: {
        count: finite(eodSummary?.count),
        bullishCount: finite(eodSummary?.bullishCount),
        neutralCount: finite(eodSummary?.neutralCount),
        bearishCount: finite(eodSummary?.bearishCount),
        bullishRatio: finite(eodSummary?.bullishRatio),
        bearishRatio: finite(eodSummary?.bearishRatio),
        cards: Array.isArray(eodSummary?.cards)
          ? eodSummary.cards
          : [],
      },
    },
    momentum: {
      intradayAvgMomentum: finite(intradaySummary?.avgMomentum),
      eodAvgMomentum: finite(eodSummary?.avgMomentum),
    },
    newHighsNewLows: {
      intradayTotalNh: Array.isArray(intradaySummary?.cards)
        ? intradaySummary.cards.reduce((sum, card) => sum + Number(card?.nh || 0), 0)
        : null,
      intradayTotalNl: Array.isArray(intradaySummary?.cards)
        ? intradaySummary.cards.reduce((sum, card) => sum + Number(card?.nl || 0), 0)
        : null,
      eodTotalNh: Array.isArray(eodSummary?.cards)
        ? eodSummary.cards.reduce((sum, card) => sum + Number(card?.nh || 0), 0)
        : null,
      eodTotalNl: Array.isArray(eodSummary?.cards)
        ? eodSummary.cards.reduce((sum, card) => sum + Number(card?.nl || 0), 0)
        : null,
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
  const systemOperatingSession = resolveSystemOperatingSession(now);
  const equityScannerSession = resolveEquityScannerSession(now);
  const intraday = buildIntradayFreshness({
    sectorHealth,
    now,
    intradayMaxAgeMs,
    equitySession: equityScannerSession,
  });
  const eod = buildEodFreshness({ sectorHealth, now });

  const usableForTrapConfirmation =
    equityScannerSession.active === true &&
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
      systemOperatingSession,
      equityScannerSession,
      intraday,
      eod,
      usableForTrapConfirmation,
      lastValidEquityRead: intraday.state === "LAST_VALID_EQUITY_READ",
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
