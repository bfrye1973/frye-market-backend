// services/core/logic/engine16MorningFib.js
// Engine 16 — Morning Impulse Fib Engine
//
// Mission (locked)
// - Detect morning impulse move
// - Build fib retracement structure
// - Track pullback state
// - Detect wick rejection
// - Detect breakout / breakdown continuation
// - Detect reversal structure
// - Detect exhaustion reversal structure (top / bottom)
// - Detect trend continuation
// - Classify current strategy type
// - Optionally refine anchors using negotiated zones
// - Optionally overlay Engine 4 volume context
//
// Does NOT:
// - place trades
// - override Engine 1 / 2 / 6
// - require negotiated zones to exist
//
// Output is designed to degrade safely.

import path from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";
import { computeVolumeBehavior } from "./volumeBehaviorEngine.js";

const MARKET_TZ = "America/New_York";
const DEFAULT_SYMBOL = "SPY";
const DEFAULT_TF = "30m";

// ~5 trading-day-equivalent coverage in calendar days.
// Using calendar days because Polygon provider is day-window based.
const FETCH_DAYS = 8;

const TF_MS = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "10m": 10 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const SUPPORTED_TF = new Set(["10m", "30m"]);

const DTF_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function avg(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function normalizeBarsForEngine16(bars) {
  return Array.isArray(bars)
    ? bars
        .map((b) => ({
          t: Number(b?.t),
          o: Number(b?.o),
          h: Number(b?.h),
          l: Number(b?.l),
          c: Number(b?.c),
          v: Number(b?.v ?? 0),
        }))
        .filter(
          (b) =>
            Number.isFinite(b.t) &&
            [b.o, b.h, b.l, b.c].every(Number.isFinite)
        )
        .sort((a, b) => a.t - b.t)
    : [];
}

function getTfMs(tf) {
  return TF_MS[tf] ?? TF_MS[DEFAULT_TF];
}

function isClosedBar(bar, tf, nowMs = Date.now()) {
  const tfMs = getTfMs(tf);
  return Number.isFinite(bar?.t) && bar.t + tfMs <= nowMs;
}

function getNyPartsFromMs(ms) {
  const parts = DTF_PARTS.formatToParts(new Date(ms));
  const out = {};
  for (const p of parts) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    dateKey: `${out.year}-${out.month}-${out.day}`,
    minuteOfDay: Number(out.hour) * 60 + Number(out.minute),
  };
}

function formatNyTimeFromMs(ms) {
  if (!Number.isFinite(ms)) return null;
  const p = getNyPartsFromMs(ms);
  const hh = String(p.hour).padStart(2, "0");
  const mm = String(p.minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getLatestSessionDateKey(closedBars) {
  if (!closedBars.length) return null;
  const last = closedBars[closedBars.length - 1];
  return getNyPartsFromMs(last.t).dateKey;
}

function filterBarsForDate(closedBars, dateKey) {
  return closedBars.filter((b) => getNyPartsFromMs(b.t).dateKey === dateKey);
}

function inPremarket(bar) {
  const p = getNyPartsFromMs(bar.t);
  return p.minuteOfDay >= 240 && p.minuteOfDay < 570; // 04:00 to 09:30 ET
}

function inMorningImpulseWindow(bar) {
  const p = getNyPartsFromMs(bar.t);
  return p.minuteOfDay >= 570 && p.minuteOfDay < 660; // 09:30 to 11:00 ET
}

function inRegularSession(bar) {
  const p = getNyPartsFromMs(bar.t);
  return p.minuteOfDay >= 570 && p.minuteOfDay < 960; // 09:30 to 16:00 ET
}

function atrAtIndex(bars, endIndex, len = 14) {
  if (!Array.isArray(bars) || endIndex < len || endIndex >= bars.length) return null;
  const trs = [];
  for (let i = endIndex - len + 1; i <= endIndex; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!cur || !prev) return null;
    const tr = Math.max(
      cur.h - cur.l,
      Math.abs(cur.h - prev.c),
      Math.abs(cur.l - prev.c)
    );
    trs.push(tr);
  }
  return avg(trs);
}

function bullishWickRejection(bar) {
  const range = bar.h - bar.l;
  if (!(range > 0)) return false;
  const lowerWick = Math.min(bar.o, bar.c) - bar.l;
  const closeUpperHalf = bar.c >= bar.l + range / 2;
  return lowerWick / range >= 0.4 && closeUpperHalf;
}

function bearishWickRejection(bar) {
  const range = bar.h - bar.l;
  if (!(range > 0)) return false;
  const upperWick = bar.h - Math.max(bar.o, bar.c);
  const closeLowerHalf = bar.c <= bar.l + range / 2;
  return upperWick / range >= 0.4 && closeLowerHalf;
}

function barTouchesNumericZone(bar, zone) {
  if (!bar || !zone) return false;
  return bar.l <= zone.hi && bar.h >= zone.lo;
}

function fibLong(A, B) {
  return {
    r382: B - (B - A) * 0.382,
    r500: B - (B - A) * 0.5,
    r618: B - (B - A) * 0.618,
    r786: B - (B - A) * 0.786,
  };
}

function fibShort(A, B) {
  return {
    r382: B + (A - B) * 0.382,
    r500: B + (A - B) * 0.5,
    r618: B + (A - B) * 0.618,
    r786: B + (A - B) * 0.786,
  };
}

function buildZonesFromFib(fib) {
  const primaryLo = Math.min(fib.r500, fib.r618);
  const primaryHi = Math.max(fib.r500, fib.r618);
  const secondaryLo = Math.min(fib.r618, fib.r786);
  const secondaryHi = Math.max(fib.r618, fib.r786);

  return {
    pullbackZone: { lo: primaryLo, hi: primaryHi },
    secondaryZone: { lo: secondaryLo, hi: secondaryHi },
  };
}

function classifyState(context, latestClose, fib) {
  if (!Number.isFinite(latestClose) || !fib) {
    return { state: "NO_IMPULSE", invalidated: false };
  }

  if (context === "LONG_CONTEXT") {
    if (latestClose > fib.r500) {
      return { state: "ABOVE_PULLBACK", invalidated: false };
    }
    if (latestClose >= fib.r618) {
      return { state: "IN_PULLBACK", invalidated: false };
    }
    if (latestClose >= fib.r786) {
      return { state: "DEEP_PULLBACK", invalidated: false };
    }
    return { state: "BELOW_PULLBACK", invalidated: true };
  }

  if (context === "SHORT_CONTEXT") {
    if (latestClose < fib.r500) {
      return { state: "ABOVE_PULLBACK", invalidated: false };
    }
    if (latestClose <= fib.r618) {
      return { state: "IN_PULLBACK", invalidated: false };
    }
    if (latestClose <= fib.r786) {
      return { state: "DEEP_PULLBACK", invalidated: false };
    }
    return { state: "BELOW_PULLBACK", invalidated: true };
  }

  return { state: "NO_IMPULSE", invalidated: false };
}

function insideZoneByClose(close, zone) {
  return Number.isFinite(close) && zone && close >= zone.lo && close <= zone.hi;
}

function deriveVolumeRegime(volumeScore, flags) {
  const trap = !!flags?.liquidityTrap;
  if (trap) return "TRAP_RISK";

  const vs = Number(volumeScore);
  if (!Number.isFinite(vs)) return "UNKNOWN";
  if (vs <= 3) return "QUIET";
  if (vs <= 7) return "NORMAL";
  return "EXPANDING";
}

function derivePressureBias(flags) {
  if (flags?.distributionDetected) return "BEARISH_PRESSURE";
  return "NEUTRAL_PRESSURE";
}

function buildFlowSummary(volumeResult) {
  const flags = volumeResult?.flags || {};
  const out = [];

  if (flags.initiativeMoveConfirmed) out.push("INITIATIVE_PRESENT");
  if (flags.absorptionDetected) out.push("ABSORPTION_DETECTED");
  if (flags.distributionDetected) out.push("DISTRIBUTION_DETECTED");
  if (flags.reversalExpansion) out.push("REVERSAL_EXPANSION");
  if (flags.pullbackContraction) out.push("PULLBACK_CONTRACTION");
  if (flags.volumeDivergence) out.push("VOLUME_DIVERGENCE");
  if (flags.liquidityTrap) out.push("LIQUIDITY_TRAP");

  return out.length ? out : ["NO_ACTIVE_FLOW_SIGNAL"];
}

function safeRangeFromZoneObject(z) {
  const src = Array.isArray(z?.priceRange)
    ? z.priceRange
    : Array.isArray(z?.manualRange)
    ? z.manualRange
    : null;

  if (!src || src.length < 2) return null;
  const a = Number(src[0]);
  const b = Number(src[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return {
    lo: Math.min(a, b),
    hi: Math.max(a, b),
  };
}

function closeInsideZone(bar, zone) {
  return Number.isFinite(bar?.c) && zone && bar.c >= zone.lo && bar.c <= zone.hi;
}

function bodyOverlapsZone(bar, zone) {
  if (!bar || !zone) return false;
  const bodyLo = Math.min(bar.o, bar.c);
  const bodyHi = Math.max(bar.o, bar.c);
  return bodyLo <= zone.hi && bodyHi >= zone.lo;
}

function chooseRelevantNegotiatedZone({ zones, bars, symbol, candidate, context }) {
  if (!Array.isArray(zones) || !zones.length || !candidate || !Array.isArray(bars)) {
    return null;
  }

  const start = Math.max(0, candidate.index - 3);
  const windowBars = bars.slice(start, candidate.index + 1);

  const scored = [];

  for (const z of zones) {
    const key = String(z?.structureKey || z?.id || "");
    if (!key.includes("|NEG|")) continue;
    if (!(key.includes(`|${symbol}|`) || key.startsWith(`MANUAL|${symbol}|`))) continue;

    const isActive =
      (typeof z?.status === "string" ? z.status.toLowerCase() === "active" : false) ||
      z?.stickyConfirmed === true;

    if (!isActive) continue;

    const range = safeRangeFromZoneObject(z);
    if (!range) continue;

    const launchBar = bars[candidate.index];
    const launchStartsInside =
      Number.isFinite(launchBar?.o) &&
      launchBar.o >= range.lo &&
      launchBar.o <= range.hi;

    const launchClosesOutside =
      Number.isFinite(launchBar?.c) &&
      (launchBar.c > range.hi || launchBar.c < range.lo);

    const launchRule = launchStartsInside && launchClosesOutside;

    const priorBars = windowBars.slice(0, Math.max(0, windowBars.length - 1));
    const priorBaseInside = priorBars.some(
      (b) => closeInsideZone(b, range) || bodyOverlapsZone(b, range)
    );

    if (!(launchRule || priorBaseInside)) continue;

    const launchPrice =
      context === "SHORT_CONTEXT"
        ? Number.isFinite(launchBar?.h)
          ? launchBar.h
          : launchBar.c
        : Number.isFinite(launchBar?.l)
        ? launchBar.l
        : launchBar.c;

    const zoneMid = (range.lo + range.hi) / 2;
    const distance = Number.isFinite(launchPrice)
      ? Math.abs(zoneMid - launchPrice)
      : Number.MAX_VALUE;

    scored.push({
      raw: z,
      lo: range.lo,
      hi: range.hi,
      mid: zoneMid,
      distance,
    });
  }

  if (!scored.length) return null;

  scored.sort((a, b) => a.distance - b.distance);
  const best = scored[0];

  return {
    id: best.raw?.id || best.raw?.structureKey || null,
    structureKey: best.raw?.structureKey || best.raw?.id || null,
    lo: best.lo,
    hi: best.hi,
    mid: best.mid,
  };
}

async function readNegotiatedZonesFromDisk() {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const filePath = path.join(__dirname, "../data/smz-levels.json");
    const txt = await readFile(filePath, "utf8");
    const parsed = JSON.parse(txt);
    const arr = Array.isArray(parsed?.structures_sticky)
      ? parsed.structures_sticky
      : [];
    return arr;
  } catch {
    return [];
  }
}

function buildSyntheticLaunchZone(bars, candidate) {
  if (!candidate || !Array.isArray(bars)) return null;
  const start = Math.max(0, candidate.index - 3);
  const seg = bars.slice(start, candidate.index + 1);
  if (!seg.length) return null;

  const lo = Math.min(...seg.map((b) => b.l));
  const hi = Math.max(...seg.map((b) => b.h));

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;

  return { lo, hi };
}

function findExtremeBarByPrice(bars, key, mode = "first") {
  if (!Array.isArray(bars) || !bars.length) return null;

  let best = null;
  for (const b of bars) {
    const v = Number(b?.[key]);
    if (!Number.isFinite(v)) continue;

    if (!best) {
      best = b;
      continue;
    }

    const bestV = Number(best?.[key]);

    if (key === "h") {
      if (v > bestV) best = b;
      else if (v === bestV && mode === "first" && b.t < best.t) best = b;
      else if (v === bestV && mode === "last" && b.t > best.t) best = b;
    } else if (key === "l") {
      if (v < bestV) best = b;
      else if (v === bestV && mode === "first" && b.t < best.t) best = b;
      else if (v === bestV && mode === "last" && b.t > best.t) best = b;
    }
  }

  return best;
}

function buildAnchorTimes({
  premarketLowBar,
  premarketHighBar,
  sessionHighBar,
  sessionLowBar,
  candidate,
  context,
  usedNegotiatedZoneAnchor,
}) {
  const premarketLowMs = Number.isFinite(premarketLowBar?.t) ? premarketLowBar.t : null;
  const premarketHighMs = Number.isFinite(premarketHighBar?.t) ? premarketHighBar.t : null;
  const sessionHighMs = Number.isFinite(sessionHighBar?.t) ? sessionHighBar.t : null;
  const sessionLowMs = Number.isFinite(sessionLowBar?.t) ? sessionLowBar.t : null;

  let anchorAMs = null;
  let anchorBMs = null;

  if (context === "LONG_CONTEXT") {
    anchorAMs = usedNegotiatedZoneAnchor
      ? Number.isFinite(candidate?.t)
        ? candidate.t
        : premarketLowMs
      : premarketLowMs;
    anchorBMs = sessionHighMs;
  } else if (context === "SHORT_CONTEXT") {
    anchorAMs = usedNegotiatedZoneAnchor
      ? Number.isFinite(candidate?.t)
        ? candidate.t
        : premarketHighMs
      : premarketHighMs;
    anchorBMs = sessionLowMs;
  }

  return {
    premarketLowMs,
    premarketHighMs,
    sessionHighMs,
    sessionLowMs,
    anchorAMs,
    anchorBMs,

    premarketLowTime: formatNyTimeFromMs(premarketLowMs),
    premarketHighTime: formatNyTimeFromMs(premarketHighMs),
    sessionHighTime: formatNyTimeFromMs(sessionHighMs),
    sessionLowTime: formatNyTimeFromMs(sessionLowMs),
    anchorATime: formatNyTimeFromMs(anchorAMs),
    anchorBTime: formatNyTimeFromMs(anchorBMs),
  };
}

function emptyTimeFields() {
  return {
    premarketLowTime: null,
    premarketHighTime: null,
    sessionHighTime: null,
    sessionLowTime: null,
    anchorATime: null,
    anchorBTime: null,
  };
}

function emptyStrategyFields() {
  return {
    strategyType: "NONE",
    readinessLabel: "NO_SETUP",
    failedBreakout: false,
    failedBreakdown: false,
    reversalDetected: false,
    trendContinuation: false,
    exhaustionDetected: false,
    exhaustionShort: false,
    exhaustionLong: false,
  };
}

export async function computeMorningFib({
  symbol = DEFAULT_SYMBOL,
  tf = DEFAULT_TF,
  includeZones = true,
  includeVolume = true,
} = {}) {
  const timeframe = SUPPORTED_TF.has(String(tf)) ? String(tf) : DEFAULT_TF;

  let rawBars;
  try {
    rawBars = await getBarsFromPolygon(symbol, timeframe, FETCH_DAYS, {
      mode: "intraday",
    });
  } catch (err) {
    return {
      ok: false,
      symbol,
      timeframe,
      context: "NONE",
      state: "NO_IMPULSE",
      error: "OHLC_UNAVAILABLE",
      detail: err?.message || String(err),
    };
  }

  const bars = normalizeBarsForEngine16(rawBars);
  const closedBars = bars.filter((b) => isClosedBar(b, timeframe));

  if (!closedBars.length) {
    return {
      ok: false,
      symbol,
      timeframe,
      context: "NONE",
      state: "NO_IMPULSE",
      error: "OHLC_UNAVAILABLE",
    };
  }

  const dateKey = getLatestSessionDateKey(closedBars);
  const todayBars = filterBarsForDate(closedBars, dateKey);
  const premarketBars = todayBars.filter(inPremarket);
  const morningBars = todayBars.filter(inMorningImpulseWindow);
  const regularBars = todayBars.filter(inRegularSession);

  if (!premarketBars.length) {
    return {
      ok: false,
      symbol,
      context: "NONE",
      state: "NO_IMPULSE",
      error: "MISSING_PREMARKET_BARS",
    };
  }

  const premarketLowBar = findExtremeBarByPrice(premarketBars, "l", "first");
  const premarketHighBar = findExtremeBarByPrice(premarketBars, "h", "first");
  const regularSessionHighBar = regularBars.length
    ? findExtremeBarByPrice(regularBars, "h", "first")
    : null;
  const regularSessionLowBar = regularBars.length
    ? findExtremeBarByPrice(regularBars, "l", "first")
    : null;

  if (!morningBars.length || !regularBars.length) {
    return {
      ok: true,
      symbol,
      date: dateKey,
      timeframe,
      context: "NONE",
      anchors: {
        premarketLow: round2(Math.min(...premarketBars.map((b) => b.l))),
        premarketHigh: round2(Math.max(...premarketBars.map((b) => b.h))),
        sessionHigh: null,
        sessionLow: null,
        anchorA: null,
        anchorB: null,
        ...emptyTimeFields(),
      },
      fib: {
        r382: null,
        r500: null,
        r618: null,
        r786: null,
      },
      pullbackZone: { lo: null, hi: null },
      secondaryZone: { lo: null, hi: null },
      state: "NO_IMPULSE",
      insidePrimaryZone: false,
      insideSecondaryZone: false,
      invalidated: false,
      wickRejectionLong: false,
      wickRejectionShort: false,
      hasPulledBack: false,
      breakoutReady: false,
      breakdownReady: false,
      ...emptyStrategyFields(),
      usedNegotiatedZoneAnchor: false,
      negotiatedZoneUsed: null,
      impulseVolumeConfirmed: false,
      volumeContext: {
        volumeScore: 0,
        volumeConfirmed: false,
        volumeRegime: "UNKNOWN",
        pressureBias: "NEUTRAL_PRESSURE",
        flowSummary: [],
      },
      meta: {
        marketTz: MARKET_TZ,
        impulseWindowMinutes: 90,
        atrPeriod: 14,
        atrMultiple: 1.2,
      },
    };
  }

  const premarketLow = Math.min(...premarketBars.map((b) => b.l));
  const premarketHigh = Math.max(...premarketBars.map((b) => b.h));

  let bestCandidate = null;

  for (const bar of morningBars) {
    const idx = closedBars.findIndex((b) => b.t === bar.t);
    if (idx < 14) continue;

    const atr = atrAtIndex(closedBars, idx, 14);
    if (!(Number.isFinite(atr) && atr > 0)) continue;

    const sessionBarsToNow = todayBars.filter(
      (b) => inRegularSession(b) && b.t <= bar.t
    );
    if (!sessionBarsToNow.length) continue;

    const sessionHighAtBar = Math.max(...sessionBarsToNow.map((b) => b.h));
    const sessionLowAtBar = Math.min(...sessionBarsToNow.map((b) => b.l));

    const longMove = sessionHighAtBar - premarketLow;
    const shortMove = premarketHigh - sessionLowAtBar;
    const threshold = 1.2 * atr;

    const longQualifies = longMove >= threshold;
    const shortQualifies = shortMove >= threshold;

    if (!longQualifies && !shortQualifies) continue;

    const direction =
      longQualifies && shortQualifies
        ? longMove >= shortMove
          ? "LONG_CONTEXT"
          : "SHORT_CONTEXT"
        : longQualifies
        ? "LONG_CONTEXT"
        : "SHORT_CONTEXT";

    const magnitude = direction === "LONG_CONTEXT" ? longMove : shortMove;

    const sessionHighBarAtBar = findExtremeBarByPrice(sessionBarsToNow, "h", "first");
    const sessionLowBarAtBar = findExtremeBarByPrice(sessionBarsToNow, "l", "first");

    const candidate = {
      index: idx,
      t: bar.t,
      context: direction,
      atr,
      magnitude,
      sessionHigh: sessionHighAtBar,
      sessionLow: sessionLowAtBar,
      sessionHighBarT: Number.isFinite(sessionHighBarAtBar?.t)
        ? sessionHighBarAtBar.t
        : null,
      sessionLowBarT: Number.isFinite(sessionLowBarAtBar?.t)
        ? sessionLowBarAtBar.t
        : null,
      anchorA: direction === "LONG_CONTEXT" ? premarketLow : premarketHigh,
      anchorB: direction === "LONG_CONTEXT" ? sessionHighAtBar : sessionLowAtBar,
    };

    if (!bestCandidate) {
      bestCandidate = candidate;
      continue;
    }

    if (candidate.magnitude > bestCandidate.magnitude) {
      bestCandidate = candidate;
      continue;
    }

    if (
      candidate.magnitude === bestCandidate.magnitude &&
      candidate.t < bestCandidate.t
    ) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return {
      ok: true,
      symbol,
      date: dateKey,
      timeframe,
      context: "NONE",
      anchors: {
        premarketLow: round2(premarketLow),
        premarketHigh: round2(premarketHigh),
        sessionHigh: round2(Math.max(...regularBars.map((b) => b.h))),
        sessionLow: round2(Math.min(...regularBars.map((b) => b.l))),
        anchorA: null,
        anchorB: null,
        premarketLowTime: formatNyTimeFromMs(premarketLowBar?.t),
        premarketHighTime: formatNyTimeFromMs(premarketHighBar?.t),
        sessionHighTime: formatNyTimeFromMs(regularSessionHighBar?.t),
        sessionLowTime: formatNyTimeFromMs(regularSessionLowBar?.t),
        anchorATime: null,
        anchorBTime: null,
      },
      fib: {
        r382: null,
        r500: null,
        r618: null,
        r786: null,
      },
      pullbackZone: { lo: null, hi: null },
      secondaryZone: { lo: null, hi: null },
      state: "NO_IMPULSE",
      insidePrimaryZone: false,
      insideSecondaryZone: false,
      invalidated: false,
      wickRejectionLong: false,
      wickRejectionShort: false,
      hasPulledBack: false,
      breakoutReady: false,
      breakdownReady: false,
      ...emptyStrategyFields(),
      usedNegotiatedZoneAnchor: false,
      negotiatedZoneUsed: null,
      impulseVolumeConfirmed: false,
      volumeContext: {
        volumeScore: 0,
        volumeConfirmed: false,
        volumeRegime: "UNKNOWN",
        pressureBias: "NEUTRAL_PRESSURE",
        flowSummary: [],
      },
      meta: {
        marketTz: MARKET_TZ,
        impulseWindowMinutes: 90,
        atrPeriod: 14,
        atrMultiple: 1.2,
      },
    };
  }

  let usedNegotiatedZoneAnchor = false;
  let negotiatedZoneUsed = null;

  if (includeZones) {
    const zones = await readNegotiatedZonesFromDisk();
    const chosenZone = chooseRelevantNegotiatedZone({
      zones,
      bars: closedBars,
      symbol,
      candidate: bestCandidate,
      context: bestCandidate.context,
    });

    if (chosenZone) {
      usedNegotiatedZoneAnchor = true;
      negotiatedZoneUsed = {
        id: chosenZone.id,
        structureKey: chosenZone.structureKey,
        lo: round2(chosenZone.lo),
        hi: round2(chosenZone.hi),
        mid: round2(chosenZone.mid),
      };
      bestCandidate.anchorA =
        bestCandidate.context === "LONG_CONTEXT" ? chosenZone.lo : chosenZone.hi;
    }
  }

  const fibRaw =
    bestCandidate.context === "LONG_CONTEXT"
      ? fibLong(bestCandidate.anchorA, bestCandidate.anchorB)
      : fibShort(bestCandidate.anchorA, bestCandidate.anchorB);

  const fib = {
    r382: round2(fibRaw.r382),
    r500: round2(fibRaw.r500),
    r618: round2(fibRaw.r618),
    r786: round2(fibRaw.r786),
  };

  const zoneRaw = buildZonesFromFib(fibRaw);
  const pullbackZone = {
    lo: round2(zoneRaw.pullbackZone.lo),
    hi: round2(zoneRaw.pullbackZone.hi),
  };
  const secondaryZone = {
    lo: round2(zoneRaw.secondaryZone.lo),
    hi: round2(zoneRaw.secondaryZone.hi),
  };

  const latestClosedBar = closedBars[closedBars.length - 1];
  const latestClose = latestClosedBar?.c;

  const insidePrimaryZone = insideZoneByClose(latestClose, zoneRaw.pullbackZone);
  const insideSecondaryZone = insideZoneByClose(latestClose, zoneRaw.secondaryZone);

  const postLockBars = closedBars.filter((b) => b.t > bestCandidate.t);
  const hasPulledBack = postLockBars.some(
    (b) =>
      barTouchesNumericZone(b, zoneRaw.pullbackZone) ||
      barTouchesNumericZone(b, zoneRaw.secondaryZone)
  );

  const wickTouched =
    barTouchesNumericZone(latestClosedBar, zoneRaw.pullbackZone) ||
    barTouchesNumericZone(latestClosedBar, zoneRaw.secondaryZone);

  const wickRejectionLong =
    bestCandidate.context === "LONG_CONTEXT" &&
    wickTouched &&
    bullishWickRejection(latestClosedBar);

  const wickRejectionShort =
    bestCandidate.context === "SHORT_CONTEXT" &&
    wickTouched &&
    bearishWickRejection(latestClosedBar);

  const breakoutReady =
    bestCandidate.context === "LONG_CONTEXT" &&
    hasPulledBack &&
    Number.isFinite(latestClose) &&
    latestClose > bestCandidate.sessionHigh;

  const breakdownReady =
    bestCandidate.context === "SHORT_CONTEXT" &&
    hasPulledBack &&
    Number.isFinite(latestClose) &&
    latestClose < bestCandidate.sessionLow;

  // -------------------------------------------------
  // Engine 16 Strategy Layer
  // -------------------------------------------------
  const pullbackMid =
    zoneRaw?.pullbackZone
      ? (zoneRaw.pullbackZone.lo + zoneRaw.pullbackZone.hi) / 2
      : null;

  let failedBreakout = false;
  let failedBreakdown = false;
  let reversalDetected = false;
  let trendContinuation = false;
  let exhaustionDetected = false;
  let exhaustionShort = false;
  let exhaustionLong = false;
  let strategyType = "NONE";
  let readinessLabel = "NO_SETUP";

  // -------------------------------------------------
  // EXHAUSTION REVERSAL (TOP / BOTTOM) — EARLY ENTRY
  // -------------------------------------------------
  const prevBar =
    closedBars.length >= 2 ? closedBars[closedBars.length - 2] : null;

  const latestRange =
    Number.isFinite(latestClosedBar?.h) && Number.isFinite(latestClosedBar?.l)
      ? latestClosedBar.h - latestClosedBar.l
      : 0;

  const latestUpperWick =
    latestRange > 0
      ? latestClosedBar.h - Math.max(latestClosedBar.o, latestClosedBar.c)
      : 0;

  const latestLowerWick =
    latestRange > 0
      ? Math.min(latestClosedBar.o, latestClosedBar.c) - latestClosedBar.l
      : 0;

  const nearHigh =
    Number.isFinite(latestClosedBar?.h) &&
    Number.isFinite(bestCandidate.sessionHigh) &&
    latestClosedBar.h >= bestCandidate.sessionHigh * 0.998;

  const nearLow =
    Number.isFinite(latestClosedBar?.l) &&
    Number.isFinite(bestCandidate.sessionLow) &&
    latestClosedBar.l <= bestCandidate.sessionLow * 1.002;

  const upperWickStrong =
    latestRange > 0 && latestUpperWick / latestRange >= 0.4;

  const lowerWickStrong =
    latestRange > 0 && latestLowerWick / latestRange >= 0.4;

  const bearishClose =
    Number.isFinite(latestClosedBar?.c) &&
    Number.isFinite(latestClosedBar?.o) &&
    latestClosedBar.c < latestClosedBar.o;

  const bullishClose =
    Number.isFinite(latestClosedBar?.c) &&
    Number.isFinite(latestClosedBar?.o) &&
    latestClosedBar.c > latestClosedBar.o;

  const momentumShiftDown =
    Number.isFinite(latestClosedBar?.c) &&
    Number.isFinite(prevBar?.c) &&
    latestClosedBar.c < prevBar.c;

  const momentumShiftUp =
    Number.isFinite(latestClosedBar?.c) &&
    Number.isFinite(prevBar?.c) &&
    latestClosedBar.c > prevBar.c;

  // Short exhaustion at highs
  if (
    bestCandidate.context === "LONG_CONTEXT" &&
    nearHigh &&
    upperWickStrong &&
    bearishClose &&
    momentumShiftDown
  ) {
    exhaustionShort = true;
    exhaustionDetected = true;
  }

  // Long exhaustion at lows
  if (
    bestCandidate.context === "SHORT_CONTEXT" &&
    nearLow &&
    lowerWickStrong &&
    bullishClose &&
    momentumShiftUp
  ) {
    exhaustionLong = true;
    exhaustionDetected = true;
  }

  // -------------------------------------------------
  // CONFIRMED REVERSAL (LATER THAN EXHAUSTION)
  // -------------------------------------------------

  // Short reversal off highs:
  // - previous context was long
  // - price pushed above impulse/session high
  // - failed to hold
  // - broke back below pullback mid
  // - displacement down is meaningful
  if (
    bestCandidate.context === "LONG_CONTEXT" &&
    Number.isFinite(latestClosedBar?.h) &&
    Number.isFinite(bestCandidate.sessionHigh) &&
    latestClosedBar.h > bestCandidate.sessionHigh &&
    Number.isFinite(latestClose) &&
    latestClose < bestCandidate.sessionHigh &&
    Number.isFinite(pullbackMid) &&
    latestClose < pullbackMid &&
    Number.isFinite(bestCandidate.atr) &&
    (bestCandidate.sessionHigh - latestClose) > bestCandidate.atr * 0.5
  ) {
    failedBreakout = true;
    reversalDetected = true;
  }

  // Long reversal off lows:
  // - previous context was short
  // - price pushed below impulse/session low
  // - failed to hold
  // - reclaimed pullback mid
  // - displacement up is meaningful
  if (
    bestCandidate.context === "SHORT_CONTEXT" &&
    Number.isFinite(latestClosedBar?.l) &&
    Number.isFinite(bestCandidate.sessionLow) &&
    latestClosedBar.l < bestCandidate.sessionLow &&
    Number.isFinite(latestClose) &&
    latestClose > bestCandidate.sessionLow &&
    Number.isFinite(pullbackMid) &&
    latestClose > pullbackMid &&
    Number.isFinite(bestCandidate.atr) &&
    (latestClose - bestCandidate.sessionLow) > bestCandidate.atr * 0.5
  ) {
    failedBreakdown = true;
    reversalDetected = true;
  }

  // Context flip is mandatory when confirmed reversal structure confirms
  let finalContext = bestCandidate.context;

  if (
    bestCandidate.context === "LONG_CONTEXT" &&
    failedBreakout &&
    reversalDetected &&
    Number.isFinite(pullbackMid) &&
    Number.isFinite(latestClose) &&
    latestClose < pullbackMid
  ) {
    finalContext = "SHORT_CONTEXT";
  }

  if (
    bestCandidate.context === "SHORT_CONTEXT" &&
    failedBreakdown &&
    reversalDetected &&
    Number.isFinite(pullbackMid) &&
    Number.isFinite(latestClose) &&
    latestClose > pullbackMid
  ) {
    finalContext = "LONG_CONTEXT";
  }

  // Continuation:
  // trend still intact, reversal not active, and price remains near the impulse edge
  if (
    finalContext === "LONG_CONTEXT" &&
    !reversalDetected &&
    !exhaustionDetected &&
    Number.isFinite(latestClose) &&
    Number.isFinite(bestCandidate.sessionHigh) &&
    Number.isFinite(bestCandidate.atr) &&
    latestClose >= bestCandidate.sessionHigh - bestCandidate.atr * 0.35
  ) {
    trendContinuation = true;
  }

  if (
    finalContext === "SHORT_CONTEXT" &&
    !reversalDetected &&
    !exhaustionDetected &&
    Number.isFinite(latestClose) &&
    Number.isFinite(bestCandidate.sessionLow) &&
    Number.isFinite(bestCandidate.atr) &&
    latestClose <= bestCandidate.sessionLow + bestCandidate.atr * 0.35
  ) {
    trendContinuation = true;
  }

  // Strategy classification / Engine 15 readiness mapping
  // Priority order:
  // EXHAUSTION > REVERSAL > BREAKDOWN > BREAKOUT > PULLBACK > CONTINUATION
  if (exhaustionDetected) {
    strategyType = "EXHAUSTION";
    readinessLabel = "EXHAUSTION_READY";
  } else if (reversalDetected && (failedBreakout || failedBreakdown)) {
    strategyType = "REVERSAL";
    readinessLabel = "REVERSAL_READY";
  } else if (hasPulledBack && breakdownReady) {
    strategyType = "BREAKDOWN";
    readinessLabel = "BREAKDOWN_READY";
  } else if (hasPulledBack && breakoutReady) {
    strategyType = "BREAKOUT";
    readinessLabel = "BREAKOUT_READY";
  } else if (hasPulledBack && insidePrimaryZone) {
    strategyType = "PULLBACK_PRIMARY";
    readinessLabel = "PULLBACK_READY";
  } else if (hasPulledBack && insideSecondaryZone) {
    strategyType = "PULLBACK_SECONDARY";
    readinessLabel = "PULLBACK_READY";
  } else if (trendContinuation) {
    strategyType = "CONTINUATION";
    readinessLabel = "CONTINUATION_READY";
  }

  const stateInfo = classifyState(finalContext, latestClose, fibRaw);

  let volumeContext = {
    volumeScore: 0,
    volumeConfirmed: false,
    volumeRegime: "UNKNOWN",
    pressureBias: "NEUTRAL_PRESSURE",
    flowSummary: [],
  };
  let impulseVolumeConfirmed = false;

  if (includeVolume) {
    const volumeZone = negotiatedZoneUsed
      ? { lo: negotiatedZoneUsed.lo, hi: negotiatedZoneUsed.hi }
      : buildSyntheticLaunchZone(closedBars, bestCandidate);

    if (volumeZone) {
      const vr = computeVolumeBehavior({
        bars: closedBars,
        zone: volumeZone,
        touchIndex: bestCandidate.index,
        opts: {
          mode: "swing",
          lookbackBars: 60,
        },
      });

      const volumeRegime = deriveVolumeRegime(vr?.volumeScore, vr?.flags || {});
      const pressureBias = derivePressureBias(vr?.flags || {});
      const flowSummary = buildFlowSummary(vr);

      volumeContext = {
        volumeScore: Number(vr?.volumeScore ?? 0),
        volumeConfirmed: !!vr?.volumeConfirmed,
        volumeRegime,
        pressureBias,
        flowSummary,
      };

      impulseVolumeConfirmed =
        !!vr?.volumeConfirmed ||
        !!vr?.flags?.reversalExpansion ||
        !!vr?.flags?.initiativeMoveConfirmed;
    }
  }

  const anchorTimes = buildAnchorTimes({
    premarketLowBar,
    premarketHighBar,
    sessionHighBar: { t: bestCandidate.sessionHighBarT },
    sessionLowBar: { t: bestCandidate.sessionLowBarT },
    candidate: bestCandidate,
    context: finalContext,
    usedNegotiatedZoneAnchor,
  });

  return {
    ok: true,
    symbol,
    date: dateKey,
    timeframe,
    context: finalContext,

    anchors: {
      premarketLow: round2(premarketLow),
      premarketHigh: round2(premarketHigh),
      sessionHigh: round2(bestCandidate.sessionHigh),
      sessionLow: round2(bestCandidate.sessionLow),
      anchorA: round2(bestCandidate.anchorA),
      anchorB: round2(bestCandidate.anchorB),

      premarketLowTime: anchorTimes.premarketLowTime,
      premarketHighTime: anchorTimes.premarketHighTime,
      sessionHighTime: anchorTimes.sessionHighTime,
      sessionLowTime: anchorTimes.sessionLowTime,
      anchorATime: anchorTimes.anchorATime,
      anchorBTime: anchorTimes.anchorBTime,
    },

    fib,
    pullbackZone,
    secondaryZone,

    state: stateInfo.state,
    insidePrimaryZone,
    insideSecondaryZone,
    invalidated: stateInfo.invalidated,

    wickRejectionLong,
    wickRejectionShort,

    hasPulledBack,
    breakoutReady,
    breakdownReady,

    strategyType,
    readinessLabel,
    failedBreakout,
    failedBreakdown,
    reversalDetected,
    trendContinuation,
    exhaustionDetected,
    exhaustionShort,
    exhaustionLong,

    usedNegotiatedZoneAnchor,
    negotiatedZoneUsed,

    impulseVolumeConfirmed,
    volumeContext,

    meta: {
      marketTz: MARKET_TZ,
      impulseWindowMinutes: 90,
      atrPeriod: 14,
      atrMultiple: 1.2,
    },
  };
}
