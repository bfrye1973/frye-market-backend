// services/core/logic/engine16MorningFib.js
// Engine 16 — Morning Impulse Fib Engine
//
// Happy-medium v3
// - keep current exhaustion trigger engine intact
// - keep pullback / continuation contract intact
// - add market-regime awareness
// - add macro roadblock awareness from Engine 1 shared helper
// - macro = caution / refinement only
// - macro does NOT auto-kill pullbacks
// - macro can downgrade blind continuation / breakout promotion near major SPX roadblocks
// - add Engine 2 wave-phase awareness
// - scalp remains allowed to trade A / B / C inside corrective structure
// - Engine 2 provides context, not forced trade direction

import path from "path";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";

import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";
import { computeVolumeBehavior } from "./volumeBehaviorEngine.js";
import { detectContinuation, emptyContinuationDebug } from "./engine16/continuation.js";
import { confirmExhaustionPhases, emptyExhaustionDebug } from "./engine16/exhaustion.js";
import { classifyEngine16Strategy } from "./engine16/strategy.js";
import { defaultMarketRegime } from "./marketRegime.js";
import { computeMacroLevelContext } from "./engine1/macroLevels.js";

const MARKET_TZ = "America/New_York";
const DISPLAY_TZ = "America/Phoenix";

const DEFAULT_SYMBOL = "SPY";
const DEFAULT_TF = "30m";
const FETCH_DAYS = 8;

const EXHAUSTION_LOOKBACK_BARS = 5;
const EXHAUSTION_MIN_ACTIVE_BARS = 2;

// locked calibration used by Engine 1 route notes
const LOCKED_SPY_TO_SPX_RATIO = 657.5 / 6600;

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

const NY_DTF_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DISPLAY_DTF_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPLAY_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function avg(values) {
  if (!Array.isArray(values) || !values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function toNum(x, fb = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function calculateEMA(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;
  const k = 2 / (length + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return round2(ema);
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

function partsFromFormatter(ms, formatter) {
  const parts = formatter.formatToParts(new Date(ms));
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

function getNyPartsFromMs(ms) {
  return partsFromFormatter(ms, NY_DTF_PARTS);
}

function getDisplayPartsFromMs(ms) {
  return partsFromFormatter(ms, DISPLAY_DTF_PARTS);
}

function formatDisplayTimeFromMs(ms) {
  if (!Number.isFinite(ms)) return null;
  const p = getDisplayPartsFromMs(ms);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function getLatestSessionDateKey(closedBars) {
  if (!closedBars.length) return null;
  return getNyPartsFromMs(closedBars[closedBars.length - 1].t).dateKey;
}

function filterBarsForDate(closedBars, dateKey) {
  return closedBars.filter((b) => getNyPartsFromMs(b.t).dateKey === dateKey);
}

function inPremarket(bar) {
  const p = getNyPartsFromMs(bar.t);
  return p.minuteOfDay >= 240 && p.minuteOfDay < 570;
}

function inMorningImpulseWindow(bar) {
  const p = getNyPartsFromMs(bar.t);
  return p.minuteOfDay >= 570 && p.minuteOfDay < 660;
}

function inRegularSession(bar) {
  const p = getNyPartsFromMs(bar.t);
  return p.minuteOfDay >= 570 && p.minuteOfDay < 960;
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
  return {
    pullbackZone: {
      lo: Math.min(fib.r500, fib.r618),
      hi: Math.max(fib.r500, fib.r618),
    },
    secondaryZone: {
      lo: Math.min(fib.r618, fib.r786),
      hi: Math.max(fib.r618, fib.r786),
    },
  };
}

function classifyState(context, latestClose, fib) {
  if (!Number.isFinite(latestClose) || !fib) {
    return { state: "NO_IMPULSE", invalidated: false };
  }

  if (context === "LONG_CONTEXT") {
    if (latestClose > fib.r500) return { state: "ABOVE_PULLBACK", invalidated: false };
    if (latestClose >= fib.r618) return { state: "IN_PULLBACK", invalidated: false };
    if (latestClose >= fib.r786) return { state: "DEEP_PULLBACK", invalidated: false };
    return { state: "BELOW_PULLBACK", invalidated: true };
  }

  if (context === "SHORT_CONTEXT") {
    if (latestClose < fib.r500) return { state: "ABOVE_PULLBACK", invalidated: false };
    if (latestClose <= fib.r618) return { state: "IN_PULLBACK", invalidated: false };
    if (latestClose <= fib.r786) return { state: "DEEP_PULLBACK", invalidated: false };
    return { state: "BELOW_PULLBACK", invalidated: true };
  }

  return { state: "NO_IMPULSE", invalidated: false };
}

function insideZoneByClose(close, zone) {
  return Number.isFinite(close) && zone && close >= zone.lo && close <= zone.hi;
}

function deriveVolumeRegime(volumeScore, flags) {
  if (flags?.liquidityTrap) return "TRAP_RISK";
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

  return { lo: Math.min(a, b), hi: Math.max(a, b) };
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
        ? Number.isFinite(launchBar?.h) ? launchBar.h : launchBar.c
        : Number.isFinite(launchBar?.l) ? launchBar.l : launchBar.c;

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
    return Array.isArray(parsed?.structures_sticky) ? parsed.structures_sticky : [];
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
      ? Number.isFinite(candidate?.t) ? candidate.t : premarketLowMs
      : premarketLowMs;
    anchorBMs = sessionHighMs;
  } else if (context === "SHORT_CONTEXT") {
    anchorAMs = usedNegotiatedZoneAnchor
      ? Number.isFinite(candidate?.t) ? candidate.t : premarketHighMs
      : premarketHighMs;
    anchorBMs = sessionLowMs;
  }

  return {
    premarketLowTime: formatDisplayTimeFromMs(premarketLowMs),
    premarketHighTime: formatDisplayTimeFromMs(premarketHighMs),
    sessionHighTime: formatDisplayTimeFromMs(sessionHighMs),
    sessionLowTime: formatDisplayTimeFromMs(sessionLowMs),
    anchorATime: formatDisplayTimeFromMs(anchorAMs),
    anchorBTime: formatDisplayTimeFromMs(anchorBMs),
  };
}

function emptySignalTimes() {
  return {
    stateBarTime: null,
    wickRejectionLongTime: null,
    wickRejectionShortTime: null,
    breakoutReadyTime: null,
    breakdownReadyTime: null,
    impulseVolumeConfirmedTime: null,
    exhaustionTime: null,
    reversalTime: null,
    continuationTime: null,
    continuationWatchTime: null,
    continuationTriggerTime: null,
    exhaustionEarlyTime: null,
    exhaustionTriggerTime: null,
  };
}

function buildAnchorLabels(context) {
  if (context === "SHORT_CONTEXT") {
    return {
      anchorAType: "IMPULSE_HIGH",
      anchorBType: "IMPULSE_LOW",
    };
  }
  return {
    anchorAType: "IMPULSE_BASE",
    anchorBType: "IMPULSE_HIGH",
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

    continuationWatch: false,
    continuationWatchShort: false,
    continuationWatchLong: false,

    continuationTrigger: false,
    continuationTriggerShort: false,
    continuationTriggerLong: false,

    exhaustionDetected: false,
    exhaustionShort: false,
    exhaustionLong: false,
    exhaustionBarTime: null,
    exhaustionBarPrice: null,
    exhaustionLookbackBars: EXHAUSTION_LOOKBACK_BARS,
    exhaustionActive: false,

    exhaustionEarly: false,
    exhaustionEarlyShort: false,
    exhaustionEarlyLong: false,

    exhaustionTrigger: false,
    exhaustionTriggerShort: false,
    exhaustionTriggerLong: false,

    debugExhaustion: emptyExhaustionDebug(EXHAUSTION_LOOKBACK_BARS),
    debugContinuation: emptyContinuationDebug(),
  };
}

function normalizeRegime(regimeInput) {
  if (regimeInput && typeof regimeInput === "object" && regimeInput.regime) {
    return regimeInput;
  }
  return defaultMarketRegime("ENGINE16_NO_REGIME");
}

function estimateSPXFromSPY(spyPrice) {
  const spy = toNum(spyPrice);
  if (!Number.isFinite(spy)) return null;
  return round2(spy / LOCKED_SPY_TO_SPX_RATIO);
}

function buildMacroRoadblock(macroLevelContext) {
  const ctx =
    macroLevelContext && typeof macroLevelContext === "object"
      ? macroLevelContext
      : null;

  const withinMacroZone = ctx?.withinMacroZone === true;
  const macroStrength = String(ctx?.macroStrength || "NONE").toUpperCase();
  const nearMacroZone = macroStrength === "MEDIUM";
  const active = withinMacroZone || nearMacroZone;

  return {
    active,
    withinMacroZone,
    nearMacroZone,
    nearestMacroLevel: ctx?.nearestMacroLevel ?? null,
    nearestSpyEquivalent: ctx?.nearestSpyEquivalent ?? null,
    distancePts: Number.isFinite(Number(ctx?.distancePts))
      ? Number(ctx.distancePts)
      : null,
    macroStrength,
    activeZone: ctx?.activeZone ?? null,
    source: ctx?.source ?? null,
  };
}

/* ==============================
   ENGINE 2 PHASE AWARENESS
============================== */

function normalizeEngine2Node(node) {
  if (!node || typeof node !== "object") return null;
  return {
    degree: node.degree ?? null,
    tf: node.tf ?? null,
    ok: node.ok ?? null,
    phase: node.phase ?? "UNKNOWN",
    confirmedPhase: node.confirmedPhase ?? null,
    phaseReason: node.phaseReason ?? null,
    cInternalStructure: node.cInternalStructure ?? null,
    cExtensionZone: node.cExtensionZone ?? null,
    cShortWatch: node.cShortWatch ?? false,
    lastMark: node.lastMark ?? null,
    nextMark: node.nextMark ?? null,
    fibScore: node.fibScore ?? null,
    invalidated: node.invalidated ?? false,
    anchorTag: node.anchorTag ?? null,
    waveMode:
      node.waveMode ??
      (["IN_A", "IN_B", "IN_C"].includes(String(node.phase))
        ? "corrective"
        : ["IN_W1", "IN_W2", "IN_W3", "IN_W4", "COMPLETE_W5"].includes(String(node.phase))
        ? "impulse"
        : "unknown"),
    isCorrective:
      node.isCorrective ??
      ["IN_A", "IN_B", "IN_C"].includes(String(node.phase)),
    isImpulse:
      node.isImpulse ??
      ["IN_W1", "IN_W2", "IN_W3", "IN_W4", "COMPLETE_W5"].includes(String(node.phase)),
    isFinalCorrectionLeg:
      node.isFinalCorrectionLeg ??
      String(node.phase) === "IN_C",
    isWave3Setup:
      node.isWave3Setup ?? false,
    correctionDirection: node.correctionDirection ?? null,
  };
}

function normalizeEngine2Context(input) {
  if (!input || typeof input !== "object") {
    return {
      primary: null,
      intermediate: null,
      minor: null,
    };
  }

  if (input.primary || input.intermediate || input.minor) {
    return {
      primary: normalizeEngine2Node(input.primary),
      intermediate: normalizeEngine2Node(input.intermediate),
      minor: normalizeEngine2Node(input.minor),
    };
  }

  return {
    primary: null,
    intermediate: normalizeEngine2Node(input),
    minor: null,
  };
}

function inferCorrectionDirection(intermediateNode) {
  if (!intermediateNode) return null;

  const direct = String(intermediateNode.correctionDirection || "").toUpperCase();
  if (direct === "UP" || direct === "DOWN") return direct;

  const phase = String(intermediateNode.phase || "UNKNOWN");
  const lastP = toNum(intermediateNode?.lastMark?.p);
  const nextP = toNum(intermediateNode?.nextMark?.p);

  if (Number.isFinite(lastP) && Number.isFinite(nextP) && nextP !== lastP) {
    return nextP > lastP ? "UP" : "DOWN";
  }

  if (phase === "IN_C") {
    if (Number.isFinite(lastP) && Number.isFinite(nextP) && nextP !== lastP) {
      return nextP > lastP ? "UP" : "DOWN";
    }
  }

  return null;
}

function buildWaveContext(engine2Ctx) {
  const primary = engine2Ctx?.primary || null;
  const intermediate = engine2Ctx?.intermediate || null;
  const minor = engine2Ctx?.minor || null;

  const primaryPhase = String(primary?.phase || "UNKNOWN");
  const intermediatePhase = String(intermediate?.phase || "UNKNOWN");
  const minorPhase = String(minor?.phase || "UNKNOWN");

  const intermediateWaveMode = String(intermediate?.waveMode || "unknown").toUpperCase();
  const correctionDirection = inferCorrectionDirection(intermediate);
  const cInternalStructure = String(intermediate?.cInternalStructure || "UNKNOWN");
  const cExtensionZone = String(intermediate?.cExtensionZone || "NONE");
  const cShortWatch = intermediate?.cShortWatch === true;

  let macroBias = "NONE";
  let waveState = "UNKNOWN";
  let wavePrep = false;
  let scalpCorrectionDirection = correctionDirection;
  let intermediateReadyForWave3 = false;

  if (
    primaryPhase === "COMPLETE_W5" &&
    (intermediate?.isCorrective === true || ["IN_A", "IN_B", "IN_C"].includes(intermediatePhase))
  ) {
    if (correctionDirection === "UP") {
      macroBias = "SHORT_PREFERENCE";
    } else if (correctionDirection === "DOWN") {
      macroBias = "LONG_PREFERENCE";
    }
  }

  if (intermediatePhase === "IN_A") {
    waveState = "EARLY_CORRECTION";
  } else if (intermediatePhase === "IN_B") {
    waveState = "MID_CORRECTION";
  } else if (intermediatePhase === "IN_C") {
    waveState = "FINAL_CORRECTION";
    wavePrep = true;
  } else if (["IN_W3", "IN_W5"].includes(intermediatePhase)) {
    waveState = "TRENDING_IMPULSE";
  }

  if (intermediate?.isWave3Setup === true) {
    intermediateReadyForWave3 = true;
  }

  return {
    primaryPhase,
    intermediatePhase,
    minorPhase,
    intermediateWaveMode,
    correctionDirection: scalpCorrectionDirection,
    macroBias,
    waveState,
    wavePrep,
    cInternalStructure,
    cExtensionZone,
    cShortWatch,
    intermediateReadyForWave3,
  };
}

export async function computeMorningFib({
  symbol = DEFAULT_SYMBOL,
  tf = DEFAULT_TF,
  includeZones = true,
  includeVolume = true,
  marketRegime = null,
  macroLevelContext = null,
  engine2Context = null,
} = {}) {
  const timeframe = SUPPORTED_TF.has(String(tf)) ? String(tf) : DEFAULT_TF;
  const regimeInfo = normalizeRegime(marketRegime);

  const localEngine2Context = normalizeEngine2Context(
    engine2Context ?? marketRegime?.engine2 ?? null
  );

  const waveContext = buildWaveContext(localEngine2Context);
  const waveReasonCodes = [];
  let waveShortPrep = false;
  let waveLongPrep = false;
  let waveCountertrendCaution = false;
  let prepBias = "NONE";
  let hourlyClose = null;
  let ema10_1h = null;
  let trendState_1h = "NEUTRAL";
  let executionBias = "NONE";

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
      marketRegime: regimeInfo,
      engine2Context: localEngine2Context,
      waveContext,
      waveReasonCodes,
      waveShortPrep,
      waveLongPrep,
      waveCountertrendCaution,
      prepBias,
      executionBias,
      trendState_1h,
      hourlyClose,
      ema10_1h,
      macroRoadblock: buildMacroRoadblock(macroLevelContext),
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
      marketRegime: regimeInfo,
      engine2Context: localEngine2Context,
      waveContext,
      waveReasonCodes,
      waveShortPrep,
      waveLongPrep,
      waveCountertrendCaution,
      prepBias,
      executionBias,
      trendState_1h,
      hourlyClose,
      ema10_1h,
      macroRoadblock: buildMacroRoadblock(macroLevelContext),
      error: "OHLC_UNAVAILABLE",
    };
  }

  const latestClosedBar = closedBars[closedBars.length - 1];
  const latestClose = latestClosedBar?.c;

  const closes = closedBars.map((bar) => bar.c);
  const ema10 = calculateEMA(closes, 10);
  const ema20 = calculateEMA(closes, 20);

  try {
    const rawBars1h = await getBarsFromPolygon(symbol, "1h", FETCH_DAYS, {
      mode: "intraday",
    });
    const bars1h = normalizeBarsForEngine16(rawBars1h);
    const closedBars1h = bars1h.filter((b) => isClosedBar(b, "1h"));

    if (closedBars1h.length >= 10) {
      const closes1h = closedBars1h.map((bar) => bar.c);
      hourlyClose = closes1h[closes1h.length - 1] ?? null;
      ema10_1h = calculateEMA(closes1h, 10);

      if (Number.isFinite(hourlyClose) && Number.isFinite(ema10_1h)) {
        if (hourlyClose > ema10_1h) {
          trendState_1h = "LONG_ONLY";
          executionBias = "LONG_ONLY";
        } else if (hourlyClose < ema10_1h) {
          trendState_1h = "SHORT_ONLY";
          executionBias = "SHORT_ONLY";
        }
      }
    }
  } catch {
    trendState_1h = "NEUTRAL";
    executionBias = "NONE";
    hourlyClose = null;
    ema10_1h = null;
  }

  const localMacroContext =
    macroLevelContext && typeof macroLevelContext === "object"
      ? macroLevelContext
      : computeMacroLevelContext({
          spyPrice: latestClose,
          spxPrice: estimateSPXFromSPY(latestClose),
          minLevel: 4000,
          maxLevel: 8000,
          step: 100,
          halfBand: 1.25,
        });

  const macroRoadblock = buildMacroRoadblock(localMacroContext);
  const macroReasonCodes = [];
  if (macroRoadblock.withinMacroZone) {
    macroReasonCodes.push("AT_MACRO_ROADBLOCK");
    macroReasonCodes.push("MACRO_CAUTION_HIGH");
  } else if (macroRoadblock.nearMacroZone) {
    macroReasonCodes.push("MACRO_CAUTION_HIGH");
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
      marketRegime: regimeInfo,
      engine2Context: localEngine2Context,
      waveContext,
      waveReasonCodes,
      waveShortPrep,
      waveLongPrep,
      waveCountertrendCaution,
      prepBias,
      executionBias,
      trendState_1h,
      hourlyClose,
      ema10_1h,
      macroRoadblock,
      macroLevelContext: localMacroContext,
      macroReasonCodes,
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

  const premarketLow = Math.min(...premarketBars.map((b) => b.l));
  const premarketHigh = Math.max(...premarketBars.map((b) => b.h));
  const currentDayHighBar = findExtremeBarByPrice(todayBars, "h", "first");
  const currentDayLowBar = findExtremeBarByPrice(todayBars, "l", "first");

  const noImpulseBase = {
    ok: true,
    symbol,
    date: dateKey,
    timeframe,
    context: "NONE",
    marketRegime: regimeInfo,
    engine2Context: localEngine2Context,
    waveContext,
    waveReasonCodes,
    waveShortPrep,
    waveLongPrep,
    waveCountertrendCaution,
    prepBias,
    executionBias,
    trendState_1h,
    hourlyClose,
    ema10_1h,
    macroLevelContext: localMacroContext,
    macroRoadblock,
    macroReasonCodes,
    anchors: {
      premarketLow: round2(premarketLow),
      premarketHigh: round2(premarketHigh),
      sessionHigh: regularBars.length ? round2(Math.max(...regularBars.map((b) => b.h))) : null,
      sessionLow: regularBars.length ? round2(Math.min(...regularBars.map((b) => b.l))) : null,
      anchorA: null,
      anchorB: null,
      premarketLowTime: formatDisplayTimeFromMs(premarketLowBar?.t),
      premarketHighTime: formatDisplayTimeFromMs(premarketHighBar?.t),
      sessionHighTime: formatDisplayTimeFromMs(regularSessionHighBar?.t),
      sessionLowTime: formatDisplayTimeFromMs(regularSessionLowBar?.t),
      anchorATime: null,
      anchorBTime: null,
    },
    anchorLabels: buildAnchorLabels("NONE"),
    anchorDebug: {
      rawAnchorA: null,
      rawAnchorATime: null,
      finalAnchorA: null,
      finalAnchorATime: null,
      rawAnchorB: null,
      rawAnchorBTime: null,
      finalAnchorB: null,
      finalAnchorBTime: null,
    },
    fib: { r382: null, r500: null, r618: null, r786: null },
    pullbackZone: { lo: null, hi: null },
    secondaryZone: { lo: null, hi: null },
    dayRange: {
      currentDayHigh: round2(currentDayHighBar?.h),
      currentDayLow: round2(currentDayLowBar?.l),
      currentDayHighTime: formatDisplayTimeFromMs(currentDayHighBar?.t),
      currentDayLowTime: formatDisplayTimeFromMs(currentDayLowBar?.t),
    },
    sessionStructure: {
      premarketHigh: round2(premarketHigh),
      premarketHighTime: formatDisplayTimeFromMs(premarketHighBar?.t),
      premarketLow: round2(premarketLow),
      premarketLowTime: formatDisplayTimeFromMs(premarketLowBar?.t),
      regularSessionHigh: round2(regularSessionHighBar?.h),
      regularSessionHighTime: formatDisplayTimeFromMs(regularSessionHighBar?.t),
      regularSessionLow: round2(regularSessionLowBar?.l),
      regularSessionLowTime: formatDisplayTimeFromMs(regularSessionLowBar?.t),
    },
    signalTimes: emptySignalTimes(),
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
      displayTz: DISPLAY_TZ,
      impulseWindowMinutes: 90,
      atrPeriod: 14,
      atrMultiple: 1.2,
    },
  };

  if (
    waveContext.waveState === "FINAL_CORRECTION" &&
    waveContext.wavePrep === true &&
    macroRoadblock.active
  ) {
    noImpulseBase.context = "DECISION_ZONE";
    noImpulseBase.state = "AWAIT_TRIGGER";
    noImpulseBase.readinessLabel = "WATCH";
    noImpulseBase.strategyType = "NONE";
    noImpulseBase.waveReasonCodes = [
      "FINAL_CORRECTION_DECISION_ZONE",
      "WAITING_FOR_TRIGGER_RESOLUTION",
      "NEUTRAL_BIAS_IN_DECISION_ZONE",
    ];
    noImpulseBase.waveShortPrep = false;
    noImpulseBase.waveLongPrep = false;
    noImpulseBase.waveCountertrendCaution = false;
    noImpulseBase.prepBias = "NONE";
  }

  if (!morningBars.length || !regularBars.length) {
    return noImpulseBase;
  }
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
      sessionHighBarT: Number.isFinite(sessionHighBarAtBar?.t) ? sessionHighBarAtBar.t : null,
      sessionLowBarT: Number.isFinite(sessionLowBarAtBar?.t) ? sessionLowBarAtBar.t : null,
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

    if (candidate.magnitude === bestCandidate.magnitude && candidate.t < bestCandidate.t) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return noImpulseBase;
  }

  const rawAnchorA = bestCandidate.anchorA;
  const rawAnchorB = bestCandidate.anchorB;
  const rawAnchorATime =
    bestCandidate.context === "LONG_CONTEXT"
      ? formatDisplayTimeFromMs(premarketLowBar?.t)
      : formatDisplayTimeFromMs(premarketHighBar?.t);
  const rawAnchorBTime =
    bestCandidate.context === "LONG_CONTEXT"
      ? formatDisplayTimeFromMs(bestCandidate.sessionHighBarT)
      : formatDisplayTimeFromMs(bestCandidate.sessionLowBarT);

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

  const pullbackMid =
    zoneRaw?.pullbackZone
      ? (zoneRaw.pullbackZone.lo + zoneRaw.pullbackZone.hi) / 2
      : null;

  let failedBreakout = false;
  let failedBreakdown = false;
  let reversalDetected = false;
  let exhaustionDetected = false;
  let exhaustionShort = false;
  let exhaustionLong = false;
  let exhaustionBarTime = null;
  let exhaustionBarPrice = null;
  let exhaustionActive = false;

  let exhaustionEarly = false;
  let exhaustionEarlyShort = false;
  let exhaustionEarlyLong = false;

  let exhaustionTrigger = false;
  let exhaustionTriggerShort = false;
  let exhaustionTriggerLong = false;

  let triggerConfirmed = false;
  let triggerType = null;
  let triggerDirection = null;
  let triggerLevel = null;
  let triggerTime = null;

  let debugExhaustion = emptyStrategyFields().debugExhaustion;

  const latestIndex = closedBars.length - 1;
  const ex = confirmExhaustionPhases({
    bars: closedBars,
    sessionHigh: bestCandidate.sessionHigh,
    sessionLow: bestCandidate.sessionLow,
    latestIndex,
    lookbackBars: EXHAUSTION_LOOKBACK_BARS,
    formatDisplayTimeFromMs,
    round2,
  });

  debugExhaustion = ex.debug;

  if (ex.shortEarlyIdx != null) {
    exhaustionEarly = true;
    exhaustionEarlyShort = true;
  }

  if (ex.longEarlyIdx != null) {
    exhaustionEarly = true;
    exhaustionEarlyLong = true;
  }

  if (ex.shortTriggerIdx != null) {
    exhaustionTrigger = true;
    exhaustionTriggerShort = true;
    exhaustionDetected = true;
    exhaustionShort = true;
    exhaustionLong = false;

    const bar = closedBars[ex.shortTriggerIdx];
    exhaustionBarTime = formatDisplayTimeFromMs(bar?.t);
    exhaustionBarPrice = round2(bar?.h);
  } else if (ex.longTriggerIdx != null) {
    exhaustionTrigger = true;
    exhaustionTriggerLong = true;
    exhaustionDetected = true;
    exhaustionLong = true;
    exhaustionShort = false;

    const bar = closedBars[ex.longTriggerIdx];
    exhaustionBarTime = formatDisplayTimeFromMs(bar?.t);
    exhaustionBarPrice = round2(bar?.l);
  }

  if (exhaustionTriggerShort) {
    const idx = ex.shortTriggerIdx;
    const barsSince =
      idx != null ? latestIndex - idx : EXHAUSTION_MIN_ACTIVE_BARS + 1;

    const invalid =
      barsSince > EXHAUSTION_MIN_ACTIVE_BARS &&
      Number.isFinite(latestClose) &&
      Number.isFinite(exhaustionBarPrice) &&
      latestClose > exhaustionBarPrice;

    exhaustionActive = !invalid;
  }

  if (exhaustionTriggerLong) {
    const idx = ex.longTriggerIdx;
    const barsSince =
      idx != null ? latestIndex - idx : EXHAUSTION_MIN_ACTIVE_BARS + 1;

    const invalid =
      barsSince > EXHAUSTION_MIN_ACTIVE_BARS &&
      Number.isFinite(latestClose) &&
      Number.isFinite(exhaustionBarPrice) &&
      latestClose < exhaustionBarPrice;

    exhaustionActive = !invalid;
  }

  triggerConfirmed = false;
  triggerType = null;
  triggerDirection = null;
  triggerLevel = null;
  triggerTime = null;

  if (exhaustionTriggerShort) {
    triggerConfirmed = true;
    triggerType = "EXHAUSTION";
    triggerDirection = "SHORT";
    triggerLevel = round2(bestCandidate.sessionLow);
    triggerTime = exhaustionBarTime;
  } else if (exhaustionTriggerLong) {
    triggerConfirmed = true;
    triggerType = "EXHAUSTION";
    triggerDirection = "LONG";
    triggerLevel = round2(bestCandidate.sessionHigh);
    triggerTime = exhaustionBarTime;
  }

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

  const stateInfo = classifyState(finalContext, latestClose, fibRaw);

  const continuation = detectContinuation({
    bars: closedBars,
    latestIndex,
    context: finalContext,
    invalidated: stateInfo.invalidated,
    hasPulledBack,
    insidePrimaryZone,
    insideSecondaryZone,
    state: stateInfo.state,
    pullbackZoneRaw: zoneRaw.pullbackZone,
    secondaryZoneRaw: zoneRaw.secondaryZone,
    exhaustionTrigger: exhaustionTrigger && exhaustionActive,
    reversalDetected,
    formatDisplayTimeFromMs,
  });

  const trendContinuation = continuation.trendContinuation;
  const continuationWatch = continuation.continuationWatch;
  const continuationWatchShort = continuation.continuationWatchShort;
  const continuationWatchLong = continuation.continuationWatchLong;
  const continuationTrigger = continuation.continuationTrigger;
  const continuationTriggerShort = continuation.continuationTriggerShort;
  const continuationTriggerLong = continuation.continuationTriggerLong;
  const debugContinuation = continuation.debugContinuation;

  let { strategyType, readinessLabel } = classifyEngine16Strategy({
    exhaustionTrigger,
    exhaustionActive,
    exhaustionEarly,
    reversalDetected,
    failedBreakout,
    failedBreakdown,
    hasPulledBack,
    breakdownReady,
    breakoutReady,
    continuationWatch,
    continuationTrigger,
    insidePrimaryZone,
    insideSecondaryZone,
    marketRegime: regimeInfo,
  });

  // ==============================
  // ENGINE 2 WAVE-BASED CONTEXT
  // ==============================

  if (waveContext.waveState === "FINAL_CORRECTION") {
    if (strategyType === "NONE" && readinessLabel === "NO_SETUP") {
      readinessLabel = "WATCH";
      waveReasonCodes.push("C_LEG_ACTIVE_AWAITING_TRIGGER");
    }

    if (waveContext.macroBias === "SHORT_PREFERENCE") {
      waveShortPrep = true;
      prepBias = "SHORT_PREP";
      waveReasonCodes.push("ENGINE2_FINAL_CORRECTION_LEG");
      waveReasonCodes.push("ENGINE2_SHORT_PREFERENCE");
    } else if (waveContext.macroBias === "LONG_PREFERENCE") {
      waveLongPrep = true;
      prepBias = "LONG_PREP";
      waveReasonCodes.push("ENGINE2_FINAL_CORRECTION_LEG");
      waveReasonCodes.push("ENGINE2_LONG_PREFERENCE");
    }

    if (
      waveContext.cShortWatch === true &&
      !exhaustionTriggerShort &&
      !continuationTriggerShort
    ) {
      if (!waveReasonCodes.includes("ENGINE2_C_SHORT_WATCH")) {
        waveReasonCodes.push("ENGINE2_C_SHORT_WATCH");
      }

      if (waveContext.cExtensionZone === "ABOVE_618") {
        if (!waveReasonCodes.includes("ENGINE2_C_EXTENSION_ABOVE_618")) {
          waveReasonCodes.push("ENGINE2_C_EXTENSION_ABOVE_618");
        }
      }

      if (waveContext.cInternalStructure === "FORMING") {
        if (!waveReasonCodes.includes("ENGINE2_C_INTERNAL_FORMING")) {
          waveReasonCodes.push("ENGINE2_C_INTERNAL_FORMING");
        }
      }

      waveShortPrep = true;
      prepBias = "SHORT_PREP";

      if (trendState_1h === "LONG_ONLY") {
        readinessLabel = "WATCH";

        if (!waveReasonCodes.includes("HOURLY_EMA_CONTINUATION_LONG")) {
          waveReasonCodes.push("HOURLY_EMA_CONTINUATION_LONG");
        }

        if (!waveReasonCodes.includes("SHORT_PREP_TIMING_GATED_BY_1H_EMA")) {
          waveReasonCodes.push("SHORT_PREP_TIMING_GATED_BY_1H_EMA");
        }
      } else if (
        readinessLabel === "WATCH" ||
        readinessLabel === "NO_SETUP" ||
        readinessLabel === "PULLBACK_READY"
      ) {
        readinessLabel = "WATCH_FOR_SHORT";
      }
    }

    if (
      strategyType === "CONTINUATION" ||
      strategyType === "BREAKOUT"
    ) {
      if (
        waveContext.macroBias === "SHORT_PREFERENCE" &&
        (continuationTriggerLong || continuationWatchLong)
      ) {
        waveCountertrendCaution = true;
        if (!waveReasonCodes.includes("COUNTERTREND_C_LEG_LONG")) {
          waveReasonCodes.push("COUNTERTREND_C_LEG_LONG");
        }
      }

      if (
        waveContext.macroBias === "LONG_PREFERENCE" &&
        (continuationTriggerShort || continuationWatchShort)
      ) {
        waveCountertrendCaution = true;
        if (!waveReasonCodes.includes("COUNTERTREND_C_LEG_SHORT")) {
          waveReasonCodes.push("COUNTERTREND_C_LEG_SHORT");
        }
      }
    }

    if (waveShortPrep && exhaustionEarlyShort && !exhaustionTriggerShort) {
      prepBias = "SHORT_PREP";

      if (trendState_1h === "LONG_ONLY") {
        readinessLabel = "WATCH";

        if (!waveReasonCodes.includes("HOURLY_EMA_CONTINUATION_LONG")) {
          waveReasonCodes.push("HOURLY_EMA_CONTINUATION_LONG");
        }

        if (!waveReasonCodes.includes("SHORT_PREP_TIMING_GATED_BY_1H_EMA")) {
          waveReasonCodes.push("SHORT_PREP_TIMING_GATED_BY_1H_EMA");
        }
      } else {
        readinessLabel = "WATCH_FOR_SHORT";
      }
    }

    if (waveLongPrep && exhaustionEarlyLong && !exhaustionTriggerLong) {
      prepBias = "LONG_PREP";
      readinessLabel = "WATCH_FOR_LONG";
    }

    if (
      trendState_1h === "LONG_ONLY" &&
      (exhaustionTriggerShort || continuationTriggerShort)
    ) {
      readinessLabel = "WATCH";

      if (!waveReasonCodes.includes("HOURLY_EMA_CONTINUATION_LONG")) {
        waveReasonCodes.push("HOURLY_EMA_CONTINUATION_LONG");
      }

      if (!waveReasonCodes.includes("SHORT_PREP_TIMING_GATED_BY_1H_EMA")) {
        waveReasonCodes.push("SHORT_PREP_TIMING_GATED_BY_1H_EMA");
      }
    }
  }

  let macroContinuationDowngraded = false;

  if (
    macroRoadblock.active &&
    (strategyType === "CONTINUATION" || strategyType === "BREAKOUT") &&
    !insidePrimaryZone &&
    !insideSecondaryZone
  ) {
    strategyType = "NONE";
    readinessLabel = "WAIT_FOR_MAGNET_RESOLUTION";
    macroContinuationDowngraded = true;
    if (!macroReasonCodes.includes("WAIT_FOR_MAGNET_RESOLUTION")) {
      macroReasonCodes.push("WAIT_FOR_MAGNET_RESOLUTION");
    }
  }

  if (
    macroRoadblock.active &&
    (readinessLabel === "WATCH_FOR_SHORT" || readinessLabel === "WATCH_FOR_LONG")
  ) {
    macroContinuationDowngraded = false;
  }

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

      volumeContext = {
        volumeScore: Number(vr?.volumeScore ?? 0),
        volumeConfirmed: !!vr?.volumeConfirmed,
        volumeRegime: deriveVolumeRegime(vr?.volumeScore, vr?.flags || {}),
        pressureBias: derivePressureBias(vr?.flags || {}),
        flowSummary: buildFlowSummary(vr),
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

  const signalTimes = {
    stateBarTime: formatDisplayTimeFromMs(latestClosedBar?.t),
    wickRejectionLongTime: wickRejectionLong ? formatDisplayTimeFromMs(latestClosedBar?.t) : null,
    wickRejectionShortTime: wickRejectionShort ? formatDisplayTimeFromMs(latestClosedBar?.t) : null,
    breakoutReadyTime: breakoutReady ? formatDisplayTimeFromMs(latestClosedBar?.t) : null,
    breakdownReadyTime: breakdownReady ? formatDisplayTimeFromMs(latestClosedBar?.t) : null,
    impulseVolumeConfirmedTime: impulseVolumeConfirmed ? formatDisplayTimeFromMs(latestClosedBar?.t) : null,
    exhaustionTime: exhaustionTrigger ? exhaustionBarTime : null,
    reversalTime: reversalDetected ? formatDisplayTimeFromMs(latestClosedBar?.t) : null,
    continuationTime:
      trendContinuation ? (continuation.continuationTriggerTime || continuation.continuationWatchTime) : null,
    continuationWatchTime: continuation.continuationWatchTime,
    continuationTriggerTime: continuation.continuationTriggerTime,
    exhaustionEarlyTime:
      ex.shortEarlyIdx != null
        ? formatDisplayTimeFromMs(closedBars[ex.shortEarlyIdx]?.t)
        : ex.longEarlyIdx != null
        ? formatDisplayTimeFromMs(closedBars[ex.longEarlyIdx]?.t)
        : null,
    exhaustionTriggerTime: exhaustionTrigger ? exhaustionBarTime : null,
  };

  const latestNyParts = getNyPartsFromMs(latestClosedBar?.t);
  const latestIsRegularSession =
    latestNyParts.minuteOfDay >= 570 && latestNyParts.minuteOfDay < 960;

  if (!latestIsRegularSession) {
    const brokeRegularHigh =
      Number.isFinite(latestClose) &&
      Number.isFinite(bestCandidate?.sessionHigh) &&
      latestClose > bestCandidate.sessionHigh;

    const brokeRegularLow =
      Number.isFinite(latestClose) &&
      Number.isFinite(bestCandidate?.sessionLow) &&
      latestClose < bestCandidate.sessionLow;

    if (brokeRegularHigh) {
      prepBias = "LONG_PREP";
      readinessLabel = "WATCH_FOR_LONG";
      stateInfo.state = "ABOVE_PULLBACK";
    }

    if (brokeRegularLow) {
      prepBias = "SHORT_PREP";
      readinessLabel = "WATCH_FOR_SHORT";
      stateInfo.state = "ABOVE_PULLBACK";
    }
  }

  return {
    ok: true,
    symbol,
    date: dateKey,
    timeframe,
    context: finalContext,
    marketRegime: regimeInfo,
    prepBias,
    executionBias,
    trendState_1h,
    hourlyClose,
    ema10_1h,

    ema10,
    ema20,

    engine2Context: localEngine2Context,
    waveContext,
    waveReasonCodes,
    waveShortPrep,
    waveLongPrep,
    waveCountertrendCaution,

    macroLevelContext: localMacroContext,
    macroRoadblock,
    macroReasonCodes,
    macroContinuationDowngraded,

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

    anchorLabels: buildAnchorLabels(finalContext),

    anchorDebug: {
      rawAnchorA: round2(rawAnchorA),
      rawAnchorATime,
      finalAnchorA: round2(bestCandidate.anchorA),
      finalAnchorATime: anchorTimes.anchorATime,
      rawAnchorB: round2(rawAnchorB),
      rawAnchorBTime,
      finalAnchorB: round2(bestCandidate.anchorB),
      finalAnchorBTime: anchorTimes.anchorBTime,
    },

    fib,
    pullbackZone,
    secondaryZone,

    dayRange: {
      currentDayHigh: round2(currentDayHighBar?.h),
      currentDayLow: round2(currentDayLowBar?.l),
      currentDayHighTime: formatDisplayTimeFromMs(currentDayHighBar?.t),
      currentDayLowTime: formatDisplayTimeFromMs(currentDayLowBar?.t),
    },

    sessionStructure: {
      premarketHigh: round2(premarketHigh),
      premarketHighTime: formatDisplayTimeFromMs(premarketHighBar?.t),
      premarketLow: round2(premarketLow),
      premarketLowTime: formatDisplayTimeFromMs(premarketLowBar?.t),
      regularSessionHigh: round2(regularSessionHighBar?.h),
      regularSessionHighTime: formatDisplayTimeFromMs(regularSessionHighBar?.t),
      regularSessionLow: round2(regularSessionLowBar?.l),
      regularSessionLowTime: formatDisplayTimeFromMs(regularSessionLowBar?.t),
    },

    signalTimes,

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
    triggerConfirmed,
    triggerType,
    triggerDirection,
    triggerLevel,
    triggerTime,
    failedBreakout,
    failedBreakdown,
    reversalDetected,
    trendContinuation,

    continuationWatch,
    continuationWatchShort,
    continuationWatchLong,
    continuationTrigger,
    continuationTriggerShort,
    continuationTriggerLong,
    debugContinuation,

    exhaustionDetected,
    exhaustionShort,
    exhaustionLong,
    exhaustionBarTime,
    exhaustionBarPrice,
    exhaustionLookbackBars: EXHAUSTION_LOOKBACK_BARS,
    exhaustionActive,

    exhaustionEarly,
    exhaustionEarlyShort,
    exhaustionEarlyLong,

    exhaustionTrigger,
    exhaustionTriggerShort,
    exhaustionTriggerLong,

    debugExhaustion,

    usedNegotiatedZoneAnchor,
    negotiatedZoneUsed,

    impulseVolumeConfirmed,
    volumeContext,

    meta: {
      marketTz: MARKET_TZ,
      displayTz: DISPLAY_TZ,
      impulseWindowMinutes: 90,
      atrPeriod: 14,
      atrMultiple: 1.2,
    },
  };
}

export default computeMorningFib;
