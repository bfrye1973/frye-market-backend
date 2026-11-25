// services/streamer/engine5b/runner.js
import WebSocket from "ws";
import { engine5bState } from "./state.js";
import { recordGoOnRisingEdge } from "./goReplayRecorder.js";
import { maybeSendInstantGoAlert } from "../../core/logic/alerts/instantGoPushover.js";
import { runEngine16DBridge } from "../../core/logic/engine16D/engine16DRunner.js";

const POLY_WS_URL = "wss://socket.polygon.io/stocks";
const BACKEND1_BASE =
  process.env.BACKEND1_BASE ||
  process.env.HIST_BASE ||
  "https://frye-market-backend-1.onrender.com";

/* -------------------- helpers -------------------- */

function resolvePolygonKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function nowUtc() {
  return new Date().toISOString();
}

function toUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function toIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toFloatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolEnv01(name, fallbackBool) {
  const raw = String(process.env[name] ?? "").trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  return fallbackBool;
}

function clampInt(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function clampFloat(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function distanceToZone(price, z) {
  const p = Number(price);
  const lo = Number(z?.lo);
  const hi = Number(z?.hi);
  if (!Number.isFinite(p) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return Infinity;
  }
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  if (p >= a && p <= b) return 0;
  if (p < a) return a - p;
  return p - b;
}

function normalizeZone(z, source = "UNKNOWN") {
  if (!z || z.lo == null || z.hi == null) return null;
  const lo = Number(z.lo);
  const hi = Number(z.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return {
    id: z.id ?? null,
    lo,
    hi,
    mid:
      z.mid != null && Number.isFinite(Number(z.mid)) ? Number(z.mid) : null,
    source,
  };
}

function isFinitePositive(n) {
  return Number.isFinite(n) && n > 0;
}

function getZoneMid(zone) {
  if (!zone) return null;
  if (Number.isFinite(Number(zone.mid))) return Number(zone.mid);

  const lo = Number(zone.lo);
  const hi = Number(zone.hi);
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    return (lo + hi) / 2;
  }
  return null;
}

function getLastPrice() {
  const tickP = Number(engine5bState.lastTick?.p);
  if (Number.isFinite(tickP)) return tickP;

  const close1s = Number(engine5bState.lastBar1s?.close);
  if (Number.isFinite(close1s)) return close1s;

  return NaN;
}

function directionFromMoveType(moveType) {
  switch (moveType) {
    case "ACCEPTANCE":
    case "LOWER_REJECTION":
      return "LONG";
    case "UPPER_REJECTION":
    case "FAILURE":
      return "SHORT";
    default:
      return null;
  }
}

function isInsideZone(price, zone) {
  const p = Number(price);
  const lo = Number(zone?.lo);
  const hi = Number(zone?.hi);
  if (!Number.isFinite(p) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return false;
  }
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return p >= a && p <= b;
}

function zoneKey(z) {
  return [
    z?.id ?? "",
    Number(z?.lo ?? NaN),
    Number(z?.hi ?? NaN),
    z?.source ?? "",
  ].join("|");
}

function buildInteractionZoneCandidates() {
  const out = [];
  const seen = new Set();

  const analysis = normalizeZone(
    engine5bState.zone?.analysis,
    engine5bState.zone?.analysis?.source ?? "ANALYSIS"
  );
  const activeNegotiated = normalizeZone(
    engine5bState.zone?.activeNegotiated,
    "ACTIVE_NEGOTIATED"
  );
  const containment = normalizeZone(
    engine5bState.zone,
    engine5bState.zone?.source ?? "CONTAINMENT"
  );

  for (const z of [analysis, activeNegotiated, containment]) {
    if (!z) continue;
    const k = zoneKey(z);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(z);
  }

  return out;
}

function pickClosestInteractionZone(price) {
  const p = Number(price);
  if (!Number.isFinite(p)) {
    return {
      zone: null,
      distancePts: Infinity,
    };
  }

  const zones = buildInteractionZoneCandidates();
  if (!zones.length) {
    return {
      zone: null,
      distancePts: Infinity,
    };
  }

  let best = null;
  for (const z of zones) {
    const d = distanceToZone(p, z);
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.distancePts) {
      best = { zone: z, distancePts: d };
    }
  }

  return (
    best || {
      zone: null,
      distancePts: Infinity,
    }
  );
}

function computeSetupAliveInfo() {
  const price = getLastPrice();
  const az = engine5bState.zone?.analysis ?? null;
  const raw = engine5bState.e3?.raw ?? null;

  if (!az || !Number.isFinite(price)) {
    return {
      setupAlive: false,
      eligibilityReason: "NO_ANALYSIS_ZONE_OR_PRICE",
    };
  }

  if (isInsideZone(price, az)) {
    return {
      setupAlive: true,
      eligibilityReason: "INSIDE_ANALYSIS_ZONE",
    };
  }

  const paddedLo = Number(raw?.padded?.lo);
  const paddedHi = Number(raw?.padded?.hi);
  if (Number.isFinite(paddedLo) && Number.isFinite(paddedHi)) {
    const paddedZone = { lo: paddedLo, hi: paddedHi };
    if (isInsideZone(price, paddedZone)) {
      return {
        setupAlive: true,
        eligibilityReason: "INSIDE_E3_PADDED_ZONE",
      };
    }
  }

  const nearDistPts = clampFloat(
    toFloatEnv("ENGINE5B_SETUP_ALIVE_NEAR_DIST_PTS", 1.0),
    0.0,
    10.0
  );
  const dist = distanceToZone(price, az);
  if (Number.isFinite(dist) && dist <= nearDistPts) {
    return {
      setupAlive: true,
      eligibilityReason: `NEAR_ANALYSIS_ZONE_${dist.toFixed(2)}PT`,
    };
  }

  return {
    setupAlive: false,
    eligibilityReason: "OUTSIDE_ANALYSIS_ELIGIBILITY",
  };
}

function computeArmedFreshnessInfo() {
  const nowMs = Date.now();
  const armedWindowMs = Number(engine5bState.config?.armedWindowMs || 120000);

  const rawTriggerLine = engine5bState.sm?.triggerLine;
  const triggerLine =
    rawTriggerLine === null || rawTriggerLine === undefined
      ? null
      : Number(rawTriggerLine);

  const currentPrice = getLastPrice();

  const armedAtMs = Number(engine5bState.sm?.armedAtMs ?? 0);
  const armedCandleTimeMs = Number(
    engine5bState.e3?.raw?.armedCandleTimeMs ?? 0
  );

  const baseTimeMs = Math.max(armedAtMs || 0, armedCandleTimeMs || 0);
  const triggerFresh = baseTimeMs > 0 && nowMs - baseTimeMs <= armedWindowMs;

  let armedValid = false;
  let staleReason = null;

  if (
    engine5bState.e3?.stage === "ARMED" ||
    engine5bState.sm?.stage === "ARMED"
  ) {
    armedValid = true;
  }

  if (!armedValid) {
    staleReason = "NOT_ARMED";
  } else if (!triggerFresh) {
    armedValid = false;
    staleReason = "ARMED_CONTEXT_STALE";
  }

  const maxExtendedPts = clampFloat(
    toFloatEnv("ENGINE5B_MOVE_TOO_EXTENDED_PTS", 1.5),
    0.05,
    20.0
  );

  let tooExtended = false;
  if (
    triggerLine !== null &&
    Number.isFinite(triggerLine) &&
    Number.isFinite(currentPrice) &&
    Math.abs(currentPrice - triggerLine) > maxExtendedPts
  ) {
    tooExtended = true;
    if (!staleReason) staleReason = "TOO_EXTENDED_FROM_TRIGGER";
  }

  return {
    armedValid,
    triggerFresh,
    tooExtended,
    staleReason,
  };
}

function getInteractionContext() {
  const price = getLastPrice();
  const refPrice = Number.isFinite(Number(engine5bState.lastBar1s?.close))
    ? Number(engine5bState.lastBar1s?.close)
    : price;

  const picked = pickClosestInteractionZone(refPrice);
  return {
    refPrice,
    price,
    zone: picked.zone,
    distancePts: picked.distancePts,
  };
}

/* -------------------- early reversal helpers -------------------- */

function getTouchBar() {
  const e4Touch = engine5bState.e4?.raw?.diagnostics?.touchBar ?? null;
  if (e4Touch) return e4Touch;

  const e3Touch = engine5bState.e3?.raw?.touchBar ?? null;
  if (e3Touch) return e3Touch;

  return null;
}

function getTouchBarsAgo() {
  const t = Number(engine5bState.e4?.raw?.timing?.touchBarsAgo);
  return Number.isFinite(t) ? t : null;
}

function computeBarWickMetrics(bar) {
  const o = Number(bar?.o);
  const h = Number(bar?.h);
  const l = Number(bar?.l);
  const c = Number(bar?.c);

  if (
    !Number.isFinite(o) ||
    !Number.isFinite(h) ||
    !Number.isFinite(l) ||
    !Number.isFinite(c)
  ) {
    return null;
  }

  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const body = Math.abs(c - o);
  const bodyMid = (o + c) / 2;

  return {
    o,
    h,
    l,
    c,
    upperWick,
    lowerWick,
    body,
    bodyMid,
  };
}

function computeEarlyReversalSignal() {
  const interaction = getInteractionContext();
  const cz = interaction.zone ?? engine5bState.zone?.analysis ?? null;
  const refPrice = interaction.refPrice;

  const lo = Number(cz?.lo);
  const hi = Number(cz?.hi);
  const breakoutPts = Number(engine5bState.config?.breakoutPts || 0.02);

  const e3Raw = engine5bState.e3?.raw ?? null;
  const e4Raw = engine5bState.e4?.raw ?? null;
  const flags = e4Raw?.flags || {};
  const diagnostics = e4Raw?.diagnostics || {};
  const pressureBias = String(e4Raw?.pressureBias || "").toUpperCase();
  const structureState = String(e3Raw?.structureState || "").toUpperCase();
  const reasonCodes = Array.isArray(e3Raw?.reasonCodes)
    ? e3Raw.reasonCodes.map((x) => String(x).toUpperCase())
    : [];

  const touchBar = getTouchBar();
  const tm = computeBarWickMetrics(touchBar);
  const touchBarsAgo = getTouchBarsAgo();
  const zonePos01 = Number(diagnostics?.zonePos01);

  if (!tm || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return {
      active: false,
      direction: null,
      reason: null,
      controlMid: null,
      touchBarsAgo: null,
    };
  }

  const recentEnough =
    Number.isFinite(touchBarsAgo) ? touchBarsAgo <= 1 : true;

  const touchedUpper =
    (Number.isFinite(zonePos01) && zonePos01 >= 0.65) ||
    tm.h >= hi - Math.max(breakoutPts, 0.05);

  const touchedLower =
    (Number.isFinite(zonePos01) && zonePos01 <= 0.35) ||
    tm.l <= lo + Math.max(breakoutPts, 0.05);

  const upperReject =
    touchedUpper &&
    tm.upperWick > tm.body &&
    Number.isFinite(tm.c) &&
    tm.c <= hi;

  const lowerReject =
    touchedLower &&
    tm.lowerWick > tm.body &&
    Number.isFinite(tm.c) &&
    tm.c >= lo;

  const shortConfirm =
    Number.isFinite(refPrice) &&
    refPrice < tm.bodyMid &&
    refPrice < tm.c;

  const longConfirm =
    Number.isFinite(refPrice) &&
    refPrice > tm.bodyMid &&
    refPrice > tm.c;

  const bearishContext =
    flags?.reversalExpansion === true ||
    flags?.distributionDetected === true ||
    pressureBias.includes("SELL") ||
    structureState === "FAILURE" ||
    reasonCodes.includes("FAILURE");

  const bullishContext =
    flags?.absorptionDetected === true ||
    flags?.reversalExpansion === true ||
    pressureBias.includes("BUY") ||
    Number(e3Raw?.reclaimOrFailure ?? 0) >= 7;

  if (recentEnough && upperReject && shortConfirm && bearishContext) {
    return {
      active: true,
      direction: "SHORT",
      reason: "UPPER_REJECTION_EARLY",
      controlMid: Number.isFinite(tm.bodyMid) ? Number(tm.bodyMid) : null,
      touchBarsAgo: Number.isFinite(touchBarsAgo) ? touchBarsAgo : null,
    };
  }

  if (recentEnough && lowerReject && longConfirm && bullishContext) {
    return {
      active: true,
      direction: "LONG",
      reason: "LOWER_REJECTION_EARLY",
      controlMid: Number.isFinite(tm.bodyMid) ? Number(tm.bodyMid) : null,
      touchBarsAgo: Number.isFinite(touchBarsAgo) ? touchBarsAgo : null,
    };
  }

  return {
    active: false,
    direction: null,
    reason: null,
    controlMid: Number.isFinite(tm.bodyMid) ? Number(tm.bodyMid) : null,
    touchBarsAgo: Number.isFinite(touchBarsAgo) ? touchBarsAgo : null,
  };
}

/* -------------------- move classification -------------------- */

function classifyMoveType() {
  const e3 = engine5bState.e3 ?? null;
  const e3Raw = e3?.raw ?? null;
  const e4 = engine5bState.e4 ?? null;
  const e4Raw = e4?.raw ?? null;

  const interaction = getInteractionContext();
  const cz = interaction.zone ?? engine5bState.zone?.analysis ?? null;
  const refPrice = interaction.refPrice;

  const lo = Number(cz?.lo);
  const hi = Number(cz?.hi);
  const mid = getZoneMid(cz);

  const breakoutPts = Number(engine5bState.config?.breakoutPts || 0.02);

  const structureState = String(e3Raw?.structureState || "").toUpperCase();
  const reasonCodes = Array.isArray(e3Raw?.reasonCodes)
    ? e3Raw.reasonCodes.map((x) => String(x).toUpperCase())
    : [];

  const flags = e4Raw?.flags || {};
  const diagnostics = e4Raw?.diagnostics || {};
  const pressureBias = String(e4Raw?.pressureBias || "").toUpperCase();

  const candle = e3Raw?.candle || {};
  const upperWick = Number(candle?.upperWick);
  const lowerWick = Number(candle?.lowerWick);
  const body = Number(candle?.body);

  const upperDominant =
    upperWick > 0 &&
    body >= 0 &&
    upperWick > body &&
    upperWick >= lowerWick;

  const lowerDominant =
    lowerWick > 0 &&
    body >= 0 &&
    lowerWick > body &&
    lowerWick >= upperWick;

  const zonePos01 = Number(diagnostics?.zonePos01);
  const inZoneNow = e3Raw?.inZoneNow === true || isInsideZone(refPrice, cz);

  const aboveZone =
    Number.isFinite(refPrice) && Number.isFinite(hi)
      ? refPrice > hi + breakoutPts
      : false;

  const belowZone =
    Number.isFinite(refPrice) && Number.isFinite(lo)
      ? refPrice < lo - breakoutPts
      : false;

  const belowMid =
    Number.isFinite(refPrice) && Number.isFinite(mid) ? refPrice < mid : false;

  const touchedUpper =
    (Number.isFinite(zonePos01) && zonePos01 >= 0.7) ||
    (Number.isFinite(refPrice) &&
      Number.isFinite(hi) &&
      refPrice >= hi - Math.max(breakoutPts, 0.1)) ||
    upperDominant ||
    e3Raw?.wickProbeShort === true;

  const touchedLower =
    (Number.isFinite(zonePos01) && zonePos01 <= 0.3) ||
    (Number.isFinite(refPrice) &&
      Number.isFinite(lo) &&
      refPrice <= lo + Math.max(breakoutPts, 0.1)) ||
    lowerDominant ||
    e3Raw?.wickProbeLong === true;

  const e4ExpansionUp =
    flags?.initiativeMoveConfirmed === true &&
    pressureBias.includes("BUY");

  const e4ExpansionDown =
    (flags?.distributionDetected === true ||
      flags?.initiativeMoveConfirmed === true) &&
    pressureBias.includes("SELL");

  const e4ReversalDown =
    flags?.reversalExpansion === true ||
    flags?.distributionDetected === true ||
    pressureBias.includes("SELL");

  const e4ReversalUp =
    flags?.reversalExpansion === true ||
    flags?.absorptionDetected === true ||
    pressureBias.includes("BUY");

  const failureSignal =
    structureState === "FAILURE" || reasonCodes.includes("FAILURE");

  const strongBullishAcceptance =
    aboveZone &&
    (e4ExpansionUp ||
      pressureBias.includes("BUY") ||
      flags?.absorptionDetected === true ||
      (Number(e3Raw?.reclaimOrFailure ?? 0) >= 7 && !belowMid && !belowZone));

  const bullishConfirm =
    e4ReversalUp ||
    e4ExpansionUp ||
    pressureBias.includes("BUY") ||
    (Number(e3Raw?.reclaimOrFailure ?? 0) >= 7 && !failureSignal);

  const bearishConfirm =
    e4ReversalDown ||
    e4ExpansionDown ||
    pressureBias.includes("SELL") ||
    failureSignal ||
    belowMid ||
    belowZone;

  const e4Conflict = e4?.liquidityTrap === true;

  if (!e4Conflict && failureSignal && !strongBullishAcceptance) {
    return "FAILURE";
  }

  if (!e4Conflict && touchedUpper && bearishConfirm) {
    return "UPPER_REJECTION";
  }

  if (!e4Conflict && touchedLower && bullishConfirm && !bearishConfirm) {
    return "LOWER_REJECTION";
  }

  if (
    !e4Conflict &&
    aboveZone &&
    (e4ExpansionUp ||
      String(e3?.stage || "").toUpperCase() === "ARMED" ||
      String(e3?.stage || "").toUpperCase() === "TRIGGERED")
  ) {
    return "ACCEPTANCE";
  }

  if (!e4Conflict && belowZone && bearishConfirm) {
    return "FAILURE";
  }

  return "NONE";
}

function scoreMoveType(moveType, info) {
  const e3 = engine5bState.e3 ?? null;
  const e3Raw = e3?.raw ?? null;
  const e4 = engine5bState.e4 ?? null;
  const e4Raw = e4?.raw ?? null;

  const interaction = getInteractionContext();
  const cz = interaction.zone ?? engine5bState.zone?.analysis ?? null;
  const refPrice = interaction.refPrice;

  const lo = Number(cz?.lo);
  const hi = Number(cz?.hi);
  const mid = getZoneMid(cz);

  const candle = e3Raw?.candle || {};
  const upperWick = Number(candle?.upperWick);
  const lowerWick = Number(candle?.lowerWick);
  const body = Number(candle?.body);

  const flags = e4Raw?.flags || {};
  const pressureBias = String(e4Raw?.pressureBias || "").toUpperCase();
  const structureState = String(e3Raw?.structureState || "").toUpperCase();
  const reasonCodes = Array.isArray(e3Raw?.reasonCodes)
    ? e3Raw.reasonCodes.map((x) => String(x).toUpperCase())
    : [];
  const failureSignal =
    structureState === "FAILURE" || reasonCodes.includes("FAILURE");

  const reactionScore = clampInt(Number(e3?.reactionScore ?? 0), 0, 10);
  const volumeScore = clampInt(Number(e4?.volumeScore ?? 0), 0, 15);

  let structurePts = 0;
  let reactionPts = 0;
  let volumePts = 0;
  let freshnessPts = 0;

  if (moveType === "ACCEPTANCE") {
    if (Number.isFinite(refPrice) && Number.isFinite(hi) && refPrice > hi) {
      structurePts += 20;
    }
    if (
      Number.isFinite(refPrice) &&
      Number.isFinite(hi) &&
      refPrice > hi + 0.02
    ) {
      structurePts += 10;
    }
    if (
      engine5bState.sm?.pbState === "IMPULSE_SEEN" ||
      engine5bState.sm?.pbState === "PULLBACK_SEEN"
    ) {
      structurePts += 5;
    }
  } else if (moveType === "UPPER_REJECTION") {
    if (upperWick > body && upperWick > 0) structurePts += 15;
    if (Number.isFinite(refPrice) && Number.isFinite(hi) && refPrice <= hi) {
      structurePts += 10;
    }
    if (pressureBias.includes("SELL")) structurePts += 5;
    if (flags?.distributionDetected === true) structurePts += 5;
  } else if (moveType === "LOWER_REJECTION") {
    if (lowerWick > body && lowerWick > 0) structurePts += 15;
    if (Number.isFinite(refPrice) && Number.isFinite(lo) && refPrice >= lo) {
      structurePts += 10;
    }
    if (pressureBias.includes("BUY")) structurePts += 5;
    if (
      flags?.absorptionDetected === true ||
      flags?.reversalExpansion === true
    ) {
      structurePts += 5;
    }
  } else if (moveType === "FAILURE") {
    if (failureSignal) structurePts += 15;
    if (Number.isFinite(refPrice) && Number.isFinite(mid) && refPrice < mid) {
      structurePts += 10;
    }
    if (Number.isFinite(refPrice) && Number.isFinite(lo) && refPrice < lo) {
      structurePts += 10;
    }
  }

  reactionPts += Math.round((reactionScore / 10) * 20);

  const e3Stage = String(e3?.stage || "").toUpperCase();
  if (e3Stage === "ARMED") reactionPts += 3;
  if (e3Stage === "TRIGGERED" || e3Stage === "CONFIRMED") reactionPts += 5;

  if (e3Raw?.touchingNow === true || e3Raw?.touchArms === true) {
    reactionPts += 2;
  }

  volumePts += Math.round((volumeScore / 15) * 18);

  if (e4?.volumeConfirmed === true) volumePts += 4;
  if (flags?.reversalExpansion === true) volumePts += 3;
  if (flags?.pullbackContraction === true) volumePts += 2;
  if (flags?.initiativeMoveConfirmed === true) volumePts += 3;
  if (flags?.distributionDetected === true) volumePts += 3;
  if (flags?.absorptionDetected === true) volumePts += 3;
  if (e4?.liquidityTrap === true) volumePts -= 8;

  if (info?.triggerFresh) freshnessPts += 8;
  if (info?.armedValid) freshnessPts += 4;
  if (info?.setupAlive) freshnessPts += 3;
  if (info?.tooExtended) freshnessPts -= 6;

  structurePts = clampInt(structurePts, 0, 35);
  reactionPts = clampInt(reactionPts, 0, 25);
  volumePts = clampInt(volumePts, 0, 25);
  freshnessPts = clampInt(freshnessPts, 0, 15);

  return clampInt(
    structurePts + reactionPts + volumePts + freshnessPts,
    0,
    100
  );
}

function recomputeMoveClassification() {
  engine5bState.sm = engine5bState.sm || {};

  const aliveInfo = computeSetupAliveInfo();

  if (
    aliveInfo.setupAlive === true &&
    engine5bState.e3?.stage === "ARMED"
  ) {
    engine5bState.sm.armedAtMs = Date.now();
  }

  const freshInfo = computeArmedFreshnessInfo();
  const moveType = classifyMoveType();
  const moveDirection = directionFromMoveType(moveType);
  const interaction = getInteractionContext();
  const early = computeEarlyReversalSignal();

  const combinedInfo = {
    ...aliveInfo,
    ...freshInfo,
  };

  const moveScore = scoreMoveType(moveType, combinedInfo);

  engine5bState.sm.moveType = moveType;
  engine5bState.sm.moveScore = moveScore;
  engine5bState.sm.moveDirection = moveDirection;
  engine5bState.sm.setupAlive = aliveInfo.setupAlive;
  engine5bState.sm.armedValid = freshInfo.armedValid;
  engine5bState.sm.triggerFresh = freshInfo.triggerFresh;
  engine5bState.sm.tooExtended = freshInfo.tooExtended;
  engine5bState.sm.staleReason = freshInfo.staleReason;
  engine5bState.sm.eligibilityReason = aliveInfo.eligibilityReason;

  engine5bState.sm.interactionZoneId = interaction.zone?.id ?? null;
  engine5bState.sm.interactionZoneSource = interaction.zone?.source ?? null;
  engine5bState.sm.interactionZoneDistPts = Number.isFinite(
    interaction.distancePts
  )
    ? Number(interaction.distancePts.toFixed(4))
    : null;

  engine5bState.sm.earlyReversal = early.active;
  engine5bState.sm.earlyReversalDirection = early.direction;
  engine5bState.sm.earlyReversalReason = early.reason;
  engine5bState.sm.earlyReversalControlMid = Number.isFinite(early.controlMid)
    ? Number(early.controlMid.toFixed(4))
    : null;
  engine5bState.sm.earlyReversalTouchBarsAgo = Number.isFinite(
    early.touchBarsAgo
  )
    ? early.touchBarsAgo
    : null;
}

async function jget(url) {
  const r = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(
      `POST ${url} -> ${r.status} ${
        (j && JSON.stringify(j).slice(0, 200)) || ""
      }`
    );
  }
  return j;
}

/* -------------------- GO helpers (display-only) -------------------- */

async function setGo(payload) {
  const nowMs = Date.now();
  const holdMs = Number(engine5bState.config?.goHoldMs || 120000);

  const cooldownUntilMs = Number.isFinite(payload.cooldownUntilMs)
    ? payload.cooldownUntilMs
    : nowMs + holdMs;

  const holdUntil = Math.max(nowMs + holdMs, cooldownUntilMs);

  const prevGo = engine5bState.go ? { ...engine5bState.go } : { signal: false };

  engine5bState.go = engine5bState.go || {};
  engine5bState.go.signal = true;
  engine5bState.go.direction = payload.direction || null;
  engine5bState.go.atUtc = payload.atUtc || nowUtc();
  engine5bState.go.price = Number.isFinite(payload.price)
    ? payload.price
    : null;
  engine5bState.go.reason = payload.reason || null;
  engine5bState.go.reasonCodes = Array.isArray(payload.reasonCodes)
    ? payload.reasonCodes
    : [];
  engine5bState.go.triggerType = payload.triggerType || null;
  engine5bState.go.triggerLine = Number.isFinite(payload.triggerLine)
    ? payload.triggerLine
    : null;
  engine5bState.go.cooldownUntilMs = cooldownUntilMs;
  engine5bState.go._holdUntilMs = holdUntil;

  await maybeSendInstantGoAlert({
    symbol: "SPY",
    prevGo,
    nextGo: engine5bState.go,
  });
}

function clearGoIfExpired() {
  const nowMs = Date.now();
  const holdUntil = Number(engine5bState.go?._holdUntilMs || 0);
  if (engine5bState.go?.signal && holdUntil && nowMs >= holdUntil) {
    engine5bState.go.signal = false;
    engine5bState.go.direction = null;
    engine5bState.go.atUtc = null;
    engine5bState.go.price = null;
    engine5bState.go.reason = null;
    engine5bState.go.reasonCodes = [];
    engine5bState.go.triggerType = null;
    engine5bState.go.triggerLine = null;
    engine5bState.go.cooldownUntilMs = null;
    engine5bState.go._holdUntilMs = null;
  }
}

/* -------------------- Engine 1 zone pick (strict + scalp fallback) -------------------- */

function pickZoneFromEngine1Context(ctx) {
  const price = Number(ctx?.meta?.current_price ?? NaN);

  const activeNeg = ctx?.active?.negotiated ?? null;
  const activeShelf = ctx?.active?.shelf ?? null;
  const activeInst = ctx?.active?.institutional ?? null;

  const active = activeNeg || activeShelf || activeInst || null;

  if (active && Number.isFinite(price)) {
    const lo = Number(active.lo);
    const hi = Number(active.hi);
    if (
      Number.isFinite(lo) &&
      Number.isFinite(hi) &&
      lo <= price &&
      price <= hi
    ) {
      return { id: active.id ?? null, lo, hi, source: "ACTIVE" };
    }
  }

  const ns = ctx?.nearest?.shelf ?? null;
  if (ns?.lo != null && ns?.hi != null) {
    const lo = Number(ns.lo);
    const hi = Number(ns.hi);
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      return {
        id: ns.id ?? null,
        lo,
        hi,
        source: "NEAREST_SHELF_SCALP_REF",
      };
    }
  }

  return { id: null, lo: null, hi: null, source: "NONE" };
}

function pickNegotiatedAnalysisZone(ctx) {
  const price = Number(ctx?.meta?.current_price ?? NaN);

  const activeNeg = normalizeZone(
    ctx?.active?.negotiated,
    "ACTIVE_NEGOTIATED"
  );
  if (activeNeg) return activeNeg;

  const negotiated = Array.isArray(ctx?.render?.negotiated)
    ? ctx.render.negotiated
    : [];
  if (!negotiated.length || !Number.isFinite(price)) return null;

  const maxDist = Number(process.env.ENGINE5B_NEGOTIATED_MAX_DIST_PTS ?? 3.0);
  let best = null;

  for (const z of negotiated) {
    const nz = normalizeZone(z, "RENDER_NEGOTIATED");
    if (!nz) continue;
    const d = distanceToZone(price, nz);
    if (!Number.isFinite(d) || d > maxDist) continue;
    if (!best || d < best.distancePts) {
      best = { ...nz, distancePts: d };
    }
  }

  if (!best) return null;
  return {
    id: best.id,
    lo: best.lo,
    hi: best.hi,
    mid: best.mid ?? null,
    source: best.source,
  };
}

/* -------------------- 1s and 1m builders from ticks -------------------- */

function applyTickTo1s(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec)) return cur;

  const sec = tSec;

  if (!cur || cur.time < sec) {
    return {
      time: sec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number.isFinite(size) ? size : 0,
    };
  }
  if (cur.time !== sec) return cur;

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

function applyTickTo1m(cur, tick) {
  const price = Number(tick?.p);
  const size = Number(tick?.s ?? 0);
  const tSec = toUnixSec(tick?.t);
  if (!Number.isFinite(price) || !Number.isFinite(tSec)) return cur;

  const minSec = Math.floor(tSec / 60) * 60;

  if (!cur || cur.time < minSec) {
    return {
      time: minSec,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: Number.isFinite(size) ? size : 0,
    };
  }
  if (cur.time !== minSec) return cur;

  const b = { ...cur };
  b.high = Math.max(b.high, price);
  b.low = Math.min(b.low, price);
  b.close = price;
  b.volume = Number(b.volume || 0) + Number(size || 0);
  return b;
}

/* -------------------- state machine helpers -------------------- */

function isKillSwitchOn() {
  return engine5bState.risk?.killSwitch === true;
}

function inCooldown() {
  const until = engine5bState.sm.cooldownUntilMs;
  return until != null && Date.now() < until;
}

function stageSet(newStage) {
  engine5bState.sm.stage = newStage;
  engine5bState.sm.lastDecision = `${nowUtc()} stage=${newStage}`;
}

function hardResetToIdle(reason) {
  engine5bState.sm.stage = "IDLE";
  engine5bState.sm.armedAtMs = null;
  engine5bState.sm.triggeredAtMs = null;
  engine5bState.sm.cooldownUntilMs = null;
  engine5bState.sm.outsideCount = 0;
  engine5bState.sm.lastNotInZoneMs = null;

  engine5bState.sm.pbState = null;
  engine5bState.sm.impulse1mTime = null;
  engine5bState.sm.impulse1mHigh = null;
  engine5bState.sm.pullback1mTime = null;
  engine5bState.sm.pullbackHigh = null;
  engine5bState.sm.triggerLine = null;
  engine5bState.sm.triggerAboveCount = 0;

  engine5bState.sm.lastDecision = `${nowUtc()} reset=IDLE reason=${
    reason || "UNKNOWN"
  }`;

  recomputeMoveClassification();
}

function isArmedRecent() {
  const t = engine5bState.sm.armedAtMs;
  if (!t) return false;
  return Date.now() - t <= engine5bState.config.armedWindowMs;
}

function pullbackReclaimCheck_1s(closePx) {
  const line = Number(engine5bState.sm.triggerLine);
  if (!Number.isFinite(closePx) || !Number.isFinite(line)) return false;

  const req = line + Number(engine5bState.config.breakoutPts || 0.02);
  return closePx > req;
}

function volumeGateOk() {
  const minScore = clampInt(toIntEnv("ENGINE5B_E4_MIN_SCORE", 6), 0, 15);

  if (engine5bState.e4?.liquidityTrap === true) return false;
  return Number(engine5bState.e4?.volumeScore ?? 0) >= minScore;
}

/* -------------------- engine calls -------------------- */

async function refreshZone() {
  const url = `${BACKEND1_BASE}/api/v1/engine5-context?symbol=SPY&tf=10m`;
  const ctx = await jget(url);

  const an = ctx?.active?.negotiated ?? null;
  engine5bState.zone = engine5bState.zone || {};
  engine5bState.zone.activeNegotiated = an
    ? {
        id: an.id ?? null,
        lo: an.lo != null ? Number(an.lo) : null,
        hi: an.hi != null ? Number(an.hi) : null,
        mid: an.mid != null ? Number(an.mid) : null,
      }
    : null;

  const z = pickZoneFromEngine1Context(ctx);
  engine5bState.zone = {
    ...engine5bState.zone,
    ...z,
    refreshedAtUtc: nowUtc(),
  };

  const negotiatedAnalysis = pickNegotiatedAnalysisZone(ctx);

  if (negotiatedAnalysis) {
    engine5bState.zone.analysis = {
      id: negotiatedAnalysis.id ?? null,
      lo: Number(negotiatedAnalysis.lo),
      hi: Number(negotiatedAnalysis.hi),
      source: negotiatedAnalysis.source ?? "NEGOTIATED_ANALYSIS",
      updatedAtUtc: nowUtc(),
    };
  } else if (
    engine5bState.zone?.lo != null &&
    engine5bState.zone?.hi != null
  ) {
    engine5bState.zone.analysis = {
      id: engine5bState.zone.id ?? null,
      lo: Number(engine5bState.zone.lo),
      hi: Number(engine5bState.zone.hi),
      source: engine5bState.zone.source ?? "UNKNOWN",
      updatedAtUtc: nowUtc(),
    };
  } else {
    engine5bState.zone.analysis = null;
  }

  if (engine5bState.zone?.source === "NONE") {
  hardResetToIdle("NO_ZONE_SOURCE_NONE");
  return;
}

recomputeMoveClassification();
}

// ✅ refreshRisk FULLY CLOSED + CORRECT
async function refreshRisk() {
  const url = `${BACKEND1_BASE}/api/trading/status`;
  const j = await jget(url);

  engine5bState.risk = {
    killSwitch: j?.killSwitch ?? null,
    paperOnly: j?.paperOnly ?? null,
    allowlist: Array.isArray(j?.allowlist) ? j.allowlist : null,
    updatedAtUtc: nowUtc(),
    raw: j,
  };

  if (engine5bState.risk.killSwitch === true) {
    hardResetToIdle("KILL_SWITCH_ON");
    return;
  }

  // ✅ THIS WAS MISSING — REQUIRED
  recomputeMoveClassification();
}
  
async function refreshE3() {
  const az = engine5bState.zone?.analysis ?? null;

  let lo = az?.lo != null ? Number(az.lo) : null;
  let hi = az?.hi != null ? Number(az.hi) : null;
  const zoneId = az?.id ?? null;
  const zoneSource = az?.source ?? null;

  if (lo == null || hi == null) {
    const z = engine5bState.zone || {};
    lo = z?.lo != null ? Number(z.lo) : null;
    hi = z?.hi != null ? Number(z.hi) : null;
  }

  if (lo == null || hi == null) return;

  const url =
    `${BACKEND1_BASE}/api/v1/reaction-score` +
    `?symbol=SPY&tf=10m&strategyId=intraday_scalp@10m` +
    `&lo=${encodeURIComponent(lo)}` +
    `&hi=${encodeURIComponent(hi)}` +
    (zoneId ? `&zoneId=${encodeURIComponent(zoneId)}` : "") +
    (zoneSource ? `&source=${encodeURIComponent(zoneSource)}` : "");

  const j = await jget(url);

  engine5bState.e3 = {
    ok: true,
    stage: String(j?.stage || "IDLE").toUpperCase(),
    armed: j?.armed === true,
    reactionScore: Number(j?.reactionScore ?? 0),
    updatedAtUtc: nowUtc(),
    raw: j,
  };

  const reasonCodes = Array.isArray(j?.reasonCodes) ? j.reasonCodes : [];
  const stage = engine5bState.e3.stage;

  const NOT_IN_ZONE_N = clampInt(toIntEnv("ENGINE5B_NOT_IN_ZONE_N", 3), 1, 10);
  const NOT_IN_ZONE_GRACE_MS = clampInt(
    toIntEnv("ENGINE5B_NOT_IN_ZONE_GRACE_MS", 90000),
    1000,
    10 * 60 * 1000
  );

  if (reasonCodes.includes("NOT_IN_ZONE")) {
    engine5bState.sm.outsideCount =
      Number(engine5bState.sm.outsideCount || 0) + 1;
    engine5bState.sm.lastNotInZoneMs =
      engine5bState.sm.lastNotInZoneMs || Date.now();

    const elapsed =
      Date.now() - Number(engine5bState.sm.lastNotInZoneMs || Date.now());

    if (
      engine5bState.sm.outsideCount >= NOT_IN_ZONE_N &&
      elapsed >= NOT_IN_ZONE_GRACE_MS
    ) {
      hardResetToIdle(`E3_NOT_IN_ZONE_N${NOT_IN_ZONE_N}_GRACE_EXCEEDED`);
      return;
    }

    engine5bState.sm.lastDecision = `${nowUtc()} e3=NOT_IN_ZONE outsideCount=${
      engine5bState.sm.outsideCount
    } elapsedMs=${elapsed}`;
    recomputeMoveClassification();
    return;
  } else {
    engine5bState.sm.outsideCount = 0;
    engine5bState.sm.lastNotInZoneMs = null;
  }

  if (stage === "ARMED") {
    if (engine5bState.sm.stage === "IDLE") stageSet("ARMED");
    engine5bState.sm.armedAtMs = engine5bState.sm.armedAtMs || Date.now();
  }

  if (stage === "TRIGGERED" || stage === "CONFIRMED") {
    if (engine5bState.sm.stage !== "TRIGGERED") {
      stageSet("TRIGGERED");
      engine5bState.sm.triggeredAtMs = Date.now();
    }
  }

    recomputeMoveClassification();

  await runEngine16DBridge({
    backend1Base: BACKEND1_BASE,
    log: console.log,
  });
}
async function refreshE4_1m() {
  const az = engine5bState.zone?.analysis ?? null;

  let lo = az?.lo != null ? Number(az.lo) : null;
  let hi = az?.hi != null ? Number(az.hi) : null;

  if (lo == null || hi == null) {
    const z = engine5bState.zone || {};
    lo = z?.lo != null ? Number(z.lo) : null;
    hi = z?.hi != null ? Number(z.hi) : null;
  }

  if (lo == null || hi == null) return;

  const url =
    `${BACKEND1_BASE}/api/v1/volume-behavior` +
    `?symbol=SPY&tf=10m&zoneLo=${encodeURIComponent(lo)}` +
    `&zoneHi=${encodeURIComponent(hi)}&mode=scalp`;

  const j = await jget(url);

  const rzLo = Number(j?.zone?.lo);
  const rzHi = Number(j?.zone?.hi);
  const reqLo = Number(lo);
  const reqHi = Number(hi);

  const match =
    Number.isFinite(rzLo) &&
    Number.isFinite(rzHi) &&
    Math.abs(rzLo - reqLo) < 1e-6 &&
    Math.abs(rzHi - reqHi) < 1e-6;

  if (!match) {
    engine5bState.e4 = {
      ok: false,
      volumeScore: 0,
      volumeConfirmed: false,
      liquidityTrap: false,
      updatedAtUtc: nowUtc(),
      raw: {
        ok: false,
        error: "ZONE_MISMATCH_STALE",
        requested: { lo, hi },
        received: j?.zone ?? null,
      },
    };
    recomputeMoveClassification();
    return;
  }

  engine5bState.e4 = {
    ok: true,
    volumeScore: Number(j?.volumeScore ?? 0),
    volumeConfirmed: j?.volumeConfirmed === true,
    liquidityTrap: j?.flags?.liquidityTrap === true,
    updatedAtUtc: nowUtc(),
    raw: j,
  };

  recomputeMoveClassification();
}

// kept but not called here
async function tryExecutePaper(dir, barTimeSec) {
  if (!engine5bState.config.executeEnabled) {
    return { ok: false, skipped: true, reason: "EXECUTE_DISABLED" };
  }
  if (isKillSwitchOn()) {
    return { ok: false, skipped: true, reason: "KILL_SWITCH" };
  }

  if (engine5bState.e4?.liquidityTrap) {
    return { ok: false, skipped: true, reason: "E4_LIQUIDITY_TRAP" };
  }

  if ((engine5bState.e4?.volumeScore ?? 0) < 7) {
    return { ok: false, skipped: true, reason: "E4_VOLUME_SCORE_LT_7" };
  }

  const idempotencyKey = `SPY|intraday_scalp@10m|${dir}|${barTimeSec}`;

  const body = {
    idempotencyKey,
    symbol: "SPY",
    strategyId: "intraday_scalp@10m",
    side: "ENTRY",
    engine6: { permission: "ALLOW" },
    engine7: { finalR: 0.1 },
    assetType: "EQUITY",
    paper: true,
    engine5: { bias: dir === "LONG" ? "long" : "short" },
  };

  const url = `${BACKEND1_BASE}/api/trading/execute`;
  return await jpost(url, body);
}

/* -------------------- main loop -------------------- */

export function startEngine5B({ log = console.log } = {}) {
  const KEY = resolvePolygonKey();
  if (!KEY) {
    log("[engine5b] Missing POLYGON_API_KEY — not started");
    return { stop() {} };
  }

  engine5bState.config.executeEnabled = false;
  engine5bState.config.mode = "monitor";
  engine5bState.config.longOnly = toBoolEnv01("ENGINE5B_LONG_ONLY", true);

  engine5bState.config.persistBars = clampInt(
    toIntEnv("ENGINE5B_PERSIST_BARS", engine5bState.config.persistBars ?? 2),
    1,
    5
  );
  engine5bState.config.breakoutPts = clampFloat(
    toFloatEnv(
      "ENGINE5B_BREAKOUT_PTS",
      engine5bState.config.breakoutPts ?? 0.02
    ),
    0.0,
    1.0
  );
  engine5bState.config.cooldownMs = clampInt(
    toIntEnv(
      "ENGINE5B_COOLDOWN_MS",
      engine5bState.config.cooldownMs ?? 120000
    ),
    1000,
    60 * 60 * 1000
  );
  engine5bState.config.armedWindowMs = clampInt(
    toIntEnv(
      "ENGINE5B_ARMED_WINDOW_MS",
      engine5bState.config.armedWindowMs ?? 120000
    ),
    1000,
    60 * 60 * 1000
  );
  engine5bState.config.e3IntervalMs = clampInt(
    toIntEnv(
      "ENGINE5B_E3_INTERVAL_MS",
      engine5bState.config.e3IntervalMs ?? 2000
    ),
    250,
    60000
  );

  engine5bState.config.goHoldMs = clampInt(
    toIntEnv("ENGINE5B_GO_HOLD_MS", engine5bState.config.goHoldMs ?? 120000),
    1000,
    10 * 60 * 1000
  );

  const IMPULSE_RANGE_PTS = clampFloat(
    toFloatEnv("ENGINE5B_IMPULSE_RANGE_PTS", 0.4),
    0.05,
    5.0
  );
  const PULLBACK_WICK_PTS = clampFloat(
    toFloatEnv("ENGINE5B_PULLBACK_WICK_PTS", 0.2),
    0.01,
    5.0
  );
  const PULLBACK_MAX_MINUTES = clampInt(
    toIntEnv("ENGINE5B_PULLBACK_MAX_MINUTES", 3),
    1,
    10
  );

  const ARMED_TRIGGER_ENABLED = toBoolEnv01(
    "ENGINE5B_ARMED_TRIGGER_ENABLED",
    true
  );
  const ARMED_TRIGGER_MAX_AGE_MS = clampInt(
    toIntEnv("ENGINE5B_ARMED_TRIGGER_MAX_AGE_MS", 15 * 60 * 1000),
    1000,
    60 * 60 * 1000
  );
  const E4_MIN_SCORE = clampInt(toIntEnv("ENGINE5B_E4_MIN_SCORE", 6), 0, 15);

  log(
    `[engine5b] starting mode=${engine5bState.config.mode} execute=${engine5bState.config.executeEnabled}`
  );
  log(
    `[engine5b] cfg persistBars=${engine5bState.config.persistBars} breakoutPts=${engine5bState.config.breakoutPts} cooldownMs=${engine5bState.config.cooldownMs}`
  );
  log(`[engine5b] GO hold ms=${engine5bState.config.goHoldMs}`);
  log(
    `[engine5b] pullback cfg impulseRangePts=${IMPULSE_RANGE_PTS} pullbackWickPts=${PULLBACK_WICK_PTS} pullbackMaxMin=${PULLBACK_MAX_MINUTES}`
  );
  log(
    `[engine5b] NOT_IN_ZONE relax N=${toIntEnv(
      "ENGINE5B_NOT_IN_ZONE_N",
      3
    )} graceMs=${toIntEnv("ENGINE5B_NOT_IN_ZONE_GRACE_MS", 90000)}`
  );
  log(
    `[engine5b] negotiated analysis maxDist=${
      process.env.ENGINE5B_NEGOTIATED_MAX_DIST_PTS ?? 3.0
    }`
  );
  log(
    `[engine5b] armed trigger enabled=${ARMED_TRIGGER_ENABLED} maxAgeMs=${ARMED_TRIGGER_MAX_AGE_MS}`
  );
  log(`[engine5b] e4 min score=${E4_MIN_SCORE}`);

  let stopped = false;
  let ws = null;

  let zoneTimer = null;
  let riskTimer = null;
  let e3Timer = null;
  let e4Timer = null;

  let cur1s = null;
  let lastClosedSec = null;

  let cur1m = null;
  let lastClosedMinSec = null;

  engine5bState.sm.pbState = engine5bState.sm.pbState ?? null;
  engine5bState.sm.triggerAboveCount =
    engine5bState.sm.triggerAboveCount ?? 0;
  engine5bState.sm.outsideCount = engine5bState.sm.outsideCount ?? 0;
  engine5bState.sm.lastNotInZoneMs = null;
    engine5bState.sm.lastNotInZoneMs ?? null;
  engine5bState.sm.moveType = engine5bState.sm.moveType ?? "NONE";
  engine5bState.sm.moveScore = engine5bState.sm.moveScore ?? 0;
  engine5bState.sm.moveDirection = engine5bState.sm.moveDirection ?? null;
  engine5bState.sm.setupAlive = engine5bState.sm.setupAlive ?? false;
  engine5bState.sm.armedValid = engine5bState.sm.armedValid ?? false;
  engine5bState.sm.triggerFresh = engine5bState.sm.triggerFresh ?? false;
  engine5bState.sm.tooExtended = engine5bState.sm.tooExtended ?? false;
  engine5bState.sm.staleReason = engine5bState.sm.staleReason ?? null;
  engine5bState.sm.eligibilityReason =
    engine5bState.sm.eligibilityReason ?? null;
  engine5bState.sm.interactionZoneId =
    engine5bState.sm.interactionZoneId ?? null;
  engine5bState.sm.interactionZoneSource =
    engine5bState.sm.interactionZoneSource ?? null;
  engine5bState.sm.interactionZoneDistPts =
    engine5bState.sm.interactionZoneDistPts ?? null;

  engine5bState.sm.earlyReversal = engine5bState.sm.earlyReversal ?? false;
  engine5bState.sm.earlyReversalDirection =
    engine5bState.sm.earlyReversalDirection ?? null;
  engine5bState.sm.earlyReversalReason =
    engine5bState.sm.earlyReversalReason ?? null;
  engine5bState.sm.earlyReversalControlMid =
    engine5bState.sm.earlyReversalControlMid ?? null;
  engine5bState.sm.earlyReversalTouchBarsAgo =
    engine5bState.sm.earlyReversalTouchBarsAgo ?? null;

  async function safe(fn, label) {
    try {
      await fn();
    } catch (e) {
      log(`[engine5b] ${label} error: ${e?.message || e}`);
    }
  }

  safe(refreshZone, "refreshZone");
  safe(refreshRisk, "refreshRisk");
  safe(refreshE3, "refreshE3");
  safe(refreshE4_1m, "refreshE4_1m");

  zoneTimer = setInterval(
    () => safe(refreshZone, "refreshZone"),
    engine5bState.config.zoneRefreshMs
  );
  riskTimer = setInterval(() => safe(refreshRisk, "refreshRisk"), 5000);
  e3Timer = setInterval(
    () => safe(refreshE3, "refreshE3"),
    engine5bState.config.e3IntervalMs
  );
  e4Timer = setInterval(
    () => safe(refreshE4_1m, "refreshE4_1m"),
    engine5bState.config.e4RefreshMs
  );

  function connectWs() {
    if (stopped) return;
    ws = new WebSocket(POLY_WS_URL);

    ws.on("open", () => {
      ws.send(JSON.stringify({ action: "auth", params: KEY }));
      ws.send(JSON.stringify({ action: "subscribe", params: `T.SPY` }));
      log("[engine5b] WS open, subscribed T.SPY");
    });

    ws.on("message", async (buf) => {
      const msg = safeJsonParse(buf.toString("utf8"));
      if (!msg) return;

      const arr = Array.isArray(msg) ? msg : [msg];
      for (const ev of arr) {
        if (ev?.ev === "status") continue;
        if (ev?.ev !== "T") continue;
        if (String(ev?.sym || "").toUpperCase() !== "SPY") continue;

        clearGoIfExpired();

        if (isKillSwitchOn()) {
          hardResetToIdle("KILL_SWITCH_TICK_BLOCK");
          continue;
        }

        engine5bState.lastTick = {
          t: ev.t,
          p: ev.p,
          s: ev.s,
          updatedAtUtc: nowUtc(),
        };

        cur1s = applyTickTo1s(cur1s, ev);
        const sec = cur1s?.time;
        if (!sec) continue;

        cur1m = applyTickTo1m(cur1m, ev);
        const minSec = cur1m?.time ?? null;

        if (minSec != null) {
          if (lastClosedMinSec == null) lastClosedMinSec = minSec;

          if (minSec !== lastClosedMinSec) {
            const closed1m = cur1m;
            const haveZone =
              engine5bState.zone?.source &&
              engine5bState.zone.source !== "NONE";
            const armedOk =
              engine5bState.e3?.stage === "ARMED" ||
              engine5bState.sm.stage === "ARMED";

            if (haveZone && armedOk) {
              if (engine5bState.sm.pbState === "IMPULSE_SEEN") {
                const impulseT = Number(engine5bState.sm.impulse1mTime ?? 0);
                if (impulseT > 0) {
                  const minsPassed = Math.floor((minSec - impulseT) / 60);
                  if (minsPassed > PULLBACK_MAX_MINUTES) {
                    engine5bState.sm.pbState = null;
                    engine5bState.sm.impulse1mTime = null;
                    engine5bState.sm.impulse1mHigh = null;
                    engine5bState.sm.pullback1mTime = null;
                    engine5bState.sm.pullbackHigh = null;
                    engine5bState.sm.triggerLine = null;
                    engine5bState.sm.triggerAboveCount = 0;
                    engine5bState.sm.lastDecision = `${nowUtc()} pb_reset=TIMEOUT`;
                  }
                }
              }

              if (!engine5bState.sm.pbState) {
                const range = Number(closed1m.high) - Number(closed1m.low);
                const zoneHi = Number(engine5bState.zone.hi);
                const breakoutPts = Number(
                  engine5bState.config.breakoutPts || 0.02
                );

                if (
                  Number.isFinite(range) &&
                  range >= IMPULSE_RANGE_PTS &&
                  Number(closed1m.close) > zoneHi + breakoutPts
                ) {
                  engine5bState.sm.pbState = "IMPULSE_SEEN";
                  engine5bState.sm.impulse1mTime = minSec;
                  engine5bState.sm.impulse1mHigh = Number(closed1m.high);
                  engine5bState.sm.lastDecision = `${nowUtc()} pb=IMPULSE_SEEN impulseHigh=${engine5bState.sm.impulse1mHigh}`;
                }
              } else if (engine5bState.sm.pbState === "IMPULSE_SEEN") {
                const impulseHigh = Number(engine5bState.sm.impulse1mHigh);
                const wickDown = impulseHigh - Number(closed1m.low);

                if (
                  Number.isFinite(impulseHigh) &&
                  Number.isFinite(wickDown) &&
                  wickDown >= PULLBACK_WICK_PTS
                ) {
                  engine5bState.sm.pbState = "PULLBACK_SEEN";
                  engine5bState.sm.pullback1mTime = minSec;
                  engine5bState.sm.pullbackHigh = Number(closed1m.high);
                  engine5bState.sm.triggerLine = Number(closed1m.high);
                  engine5bState.sm.triggerAboveCount = 0;
                  engine5bState.sm.lastDecision = `${nowUtc()} pb=PULLBACK_SEEN triggerLine=${engine5bState.sm.triggerLine}`;
                }
              }
            }

            recomputeMoveClassification();
            lastClosedMinSec = minSec;
          }
        }

        if (
          ARMED_TRIGGER_ENABLED &&
          engine5bState.sm.stage === "ARMED" &&
          engine5bState.sm.pbState == null &&
          !Number.isFinite(Number(engine5bState.sm.triggerLine))
        ) {
          const armedHigh = Number(engine5bState.e3?.raw?.armedCandleHigh);
          const armedTimeMs = Number(
            engine5bState.e3?.raw?.armedCandleTimeMs ?? 0
          );

          if (isFinitePositive(armedHigh)) {
            const ageOk =
              !armedTimeMs ||
              Date.now() - armedTimeMs <= ARMED_TRIGGER_MAX_AGE_MS;

            if (ageOk) {
              engine5bState.sm.triggerLine = armedHigh;
              engine5bState.sm.lastDecision = `${nowUtc()} armed_triggerLine=${armedHigh}`;
              recomputeMoveClassification();
            }
          }
        }

        if (lastClosedSec == null) lastClosedSec = sec;

        if (sec !== lastClosedSec) {
          engine5bState.lastBar1s = { ...cur1s, closedAtUtc: nowUtc() };
          const closePx = Number(cur1s?.close);

          if (
            engine5bState.sm.pbState === "PULLBACK_SEEN" &&
            engine5bState.sm.stage === "ARMED" &&
            isArmedRecent() &&
            !inCooldown()
          ) {
            const above = pullbackReclaimCheck_1s(closePx);
            if (above) {
              engine5bState.sm.triggerAboveCount =
                Number(engine5bState.sm.triggerAboveCount || 0) + 1;
            } else {
              engine5bState.sm.triggerAboveCount = 0;
            }

            if (
              engine5bState.sm.triggerAboveCount >=
                engine5bState.config.persistBars &&
              volumeGateOk()
            ) {
              stageSet("TRIGGERED");
              engine5bState.sm.triggeredAtMs = Date.now();

              engine5bState.sm.cooldownUntilMs =
                Date.now() + engine5bState.config.cooldownMs;

              const wasGo = engine5bState.go?.signal === true;
              const triggerLineForGo = Number(engine5bState.sm.triggerLine);

              await setGo({
                direction: "LONG",
                atUtc: nowUtc(),
                price: Number.isFinite(closePx) ? closePx : null,
                reason: "PULLBACK_RECLAIM",
                reasonCodes: [
                  "PB_RECLAIM",
                  "E3_ARMED",
                  "E4_OK",
                  "TRIGGER_LINE_BREAK",
                ],
                triggerType: "PULLBACK_RECLAIM",
                triggerLine: triggerLineForGo,
                cooldownUntilMs: engine5bState.sm.cooldownUntilMs,
              });

              if (!wasGo && engine5bState.go?.signal === true) {
                recordGoOnRisingEdge({
                  backend1Base: BACKEND1_BASE,
                  symbol: "SPY",
                  strategyId: "intraday_scalp@10m",
                  go: engine5bState.go,
                }).catch(() => {});
              }

              engine5bState.sm.lastDecision = `${nowUtc()} GO(PULLBACK_RECLAIM) aboveCount=${engine5bState.sm.triggerAboveCount} cooldownUntilMs=${engine5bState.sm.cooldownUntilMs}`;

              stageSet("COOLDOWN");

              engine5bState.sm.pbState = null;
              engine5bState.sm.impulse1mTime = null;
              engine5bState.sm.impulse1mHigh = null;
              engine5bState.sm.pullback1mTime = null;
              engine5bState.sm.pullbackHigh = null;
              engine5bState.sm.triggerLine = null;
              engine5bState.sm.triggerAboveCount = 0;
            }
          }

          if (
            ARMED_TRIGGER_ENABLED &&
            engine5bState.sm.pbState == null &&
            engine5bState.sm.stage === "ARMED" &&
            isArmedRecent() &&
            !inCooldown() &&
            Number.isFinite(Number(engine5bState.sm.triggerLine))
          ) {
            const triggerLine = Number(engine5bState.sm.triggerLine);

            const above = pullbackReclaimCheck_1s(closePx);
            if (above) {
              engine5bState.sm.triggerAboveCount =
                Number(engine5bState.sm.triggerAboveCount || 0) + 1;
            } else {
              engine5bState.sm.triggerAboveCount = 0;
            }

            if (
              engine5bState.sm.triggerAboveCount >=
                engine5bState.config.persistBars &&
              isFinitePositive(triggerLine) &&
              volumeGateOk()
            ) {
              stageSet("TRIGGERED");
              engine5bState.sm.triggeredAtMs = Date.now();

              engine5bState.sm.cooldownUntilMs =
                Date.now() + engine5bState.config.cooldownMs;

              const wasGo = engine5bState.go?.signal === true;

              await setGo({
                direction: "LONG",
                atUtc: nowUtc(),
                price: Number.isFinite(closePx) ? closePx : null,
                reason: "ARMED_CANDLE_BREAK",
                reasonCodes: [
                  "ARMED_CANDLE_BREAK",
                  "E3_ARMED",
                  "E4_OK",
                  "TRIGGER_LINE_BREAK",
                ],
                triggerType: "ARMED_CANDLE_BREAK",
                triggerLine,
                cooldownUntilMs: engine5bState.sm.cooldownUntilMs,
              });

              if (!wasGo && engine5bState.go?.signal === true) {
                recordGoOnRisingEdge({
                  backend1Base: BACKEND1_BASE,
                  symbol: "SPY",
                  strategyId: "intraday_scalp@10m",
                  go: engine5bState.go,
                }).catch(() => {});
              }

              engine5bState.sm.lastDecision = `${nowUtc()} GO(ARMED_CANDLE_BREAK) aboveCount=${engine5bState.sm.triggerAboveCount} triggerLine=${triggerLine} cooldownUntilMs=${engine5bState.sm.cooldownUntilMs}`;

              stageSet("COOLDOWN");

              engine5bState.sm.triggerLine = null;
              engine5bState.sm.triggerAboveCount = 0;
            }
          }

          if (engine5bState.sm.stage === "COOLDOWN" && !inCooldown()) {
            hardResetToIdle("COOLDOWN_EXPIRED");
          } else {
            recomputeMoveClassification();
          }

          lastClosedSec = sec;
        }
      }
    });

    ws.on("close", () => {
      log("[engine5b] WS closed; reconnecting in 2.5s");
      setTimeout(() => connectWs(), 2500);
    });

    ws.on("error", (err) => {
      log(`[engine5b] WS error: ${err?.message || err}`);
      try {
        ws.close();
      } catch {}
    });
  }

  connectWs();

  return {
    stop() {
      stopped = true;
      try {
        ws?.close?.();
      } catch {}
      if (zoneTimer) clearInterval(zoneTimer);
      if (riskTimer) clearInterval(riskTimer);
      if (e3Timer) clearInterval(e3Timer);
      if (e4Timer) clearInterval(e4Timer);
      log("[engine5b] stopped");
    },
  };
}
