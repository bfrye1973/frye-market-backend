// services/core/jobs/buildStrategySnapshot.js
// Stable snapshot builder (SPY only)
//
// Phase 4 / Conscious Brain wiring:
// - computes shared market regime from LIVE Market Meter endpoints
// - passes market regime into Engine 16 directly
// - passes market regime into Engine 6 permission body
// - keeps old engine15 + engine15Decision flow intact
//
// IMPORTANT:
// - MASTER is display only and NOT used for regime
// - direction comes from 30m + 1h
// - strictness comes from 4h + EOD

import fs from "fs";
import { computeConfluenceScore } from "../logic/confluenceScorer.js";
import computeEngine15Readiness from "../logic/engine15StrategyReadiness.js";
import { computeEngine15DecisionReferee } from "../logic/engine15DecisionReferee.js";
import { computeMorningFib } from "../logic/engine16MorningFib.js";
import { computeMarketRegime } from "../logic/marketRegime.js";

/* -----------------------------
   Absolute paths / constants
------------------------------*/
const DATA_DIR = "/opt/render/project/src/services/core/data";
const SNAPSHOT_FILE = `${DATA_DIR}/strategy-snapshot.json`;

const CORE_BASE = process.env.CORE_BASE || "http://127.0.0.1:10000";

const symbol = "SPY";

const STRATEGIES = [
  { strategyId: "intraday_scalp@10m", tf: "10m", degree: "minute", wave: "W1" },
  { strategyId: "minor_swing@1h", tf: "1h", degree: "minor", wave: "W1" },
  { strategyId: "intermediate_long@4h", tf: "4h", degree: "intermediate", wave: "W1" },
];

const ENGINE2_MAP = {
  intraday_scalp: { degree: "minor", tf: "1h" },
  minor_swing: { degree: "intermediate", tf: "1h" },
  intermediate_long: { degree: "primary", tf: "1d" },
};

function nowIso() {
  return new Date().toISOString();
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/* -----------------------------
   Safe HTTP helpers
------------------------------*/
async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);
      return { ok: res.ok, status: res.status, json, text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(url, body, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();

    try {
      const json = JSON.parse(text);
      return { ok: res.ok, status: res.status, json, text };
    } catch {
      return { ok: false, status: res.status, json: null, text };
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      text: String(err?.message || err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/* -----------------------------
   Live Market Meter (authoritative)
------------------------------*/
async function fetchLiveMarketMeter() {
  const [intraday, m30, hourly, h4, eod] = await Promise.all([
    fetchJson(`${CORE_BASE}/live/intraday`, 15000),
    fetchJson(`${CORE_BASE}/live/30m`, 15000),
    fetchJson(`${CORE_BASE}/live/hourly`, 15000),
    fetchJson(`${CORE_BASE}/live/4h`, 15000),
    fetchJson(`${CORE_BASE}/live/eod`, 15000),
  ]);

  const intradayJ = intraday?.json || {};
  const m30J = m30?.json || {};
  const hourlyJ = hourly?.json || {};
  const h4J = h4?.json || {};
  const eodJ = eod?.json || {};

  return {
    score10m:
      toNum(intradayJ?.metrics?.overall_intraday_score),
    state10m:
      intradayJ?.metrics?.overall_intraday_state ?? null,

    score30m:
      toNum(m30J?.metrics?.overall_30m_score),
    state30m:
      m30J?.metrics?.overall_30m_state ?? null,

    score1h:
      toNum(hourlyJ?.metrics?.overall_hourly_score),
    state1h:
      hourlyJ?.metrics?.overall_hourly_state ?? null,

    score4h:
      toNum(h4J?.metrics?.trend_strength_4h_pct) ??
      toNum(h4J?.fourHour?.overall4h?.score),
    state4h:
      h4J?.fourHour?.overall4h?.state ?? null,

    scoreEOD:
      toNum(eodJ?.metrics?.overall_eod_score) ??
      toNum(eodJ?.daily?.overallEOD?.score),
    stateEOD:
      eodJ?.metrics?.overall_eod_state ??
      eodJ?.daily?.overallEOD?.state ??
      null,

    raw: {
      intraday: intradayJ,
      m30: m30J,
      hourly: hourlyJ,
      h4: h4J,
      eod: eodJ,
    },

    _src: "LIVE_10M_30M_1H_4H_EOD",
  };
}

/* -----------------------------
   Momentum
------------------------------*/
function fallbackMomentum(sym) {
  return {
    ok: false,
    symbol: sym,
    smi10m: { k: null, d: null, direction: "UNKNOWN", cross: "NONE" },
    smi1h: { k: null, d: null, direction: "UNKNOWN", cross: "NONE" },
    alignment: "MIXED",
    compression: { active: false, bars: 0, width: 0 },
    momentumState: "UNKNOWN",
  };
}

async function fetchMomentumContext(sym) {
  const r = await fetchJson(`${CORE_BASE}/api/v1/momentum-context?symbol=${sym}`, 15000);
  return r?.json || fallbackMomentum(sym);
}

/* -----------------------------
   Engine 16
------------------------------*/
function fallbackEngine16(sym, tf = "30m", marketRegime = null) {
  return {
    ok: false,
    symbol: sym,
    date: null,
    timeframe: tf,
    context: "NONE",
    marketRegime: marketRegime || null,
    anchors: {
      premarketLow: null,
      premarketHigh: null,
      sessionHigh: null,
      sessionLow: null,
      anchorA: null,
      anchorB: null,
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
    strategyType: "NONE",
    readinessLabel: "NO_SETUP",
    exhaustionDetected: false,
    exhaustionShort: false,
    exhaustionLong: false,
    exhaustionActive: false,
    exhaustionBarTime: null,
    exhaustionBarPrice: null,
    meta: {
      marketTz: "America/New_York",
      impulseWindowMinutes: 90,
      atrPeriod: 14,
      atrMultiple: 1.2,
    },
    error: "ENGINE16_UNAVAILABLE",
  };
}

async function buildEngine16Direct(sym, tf = "30m", marketRegime = null) {
  try {
    return await computeMorningFib({
      symbol: sym,
      tf,
      includeZones: true,
      includeVolume: true,
      marketRegime,
    });
  } catch (err) {
    return {
      ...fallbackEngine16(sym, tf, marketRegime),
      error: String(err?.message || err),
    };
  }
}

/* -----------------------------
   Permission helpers
------------------------------*/
function normalizeEngine5ForEngine6(confluenceJson) {
  if (!confluenceJson || typeof confluenceJson !== "object") {
    return { invalid: false, total: null, reasonCodes: [] };
  }

  const invalid = Boolean(confluenceJson.invalid);
  const reasonCodes = Array.isArray(confluenceJson.reasonCodes)
    ? confluenceJson.reasonCodes
    : [];

  const rawTotal =
    Number(confluenceJson?.scores?.total) ||
    Number(confluenceJson?.total);

  const total = Number.isFinite(rawTotal) ? rawTotal : null;

  const label = confluenceJson?.scores?.label || confluenceJson?.label || null;
  const flags = confluenceJson?.flags || null;
  const compression = confluenceJson?.compression || null;
  const bias = confluenceJson?.bias ?? null;

  return { invalid, total, reasonCodes, label, flags, compression, bias };
}

function isInside(price, z) {
  const p = Number(price);
  const lo = Number(z?.lo);
  const hi = Number(z?.hi);
  if (!Number.isFinite(p) || !Number.isFinite(lo) || !Number.isFinite(hi)) return false;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return p >= a && p <= b;
}

function computeZoneTelemetryFromCtx(ctx) {
  const price = Number(ctx?.meta?.current_price ?? ctx?.meta?.currentPrice);
  const active = ctx?.active || {};

  let zoneType = "UNKNOWN";
  let activeZone = null;

  if (active?.negotiated) {
    zoneType = "NEGOTIATED";
    activeZone = active.negotiated;
  } else if (active?.institutional) {
    zoneType = "INSTITUTIONAL";
    activeZone = active.institutional;
  } else if (active?.shelf) {
    zoneType = "SHELF";
    activeZone = active.shelf;
  }

  const withinZone = activeZone ? isInside(price, activeZone) : false;
  return { zoneType, withinZone };
}

function buildZoneContext(engine1ContextJson, confluenceLocation = null) {
  if (!engine1ContextJson || typeof engine1ContextJson !== "object") return null;

  const { zoneType, withinZone } = computeZoneTelemetryFromCtx(engine1ContextJson);

  return {
    meta: engine1ContextJson.meta || null,
    active: engine1ContextJson.active || null,
    nearest: engine1ContextJson.nearest || null,
    zoneType,
    withinZone,
    locationState: confluenceLocation?.state || null,
    nearAllowedZone: confluenceLocation?.nearAllowedZone === true,
    flags: engine1ContextJson.flags || null,
    render: {
      negotiated: Array.isArray(engine1ContextJson?.render?.negotiated)
        ? engine1ContextJson.render.negotiated
        : [],
      institutional: Array.isArray(engine1ContextJson?.render?.institutional)
        ? engine1ContextJson.render.institutional
        : [],
      shelves: Array.isArray(engine1ContextJson?.render?.shelves)
        ? engine1ContextJson.render.shelves
        : [],
    },
  };
}

/* -----------------------------
   Confluence route-equivalent helpers
------------------------------*/
function containsPrice(z, price) {
  if (!z || !Number.isFinite(price)) return false;
  const lo = Number(z.lo);
  const hi = Number(z.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return lo <= price && price <= hi;
}

function pickActiveExecutionZone(engine1Context, price) {
  const activeNegotiated = engine1Context?.active?.negotiated ?? null;
  const activeShelf = engine1Context?.active?.shelf ?? null;
  const activeInstitutional = engine1Context?.active?.institutional ?? null;

  const candidate = activeNegotiated || activeShelf || activeInstitutional || null;

  if (candidate && containsPrice(candidate, price)) return candidate;
  return null;
}

function modeFromStrategyId(strategyId) {
  const s = String(strategyId || "").toLowerCase();
  if (s.includes("intraday_scalp")) return "scalp";
  if (s.includes("minor_swing")) return "swing";
  if (s.includes("intermediate_long")) return "long";
  return "swing";
}

function volumeStateFromEngine4(engine4, zoneRef) {
  if (!zoneRef) return "NO_ACTIVE_ZONE";
  if (!engine4 || !engine4.flags) return "NO_SIGNAL";

  const f = engine4.flags;

  if (f.liquidityTrap) return "TRAP_SUSPECTED";
  if (engine4.volumeConfirmed && f.initiativeMoveConfirmed) return "INITIATIVE";
  if (f.absorptionDetected) return "ABSORPTION";
  if (f.distributionDetected) return "DISTRIBUTION";
  if (f.volumeDivergence) return "DIVERGENCE";
  if (f.pullbackContraction) return "PULLBACK_CONTRACTION";
  if (f.reversalExpansion) return "REVERSAL_EXPANSION";
  return "NEGOTIATING";
}

function keepAliveNoZone(out) {
  const rcs = Array.isArray(out?.reasonCodes) ? out.reasonCodes : [];
  const noZoneOnly =
    out?.invalid === true &&
    rcs.length === 1 &&
    rcs[0] === "NO_ZONE_NO_TRADE";

  if (noZoneOnly) {
    out.invalid = false;
    out.tradeReady = false;
    out.flags = out.flags || {};
    out.flags.tradeReady = false;
    out.flags.withinZone = false;
    out.reasonCodes = ["NOT_IN_ZONE_WAITING_FOR_SETUP"];

    out.scores = out.scores || {};
    out.scores.engine1 = 0;
    out.scores.engine2 = 0;
    out.scores.engine3 = 0;
    out.scores.engine4 = 0;
    out.scores.compression = 0;
    out.scores.total = 0;
    out.scores.label = "IGNORE";
  }

  return out;
}

/* -----------------------------
   Near allowed-zone display patch
------------------------------*/
const NEAR_ALLOWED_ZONE_WINDOW_PTS = 1.5;

function distToZone(price, z) {
  const p = toNum(price);
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (p == null || lo == null || hi == null) return null;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  if (p >= a && p <= b) return 0;
  return p < a ? a - p : p - b;
}

function nearestAllowedZone({ price, negotiated = [], institutional = [] }) {
  let best = null;

  const scan = (arr, zoneType) => {
    const list = Array.isArray(arr) ? arr : [];
    for (const z of list) {
      const d = distToZone(price, z);
      if (d == null) continue;
      if (!best || d < best.distancePts) {
        best = {
          zoneType,
          id: z?.id ?? null,
          lo: z?.lo ?? null,
          hi: z?.hi ?? null,
          mid: z?.mid ?? null,
          strength: z?.strength ?? null,
          distancePts: d,
        };
      }
    }
  };

  scan(negotiated, "NEGOTIATED");
  scan(institutional, "INSTITUTIONAL");

  return best;
}

function applyNearAllowedZoneDisplay({ confluence, ctx }) {
  if (!confluence || typeof confluence !== "object") return confluence;

  const price =
    toNum(confluence?.price) ??
    toNum(ctx?.meta?.current_price) ??
    toNum(ctx?.meta?.currentPrice);

  if (price == null) return confluence;

  const loc = confluence.location || {};
  const state = String(loc.state || "");

  if (state !== "NOT_IN_ZONE") return confluence;

  const negotiated = ctx?.render?.negotiated || [];
  const institutional = ctx?.render?.institutional || [];

  const nearest = nearestAllowedZone({ price, negotiated, institutional });

  if (!nearest || !Number.isFinite(nearest.distancePts)) return confluence;

  const near =
    nearest.distancePts > 0 &&
    nearest.distancePts <= NEAR_ALLOWED_ZONE_WINDOW_PTS;

  if (!near) {
    return {
      ...confluence,
      location: {
        ...loc,
        nearAllowedZone: false,
        nearestAllowed: {
          zoneType: nearest.zoneType,
          zoneId: nearest.id,
          lo: nearest.lo,
          hi: nearest.hi,
          distancePts: Number(nearest.distancePts.toFixed(2)),
        },
      },
    };
  }

  return {
    ...confluence,
    location: {
      ...loc,
      state: "NEAR_ALLOWED_ZONE",
      zoneType: nearest.zoneType,
      zoneId: nearest.id,
      nearAllowedZone: true,
      nearestAllowed: {
        zoneType: nearest.zoneType,
        zoneId: nearest.id,
        lo: nearest.lo,
        hi: nearest.hi,
        distancePts: Number(nearest.distancePts.toFixed(2)),
      },
    },
  };
}

/* -----------------------------
   Engine 2 helpers
------------------------------*/
function bucketForStrategyId(strategyId) {
  const id = String(strategyId || "");
  if (id.startsWith("intraday_scalp")) return "intraday_scalp";
  if (id.startsWith("minor_swing")) return "minor_swing";
  if (id.startsWith("intermediate_long")) return "intermediate_long";
  return null;
}

async function fetchFibLevels({ symbol, tf, degree, wave }) {
  const u = new URL(`${CORE_BASE}/api/v1/fib-levels`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("degree", degree);
  u.searchParams.set("wave", wave);
  const r = await fetchJson(u.toString(), 15000);
  return r?.json || { ok: false };
}

async function fetchLastBarTimeSec({ symbol, tf }) {
  const u = new URL(`${CORE_BASE}/api/v1/ohlc`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("timeframe", tf);
  u.searchParams.set("limit", "1");

  const r = await fetchJson(u.toString(), 15000);
  const j = r?.json;

  const bar =
    Array.isArray(j) ? j[0] :
    Array.isArray(j?.bars) ? j.bars[0] :
    Array.isArray(j?.data) ? j.data[0] :
    null;

  const t = Number(bar?.time ?? bar?.t ?? bar?.tSec);
  return Number.isFinite(t) ? t : null;
}

function calcFibScore(payloadW1, payloadW4) {
  const p =
    payloadW1 && payloadW1.ok
      ? payloadW1
      : payloadW4 && payloadW4.ok
        ? payloadW4
        : null;

  if (!p) return { fibScore: 0, invalidated: false, anchorTag: null };

  const invalidated = !!p?.signals?.invalidated;
  const anchorTag = p?.signals?.tag ?? null;

  if (invalidated) return { fibScore: 0, invalidated: true, anchorTag };

  let score = 0;
  if (p?.signals?.inRetraceZone) score += 10;
  if (p?.signals?.near50) score += 10;

  return { fibScore: score, invalidated: false, anchorTag };
}

function isRealMark(m) {
  if (!m || typeof m !== "object") return false;

  const p = Number(m.p);
  const tSec = m.tSec;

  if (!Number.isFinite(p) || p <= 0) return false;
  if (typeof tSec !== "number" || !Number.isFinite(tSec) || tSec <= 0) return false;

  return true;
}

function computeWavePhaseFromMarks(waveMarks, lastBarTimeSec) {
  const order = ["W1", "W2", "W3", "W4", "W5"];
  const marksPresent = [];

  for (const k of order) {
    if (isRealMark(waveMarks?.[k])) marksPresent.push(k);
  }

  if (!marksPresent.length || typeof lastBarTimeSec !== "number" || !Number.isFinite(lastBarTimeSec)) {
    return { phase: "UNKNOWN", lastMark: null, nextMark: null, marksPresent };
  }

  let lastKey = null;
  for (const k of order) {
    const m = waveMarks?.[k];
    if (!isRealMark(m)) continue;
    if (m.tSec <= lastBarTimeSec) lastKey = k;
  }

  if (!lastKey) {
    const nk = marksPresent[0] || null;
    return {
      phase: "PRE_W1",
      lastMark: null,
      nextMark: nk ? { key: nk, ...waveMarks[nk] } : null,
      marksPresent,
    };
  }

  const lastIdx = order.indexOf(lastKey);
  let nextKey = null;
  for (let i = lastIdx + 1; i < order.length; i++) {
    const k = order[i];
    if (marksPresent.includes(k)) {
      nextKey = k;
      break;
    }
  }

  return {
    phase: `IN_${lastKey}`,
    lastMark: { key: lastKey, ...waveMarks[lastKey] },
    nextMark: nextKey ? { key: nextKey, ...waveMarks[nextKey] } : null,
    marksPresent,
  };
}

async function buildEngine2Block({ symbol, degree, tf }) {
  const [w1, w4, lastBarTimeSec] = await Promise.all([
    fetchFibLevels({ symbol, tf, degree, wave: "W1" }).catch(() => ({ ok: false })),
    fetchFibLevels({ symbol, tf, degree, wave: "W4" }).catch(() => ({ ok: false })),
    fetchLastBarTimeSec({ symbol, tf }).catch(() => null),
  ]);

  const ok = !!(w1?.ok || w4?.ok);

  const { fibScore, invalidated, anchorTag } = calcFibScore(w1, w4);

  const waveMarks =
    (w1?.ok ? w1?.anchors?.waveMarks : null) ||
    (w4?.ok ? w4?.anchors?.waveMarks : null) ||
    null;

  const { phase, lastMark, nextMark, marksPresent } = computeWavePhaseFromMarks(
    waveMarks,
    lastBarTimeSec
  );

  return {
    degree,
    tf,
    ok,
    waveRequested: w4?.ok ? "W4" : w1?.ok ? "W1" : null,
    fibScore,
    invalidated,
    phase,
    lastMark,
    nextMark,
    marksPresent,
    anchorTag: anchorTag ?? null,
  };
}

/* -----------------------------
   Reaction / Volume
------------------------------*/
async function fetchReaction({ symbol, tf, strategyId, zoneId, zoneLo, zoneHi }) {
  const u = new URL(`${CORE_BASE}/api/v1/reaction-score`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("strategyId", strategyId);

  if (zoneId) u.searchParams.set("zoneId", zoneId);
  if (zoneLo != null) u.searchParams.set("lo", String(zoneLo));
  if (zoneHi != null) u.searchParams.set("hi", String(zoneHi));

  const r = await fetchJson(u.toString(), 30000);

  if (r.ok && r.json) return r.json;

  return {
    ok: true,
    invalid: false,
    reactionScore: 0,
    structureState: "HOLD",
    reasonCodes: ["ENGINE3_UNAVAILABLE"],
    zone: { id: zoneId, lo: zoneLo, hi: zoneHi },
    armed: false,
    stage: "IDLE",
    mode: modeFromStrategyId(strategyId),
    diagnostics: { error: r?.text || "ENGINE3_FETCH_FAILED" },
  };
}

async function fetchVolume({ symbol, tf, zoneLo, zoneHi, mode }) {
  if (zoneLo == null || zoneHi == null) {
    return {
      ok: true,
      volumeScore: 0,
      volumeConfirmed: false,
      reasonCodes: ["NO_ACTIVE_ZONE"],
      flags: {},
      diagnostics: { note: "NO_ACTIVE_ZONE" },
    };
  }

  const u = new URL(`${CORE_BASE}/api/v1/volume-behavior`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("zoneLo", String(zoneLo));
  u.searchParams.set("zoneHi", String(zoneHi));
  if (mode) u.searchParams.set("mode", mode);

  const r = await fetchJson(u.toString(), 30000);

  if (r.ok && r.json) return r.json?.raw || r.json;

  return {
    ok: true,
    volumeScore: 0,
    volumeConfirmed: false,
    reasonCodes: ["ENGINE4_UNAVAILABLE"],
    flags: {},
    diagnostics: { error: r?.text || "ENGINE4_FETCH_FAILED" },
  };
}

/* -----------------------------
   Build one strategy
------------------------------*/
async function processStrategy(s, momentum, marketMind, marketRegime, engine16) {
  console.log(`→ Processing ${s.strategyId}`);

  const contextResp = await fetchJson(
    `${CORE_BASE}/api/v1/engine5-context?symbol=${symbol}&tf=${s.tf}`,
    30000
  );

  const engine1Context =
    contextResp?.json ||
    { ok: false, status: contextResp?.status || 0, error: contextResp?.text || "no_context" };

  const price = Number(engine1Context?.meta?.current_price ?? NaN);
  const strategyMode = modeFromStrategyId(s.strategyId);

  let execZoneRef = Number.isFinite(price)
    ? pickActiveExecutionZone(engine1Context, price)
    : null;

  let execZoneRefSource = "ACTIVE";

  if (!execZoneRef && strategyMode === "scalp") {
    const ns = engine1Context?.nearest?.shelf ?? null;
    if (ns && ns.lo != null && ns.hi != null) {
      execZoneRef = ns;
      execZoneRefSource = "NEAREST_SHELF_SCALP_REF";
    }
  }

  const zoneId = execZoneRef?.id ?? null;
  const zoneLo = execZoneRef?.lo ?? null;
  const zoneHi = execZoneRef?.hi ?? null;

  const fib = await fetchFibLevels({
    symbol,
    tf: s.tf,
    degree: s.degree,
    wave: s.wave,
  }).catch(() => ({
    ok: false,
    reason: "ENGINE2_UNAVAILABLE",
    message: "builder_fib_fetch_failed",
    meta: { symbol, tf: s.tf, degree: s.degree, wave: s.wave, generated_at_utc: null },
    anchors: null,
    signals: { invalidated: false, inRetraceZone: false, near50: false, tag: null },
  }));

  const reaction = await fetchReaction({
    symbol,
    tf: s.tf,
    strategyId: s.strategyId,
    zoneId,
    zoneLo,
    zoneHi,
  });

  const volume = await fetchVolume({
    symbol,
    tf: s.tf,
    zoneLo,
    zoneHi,
    mode: strategyMode,
  });

  let confluence = computeConfluenceScore({
    symbol,
    tf: s.tf,
    degree: s.degree,
    wave: s.wave,
    price: Number.isFinite(price) ? price : null,
    engine1Context,
    fib,
    reaction,
    volume,
    strategyId: s.strategyId,
    mode: strategyMode,
    zoneRefOverride: execZoneRef
      ? {
          id: execZoneRef.id ?? null,
          lo: execZoneRef.lo ?? null,
          hi: execZoneRef.hi ?? null,
          mid: execZoneRef.mid ?? null,
          strength: execZoneRef.strength ?? null,
          type: execZoneRef.type ?? null,
          zoneType:
            execZoneRefSource === "ACTIVE"
              ? (
                  engine1Context?.active?.negotiated ? "NEGOTIATED" :
                  engine1Context?.active?.shelf ? "SHELF" :
                  engine1Context?.active?.institutional ? "INSTITUTIONAL" :
                  null
                )
              : "SHELF",
        }
      : null,
    zoneRefSource: execZoneRefSource,
  });

  keepAliveNoZone(confluence);

  confluence.strategyId = confluence.strategyId ?? s.strategyId;
  confluence.mode = confluence.mode ?? strategyMode;
  confluence.zoneRefSource = confluence.zoneRefSource ?? execZoneRefSource;
  confluence.volumeState = confluence.volumeState ?? volumeStateFromEngine4(volume, execZoneRef);

  confluence.engine2 = confluence.engine2 || {};
  confluence.engine2.anchorTag = fib?.signals?.tag ?? null;
  confluence.engine2.invalidated = fib?.signals?.invalidated ?? false;
  confluence.engine2.inRetraceZone = fib?.signals?.inRetraceZone ?? false;
  confluence.engine2.near50 = fib?.signals?.near50 ?? false;
  confluence.engine2.request = { tf: s.tf, degree: s.degree, wave: s.wave };

  confluence.context = confluence.context || {};
  confluence.context.activeZone =
    confluence.context.activeZone ||
    (execZoneRef
      ? {
          id: execZoneRef.id ?? null,
          zoneType:
            execZoneRefSource === "ACTIVE"
              ? (
                  engine1Context?.active?.negotiated ? "NEGOTIATED" :
                  engine1Context?.active?.shelf ? "SHELF" :
                  engine1Context?.active?.institutional ? "INSTITUTIONAL" :
                  null
                )
              : "SHELF",
          lo: execZoneRef.lo ?? null,
          hi: execZoneRef.hi ?? null,
          mid: execZoneRef.mid ?? null,
          strength: execZoneRef.strength ?? null,
          source: execZoneRefSource,
        }
      : null);

  confluence.context.fib = {
    meta: fib?.meta ?? null,
    anchors: fib?.anchors?.waveMarks ?? fib?.anchors ?? null,
    signals: fib?.signals ?? null,
  };

  confluence.context.reaction = {
    stage: reaction?.stage ?? "IDLE",
    armed: reaction?.armed ?? false,
    reactionScore: Number(reaction?.reactionScore ?? 0),
    confirmed: reaction?.confirmed === true,
    structureState: reaction?.structureState ?? "HOLD",
    reasonCodes: Array.isArray(reaction?.reasonCodes) ? reaction.reasonCodes : [],
  };

  confluence.context.volume = {
    volumeScore: Number(volume?.volumeScore ?? 0),
    volumeConfirmed: volume?.volumeConfirmed === true,
    flags: volume?.flags ?? {},
    state: confluence.volumeState,
    reasonCodes: Array.isArray(volume?.reasonCodes) ? volume.reasonCodes : [],
  };

  confluence.context.engine1 = {
    meta: engine1Context?.meta ?? null,
    active: engine1Context?.active ?? null,
    nearest: engine1Context?.nearest ?? null,
    render: engine1Context?.render ?? null,
  };

  const patchedConfluence =
    contextResp?.ok !== false && engine1Context
      ? applyNearAllowedZoneDisplay({ confluence, ctx: engine1Context })
      : confluence;

  const zoneContext = buildZoneContext(
    engine1Context,
    patchedConfluence?.location || null
  );

  const permissionBody = {
    symbol,
    tf: s.tf,
    strategyType:
      patchedConfluence?.strategyType ||
      engine16?.strategyType ||
      "UNKNOWN",
    engine5: normalizeEngine5ForEngine6(patchedConfluence),
    marketMeter: null,
    marketRegime,
    zoneContext,
    intent: { action: "NEW_ENTRY" },
  };

  const permissionResp = await postJson(
    `${CORE_BASE}/api/v1/trade-permission`,
    permissionBody,
    30000
  );

  const permissionV2Body = {
    symbol,
    strategyId: s.strategyId,
    market: marketMind,
    setup: {
      setupScore: Number(patchedConfluence?.scores?.total) || Number(patchedConfluence?.total) || 0,
      label: patchedConfluence?.scores?.label || patchedConfluence?.label || "D",
      invalid: Boolean(patchedConfluence?.invalid),
    },
  };

  const permissionV2Resp = await postJson(
    `${CORE_BASE}/api/v1/trade-permission-v2`,
    permissionV2Body,
    30000
  );

  const bucket = bucketForStrategyId(s.strategyId);
  const map = bucket ? ENGINE2_MAP[bucket] : null;

  let engine2 = null;
  if (map) {
    try {
      engine2 = await buildEngine2Block({
        symbol,
        degree: map.degree,
        tf: map.tf,
      });
    } catch {
      engine2 = {
        degree: map.degree,
        tf: map.tf,
        ok: false,
        waveRequested: null,
        fibScore: 0,
        invalidated: false,
        phase: "UNKNOWN",
        lastMark: null,
        nextMark: null,
        marksPresent: [],
        anchorTag: null,
        error: "ENGINE2_ATTACH_FAILED",
      };
    }
  }

  const engine15Decision = computeEngine15DecisionReferee({
    symbol,
    strategyId: s.strategyId,
    engine16,
    engine5: patchedConfluence || null,
    momentum,
    permission:
      permissionResp?.json ||
      {
        permission: "UNKNOWN",
        sizeMultiplier: null,
        reasonCodes: [],
      },
    engine3: patchedConfluence?.context?.reaction || null,
    engine4: patchedConfluence?.context?.volume || null,
    zoneContext,
  });

  const engine15 = computeEngine15Readiness({
    symbol,
    strategyId: s.strategyId,
    engine16,
    engine3: patchedConfluence?.context?.reaction || null,
    engine4: patchedConfluence?.context?.volume || null,
    engine5: patchedConfluence || null,
    engine15Decision: engine15Decision || null,
  });

  let executionBias = "NORMAL";

  if (engine15?.readiness === "EXHAUSTION_READY") {
    if (engine15?.direction === "SHORT") {
      executionBias = "SHORT_PRIORITY";
    } else if (engine15?.direction === "LONG") {
      executionBias = "LONG_PRIORITY";
    }
  }

  return {
    strategyId: s.strategyId,
    tf: s.tf,
    degree: s.degree,
    wave: s.wave,
    marketRegime,
    confluence: patchedConfluence,
    permission:
      permissionResp?.json || { ok: false, status: permissionResp?.status || 0, error: permissionResp?.text || "no_permission" },
    engine6v2:
      permissionV2Resp?.json || {
        ok: false,
        status: permissionV2Resp?.status || 0,
        error: permissionV2Resp?.text || "no_v2",
      },
    engine2,
    engine16,
    engine15,
    engine15Decision,
    executionBias,
    momentum,
    context: engine1Context,
  };
}

/* -----------------------------
   Build snapshot
------------------------------*/
async function buildSnapshot() {
  console.log("Starting strategy snapshot build...");

  const momentum = await fetchMomentumContext(symbol);
  console.log("Momentum fetched");

  const marketMind = await fetchLiveMarketMeter();
  console.log("Live Market Meter fetched");

  const marketRegime = computeMarketRegime({
    score10m: marketMind?.score10m,
    score30m: marketMind?.score30m,
    score1h: marketMind?.score1h,
    score4h: marketMind?.score4h,
    scoreEOD: marketMind?.scoreEOD,
    state10m: marketMind?.state10m,
    state30m: marketMind?.state30m,
    state1h: marketMind?.state1h,
    state4h: marketMind?.state4h,
    stateEOD: marketMind?.stateEOD,
  });

  console.log(
    "Market regime computed:",
    marketRegime?.regime,
    marketRegime?.directionBias,
    marketRegime?.strictness
  );

  const result = {
    ok: true,
    symbol,
    now: nowIso(),
    includeContext: true,
    marketMind,
    marketRegime,
    momentum,
    engine16: null,
    strategies: {},
  };

  for (const s of STRATEGIES) {
    let engine16ForStrategy = null;

    try {
      engine16ForStrategy = await buildEngine16Direct(symbol, s.tf, marketRegime);
      console.log(`Engine16 built directly for ${s.strategyId} @ ${s.tf}`);

      const strategy = await processStrategy(
        s,
        momentum,
        marketMind,
        marketRegime,
        engine16ForStrategy
      );

      result.strategies[s.strategyId] = strategy;
    } catch (err) {
      result.strategies[s.strategyId] = {
        strategyId: s.strategyId,
        tf: s.tf,
        degree: s.degree,
        wave: s.wave,
        marketRegime,
        confluence: { ok: false, error: String(err?.message || err) },
        permission: { ok: false, error: "builder_strategy_failed" },
        engine6v2: { ok: false, error: "builder_strategy_failed" },
        engine2: null,
        engine16: engine16ForStrategy || fallbackEngine16(symbol, s.tf, marketRegime),
        engine15: {
          ok: false,
          error: "builder_strategy_failed",
          readiness: "NO_SETUP",
          strategyType: "NONE",
          direction: "NONE",
          active: false,
        },
        engine15Decision: {
          ok: false,
          engine: "engine15.decisionReferee.v2",
          error: "builder_strategy_failed",
          strategyType: "NONE",
          direction: "NONE",
          readinessLabel: "WAIT",
          executionBias: "NONE",
          action: "NO_ACTION",
          priority: 0,
          entryStyle: "NONE",
          reasonCodes: ["BUILDER_STRATEGY_FAILED"],
          blockers: [String(err?.message || err)],
          conflicts: [],
          qualityGatePassed: false,
          momentumGatePassed: false,
          permissionGatePassed: false,
          qualityScore: 0,
          qualityGrade: "IGNORE",
          qualityBand: "INVALID",
          qualityBreakdown: {
            engine1: 0,
            engine2: 0,
            engine3: 0,
            engine4: 0,
            compression: 0,
          },
          permission: "UNKNOWN",
          sizeMultiplier: null,
          lifecycle: {
            lifecycleStage: "BUILDING",
            isFreshSetup: false,
            entryWindowOpen: false,
            signalPrice: null,
            currentPrice: null,
            barsSinceSignal: null,
            moveFromSignalPts: null,
            moveFromSignalAtr: null,
            zonesInPath: [],
            zonesHit: 0,
            targetCount: 0,
            targetProgress01: 0,
            firstTargetHit: false,
            secondTargetHit: false,
            runnerActive: false,
            setupCompleted: false,
            edgeRemainingPct: 100,
            nextFocus: "LOOK_FOR_NEW_SETUP",
          },
          debug: {},
        },
        executionBias: "NORMAL",
        momentum,
        context: { ok: false, error: "builder_strategy_failed" },
      };
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(result, null, 2));

  console.log("Strategy snapshot written:", SNAPSHOT_FILE);
}

/* -----------------------------
   Run builder
------------------------------*/
buildSnapshot()
  .then(() => {
    console.log("Snapshot build completed successfully");
  })
  .catch((err) => {
    console.error("Snapshot builder failed:", err);
  });
