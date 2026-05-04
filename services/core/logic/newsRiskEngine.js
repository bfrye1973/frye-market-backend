"use strict";

/**
 * Engine 24 — News Risk Engine
 *
 * Purpose:
 * - Classify market news headlines into LOW / MEDIUM / HIGH risk.
 * - Prepare a future safety signal for Engine 22.
 *
 * Important:
 * - This file is pure logic.
 * - It does NOT call Finnhub directly.
 * - It does NOT touch Engine 22, Engine 17, Engine 15, or Engine 16.
 */

const DEFAULT_NEWS_RISK = {
  ok: true,
  active: false,
  riskLevel: "LOW",
  category: "UNKNOWN",
  headline: "",
  source: "FINNHUB",
  publishedAt: "",
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
  "fed emergency",
  "cpi surprise",
  "nfp surprise"
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

function computeNewsRisk({ headlines = [] } = {}) {
  const out = cloneDefault();

  if (!Array.isArray(headlines) || headlines.length === 0) {
    return out;
  }

  for (const item of headlines) {
    const headline = getHeadlineText(item);
    const text = normalizeText(headline);

    const matched = HIGH_KEYWORDS.filter((word) => text.includes(word));

    if (matched.length > 0) {
      out.ok = true;
      out.active = true;
      out.riskLevel = "HIGH";

      out.category =
        text.includes("oil") ||
        text.includes("petroleum") ||
        text.includes("hormuz")
          ? "OIL"
          : text.includes("fed") || text.includes("cpi") || text.includes("nfp")
          ? "MACRO"
          : "GEOPOLITICAL";

      out.headline = headline;
      out.source = item.source || "FINNHUB";
      out.publishedAt = item.publishedAt || item.datetime || "";

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
  }

  return out;
}

export {
  DEFAULT_NEWS_RISK,
  computeNewsRisk
};
