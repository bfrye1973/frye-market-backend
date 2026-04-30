// services/core/logic/engine22ScalpOpportunity.js
// Engine 22 — Scalp Opportunity Engine
// V2: Exhaustion Bounce Long + Exhaustion Rejection Short
// Read-only. Does NOT affect Engine 15 / readiness / trades.

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function absRound2(x) {
  return Number.isFinite(x) ? Math.round(Math.abs(x) * 100) / 100 : null;
}

export function computeEngine22ScalpOpportunity({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  tf = "10m",
  engine16 = null,
} = {}) {
  const base = {
    ok: true,
    engine: "engine22.scalpOpportunity.v2",
    active: false,
    mode: "OBSERVATION_ONLY",
    symbol,
    strategyId,
    tf,

    supportedSetups: {
      exhaustionBounceLong: true,
      exhaustionRejectionShort: true,
    },

    type: "NONE",
    status: "NO_SCALP",
    direction: "NONE",
    side: "NONE",

    targetMove: 1.0,
    stop: null,
    confidence: 0,

    entryZone: null,
    targetZone: null,
    invalidationLevel: null,

    entryTriggerLevel: null,
    distanceToEntry: null,
    needs: "WAIT_FOR_EXHAUSTION_TRIGGER",

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
  const exhaustionPrice = toNum(engine16.exhaustionBarPrice);

  const exhaustionTriggerLong = engine16.exhaustionTriggerLong === true;
  const exhaustionTriggerShort = engine16.exhaustionTriggerShort === true;
  const exhaustionActive = engine16.exhaustionActive === true;

  const hasPrice =
    Number.isFinite(latestClose) &&
    Number.isFinite(exhaustionPrice);

  const hasEma = Number.isFinite(ema10);

  if (!hasPrice) {
    return {
      ...base,
      reasonCodes: ["MISSING_PRICE_OR_EXHAUSTION_LEVEL"],
      debug: {
        latestClose,
        ema10,
        exhaustionPrice,
        exhaustionTriggerLong,
        exhaustionTriggerShort,
        exhaustionActive,
      },
    };
  }

  // ============================================================
  // LONG SETUP
  // Hard selloff → exhaustion long → hold low → reclaim EMA10
  // ============================================================
  if (exhaustionTriggerLong) {
    const holdsLow = latestClose >= exhaustionPrice;

    if (!holdsLow) {
      return {
        ...base,
        reasonCodes: ["LONG_EXHAUSTION_LOW_FAILED"],
        debug: {
          latestClose,
          ema10,
          exhaustionPrice,
          exhaustionTriggerLong,
          exhaustionTriggerShort,
          exhaustionActive,
          holdsLow,
        },
      };
    }

    const reclaimEma10 = hasEma && latestClose > ema10;
    const distanceToEntry = hasEma ? ema10 - latestClose : null;

    const status = reclaimEma10 ? "ENTRY_LONG" : "PROBE_LONG";
    const confidence = reclaimEma10 ? 72 : 65;

    return {
      ...base,
      active: true,
      type: "EXHAUSTION_BOUNCE_LONG",
      status,
      direction: "LONG",
      side: "LONG",

      stop: "below exhaustion low",
      confidence,

      entryZone: {
        lo: round2(exhaustionPrice),
        hi: round2(latestClose),
      },

      targetZone: {
        lo: round2(latestClose + 0.5),
        hi: round2(latestClose + 1.0),
      },

      invalidationLevel: round2(exhaustionPrice),
      entryTriggerLevel: round2(ema10),
      distanceToEntry: reclaimEma10 ? 0 : absRound2(distanceToEntry),
      needs: reclaimEma10 ? "ENTRY_ACTIVE" : "RECLAIM_EMA10",

      reasonCodes: [
        "LONG_EXHAUSTION_TRIGGERED",
        "PRICE_HOLDING_EXHAUSTION_LOW",
        reclaimEma10 ? "EMA10_RECLAIMED" : "WAITING_FOR_EMA10_RECLAIM",
        "OBSERVATION_ONLY",
      ],

      debug: {
        latestClose,
        ema10,
        exhaustionPrice,
        exhaustionTriggerLong,
        exhaustionTriggerShort,
        exhaustionActive,
        holdsLow,
        reclaimEma10,
        distanceToEntry: reclaimEma10 ? 0 : absRound2(distanceToEntry),
      },
    };
  }

  // ============================================================
  // SHORT SETUP
  // Hard push up → exhaustion short → fail high → lose EMA10
  // ============================================================
  if (exhaustionTriggerShort) {
    const failsHigh = latestClose <= exhaustionPrice;

    if (!failsHigh) {
      return {
        ...base,
        reasonCodes: ["SHORT_EXHAUSTION_HIGH_FAILED"],
        debug: {
          latestClose,
          ema10,
          exhaustionPrice,
          exhaustionTriggerLong,
          exhaustionTriggerShort,
          exhaustionActive,
          failsHigh,
        },
      };
    }

    const loseEma10 = hasEma && latestClose < ema10;
    const distanceToEntry = hasEma ? latestClose - ema10 : null;

    const status = loseEma10 ? "ENTRY_SHORT" : "PROBE_SHORT";
    const confidence = loseEma10 ? 72 : 65;

    return {
      ...base,
      active: true,
      type: "EXHAUSTION_REJECTION_SHORT",
      status,
      direction: "SHORT",
      side: "SHORT",

      stop: "above exhaustion high",
      confidence,

      entryZone: {
        lo: round2(latestClose),
        hi: round2(exhaustionPrice),
      },

      targetZone: {
        lo: round2(latestClose - 1.0),
        hi: round2(latestClose - 0.5),
      },

      invalidationLevel: round2(exhaustionPrice),
      entryTriggerLevel: round2(ema10),
      distanceToEntry: loseEma10 ? 0 : absRound2(distanceToEntry),
      needs: loseEma10 ? "ENTRY_ACTIVE" : "LOSE_EMA10",

      reasonCodes: [
        "SHORT_EXHAUSTION_TRIGGERED",
        "PRICE_FAILING_EXHAUSTION_HIGH",
        loseEma10 ? "EMA10_LOST" : "WAITING_FOR_EMA10_LOSS",
        "OBSERVATION_ONLY",
      ],

      debug: {
        latestClose,
        ema10,
        exhaustionPrice,
        exhaustionTriggerLong,
        exhaustionTriggerShort,
        exhaustionActive,
        failsHigh,
        loseEma10,
        distanceToEntry: loseEma10 ? 0 : absRound2(distanceToEntry),
      },
    };
  }

  return {
    ...base,
    reasonCodes: ["NO_EXHAUSTION_SCALP_TRIGGER"],
    debug: {
      latestClose,
      ema10,
      exhaustionPrice,
      exhaustionTriggerLong,
      exhaustionTriggerShort,
      exhaustionActive,
    },
  };
}

export default computeEngine22ScalpOpportunity;
