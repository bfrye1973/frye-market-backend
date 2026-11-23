// Engine 4 v2 — SHADOW participation read for Strategy 1 (ES).
//
// Owner design (2026-11-23, issue #365):
//   - Completed 5m bars only, evaluated against the LAST TWO COMPLETED bars
//     (fixes v1, which treated the forming bar as "current" and could only
//     confirm when a snapshot landed in the gap right after a 5m close).
//   - Volume measured against a rolling baseline (median of prior completed
//     bars), not the single previous bar.
//   - Warnings, not gates: climax / capitulation at a zone, absorption at a
//     zone edge, effort without result.
//   - Participation confirmation persists per candidate + zone + direction
//     until it fades on completed bars, turns adverse, or upstream changes.
//   - Engine 29 trend is carried as context only.
//
// Authority: NONE. This module never creates direction, permission, entries,
// exits or execution, and nothing downstream may read it as a gate. Canonical
// Engine 4 v1 is unchanged.

import { deriveCandleCompletionTruth } from "../../engine3/candleCompletionTruth.js";

export const ENGINE4_V2_VERSION = "engine4.v2.participationShadow.v1";

export const ENGINE4_V2_DEFAULT_POLICY = Object.freeze({
  baselineBars: 20,
  atrBars: 14,
  supportRelVol: 0.9,
  adverseRelVol: 1.25,
  climaxRelVol: 3.0,
  climaxRangeAtr: 1.5,
  absorptionRelVol: 1.5,
  absorptionWickPct: 0.5,
  effortRelVol: 1.5,
  effortMaxProgressAtr: 0.25,
  fadeRelVol: 0.7,
  fadeBars: 2,
  zoneBandAtr: 0.25,
  directionalWindow: 6,
});

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const toNum = (x) => num(typeof x === "string" ? Number(x) : x);
const dirOf = (d) => (d === "LONG" || d === "SHORT" ? d : "NEUTRAL");
const round = (x, p = 2) => (x == null ? null : Math.round(x * 10 ** p) / 10 ** p);

function median(values) {
  const s = values.filter((v) => v != null).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function normalizeBar(b) {
  const t = toNum(b?.time ?? b?.t ?? b?.tSec);
  const o = toNum(b?.open), h = toNum(b?.high), l = toNum(b?.low), c = toNum(b?.close);
  const v = toNum(b?.volume) ?? 0;
  if ([t, o, h, l, c].some((x) => x == null) || h < l) return null;
  const startSec = t > 1e12 ? Math.floor(t / 1000) : t;
  return { t: startSec, o, h, l, c, v };
}

function atrAt(bars, i, n) {
  let sum = 0, k = 0;
  for (let j = Math.max(1, i - n + 1); j <= i; j++) {
    const b = bars[j], p = bars[j - 1];
    sum += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    k++;
  }
  return k ? sum / k : null;
}

function trendFromEngine29(engine29, evaluationTimeMs) {
  const timestamp = engine29?.timestamp ?? engine29?.snapshotTime ?? engine29?.updatedAt ?? null;
  const parsedMs = typeof timestamp === "number" ? (timestamp < 1e12 ? timestamp * 1000 : timestamp) : (typeof timestamp === "string" ? Date.parse(timestamp) : NaN);
  const ageMs = Number.isFinite(parsedMs) && Number.isFinite(evaluationTimeMs) ? evaluationTimeMs - parsedMs : null;
  const freshness = engine29?.freshness ?? engine29?.freshnessStatus ?? null;
  const degraded = engine29?.dataDegraded === true || engine29?.degraded === true;
  const stale = ageMs == null || ageMs < -60000 || ageMs > 10 * 60 * 1000 || (typeof freshness === "string" && /STALE|DEGRADED|INVALID|MISSING|UNAVAILABLE/i.test(freshness));
  if (degraded || stale) return { available: false, trend: "UNAVAILABLE", source: "engine29.fastTacticalState", timestamp, freshness, dataDegraded: degraded, health: degraded ? "DEGRADED" : "STALE_OR_UNVERIFIED" };
  const fast = engine29?.fastTacticalState ?? null;
  if (!fast) return { available: false, trend: "UNAVAILABLE", source: null };
  const trend =
    fast === "BUYING_PRESSURE_INCREASING" ? "UP" :
    fast === "SELLING_PRESSURE_INCREASING" ? "DOWN" : "FLAT";
  return { available: true, trend, source: "engine29.fastTacticalState", fastTacticalState: fast };
}

export function buildEngine4V2Shadow({
  bars5m = [],
  evaluationTimeMs = null,
  direction = "NEUTRAL",
  zone = null,
  zoneEligible = false,
  candidateId = null,
  zoneId = null,
  priorState = null,
  engine29 = null,
  policy = null,
} = {}) {
  const P = { ...ENGINE4_V2_DEFAULT_POLICY, ...(policy || {}) };
  const dir = dirOf(direction);
  const base = {
    version: ENGINE4_V2_VERSION,
    mode: "SHADOW_DIAGNOSTIC_ONLY",
    shadowOnly: true,
    gate: false,
    canonicalEngine4Unchanged: true,
    noPermissionCreated: true,
    noExecution: true,
    directionAuthority: false,
    candidateId, zoneId, direction: dir,
    evaluationTimeMs: num(evaluationTimeMs),
    policy: P,
  };

  const truth = deriveCandleCompletionTruth({ bars: bars5m, timeframe: "5m", evaluationTimeMs });
  const completed = (truth.completedBars || []).map(normalizeBar).filter(Boolean).sort((a, b) => a.t - b.t);
  const forming = truth.formingBar ? normalizeBar(truth.formingBar) : null;

  if (completed.length < P.baselineBars + 2) {
    return {
      ...base,
      available: false,
      participationState: "UNAVAILABLE",
      confirmationState: "UNAVAILABLE",
      warnings: [],
      reasonCodes: ["ENGINE4_V2_INSUFFICIENT_COMPLETED_5M_HISTORY"],
      completedBarCount: completed.length,
      persistedState: carryPrior(priorState, base),
    };
  }

  const i = completed.length - 1;
  const b = completed[i];
  const p = completed[i - 1];
  const baseline = median(completed.slice(i - P.baselineBars, i).map((x) => x.v));
  const relVol = baseline ? b.v / baseline : null;
  const atr = atrAt(completed, i, P.atrBars) || null;
  const range = Math.max(b.h - b.l, 1e-9);
  const progress = b.c - p.c;
  const progressAtr = atr ? Math.abs(progress) / atr : null;
  const barDir = b.c > b.o ? "UP" : b.c < b.o ? "DOWN" : "FLAT";

  // Directional volume over the recent window of completed bars.
  const win = completed.slice(Math.max(0, i - P.directionalWindow + 1), i + 1);
  const upVol = win.filter((x) => x.c > x.o).reduce((a, x) => a + x.v, 0);
  const downVol = win.filter((x) => x.c < x.o).reduce((a, x) => a + x.v, 0);
  const upShare = upVol + downVol > 0 ? upVol / (upVol + downVol) : null;

  // Zone relation (Engine 26 geometry, read-only).
  const zlo = num(zone?.low), zhi = num(zone?.high);
  const zoneKnown = zoneEligible === true && zlo != null && zhi != null && atr != null;
  const band = zoneKnown ? P.zoneBandAtr * atr : 0;
  const atZone = zoneKnown && b.l <= zhi + band && b.h >= zlo - band;
  const lowerWickPct = (Math.min(b.o, b.c) - b.l) / range;
  const upperWickPct = (b.h - Math.max(b.o, b.c)) / range;

  const warnings = [];
  const climax = relVol != null && atr != null && relVol >= P.climaxRelVol && range >= P.climaxRangeAtr * atr;
  if (climax) {
    const side = barDir === "DOWN" ? "SELLING" : barDir === "UP" ? "BUYING" : "TWO_SIDED";
    warnings.push({
      code: atZone ? "CAPITULATION_AT_ZONE" : "CLIMAX_VOLUME",
      side,
      meaning: atZone
        ? `Climactic ${side.toLowerCase()} volume at the zone: exhaustion/capitulation risk elevated; downstream engines independently determine any actions`
        : `Climactic ${side.toLowerCase()} volume: move may be exhausting`,
      relVol: round(relVol), rangeAtr: round(range / atr),
    });
  }
  if (atZone && relVol != null && relVol >= P.absorptionRelVol) {
    if (lowerWickPct >= P.absorptionWickPct && b.c >= zlo) {
      warnings.push({ code: "ABSORPTION_AT_ZONE", side: "SELLERS_ABSORBED", meaning: "Heavy volume pushed below/into the zone but closed back up: buyers defending", relVol: round(relVol), wickPct: round(lowerWickPct) });
    }
    if (upperWickPct >= P.absorptionWickPct && b.c <= zhi) {
      warnings.push({ code: "ABSORPTION_AT_ZONE", side: "BUYERS_ABSORBED", meaning: "Heavy volume pushed above/into the zone but closed back down: sellers defending", relVol: round(relVol), wickPct: round(upperWickPct) });
    }
  }
  if (relVol != null && progressAtr != null && relVol >= P.effortRelVol && progressAtr <= P.effortMaxProgressAtr) {
    warnings.push({ code: "EFFORT_WITHOUT_RESULT", side: "TWO_SIDED", meaning: "High volume, little net progress: someone is absorbing", relVol: round(relVol), progressAtr: round(progressAtr) });
  }

  // Participation relative to Engine 3's direction, on the completed pair.
  let participationState = "NO_DIRECTION";
  if (dir !== "NEUTRAL" && relVol != null) {
    const L = dir === "LONG";
    const withDir = L ? barDir === "UP" && progress > 0 : barDir === "DOWN" && progress < 0;
    const againstDir = L ? barDir === "DOWN" && progress < 0 : barDir === "UP" && progress > 0;
    const defended = warnings.some((w) => w.code === "ABSORPTION_AT_ZONE" && (L ? w.side === "SELLERS_ABSORBED" : w.side === "BUYERS_ABSORBED"));
    if (againstDir && relVol >= P.adverseRelVol && !defended) participationState = "ADVERSE";
    else if (withDir && relVol >= P.supportRelVol) participationState = "SUPPORTIVE";
    else participationState = "UNRESOLVED";
  }

  // Persistent confirmation per candidate + zone + direction (counted once per completed bar).
  const key = `${candidateId ?? "-"}|${zoneId ?? "-"}|${dir}`;
  const prior = priorState && priorState.key === key ? priorState : null;
  const newBar = !prior || prior.lastBarTime !== b.t;
  let confirmationState = prior?.confirmationState ?? "UNRESOLVED";
  let fadeCount = prior?.fadeCount ?? 0;
  let confirmedAtBarTime = prior?.confirmedAtBarTime ?? null;
  const reasonCodes = ["ENGINE4_V2_COMPLETED_PAIR_EVALUATED", "ENGINE4_V2_SHADOW_NO_GATE"];

  if (dir === "NEUTRAL") {
    confirmationState = "NO_DIRECTION"; fadeCount = 0; confirmedAtBarTime = null;
  } else if (participationState === "ADVERSE") {
    confirmationState = "ADVERSE"; fadeCount = 0; reasonCodes.push("ENGINE4_V2_ADVERSE_COMPLETED_PARTICIPATION");
  } else if (confirmationState === "CONFIRMED") {
    if (newBar) {
      const quiet = relVol != null && relVol < P.fadeRelVol && !(dir === "LONG" ? progress > 0 : progress < 0);
      fadeCount = quiet ? fadeCount + 1 : 0;
    }
    if (fadeCount >= P.fadeBars) { confirmationState = "FADED"; reasonCodes.push("ENGINE4_V2_FADED_ON_COMPLETED_BARS"); }
    else reasonCodes.push("ENGINE4_V2_CONFIRMATION_HELD");
  } else if (participationState === "SUPPORTIVE") {
    confirmationState = "CONFIRMED"; fadeCount = 0; confirmedAtBarTime = b.t; reasonCodes.push("ENGINE4_V2_CONFIRMED_ON_COMPLETED_PAIR");
  } else if (confirmationState !== "FADED") {
    confirmationState = "UNRESOLVED";
  }
  if (!prior && priorState) reasonCodes.push("ENGINE4_V2_NEW_SETUP_KEY_RESET");

  // Forming bar: diagnostic only, pace-normalized so a young bar is not read as "weak".
  let forming5m = null;
  if (forming && baseline && num(evaluationTimeMs) != null) {
    const elapsed = Math.min(1, Math.max(0.05, (evaluationTimeMs / 1000 - forming.t) / 300));
    forming5m = { barTime: forming.t, elapsedFraction: round(elapsed), volume: forming.v, pacedRelVol: round(forming.v / elapsed / baseline), authority: "DIAGNOSTIC_ONLY" };
  }

  const engine29Context = trendFromEngine29(engine29, num(evaluationTimeMs));
  const trendAlignment = !engine29Context.available || dir === "NEUTRAL" ? "UNAVAILABLE"
    : engine29Context.trend === "FLAT" ? "NEUTRAL"
    : (engine29Context.trend === "UP") === (dir === "LONG") ? "WITH_TREND" : "AGAINST_TREND";

  const out = {
    ...base,
    available: true,
    participationState,
    confirmationState,
    confirmedAtBarTime,
    warnings,
    evidence: {
      completedBarTime: b.t,
      priorCompletedBarTime: p.t,
      completedBar: b,
      priorCompletedBar: p,
      volume: b.v,
      baselineVolume: round(baseline, 0),
      relVol: round(relVol),
      legacyBarToBarRatio: p.v ? round(b.v / p.v) : null,
      atr5m: round(atr),
      progressPoints: round(progress),
      progressAtr: round(progressAtr),
      barDirection: barDir,
      directionalVolume: { window: win.length, upVol, downVol, upShare: round(upShare) },
      atZone,
    },
    forming5m,
    engine29Context: { ...engine29Context, trendAlignment, authority: "CONTEXT_ONLY" },
    reasonCodes,
    completedBarCount: completed.length,
  };
  out.persistedState = { version: ENGINE4_V2_VERSION, key, confirmationState, fadeCount, confirmedAtBarTime, lastBarTime: b.t, evaluationTimeMs: num(evaluationTimeMs) };
  return out;
}

function carryPrior(priorState, base) {
  return priorState && typeof priorState === "object"
    ? { ...priorState, evaluationTimeMs: base.evaluationTimeMs }
    : null;
}

export default buildEngine4V2Shadow;
