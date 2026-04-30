// services/core/logic/engine22ScalpOpportunity.js
// Engine 22 — Scalp Opportunity Engine
// V1: Exhaustion Bounce Long ONLY
// Read-only. Does NOT affect Engine 15 / readiness / trades.

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

export function computeEngine22ScalpOpportunity({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  tf = "10m",
  engine16 = null,
} = {}) {
  const base = {
    ok: true,
    engine: "engine22.scalpOpportunity.v1",
    active: false,
    mode: "OBSERVATION_ONLY",
    symbol,
    strategyId,
    tf,
    supportedSetups: {
      exhaustionBounceLong: true,
      exhaustionBounceShort: false,
    },
    type: "NONE",
    status: "NO_SCALP",
    direction: "NONE",
    targetMove: 1.0,
    stop: null,
    confidence: 0,
    entryZone: null,
    targetZone: null,
    invalidationLevel: null,
    reasonCodes: [],
    debug: {},
  };

  if (strategyId !== "intraday_scalp@10m" || tf !== "10m") {
    return {
      ...base,
      reasonCodes: ["ENGINE22_ONLY_ENABLED_FOR_INTRADAY_SCALP_10M"],
    };
  }

  if (!engine16 || engine16.ok !== true) {
    return {
      ...base,
      reasonCodes: ["ENGINE16_UNAVAILABLE"],
    };
  }

  const latestClose = toNum(engine16.latestClose);
  const ema10 = toNum(engine16.ema10);
  const exhaustionLow = toNum(engine16.exhaustionBarPrice);

  const exhaustionTriggerLong = engine16.exhaustionTriggerLong === true;
  const exhaustionActive = engine16.exhaustionActive === true;

  if (!exhaustionTriggerLong) {
    return {
      ...base,
      reasonCodes: ["NO_LONG_EXHAUSTION_TRIGGER"],
      debug: {
        exhaustionTriggerLong,
        exhaustionActive,
        latestClose,
        ema10,
        exhaustionLow,
      },
    };
  }

  if (!Number.isFinite(latestClose) || !Number.isFinite(exhaustionLow)) {
    return {
      ...base,
      reasonCodes: ["MISSING_PRICE_OR_EXHAUSTION_LOW"],
      debug: {
        latestClose,
        ema10,
        exhaustionLow,
      },
    };
  }

  const holdsLow = latestClose >= exhaustionLow;

  if (!holdsLow) {
    return {
      ...base,
      reasonCodes: ["EXHAUSTION_LOW_FAILED"],
      debug: {
        latestClose,
        ema10,
        exhaustionLow,
      },
    };
  }

  const reclaimEma10 =
    Number.isFinite(ema10) &&
    latestClose > ema10;

  const status = reclaimEma10 ? "ENTRY_LONG" : "PROBE_LONG";
  const confidence = reclaimEma10 ? 70 : 65;

  return {
    ...base,
    active: true,
    type: "EXHAUSTION_BOUNCE_LONG",
    status,
    direction: "LONG",
    stop: "below exhaustion low",
    confidence,
    entryZone: {
      lo: round2(exhaustionLow),
      hi: round2(latestClose),
    },
    targetZone: {
      lo: round2(latestClose + 0.5),
      hi: round2(latestClose + 1.0),
    },
    invalidationLevel: round2(exhaustionLow),
    reasonCodes: [
      "LONG_EXHAUSTION_TRIGGERED",
      "PRICE_HOLDING_EXHAUSTION_LOW",
      reclaimEma10 ? "EMA10_RECLAIMED" : "WAITING_FOR_EMA10_RECLAIM",
      "OBSERVATION_ONLY",
    ],
    debug: {
      latestClose,
      ema10,
      exhaustionLow,
      exhaustionTriggerLong,
      exhaustionActive,
      reclaimEma10,
    },
  };
}

export default computeEngine22ScalpOpportunity;
