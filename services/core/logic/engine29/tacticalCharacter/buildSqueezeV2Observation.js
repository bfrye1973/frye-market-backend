// services/core/logic/engine29/tacticalCharacter/buildSqueezeV2Observation.js
// Engine 29 Squeeze v2 — live read-only observation builder.
// ES 10m/20m = onset/persistence evidence.
// Engine25 /live/intraday = canonical scanner evidence.
// Does not create campaign identity, Parent MOVE, permission, sizing, or execution.

import {
  scoreESAbnormalityHorizon,
  scoreESAbnormalityQuality,
  scoreSqueezePressure,
  scoreSqueezeV2Internals,
} from "./squeezeV2Scoring.js";

const DEFAULT_BACKEND =
  process.env.BACKEND_BASE ||
  process.env.CORE_BASE_URL ||
  "https://frye-market-backend-1.onrender.com";

function finite(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(a, b) {
  a = finite(a); b = finite(b);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

function sameWindowReturns(bars, barsBack, baselineWindows = 40) {
  const out = [];
  const endExclusive = bars.length - 1;
  const start = Math.max(barsBack, endExclusive - baselineWindows);
  for (let end = start; end < endExclusive; end += 1) {
    const r = pct(bars[end - barsBack]?.close, bars[end]?.close);
    if (Number.isFinite(r)) out.push(r);
  }
  return out;
}

function currentReturn(bars, barsBack) {
  if (!Array.isArray(bars) || bars.length < barsBack + 1) return null;
  return pct(bars.at(-(barsBack + 1))?.close, bars.at(-1)?.close);
}

function directionFromReturns(r10, r20) {
  const values = [r10, r20].filter(Number.isFinite);
  if (!values.length) return null;
  const composite = values.reduce((s, v) => s + v, 0) / values.length;
  if (composite > 0) return "UP";
  if (composite < 0) return "DOWN";
  return null;
}

function classifySector(card) {
  const breadth = finite(card?.breadth_pct);
  const momentum = finite(card?.momentum_pct);
  if (!Number.isFinite(breadth) || !Number.isFinite(momentum)) return null;
  if (breadth >= 55 && momentum >= 55) return "STRONG";
  if (breadth <= 45 && momentum <= 45) return "WEAK";
  return "NEUTRAL";
}

function normalizeEngine25(raw) {
  const cards = Array.isArray(raw?.sectorCards) ? raw.sectorCards : [];
  if (cards.length !== 11) return null;

  const sum = (field) =>
    cards.reduce((total, card) => {
      const n = finite(card?.[field]);
      return total + (Number.isFinite(n) ? n : 0);
    }, 0);

  const advancing = sum("up");
  const declining = sum("down");
  const total = advancing + declining;

  const advVol = sum("advancingVolume");
  const decVol = sum("decliningVolume");
  const directionalVolTotal = advVol + decVol;

  const states = cards.map(classifySector);
  if (states.some((state) => !state) || total <= 0 || directionalVolTotal <= 0) {
    return null;
  }

  const sourceTimestamp =
    raw?.updated_at_utc ||
    raw?.meta?.last_full_run_utc ||
    raw?.updated_at ||
    null;

  return {
    sourceTimestamp,
    advancingBreadthPct: (advancing / total) * 100,
    decliningBreadthPct: (declining / total) * 100,
    strongSectorCount: states.filter((x) => x === "STRONG").length,
    neutralSectorCount: states.filter((x) => x === "NEUTRAL").length,
    weakSectorCount: states.filter((x) => x === "WEAK").length,
    newHighs: sum("nh"),
    newLows: sum("nl"),
    advancingVolumeShare: (advVol / directionalVolTotal) * 100,
    decliningVolumeShare: (decVol / directionalVolTotal) * 100,
  };
}

async function fetchEngine25Intraday({
  backendBase = DEFAULT_BACKEND,
  fetchFn = fetch,
} = {}) {
  const url = `${String(backendBase).replace(/\/+$/, "")}/live/intraday`;
  const response = await fetchFn(url, {
    cache: "no-store",
    headers: { accept: "application/json", "cache-control": "no-store" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ENGINE25_INTRADAY_HTTP_${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function unavailable(reason, timestamp) {
  return {
    version: "engine29.squeezeV2Observation.v1",
    available: false,
    dataDegraded: true,
    timestamp,
    direction: null,
    sourceTimestamp: null,
    es10mReturnPct: null,
    es20mReturnPct: null,
    es10mQuality: null,
    es20mQuality: null,
    esAbnormalityQuality: null,
    internalDivergence: null,
    participationConfirmation: null,
    directionalBreadthPct: null,
    squeezePressure: null,
    watchQualified: false,
    activeQualified: false,
    reasonCodes: [reason],
  };
}

export async function buildEngine29SqueezeV2Observation({
  now = Date.now(),
  esAnchor = null,
  engine25Intraday = null,
  backendBase = DEFAULT_BACKEND,
  fetchFn = fetch,
} = {}) {
  const timestamp = new Date(now).toISOString();
  const bars = esAnchor?.liveMonitor?.bars || [];

  if (!Array.isArray(bars) || bars.length < 5) {
    return unavailable("SQUEEZE_V2_ES_10M_UNAVAILABLE", timestamp);
  }

  let raw = engine25Intraday;
  if (!raw) {
    try {
      raw = await fetchEngine25Intraday({ backendBase, fetchFn });
    } catch {
      return unavailable("SQUEEZE_V2_ENGINE25_INTRADAY_UNAVAILABLE", timestamp);
    }
  }

  const internalsInput = normalizeEngine25(raw);
  if (!internalsInput) {
    return unavailable("SQUEEZE_V2_ENGINE25_INTRADAY_INVALID", timestamp);
  }

  const sourceMs = Date.parse(internalsInput.sourceTimestamp || "");
  const ageMs = Number.isFinite(sourceMs) ? Math.max(0, now - sourceMs) : null;
  if (!Number.isFinite(ageMs) || ageMs > 15 * 60 * 1000) {
    return unavailable("SQUEEZE_V2_ENGINE25_INTRADAY_STALE", timestamp);
  }

  const r10 = currentReturn(bars, 1);
  const r20 = currentReturn(bars, 2);
  const direction = directionFromReturns(r10, r20);
  if (!direction) {
    return unavailable("SQUEEZE_V2_DIRECTION_UNRESOLVED", timestamp);
  }

  const a10 = scoreESAbnormalityHorizon({
    currentReturnPct: r10,
    historicalSameWindowReturnsPct: sameWindowReturns(bars, 1),
  });
  const a20 = scoreESAbnormalityHorizon({
    currentReturnPct: r20,
    historicalSameWindowReturnsPct: sameWindowReturns(bars, 2),
  });
  const es = scoreESAbnormalityQuality({
    quality10: a10.quality,
    quality20: a20.quality,
  });

  const internals = scoreSqueezeV2Internals(internalsInput, direction);
  const divergence = internals?.internalDivergence?.score;
  const participation = internals?.participationConfirmation?.score;
  const pressure = scoreSqueezePressure({
    esAbnormalityQuality: es.score,
    internalDivergence: divergence,
  });

  const directionalBreadthPct =
    direction === "UP"
      ? internalsInput.advancingBreadthPct
      : internalsInput.decliningBreadthPct;

  const available =
    es.available === true &&
    internals?.internalDivergence?.available === true &&
    internals?.participationConfirmation?.available === true &&
    pressure.available === true;

  if (!available) {
    return unavailable("SQUEEZE_V2_REQUIRED_SCORE_UNAVAILABLE", timestamp);
  }

  const watchQualified =
    Number(a10.quality) >= 45 &&
    Number(divergence) >= 45 &&
    Number(pressure.score) >= 25;

  const activeQualified =
    Number(es.score) >= 50 &&
    Number(divergence) >= 55 &&
    Number(pressure.score) >= 40;

  return {
    version: "engine29.squeezeV2Observation.v1",
    available: true,
    dataDegraded: false,
    timestamp,
    sourceTimestamp: internalsInput.sourceTimestamp,
    observationId: internalsInput.sourceTimestamp,
    observationTimeframe: "10m",
    sourceAgeMs: ageMs,
    direction,
    es10mReturnPct: r10,
    es20mReturnPct: r20,
    es10mQuality: a10.quality,
    es20mQuality: a20.quality,
    esAbnormalityQuality: es.score,
    internalDivergence: divergence,
    participationConfirmation: participation,
    directionalBreadthPct,
    squeezePressure: pressure.score,
    watchQualified,
    activeQualified,
    reasonCodes: [
      watchQualified ? "SQUEEZE_V2_WATCH_GATES_PASSED" : "SQUEEZE_V2_WATCH_GATES_NOT_PASSED",
      activeQualified ? "SQUEEZE_V2_ACTIVE_GATES_PASSED" : "SQUEEZE_V2_ACTIVE_GATES_NOT_PASSED",
    ],
  };
}

export default buildEngine29SqueezeV2Observation;
