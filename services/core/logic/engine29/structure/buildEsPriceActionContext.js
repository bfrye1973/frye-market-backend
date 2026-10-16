// Engine 29 Bigger Picture — ES daily + recent weekly price action.
//
// Uses current resolved-contract daily ES bars.
// Weekly bars are aggregated from those daily bars.
// This is recent price-action context only, not continuous/roll-normalized
// long-term futures structure authority.

import { aggregateDailyToWeekly } from "./aggregateDailyToWeekly.js";
import { attachEmaSet, emaSlope } from "./calculateEma.js";
import {
  detectConfirmedSwings,
  summarizeSwingTrend,
} from "./detectSwingStructure.js";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function enrich(bars = []) {
  return attachEmaSet(
    (Array.isArray(bars) ? bars : [])
      .filter((bar) =>
        Number.isFinite(Number(bar?.time)) &&
        Number.isFinite(Number(bar?.close))
      )
      .slice()
      .sort((a, b) => Number(a.time) - Number(b.time)),
    [10, 20]
  );
}

function classifyPriceAction(bars = []) {
  const enriched = enrich(bars);
  const latest = enriched.at(-1) || null;

  if (!latest) {
    return {
      available: false,
      state: "UNAVAILABLE",
      color: "YELLOW",
      reason: "PRICE_ACTION_UNAVAILABLE",
    };
  }

  const close = finite(latest.close);
  const ema10 = finite(latest.ema10);
  const ema20 = finite(latest.ema20);
  const ema10SlopePct = finite(emaSlope(enriched, "ema10", 3));
  const ema20SlopePct = finite(emaSlope(enriched, "ema20", 3));

  const swings = detectConfirmedSwings(enriched, {
    left: 2,
    right: 2,
  });
  const swing = summarizeSwingTrend(swings);

  const green =
    close !== null &&
    ema10 !== null &&
    ema20 !== null &&
    ema10SlopePct !== null &&
    ema20SlopePct !== null &&
    close > ema10 &&
    ema10 > ema20 &&
    ema10SlopePct > 0 &&
    ema20SlopePct > 0 &&
    swing.trend === "BULLISH";

  const red =
    close !== null &&
    ema10 !== null &&
    ema20 !== null &&
    ema10SlopePct !== null &&
    ema20SlopePct !== null &&
    close < ema10 &&
    ema10 < ema20 &&
    ema10SlopePct < 0 &&
    ema20SlopePct < 0 &&
    swing.trend === "BEARISH";

  const state = green
    ? "UPTREND_SUPPORTIVE"
    : red
      ? "DOWNWARD_PRESSURE"
      : "WAIT_CONSOLIDATING";

  return {
    available: true,
    state,
    color: green ? "GREEN" : red ? "RED" : "YELLOW",
    latest: {
      date: latest.date || null,
      time: latest.time ?? null,
      open: finite(latest.open),
      high: finite(latest.high),
      low: finite(latest.low),
      close,
      completed: latest.completed === true,
    },
    movingAverages: {
      ema10,
      ema20,
      ema10SlopePct,
      ema20SlopePct,
      closeAboveEma10:
        close !== null && ema10 !== null ? close > ema10 : null,
      closeAboveEma20:
        close !== null && ema20 !== null ? close > ema20 : null,
    },
    swings: {
      trend: swing.trend,
      highStructure: swing.highStructure,
      lowStructure: swing.lowStructure,
      lastSwingHigh: swing.lastSwingHigh,
      lastSwingLow: swing.lastSwingLow,
    },
  };
}

export function buildEngine29EsPriceActionContext(
  esAnchor,
  { now = Date.now() } = {}
) {
  const dailyBars =
    esAnchor?.dailyPriceActionSource?.bars || [];

  const weeklyBars = aggregateDailyToWeekly(dailyBars, { now });

  return {
    version: "engine29.esPriceAction.v1",
    authority: "ENGINE29_ES_PRICE_ACTION_CONTEXT",
    resolvedSymbol:
      esAnchor?.dailyPriceActionSource?.resolvedSymbol ||
      esAnchor?.resolvedSymbol ||
      null,
    source: esAnchor?.source || "FRYE_FUTURES_OHLC_PROVIDER",
    historyScope: "CURRENT_RESOLVED_CONTRACT_RECENT_ONLY",
    longTermStructuralAuthority: false,

    daily: {
      timeframe: "1D",
      role: "CURRENT_ES_DAILY_PRICE_ACTION",
      ...classifyPriceAction(dailyBars),
    },

    weekly: {
      timeframe: "1W",
      role: "RECENT_ES_WEEKLY_PRICE_ACTION",
      historyScope:
        "CURRENT_CONTRACT_WEEKLY_AGGREGATION_NOT_CONTINUOUS_LONG_TERM_HISTORY",
      longTermStructuralAuthority: false,
      ...classifyPriceAction(weeklyBars),
    },
  };
}

export default buildEngine29EsPriceActionContext;
