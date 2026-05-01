// services/core/logic/engine22ScalpOpportunity.js
// Engine 22 — Scalp Opportunity Engine
// V3: Engine16 exhaustion + Engine3B quality + R:R + ATH/extension target
// Read-only. Does NOT affect Engine 15 / lifecycle / trades.

import { logEngine22Alert } from "./engine22AlertLogger.js";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function validPrice(x) {
  const n = toNum(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(x) {
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function safeBool(x) {
  return x === true;
}

function normalizeScore(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function getReactionInputs(reaction, waveReactionFromArg) {
  const waveReaction =
    waveReactionFromArg ||
    reaction?.waveReaction ||
    null;

  return {
    reactionScore: normalizeScore(reaction?.reactionScore),
    structureState: reaction?.structureState || null,
    reasonCodes: Array.isArray(reaction?.reasonCodes) ? reaction.reasonCodes : [],
    waveReaction,
  };
}

function gradeReactionQuality({ side, reactionScore, waveReaction }) {
  const wr = waveReaction || {};
  const evidence = Array.isArray(wr.evidence) ? wr.evidence : [];

  const momentumFading = safeBool(wr.momentumFading);
  const failedContinuation = safeBool(wr.failedContinuation);

  let score = 0;
  const reasons = [];

  if (reactionScore >= 4) {
    score += 20;
    reasons.push("ENGINE3_REACTION_SCORE_OK");
  }

  if (momentumFading) {
    score += 20;
    reasons.push("MOMENTUM_FADING");
  }

  if (side === "LONG") {
    if (safeBool(wr.accumulationWarning)) {
      score += 25;
      reasons.push("ACCUMULATION_WARNING");
    }
    if (safeBool(wr.sellerAbsorption)) {
      score += 25;
      reasons.push("SELLER_ABSORPTION");
    }
    if (safeBool(wr.acceptedAtLows)) {
      score += 10;
      reasons.push("ACCEPTED_AT_LOWS");
    }
  }

  if (side === "SHORT") {
    if (safeBool(wr.distributionWarning)) {
      score += 25;
      reasons.push("DISTRIBUTION_WARNING");
    }
    if (safeBool(wr.buyerAbsorption)) {
      score += 25;
      reasons.push("BUYER_ABSORPTION");
    }
    if (safeBool(wr.acceptedAtHighs)) {
      score += 10;
      reasons.push("ACCEPTED_AT_HIGHS");
    }
    if (safeBool(wr.extensionRisk)) {
      score += 10;
      reasons.push("EXTENSION_RISK");
    }
  }

  if (failedContinuation) {
    score -= 20;
    reasons.push("FAILED_CONTINUATION_RISK");
  }

  score = Math.max(0, Math.min(100, score));

  const grade =
    score >= 85 ? "A++" :
    score >= 75 ? "A" :
    score >= 60 ? "B" :
    score >= 45 ? "C" :
    "WEAK";

  return {
    score,
    grade,
    pass: score >= 60,
    aPlusPlus: score >= 85,
    reactionState: wr.reactionState || null,
    reactionQualityScore: wr.reactionQualityScore ?? null,
    traderMessage: wr.traderMessage || null,
    evidence,
    reasons,
  };
}

function buildRiskPlan({ side, entry, exhaustionPrice, targetMove = 1 }) {
  const entryPx = validPrice(entry);
  const exPx = validPrice(exhaustionPrice);

  if (!entryPx || !exPx) {
    return {
      pass: false,
      grade: "INVALID",
      reason: "MISSING_ENTRY_OR_STOP",
      entry: round2(entryPx),
      stop: round2(exPx),
      target: null,
      riskAmount: null,
      rewardAmount: null,
      riskReward: null,
      minRequired: 2,
      targetSource: "UNAVAILABLE",
    };
  }

  const stop = exPx;
  const riskAmount = Math.abs(entryPx - stop);

  if (!Number.isFinite(riskAmount) || riskAmount <= 0) {
    return {
      pass: false,
      grade: "INVALID",
      reason: "INVALID_RISK",
      entry: round2(entryPx),
      stop: round2(stop),
      target: null,
      riskAmount: round2(riskAmount),
      rewardAmount: null,
      riskReward: null,
      minRequired: 2,
      targetSource: "UNAVAILABLE",
    };
  }

  const rewardTarget = Math.max(Number(targetMove || 1), riskAmount * 2);
  const target =
    side === "LONG"
      ? entryPx + rewardTarget
      : entryPx - rewardTarget;

  const rewardAmount = Math.abs(target - entryPx);
  const riskReward = rewardAmount / riskAmount;

  const pass = riskReward >= 2;

  return {
    pass,
    grade:
      riskReward >= 3 ? "A++" :
      riskReward >= 2 ? "A" :
      riskReward >= 1.9 ? "NEAR_PASS" :
      "FAIL",
    reason: pass ? "RISK_REWARD_PASS" : "RISK_REWARD_BELOW_2R",
    entry: round2(entryPx),
    stop: round2(stop),
    target: round2(target),
    riskAmount: round2(riskAmount),
    rewardAmount: round2(rewardAmount),
    riskReward: round2(riskReward),
    minRequired: 2,
    targetSource: "BLUE_SKY_EXTENSION",
    exitRule: side === "LONG" ? "CLOSE_BELOW_EMA10_10M" : "CLOSE_ABOVE_EMA10_10M",
  };
}

function buildManagement({ side, latestClose, ema10 }) {
  const close = validPrice(latestClose);
  const ema = validPrice(ema10);

  if (!close || !ema) {
    return {
      exitRule: side === "LONG" ? "CLOSE_BELOW_EMA10_10M" : "CLOSE_ABOVE_EMA10_10M",
      ema10: round2(ema),
      trendActive: false,
      exitSignal: false,
      reason: "EMA10_UNAVAILABLE",
    };
  }

  if (side === "LONG") {
    return {
      exitRule: "CLOSE_BELOW_EMA10_10M",
      ema10: round2(ema),
      trendActive: close >= ema,
      exitSignal: close < ema,
      reason: close >= ema ? "LONG_RUNNER_ABOVE_EMA10" : "LONG_EXIT_BELOW_EMA10",
    };
  }

  return {
    exitRule: "CLOSE_ABOVE_EMA10_10M",
    ema10: round2(ema),
    trendActive: close <= ema,
    exitSignal: close > ema,
    reason: close <= ema ? "SHORT_RUNNER_BELOW_EMA10" : "SHORT_EXIT_ABOVE_EMA10",
  };
}
function computeMarketBias({ engine2State, engine16, marketMind }) {
  const minutePhase = engine2State?.minute?.phase;
  const primary = engine2State?.primaryPhase;
  const intermediate = engine2State?.intermediatePhase;
  const minor = engine2State?.minorPhase;

  const hourlyClose = engine16?.hourlyClose;
  const ema10_1h = engine16?.ema10_1h;

  const score1h = marketMind?.score1h;
  const score4h = marketMind?.score4h;
  const scoreEOD = marketMind?.scoreEOD;

  const longWave =
    ["IN_W3", "IN_W5"].includes(primary) &&
    ["IN_W3", "IN_W5"].includes(intermediate) &&
    ["IN_W3", "IN_W5"].includes(minor) &&
    ["IN_W3", "IN_W5"].includes(minutePhase);

  const longTrend =
    hourlyClose > ema10_1h &&
    score1h > 55 &&
    score4h > 58 &&
    scoreEOD > 61;

  const shortTrend =
    hourlyClose < ema10_1h &&
    score1h < 55 &&
    score4h < 58 &&
    scoreEOD < 61;

  if (longWave && longTrend) {
    return {
      bias: "LONG_ONLY_DIP_BUY",
      blockShorts: true,
      allowLongs: true,
      reason: "W3_W5_BULLISH_STRUCTURE"
    };
  }

  if (shortTrend) {
    return {
      bias: "SHORT_ONLY_RIP_SELL",
      blockShorts: false,
      allowLongs: false,
      reason: "WEAK_MARKET_STRUCTURE"
    };
  }

  return {
    bias: "NEUTRAL",
    blockShorts: false,
    allowLongs: false,
    reason: "NO_CLEAR_STRUCTURE"
  };
}
function logEntryIfNeeded({
  symbol,
  strategyId,
  tf,
  type,
  status,
  direction,
  price,
  confidence,
  targetMove,
  invalidationLevel,
}) {
  if (status !== "ENTRY_LONG" && status !== "ENTRY_SHORT") return;

  logEngine22Alert({
    symbol,
    strategyId,
    tf,
    type,
    status,
    direction,
    price,
    confidence,
    targetMove,
    invalidationLevel,
    triggeredAt: new Date().toISOString(),
  });
}

export function computeEngine22ScalpOpportunity({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  tf = "10m",
  engine16 = null,
  reaction = null,
  waveReaction = null,
} = {}) {
  const base = {
    ok: true,
    engine: "engine22.scalpOpportunity.v3",
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

    quality: null,
    risk: null,
    management: null,

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

  const marketBias = computeMarketBias({
  engine2State,
  engine16,
  marketMind
});
  
  const latestClose = validPrice(engine16.latestClose);
  const ema10 = validPrice(engine16.ema10);
  const ema20 = validPrice(engine16.ema20);

  const continuationWatchLong = engine16?.continuationWatchLong === true;
  const continuationTriggerLong = engine16?.continuationTriggerLong === true;
  const exhaustionPrice = validPrice(engine16.exhaustionBarPrice);

  const exhaustionTriggerLong = engine16.exhaustionTriggerLong === true;
  const exhaustionTriggerShort = engine16.exhaustionTriggerShort === true;
  const exhaustionActive = engine16.exhaustionActive === true;

  const {
    reactionScore,
    structureState,
    reasonCodes: engine3ReasonCodes,
    waveReaction: wr,
  } = getReactionInputs(reaction, waveReaction);

  if (!latestClose) {
    return {
      ...base,
      marketBias,
      reasonCodes: ["NO_EXHAUSTION_SCALP_TRIGGER"],
      debug: {
        latestClose,
        ema10,
        exhaustionPrice,
        exhaustionTriggerLong,
        exhaustionTriggerShort,
        exhaustionActive,
        reactionScore,
        structureState,
        hasWaveReaction: !!wr,
      },
    };
  }
  if (!latestClose || !exhaustionPrice) {
  return {
    ...base,
    marketBias,
    reasonCodes: ["NO_EXHAUSTION_SCALP_TRIGGER"],
    debug: {...}
  };
}

// 👇 ADD THIS HERE (THIS IS STEP 2)

// ===============================
// CONTINUATION DIP BUY LOGIC
// ===============================
if (
  marketBias?.bias === "LONG_ONLY_DIP_BUY" &&
  continuationWatchLong
) {
  const pulledBack =
    latestClose <= ema10 || latestClose <= ema20;

  const reclaimed =
    latestClose > ema10;

  if (pulledBack && !reclaimed) {
    return {
      ...base,
      active: true,
      type: "DIP_BUY_WATCH",
      status: "WATCH_LONG",
      direction: "LONG",
      side: "LONG",
      marketBias,
      reasonCodes: [
        "DIP_PULLBACK_DETECTED",
        "WAIT_FOR_RECLAIM"
      ],
      debug: {
        latestClose,
        ema10,
        ema20,
        pulledBack,
        reclaimed
      }
    };
  }

  if (continuationTriggerLong) {
    const confidence = 80;

    logEntryIfNeeded({
      symbol,
      strategyId,
      tf,
      type: "DIP_BUY_CONTINUATION",
      status: "ENTRY_LONG",
      direction: "LONG",
      price: latestClose,
      confidence,
      targetMove: base.targetMove,
      invalidationLevel: ema20,
    });

    return {
      ...base,
      active: true,
      type: "DIP_BUY_CONTINUATION",
      status: "ENTRY_LONG",
      direction: "LONG",
      side: "LONG",
      marketBias,
      confidence,
      reasonCodes: [
        "DIP_BUY_CONFIRMED",
        "EMA_RECLAIM",
        "BREAK_MICRO_HIGH"
      ],
      debug: {
        latestClose,
        ema10,
        ema20,
        continuationTriggerLong
      }
    };
  }
} 
  // ============================================================
  // LONG: exhaustion bounce from low
  // ============================================================
  if (exhaustionTriggerLong) {
    const side = "LONG";
    const holdsLow = latestClose >= exhaustionPrice;

    if (!holdsLow) {
      return {
        ...base,
        reasonCodes: ["LONG_EXHAUSTION_LOW_FAILED"],
        debug: {
          latestClose,
          ema10,
          exhaustionPrice,
          holdsLow,
          reactionScore,
          structureState,
        },
      };
    }

    const quality = gradeReactionQuality({ side, reactionScore, waveReaction: wr });

    const risk = buildRiskPlan({
      side,
      entry: latestClose,
      exhaustionPrice,
      targetMove: base.targetMove,
    });

    const management = buildManagement({ side, latestClose, ema10 });

    const qualityPass = quality.pass;
    const riskPass = risk.pass;

    const status = qualityPass && riskPass ? "ENTRY_LONG" : "PROBE_LONG";

    const confidence = Math.min(
      95,
      Math.max(
        50,
        50 +
          Math.round((quality.score || 0) * 0.3) +
          (riskPass ? 10 : 0) +
          (management.trendActive ? 5 : 0)
      )
    );

    logEntryIfNeeded({
      symbol,
      strategyId,
      tf,
      type: "EXHAUSTION_BOUNCE_LONG",
      status,
      direction: "LONG",
      price: latestClose,
      confidence,
      targetMove: base.targetMove,
      invalidationLevel: exhaustionPrice,
    });

    return {
      ...base,
      active: true,
      type: "EXHAUSTION_BOUNCE_LONG",
      status,
      direction: "LONG",
      side,
      marketBias,

      stop: "below exhaustion low",
      confidence,

      entryZone: {
        lo: round2(exhaustionPrice),
        hi: round2(latestClose),
      },

      targetZone: {
        lo: round2(risk?.target),
        hi: round2(risk?.target),
      },

      invalidationLevel: round2(exhaustionPrice),
      entryTriggerLevel: null,
      distanceToEntry: null,

      needs:
        status === "ENTRY_LONG"
          ? "ENTRY_ACTIVE"
          : !qualityPass
          ? "BETTER_ENGINE3_REACTION_QUALITY"
          : !riskPass
          ? "BETTER_RISK_REWARD"
          : "WAIT",

      quality,
      risk,
      management,

      reasonCodes: [
        "LONG_EXHAUSTION_TRIGGERED",
        "PRICE_HOLDING_EXHAUSTION_LOW",
        qualityPass ? "ENGINE3_QUALITY_PASS" : "ENGINE3_QUALITY_WEAK",
        riskPass ? "RISK_REWARD_PASS" : "RISK_REWARD_FAIL",
        "EMA10_USED_FOR_MANAGEMENT_NOT_ENTRY",
        "OBSERVATION_ONLY",
      ],

      debug: {
        latestClose,
        ema10,
        exhaustionPrice,
        exhaustionTriggerLong,
        exhaustionTriggerShort,
        exhaustionActive,
        reactionScore,
        structureState,
        engine3ReasonCodes,
        holdsLow,
      },
    };
  }

  // ============================================================
  // SHORT: exhaustion rejection from high
  // ============================================================
  if (exhaustionTriggerShort) {
    const side = "SHORT";
    const failsHigh = latestClose <= exhaustionPrice;

    if (!failsHigh) {
      return {
        ...base,
        reasonCodes: ["SHORT_EXHAUSTION_HIGH_FAILED"],
        debug: {
          latestClose,
          ema10,
          exhaustionPrice,
          failsHigh,
          reactionScore,
          structureState,
        },
      };
    }

    const quality = gradeReactionQuality({ side, reactionScore, waveReaction: wr });

    const risk = buildRiskPlan({
      side,
      entry: latestClose,
      exhaustionPrice,
      targetMove: base.targetMove,
    });

    const management = buildManagement({ side, latestClose, ema10 });

    const qualityPass = quality.pass;
    const riskPass = risk.pass;

    const status = qualityPass && riskPass ? "ENTRY_SHORT" : "PROBE_SHORT";

    const confidence = Math.min(
      95,
      Math.max(
        50,
        50 +
          Math.round((quality.score || 0) * 0.3) +
          (riskPass ? 10 : 0) +
          (management.trendActive ? 5 : 0)
      )
    );

    logEntryIfNeeded({
      symbol,
      strategyId,
      tf,
      type: "EXHAUSTION_REJECTION_SHORT",
      status,
      direction: "SHORT",
      price: latestClose,
      confidence,
      targetMove: base.targetMove,
      invalidationLevel: exhaustionPrice,
    });

    return {
      ...base,
      active: true,
      type: "EXHAUSTION_REJECTION_SHORT",
      status,
      direction: "SHORT",
      side,

      stop: "above exhaustion high",
      confidence,

      entryZone: {
        lo: round2(latestClose),
        hi: round2(exhaustionPrice),
      },

      targetZone: {
        lo: round2(risk?.target),
        hi: round2(risk?.target),
      },

      invalidationLevel: round2(exhaustionPrice),
      entryTriggerLevel: null,
      distanceToEntry: null,

      needs:
        status === "ENTRY_SHORT"
          ? "ENTRY_ACTIVE"
          : !qualityPass
          ? "BETTER_ENGINE3_REACTION_QUALITY"
          : !riskPass
          ? "BETTER_RISK_REWARD"
          : "WAIT",

      quality,
      risk,
      management,

      reasonCodes: [
        "SHORT_EXHAUSTION_TRIGGERED",
        "PRICE_FAILING_EXHAUSTION_HIGH",
        qualityPass ? "ENGINE3_QUALITY_PASS" : "ENGINE3_QUALITY_WEAK",
        riskPass ? "RISK_REWARD_PASS" : "RISK_REWARD_FAIL",
        "EMA10_USED_FOR_MANAGEMENT_NOT_ENTRY",
        "OBSERVATION_ONLY",
      ],

      debug: {
        latestClose,
        ema10,
        exhaustionPrice,
        exhaustionTriggerLong,
        exhaustionTriggerShort,
        exhaustionActive,
        reactionScore,
        structureState,
        engine3ReasonCodes,
        failsHigh,
      },
    };
  }

  return {
    ...base,
    marketBias,
    reasonCodes: ["NO_EXHAUSTION_SCALP_TRIGGER"],
    debug: {
      latestClose,
      ema10,
      exhaustionPrice,
      exhaustionTriggerLong,
      exhaustionTriggerShort,
      exhaustionActive,
      reactionScore,
      structureState,
      hasWaveReaction: !!wr,
    },
  };
}

export default computeEngine22ScalpOpportunity;
