"use strict";

/**
 * Engine 24 — News Risk Engine
 *
 * Purpose:
 * - Classify market news headlines into LOW / MEDIUM / HIGH risk.
 * - Add freshness control so old headlines do not keep Engine 22 blocked all day.
 *
 * Important:
 * - This file is pure logic.
 * - It does NOT call Finnhub directly.
 * - It does NOT touch Engine 22, Engine 17, Engine 15, or Engine 16.
 */

const DEFAULT_MAX_AGE_MINUTES = 30;

const DEFAULT_NEWS_RISK = {
  ok: true,
  active: false,
  stale: false,
  riskLevel: "LOW",
  category: "UNKNOWN",
  headline: "",
  source: "FINNHUB",
  publishedAt: "",
  ageMinutes: null,
  maxAgeMinutes: DEFAULT_MAX_AGE_MINUTES,
  affected: {
    SPY: "NEUTRAL",
    QQQ: "NEUTRAL",
    VIX: "NEUTRAL",
    OIL: "NEUTRAL",
    USD: "NEUTRAL"
  },
  engineAction: {
    blockNewLongs: false,
    blockNewShorts: false,
    pauseScalpsMinutes: 0,
    tightenStops: false,
    reasonCode: null
  },
  reasonCodes: []
};

const HIGH_KEYWORDS = [
  "missile",
  "drone",
  "attack",
  "explosion",
  "air defense",
  "oil facility",
  "petroleum",
  "iran",
  "israel",
  "strait of hormuz",
  "hormuz",
  "fed emergency",
  "cpi surprise",
  "nfp surprise"
];

const MEDIUM_KEYWORDS = [
  "middle east tensions",
  "oil price shock",
  "geopolitical risk",
  "inflation",
  "treasury yields",
  "fed",
  "powell",
  "fomc",
  "recession",
  "bank stress"
];

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_NEWS_RISK));
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function getHeadlineText(item) {
  if (!item || typeof item !== "object") return "";
  return item.headline || item.title || item.summary || "";
}

function getPublishedAt(item) {
  if (!item || typeof item !== "object") return "";

  if (item.datetime) return item.datetime;
  if (item.publishedAt) return item.publishedAt;
  if (item.published_at) return item.published_at;
  if (item.time) return item.time;

  return "";
}

function toTimestampMs(value) {
  if (!value) return null;

  if (typeof value === "number") {
    return value > 1000000000000 ? value : value * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getAgeMinutes(publishedAt, nowMs) {
  const ts = toTimestampMs(publishedAt);
  if (!ts) return null;

  return Math.max(0, Math.round((nowMs - ts) / 60000));
}

function classifyCategory(text) {
  if (
    text.includes("oil") ||
    text.includes("petroleum") ||
    text.includes("hormuz") ||
    text.includes("tanker") ||
    text.includes("vessel")
  ) {
    return "OIL";
  }

  if (
    text.includes("fed") ||
    text.includes("cpi") ||
    text.includes("nfp") ||
    text.includes("inflation") ||
    text.includes("payroll")
  ) {
    return "MACRO";
  }

  if (
    text.includes("iran") ||
    text.includes("israel") ||
    text.includes("missile") ||
    text.includes("drone") ||
    text.includes("attack") ||
    text.includes("explosion")
  ) {
    return "GEOPOLITICAL";
  }

  return "UNKNOWN";
}

function buildHighRiskOutput({ item, headline, matched, ageMinutes, maxAgeMinutes }) {
  const text = normalizeText(headline);
  const out = cloneDefault();

  out.ok = true;
  out.active = true;
  out.stale = false;
  out.riskLevel = "HIGH";
  out.category = classifyCategory(text);
  out.headline = headline;
  out.source = item.source || "FINNHUB";
  out.publishedAt = getPublishedAt(item);
  out.ageMinutes = ageMinutes;
  out.maxAgeMinutes = maxAgeMinutes;

  out.affected = {
    SPY: "BEARISH",
    QQQ: "BEARISH",
    VIX: "BULLISH",
    OIL: "BULLISH",
    USD: "BULLISH"
  };

  out.engineAction = {
    blockNewLongs: true,
    blockNewShorts: false,
    pauseScalpsMinutes: 10,
    tightenStops: true,
    reasonCode: "BREAKING_NEWS_SHOCK"
  };

  out.reasonCodes = [
    "BREAKING_NEWS_SHOCK",
    "GEOPOLITICAL_OR_OIL_RISK",
    ...matched.map((word) =>
      "MATCHED_" + word.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
    )
  ];

  return out;
}

function buildStaleRiskOutput({ item, headline, matched, ageMinutes, maxAgeMinutes }) {
  const text = normalizeText(headline);
  const out = cloneDefault();

  out.ok = true;
  out.active = false;
  out.stale = true;
  out.riskLevel = "MEDIUM";
  out.category = classifyCategory(text);
  out.headline = headline;
  out.source = item.source || "FINNHUB";
  out.publishedAt = getPublishedAt(item);
  out.ageMinutes = ageMinutes;
  out.maxAgeMinutes = maxAgeMinutes;

  out.affected = {
    SPY: "NEUTRAL",
    QQQ: "NEUTRAL",
    VIX: "NEUTRAL",
    OIL: out.category === "OIL" ? "BULLISH" : "NEUTRAL",
    USD: "NEUTRAL"
  };

  out.engineAction = {
    blockNewLongs: false,
    blockNewShorts: false,
    pauseScalpsMinutes: 0,
    tightenStops: false,
    reasonCode: "STALE_NEWS_RISK"
  };

  out.reasonCodes = [
    "STALE_NEWS_RISK",
    ...matched.map((word) =>
      "STALE_MATCHED_" + word.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
    )
  ];

  return out;
}

function buildMediumRiskOutput({ item, headline, matched, ageMinutes, maxAgeMinutes }) {
  const text = normalizeText(headline);
  const out = cloneDefault();

  out.ok = true;
  out.active = true;
  out.stale = false;
  out.riskLevel = "MEDIUM";
  out.category = classifyCategory(text);
  out.headline = headline;
  out.source = item.source || "FINNHUB";
  out.publishedAt = getPublishedAt(item);
  out.ageMinutes = ageMinutes;
  out.maxAgeMinutes = maxAgeMinutes;

  out.engineAction = {
    blockNewLongs: false,
    blockNewShorts: false,
    pauseScalpsMinutes: 5,
    tightenStops: true,
    reasonCode: "NEWS_CAUTION"
  };

  out.reasonCodes = [
    "NEWS_CAUTION",
    ...matched.map((word) =>
      "MATCHED_" + word.toUpperCase().replace(/[^A-Z0-9]+/g, "_")
    )
  ];

  return out;
}

function computeNewsRisk({
  headlines = [],
  now = new Date(),
  maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES
} = {}) {
  const out = cloneDefault();
  out.maxAgeMinutes = maxAgeMinutes;

  const nowMs = new Date(now).getTime();

  if (!Array.isArray(headlines) || headlines.length === 0) {
    return out;
  }

  let bestStaleHigh = null;

  for (const item of headlines) {
    const headline = getHeadlineText(item);
    const text = normalizeText(headline);

    if (!headline) continue;

    const publishedAt = getPublishedAt(item);
    const ageMinutes = getAgeMinutes(publishedAt, nowMs);

    const highMatched = HIGH_KEYWORDS.filter((word) => text.includes(word));

    if (highMatched.length > 0) {
      const isFresh = ageMinutes === null || ageMinutes <= maxAgeMinutes;

      if (isFresh) {
        return buildHighRiskOutput({
          item,
          headline,
          matched: highMatched,
          ageMinutes,
          maxAgeMinutes
        });
      }

      if (!bestStaleHigh) {
        bestStaleHigh = {
          item,
          headline,
          matched: highMatched,
          ageMinutes,
          maxAgeMinutes
        };
      }

      continue;
    }

    const mediumMatched = MEDIUM_KEYWORDS.filter((word) => text.includes(word));

    if (mediumMatched.length > 0) {
      const isFresh = ageMinutes === null || ageMinutes <= maxAgeMinutes;

      if (isFresh) {
        return buildMediumRiskOutput({
          item,
          headline,
          matched: mediumMatched,
          ageMinutes,
          maxAgeMinutes
        });
      }
    }
  }

  if (bestStaleHigh) {
    return buildStaleRiskOutput(bestStaleHigh);
  }

  return out;
}

export {
  DEFAULT_NEWS_RISK,
  DEFAULT_MAX_AGE_MINUTES,
  computeNewsRisk
};
