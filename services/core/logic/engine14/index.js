// services/core/logic/engine14/index.js

import { normalizeBars } from "./normalizeInputs.js";
import { detectCompressionRelease } from "./detectCompressionRelease.js";
import { detectScalpSetup } from "./detectScalpSetup.js";
import {
  fetchBars,
  fetchEngine1Context,
  fetchEngine3,
  fetchEngine4,
  fetchEngine45,
} from "./adapters.js";

function toNum(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeZone(zone, forcedType = null) {
  if (!zone || typeof zone !== "object") return null;

  const lo = toNum(zone.lo);
  const hi = toNum(zone.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;

  const midRaw = toNum(zone.mid, NaN);
  const mid = Number.isFinite(midRaw) ? midRaw : (lo + hi) / 2;

  return {
    id: zone.id || zone.zoneId || "UNKNOWN_ZONE",
    type: forcedType || zone.type || zone.zoneType || "UNKNOWN",
    lo,
    hi,
    mid,
  };
}

function pickNearestByPrice(zones = [], currentPrice, forcedType) {
  if (!Array.isArray(zones) || !zones.length || !Number.isFinite(currentPrice)) {
    return null;
  }

  let best = null;
  let bestDist = Infinity;

  for (const z of zones) {
    const normalized = normalizeZone(z, forcedType);
    if (!normalized) continue;

    const dist = Math.abs(currentPrice - normalized.mid);
    if (dist < bestDist) {
      best = normalized;
      bestDist = dist;
    }
  }

  return best;
}

function resolveZone(engine1) {
  const currentPrice = toNum(engine1?.meta?.current_price, NaN);

  const activeNegotiated = normalizeZone(engine1?.active?.negotiated, "NEGOTIATED");
  const activeShelf = normalizeZone(engine1?.active?.shelf, "SHELF");
  const activeInstitutional = normalizeZone(engine1?.active?.institutional, "INSTITUTIONAL");

  const nearestShelf = normalizeZone(engine1?.nearest?.shelf, "SHELF");
  const nearestNegotiated = normalizeZone(engine1?.nearest?.negotiated, "NEGOTIATED");
  const nearestInstitutional = normalizeZone(engine1?.nearest?.institutional, "INSTITUTIONAL");

  const renderNegotiated = Array.isArray(engine1?.render?.negotiated)
    ? engine1.render.negotiated
    : [];
  const renderInstitutional = Array.isArray(engine1?.render?.institutional)
    ? engine1.render.institutional
    : [];
  const renderShelves = Array.isArray(engine1?.render?.shelves)
    ? engine1.render.shelves
    : [];

  const fallbackNegotiated = pickNearestByPrice(
    renderNegotiated,
    currentPrice,
    "NEGOTIATED"
  );
  const fallbackInstitutional = pickNearestByPrice(
    renderInstitutional,
    currentPrice,
    "INSTITUTIONAL"
  );
  const fallbackShelf = pickNearestByPrice(renderShelves, currentPrice, "SHELF");

  return (
    activeNegotiated ||
    activeShelf ||
    activeInstitutional ||
    nearestNegotiated ||
    nearestShelf ||
    nearestInstitutional ||
    fallbackNegotiated ||
    fallbackShelf ||
    fallbackInstitutional ||
    null
  );
}

function buildMomentumPayload(engine45) {
  const smi10m = engine45?.smi10m || engine45?.momentum?.smi10m || {};
  const smi1h = engine45?.smi1h || engine45?.momentum?.smi1h || {};

  const smiSeries10m =
    engine45?.smiSeries10m ||
    engine45?.series?.smi10m ||
    engine45?.momentum?.smiSeries10m ||
    [];

  const compression =
    engine45?.compression ||
    engine45?.momentum?.compression ||
    detectCompressionRelease(smiSeries10m);

  return {
    smi10m,
    smi1h,
    alignment: engine45?.alignment || engine45?.momentum?.alignment || "UNKNOWN",
    compression,
    raw: engine45,
  };
}

function normalizeEngine3(engine3Raw) {
  return {
    stage: engine3Raw?.stage || "IDLE",
    armed: Boolean(engine3Raw?.armed),
    reactionScore: toNum(engine3Raw?.reactionScore, 0),
    structureState: engine3Raw?.structureState || "UNKNOWN",
    controlCandle: engine3Raw?.controlCandle || "UNKNOWN",
  };
}

function normalizeEngine4(engine4Raw) {
  return {
    volumeScore: toNum(engine4Raw?.volumeScore, 0),
    pressureBias: engine4Raw?.pressureBias || "UNKNOWN",
    flags: engine4Raw?.flags || {
      reversalExpansion: Boolean(engine4Raw?.reversalExpansion),
      pullbackContraction: Boolean(engine4Raw?.pullbackContraction),
      initiativeMoveConfirmed: Boolean(engine4Raw?.initiativeMoveConfirmed),
      absorptionDetected: Boolean(engine4Raw?.absorptionDetected),
      distributionDetected: Boolean(engine4Raw?.distributionDetected),
      liquidityTrap: Boolean(engine4Raw?.liquidityTrap),
    },
  };
}

export async function computeEngine14({ symbol = "SPY" } = {}) {
  const [bars10mRaw, bars1hRaw, engine1Raw, engine45Raw] = await Promise.all([
    fetchBars(symbol, "10m", 120),
    fetchBars(symbol, "1h", 120),
    fetchEngine1Context(symbol),
    fetchEngine45(symbol),
  ]);

  const bars10m = normalizeBars(bars10mRaw);
  const bars1h = normalizeBars(bars1hRaw);

  if (bars10m.length < 5 || bars1h.length < 5) {
    throw new Error("ENGINE14_INSUFFICIENT_BARS");
  }

  const zone = resolveZone(engine1Raw);
  if (!zone) {
    throw new Error("ENGINE14_NO_ZONE");
  }

  const lastPrice = toNum(bars10m[bars10m.length - 1]?.close, NaN);
  if (!Number.isFinite(lastPrice)) {
    throw new Error("ENGINE14_NO_LAST_PRICE");
  }

  const [engine3Raw, engine4Raw] = await Promise.all([
    fetchEngine3(symbol, zone),
    fetchEngine4(symbol, zone),
  ]);

  const engine3 = normalizeEngine3(engine3Raw);
  const engine4 = normalizeEngine4(engine4Raw);
  const momentum = buildMomentumPayload(engine45Raw);

  const result = detectScalpSetup({
    symbol,
    bars10m,
    bars1h,
    zone,
    price: lastPrice,
    engine3,
    engine4,
    momentum,
  });

  return {
    ...result,
    asOf: new Date().toISOString(),
    tfPrimary: "10m",
    tfBias: "1h",
  };
}
