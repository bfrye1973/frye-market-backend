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

function resolveZone(engine1) {
  const zone =
    engine1?.activeNegotiated ||
    engine1?.activeZone ||
    engine1?.zone ||
    engine1?.analysis?.activeZone ||
    null;

  if (!zone) return null;

  return {
    id: zone.id || zone.zoneId || "UNKNOWN_ZONE",
    type: zone.type || zone.zoneType || "NEGOTIATED",
    lo: Number(zone.lo),
    hi: Number(zone.hi),
    mid: Number.isFinite(Number(zone.mid)) ? Number(zone.mid) : undefined,
  };
}

function buildMomentumPayload(engine45) {
  const smi10m =
    engine45?.smi10m ||
    engine45?.momentum?.smi10m ||
    {};

  const smi1h =
    engine45?.smi1h ||
    engine45?.momentum?.smi1h ||
    {};

  const smiSeries10m =
    engine45?.smiSeries10m ||
    engine45?.series?.smi10m ||
    [];

  const compression =
    engine45?.compression ||
    detectCompressionRelease(smiSeries10m);

  return {
    smi10m,
    smi1h,
    alignment: engine45?.alignment || engine45?.momentum?.alignment || "UNKNOWN",
    compression,
    raw: engine45,
  };
}

export async function computeEngine14({ symbol = "SPY" }) {
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

  const lastPrice = Number(bars10m[bars10m.length - 1]?.close);

  const [engine3Raw, engine4Raw] = await Promise.all([
    fetchEngine3(symbol, zone),
    fetchEngine4(symbol, zone),
  ]);

  const engine3 = {
    stage: engine3Raw?.stage || "IDLE",
    armed: Boolean(engine3Raw?.armed),
    reactionScore: Number(engine3Raw?.reactionScore || 0),
    structureState: engine3Raw?.structureState || "UNKNOWN",
    controlCandle: engine3Raw?.controlCandle || "UNKNOWN",
  };

  const engine4 = {
    volumeScore: Number(engine4Raw?.volumeScore || 0),
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
