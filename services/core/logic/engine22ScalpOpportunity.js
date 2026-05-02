// services/core/logic/engine22ScalpOpportunity.js
// Engine 22 — Scalp Opportunity Engine
// V5: Minute wave-aware scalp execution
//
// Core rules:
// - Minute W3 = normal dip-buy scalps allowed
// - Minute W5 = normal dip-buy scalps allowed
// - Minute W2 = blind dip buys blocked
// - Minute W4 = blind dip buys blocked
// - W2 complete + W3 trigger = long entry allowed
// - W4 complete + W5 trigger = long entry allowed
//
// Read-only. Does NOT affect Engine 15 / lifecycle / trades directly.

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

function isImpulsePhase(x) {
  return x === "IN_W3" || x === "IN_W5";
}

function isCorrectionPhase(x) {
  return x === "IN_W2" || x === "IN_W4";
}

function getMinutePhase(engine2State) {
  // Engine 2 confirmed:
  // Use minute.phase first.
  // Then minutePhase.
  // Do NOT fallback to minorPhase for minute decisions.
  return (
    engine2State?.minute?.phase ||
    engine2State?.minutePhase ||
    "UNKNOWN"
  );
}

function getWavePhases(engine2State) {
  return {
    primaryPhase:
      engine2State?.primaryPhase ||
      engine2State?.primary?.phase ||
      "UNKNOWN",

    intermediatePhase:
      engine2State?.intermediatePhase ||
      engine2State?.intermediate?.phase ||
      "UNKNOWN",

    minorPhase:
      engine2State?.minorPhase ||
      engine2State?.minor?.phase ||
      "UNKNOWN",

    minutePhase: getMinutePhase(engine2State),

    confirmedMinutePhase:
      engine2State?.minute?.confirmedPhase ||
      "UNKNOWN",
  };
}

function isBullishFinalImpulseContext({ primaryPhase, intermediatePhase, minorPhase }) {
  return (
    primaryPhase === "IN_W5" &&
    intermediatePhase === "IN_W5" &&
    minorPhase === "IN_W5"
  );
}

function isBullishHigherWaveContext({ primaryPhase, intermediatePhase, minorPhase }) {
  return (
    isImpulsePhase(primaryPhase) &&
    isImpulsePhase(intermediatePhase) &&
    isImpulsePhase(minorPhase)
  );
}

function getReactionInputs(reaction, waveReactionFromArg) {
  const waveReaction = waveReactionFromArg || reaction?.waveReaction || null;

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
  const target = side === "LONG" ? entryPx + rewardTarget : entryPx - rewardTarget;

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
  const phases = getWavePhases(engine2State);
  const {
    primaryPhase,
    intermediatePhase,
    minorPhase,
    minutePhase,
  } = phases;

  const finalImpulseContext = isBullishFinalImpulseContext({
    primaryPhase,
    intermediatePhase,
    minorPhase,
  });

  const bullishHigherWaveContext = isBullishHigherWaveContext({
    primaryPhase,
    intermediatePhase,
    minorPhase,
  });

  const minuteAllowsDipBuy =
    minutePhase === "IN_W3" ||
    minutePhase === "IN_W5";

  const minuteBlocksDipBuy =
    minutePhase === "IN_W2" ||
    minutePhase === "IN_W4";

  const hourlyClose = validPrice(engine16?.hourlyClose);
  const ema10_1h = validPrice(engine16?.ema10_1h);

  const score1h = toNum(
    marketMind?.score1h ??
    marketMind?.oneHourScore
  );

  const score4h = toNum(
    marketMind?.score4h ??
    marketMind?.fourHourScore
  );

  const scoreEOD = toNum(
    marketMind?.scoreEOD ??
    marketMind?.masterScore ??
    marketMind?.eodScore
  );

  const longTrend =
    hourlyClose !== null &&
    ema10_1h !== null &&
    score1h !== null &&
    score4h !== null &&
    scoreEOD !== null &&
    hourlyClose > ema10_1h &&
    score1h > 55 &&
    score4h > 58 &&
    scoreEOD > 61;

  const shortTrend =
    hourlyClose !== null &&
    ema10_1h !== null &&
    score1h !== null &&
    score4h !== null &&
    scoreEOD !== null &&
    hourlyClose < ema10_1h &&
    score1h < 55 &&
    score4h < 58 &&
    scoreEOD < 61;

  if (bullishHigherWaveContext && minuteAllowsDipBuy && longTrend) {
    return {
      bias: "LONG_ONLY_DIP_BUY",
      blockShorts: true,
      blockLongs: false,
      allowLongs: true,
      allowShorts: false,
      reason: "W3_W5_BULLISH_STRUCTURE",
      inputs: {
        ...phases,
        hourlyClose: round2(hourlyClose),
        ema10_1h: round2(ema10_1h),
        score1h,
        score4h,
        scoreEOD,
        minuteAllowsDipBuy,
        minuteBlocksDipBuy,
      },
    };
  }

  if (finalImpulseContext && minuteBlocksDipBuy) {
    return {
      bias: "FINAL_IMPULSE_NO_SHORTS",
      blockShorts: true,
      blockLongs: true,
      allowLongs: false,
      allowShorts: false,
      reason: "MINUTE_W2_W4_CORRECTION_INSIDE_FINAL_IMPULSE",
      inputs: {
        ...phases,
        hourlyClose: round2(hourlyClose),
        ema10_1h: round2(ema10_1h),
        score1h,
        score4h,
        scoreEOD,
        minuteAllowsDipBuy,
        minuteBlocksDipBuy,
      },
    };
  }

  if (finalImpulseContext) {
    return {
      bias: "FINAL_IMPULSE_NO_SHORTS",
      blockShorts: true,
      blockLongs: false,
      allowLongs: false,
      allowShorts: false,
      reason: "PRIMARY_INTERMEDIATE_MINOR_W5_BLOCK_SHORTS",
      inputs: {
        ...phases,
        hourlyClose: round2(hourlyClose),
        ema10_1h: round2(ema10_1h),
        score1h,
        score4h,
        scoreEOD,
        minuteAllowsDipBuy,
        minuteBlocksDipBuy,
      },
    };
  }

  if (shortTrend && !finalImpulseContext) {
    return {
      bias: "SHORT_ONLY_RIP_SELL",
      blockShorts: false,
      blockLongs: true,
      allowLongs: false,
      allowShorts: true,
      reason: "ALL_MAJOR_SCORES_WEAK_AND_1H_BELOW_EMA10",
      inputs: {
        ...phases,
        hourlyClose: round2(hourlyClose),
        ema10_1h: round2(ema10_1h),
        score1h,
        score4h,
        scoreEOD,
        minuteAllowsDipBuy,
        minuteBlocksDipBuy,
      },
    };
  }

  return {
    bias: "NEUTRAL",
    blockShorts: false,
    blockLongs: false,
    allowLongs: false,
    allowShorts: false,
    reason: "NO_CLEAR_STRUCTURE",
    inputs: {
      ...phases,
      hourlyClose: round2(hourlyClose),
      ema10_1h: round2(ema10_1h),
      score1h,
      score4h,
      scoreEOD,
      minuteAllowsDipBuy,
      minuteBlocksDipBuy,
    },
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

function getCorrectionLevels({ engine2State, setup }) {
  const minute = engine2State?.minute || {};

  if (setup === "W2_TO_W3_LONG") {
    const w2Low =
      validPrice(minute?.w2Low) ??
      validPrice(minute?.cLow) ??
      validPrice(minute?.supportLevel) ??
      validPrice(minute?.invalidationLevel);

    const bHigh =
      validPrice(minute?.bHigh) ??
      validPrice(minute?.lowerHighLevel) ??
      validPrice(minute?.continuationLevel);

    return {
      correctionLow: w2Low,
      triggerLevel: bHigh,
      correctionLowName: "w2Low",
      triggerLevelName: "bHigh",
    };
  }

  if (setup === "W4_TO_W5_LONG") {
    const w4Low =
      validPrice(minute?.w4Low) ??
      (
        minute?.lastMark?.key === "W4"
          ? validPrice(minute?.lastMark?.p)
          : null
      ) ??
      validPrice(minute?.cLow) ??
      validPrice(minute?.supportLevel) ??
      validPrice(minute?.invalidationLevel);

    const bHigh =
      validPrice(minute?.bHigh) ??
      validPrice(minute?.lowerHighLevel) ??
      validPrice(minute?.continuationLevel);

    return {
      correctionLow: w4Low,
      triggerLevel: bHigh,
      correctionLowName: "w4Low",
      triggerLevelName: "bHigh",
    };
  }

  return {
    correctionLow: null,
    triggerLevel: null,
    correctionLowName: null,
    triggerLevelName: null,
  };
}

function detectCorrectionToImpulseLong({
  setup,
  engine2State,
  engine16,
  marketBias,
  latestClose,
  ema10,
  ema20,
}) {
  const phases = getWavePhases(engine2State);
  const {
    primaryPhase,
    intermediatePhase,
    minorPhase,
    minutePhase,
    confirmedMinutePhase,
  } = phases;

  const bullishHigherWaveContext = isBullishHigherWaveContext({
    primaryPhase,
    intermediatePhase,
    minorPhase,
  });

  const requiredMinutePhase =
    setup === "W2_TO_W3_LONG" ? "IN_W2" :
    setup === "W4_TO_W5_LONG" ? "IN_W4" :
    null;

  const nextImpulse =
    setup === "W2_TO_W3_LONG" ? "W3" :
    setup === "W4_TO_W5_LONG" ? "W5" :
    "UNKNOWN";

  const readyState =
    setup === "W2_TO_W3_LONG" ? "W3_READY" :
    setup === "W4_TO_W5_LONG" ? "W5_READY" :
    "READY";

  const triggerState =
    setup === "W2_TO_W3_LONG" ? "W3_TRIGGER_LONG" :
    setup === "W4_TO_W5_LONG" ? "W5_TRIGGER_LONG" :
    "TRIGGER_LONG";

  const activeWaitType =
    setup === "W2_TO_W3_LONG" ? "W2_ACTIVE_WAIT" :
    setup === "W4_TO_W5_LONG" ? "W4_ACTIVE_WAIT" :
    "CORRECTION_ACTIVE_WAIT";

  const waitNeed =
    setup === "W2_TO_W3_LONG" ? "WAIT_FOR_W3_TRIGGER" :
    setup === "W4_TO_W5_LONG" ? "WAIT_FOR_W5_TRIGGER" :
    "WAIT_FOR_TRIGGER";

  if (!requiredMinutePhase || minutePhase !== requiredMinutePhase) {
    return {
      active: false,
      setupType: "NONE",
      reasonCodes: ["NOT_REQUIRED_MINUTE_PHASE"],
    };
  }

  const {
    correctionLow,
    triggerLevel,
    correctionLowName,
    triggerLevelName,
  } = getCorrectionLevels({ engine2State, setup });

  const close = validPrice(latestClose);
  const e10 = validPrice(ema10);
  const e20 = validPrice(ema20);

  const prevClose =
    validPrice(engine16?.previousClose) ??
    validPrice(engine16?.prevClose) ??
    null;

  const correctionLowHeld =
    correctionLow !== null &&
    close !== null &&
    close >= correctionLow * 0.995;

  const reclaimedEma10 =
    close !== null &&
    e10 !== null &&
    (
      prevClose !== null
        ? prevClose <= e10 && close > e10
        : close > e10
    );

  const aboveEma20 =
    close !== null &&
    e20 !== null &&
    close > e20;

  const brokeTriggerLevel =
    close !== null &&
    triggerLevel !== null &&
    close > triggerLevel;

  const missingLevels = [];
  if (correctionLow === null) missingLevels.push(correctionLowName || "correctionLow");
  if (triggerLevel === null) missingLevels.push(triggerLevelName || "triggerLevel");

  const triggerConfirmed =
    bullishHigherWaveContext &&
    correctionLowHeld &&
    reclaimedEma10 &&
    aboveEma20 &&
    brokeTriggerLevel;

  const ready =
    bullishHigherWaveContext &&
    correctionLowHeld &&
    reclaimedEma10 &&
    aboveEma20 &&
    !brokeTriggerLevel;

  const confidenceBase =
    setup === "W2_TO_W3_LONG" ? 88 :
    setup === "W4_TO_W5_LONG" ? 76 :
    70;

  if (triggerConfirmed) {
    return {
      active: true,
      setupType: setup,
      type: setup,
      state: triggerState,
      status: "ENTRY_LONG",
      readiness: "GO_LONG",
      direction: "LONG",
      side: "LONG",
      allowLongEntry: true,
      allowShort: false,
      triggerConfirmed: true,
      triggerType: "BREAK_ABOVE_B_HIGH_OR_LOWER_HIGH",
      triggerLevel: round2(triggerLevel),
      stopLevel: round2(correctionLow),
      confidence: confidenceBase,
      sizeMode: setup === "W2_TO_W3_LONG" ? "NORMAL" : "CAUTION",
      needs: "ENTRY_ACTIVE",
      marketBias,
      reasonCodes: [
        "BULLISH_HIGHER_WAVE_CONTEXT",
        `${requiredMinutePhase}_ACTIVE`,
        `${nextImpulse}_IMPULSE_TRIGGER`,
        "CORRECTION_LOW_HELD",
        "EMA10_RECLAIM",
        "ABOVE_EMA20",
        "BREAK_ABOVE_TRIGGER_LEVEL",
        triggerState,
        "OBSERVATION_ONLY",
      ],
      debug: {
        ...phases,
        setup,
        latestClose: close,
        ema10: e10,
        ema20: e20,
        prevClose,
        correctionLow,
        triggerLevel,
        correctionLowHeld,
        reclaimedEma10,
        aboveEma20,
        brokeTriggerLevel,
        missingLevels,
      },
    };
  }

  if (ready) {
    return {
      active: true,
      setupType: setup,
      type: readyState,
      state: readyState,
      status: "WATCH",
      readiness: "READY",
      direction: "LONG",
      side: "LONG",
      allowLongEntry: false,
      allowShort: false,
      triggerConfirmed: false,
      triggerType: "WAIT_BREAK_ABOVE_B_HIGH_OR_LOWER_HIGH",
      triggerLevel: round2(triggerLevel),
      stopLevel: round2(correctionLow),
      confidence: Math.max(60, confidenceBase - 15),
      sizeMode: setup === "W2_TO_W3_LONG" ? "NORMAL" : "CAUTION",
      needs:
        setup === "W2_TO_W3_LONG"
          ? "WAIT_FOR_W3_TRIGGER"
          : "WAIT_FOR_W5_TRIGGER",
      marketBias,
      reasonCodes: [
        "BULLISH_HIGHER_WAVE_CONTEXT",
        `${requiredMinutePhase}_ACTIVE`,
        "CORRECTION_LOW_HELD",
        "EMA10_RECLAIM",
        "ABOVE_EMA20",
        "WAIT_FOR_TRIGGER_LEVEL_BREAK",
        "OBSERVATION_ONLY",
      ],
      debug: {
        ...phases,
        setup,
        latestClose: close,
        ema10: e10,
        ema20: e20,
        prevClose,
        correctionLow,
        triggerLevel,
        correctionLowHeld,
        reclaimedEma10,
        aboveEma20,
        brokeTriggerLevel,
        missingLevels,
      },
    };
  }

  return {
    active: true,
    setupType: setup,
    type: activeWaitType,
    state: activeWaitType,
    status: "WATCH",
    readiness: "WATCH",
    direction: "NONE",
    side: "NONE",
    allowLongEntry: false,
    allowShort: false,
    triggerConfirmed: false,
    triggerType: `WAIT_${nextImpulse}_CONFIRMATION`,
    triggerLevel: round2(triggerLevel),
    stopLevel: round2(correctionLow),
    confidence: 0,
    sizeMode: "NONE",
    needs: waitNeed,
    marketBias,
    reasonCodes: [
      `${requiredMinutePhase}_ACTIVE`,
      "BLIND_DIP_BUY_BLOCKED",
      "WAIT_FOR_CORRECTION_TO_IMPULSE_TRIGGER",
      ...(bullishHigherWaveContext ? ["BULLISH_HIGHER_WAVE_CONTEXT"] : ["NO_BULLISH_HIGHER_WAVE_CONTEXT"]),
      ...(missingLevels.length ? ["MISSING_CORRECTION_LEVELS"] : []),
      "OBSERVATION_ONLY",
    ],
    debug: {
      ...phases,
      setup,
      latestClose: close,
      ema10: e10,
      ema20: e20,
      prevClose,
      correctionLow,
      triggerLevel,
      correctionLowHeld,
      reclaimedEma10,
      aboveEma20,
      brokeTriggerLevel,
      missingLevels,
      note:
        missingLevels.length
          ? "Waiting because Engine 2 has not provided correction low / B high yet."
          : "Waiting for reclaim and trigger confirmation.",
    },
  };
}

function toCorrectionReturn(base, detection) {
  return {
    ...base,
    active: detection.active === true,
    setupType: detection.setupType || null,
    type: detection.type || detection.state || "CORRECTION_ACTIVE_WAIT",
    state: detection.state || detection.type || "CORRECTION_ACTIVE_WAIT",
    status: detection.status || "WATCH",
    readiness: detection.readiness || "WATCH",
    direction: detection.direction || "NONE",
    side: detection.side || "NONE",
    allowLongEntry: detection.allowLongEntry === true,
    allowShort: detection.allowShort === true,
    triggerConfirmed: detection.triggerConfirmed === true,
    triggerType: detection.triggerType || null,
    entryTriggerLevel: detection.triggerLevel ?? null,
    invalidationLevel: detection.stopLevel ?? null,
    stop:
      detection.stopLevel != null
        ? `below ${detection.stopLevel}`
        : null,
    confidence: detection.confidence || 0,
    sizeMode: detection.sizeMode || "NONE",
    needs: detection.needs || "WAIT_FOR_TRIGGER",
    marketBias: detection.marketBias || base.marketBias || null,
    reasonCodes: Array.isArray(detection.reasonCodes) ? detection.reasonCodes : [],
    debug: detection.debug || {},
  };
}

export function computeEngine22ScalpOpportunity({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  tf = "10m",
  engine16 = null,
  reaction = null,
  waveReaction = null,
  engine2State = null,
  marketMind = null,
} = {}) {
  const base = {
    ok: true,
    engine: "engine22.scalpOpportunity.v5",
    active: false,
    mode: "OBSERVATION_ONLY",
    symbol,
    strategyId,
    tf,

    supportedSetups: {
      dipBuyContinuation: true,
      exhaustionBounceLong: true,
      exhaustionRejectionShort: true,
      w2ToW3Long: true,
      w4ToW5Long: true,
      correctionAToBLong: false,
      correctionBToCShort: false,
    },

    setupType: null,
    type: "NONE",
    state: "NONE",
    status: "NO_SCALP",
    readiness: "WAIT",
    direction: "NONE",
    side: "NONE",

    allowLongEntry: false,
    allowShort: false,
    triggerConfirmed: false,
    triggerType: null,

    targetMove: 1.0,
    stop: null,
    confidence: 0,
    sizeMode: "NONE",

    entryZone: null,
    targetZone: null,
    invalidationLevel: null,

    entryTriggerLevel: null,
    distanceToEntry: null,
    needs: "WAIT_FOR_SETUP",

    marketBias: null,
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

  const phases = getWavePhases(engine2State);
  const {
    primaryPhase,
    intermediatePhase,
    minorPhase,
    minutePhase,
    confirmedMinutePhase,
  } = phases;

  const finalImpulseContext = isBullishFinalImpulseContext({
    primaryPhase,
    intermediatePhase,
    minorPhase,
  });

  const bullishHigherWaveContext = isBullishHigherWaveContext({
    primaryPhase,
    intermediatePhase,
    minorPhase,
  });

  const marketBias = computeMarketBias({
    engine2State,
    engine16,
    marketMind,
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
      reasonCodes: ["NO_PRICE_AVAILABLE"],
      debug: {
        ...phases,
        latestClose,
        ema10,
        ema20,
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

  // ============================================================
  // PHASE 1 + PHASE 2:
  // Minute W2/W4 correction logic.
  //
  // W2 and W4 block blind dip buys.
  // If correction-to-impulse trigger fields are available, Engine 22 can
  // promote W2 -> W3 or W4 -> W5.
  // ============================================================

  if (minutePhase === "IN_W2") {
    const w2ToW3Long = detectCorrectionToImpulseLong({
      setup: "W2_TO_W3_LONG",
      engine2State,
      engine16,
      marketBias,
      latestClose,
      ema10,
      ema20,
    });

    if (w2ToW3Long?.status === "ENTRY_LONG") {
      logEntryIfNeeded({
        symbol,
        strategyId,
        tf,
        type: "W2_TO_W3_LONG",
        status: "ENTRY_LONG",
        direction: "LONG",
        price: latestClose,
        confidence: w2ToW3Long.confidence || 88,
        targetMove: base.targetMove,
        invalidationLevel: w2ToW3Long.stopLevel ?? null,
      });
    }

    return toCorrectionReturn(base, w2ToW3Long);
  }

  if (minutePhase === "IN_W4") {
    const w4ToW5Long = detectCorrectionToImpulseLong({
      setup: "W4_TO_W5_LONG",
      engine2State,
      engine16,
      marketBias,
      latestClose,
      ema10,
      ema20,
    });

    if (w4ToW5Long?.status === "ENTRY_LONG") {
      logEntryIfNeeded({
        symbol,
        strategyId,
        tf,
        type: "W4_TO_W5_LONG",
        status: "ENTRY_LONG",
        direction: "LONG",
        price: latestClose,
        confidence: w4ToW5Long.confidence || 76,
        targetMove: base.targetMove,
        invalidationLevel: w4ToW5Long.stopLevel ?? null,
      });
    }

    return toCorrectionReturn(base, w4ToW5Long);
  }

  // ============================================================
  // PHASE 3:
  // Normal impulse dip-buy logic.
  //
  // Only allowed during Minute W3 or Minute W5.
  // This prevents continuationTriggerLong from buying W2/W4 early.
  // ============================================================

  const minuteAllowsNormalDipBuy =
    minutePhase === "IN_W3" ||
    minutePhase === "IN_W5";

  if (marketBias?.bias === "LONG_ONLY_DIP_BUY" && continuationWatchLong && minuteAllowsNormalDipBuy) {
    const pulledBack =
      (ema10 !== null && latestClose <= ema10) ||
      (ema20 !== null && latestClose <= ema20);

    const reclaimed = ema10 !== null && latestClose > ema10;

    if (pulledBack && !reclaimed) {
      return {
        ...base,
        active: true,
        setupType: "DIP_BUY_CONTINUATION",
        type: "DIP_BUY_WATCH",
        state: "DIP_BUY_WATCH",
        status: "WATCH_LONG",
        readiness: "WATCH",
        direction: "LONG",
        side: "LONG",
        allowLongEntry: false,
        allowShort: false,
        marketBias,
        needs: "WAIT_FOR_EMA10_RECLAIM_OR_CONTINUATION_TRIGGER",
        reasonCodes: [
          "LONG_ONLY_DIP_BUY_BIAS",
          `${minutePhase}_ALLOWS_DIP_BUY`,
          "DIP_PULLBACK_DETECTED",
          "WAIT_FOR_RECLAIM",
          "OBSERVATION_ONLY",
        ],
        debug: {
          ...phases,
          latestClose,
          ema10,
          ema20,
          pulledBack,
          reclaimed,
          continuationWatchLong,
          continuationTriggerLong,
          finalImpulseContext,
          bullishHigherWaveContext,
        },
      };
    }

    if (continuationTriggerLong) {
      const confidence =
        minutePhase === "IN_W3" ? 82 :
        minutePhase === "IN_W5" ? 72 :
        70;

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
        setupType: "DIP_BUY_CONTINUATION",
        type: "DIP_BUY_CONTINUATION",
        state: "DIP_BUY_CONTINUATION",
        status: "ENTRY_LONG",
        readiness: "GO_LONG",
        direction: "LONG",
        side: "LONG",
        allowLongEntry: true,
        allowShort: false,
        triggerConfirmed: true,
        triggerType: "CONTINUATION_TRIGGER_LONG",
        marketBias,
        confidence,
        sizeMode: minutePhase === "IN_W5" ? "CAUTION" : "NORMAL",
        stop: "below EMA20 / last pullback low",
        invalidationLevel: round2(ema20),
        needs: "ENTRY_ACTIVE",
        reasonCodes: [
          "LONG_ONLY_DIP_BUY_BIAS",
          `${minutePhase}_ALLOWS_DIP_BUY`,
          "DIP_BUY_CONFIRMED",
          "CONTINUATION_TRIGGER_LONG",
          "OBSERVATION_ONLY",
        ],
        debug: {
          ...phases,
          latestClose,
          ema10,
          ema20,
          continuationWatchLong,
          continuationTriggerLong,
          finalImpulseContext,
          bullishHigherWaveContext,
        },
      };
    }
  }

  // ============================================================
  // LONG: exhaustion bounce from low
  // ============================================================

  if (exhaustionTriggerLong && exhaustionPrice !== null) {
    const side = "LONG";
    const holdsLow = latestClose >= exhaustionPrice;

    if (!holdsLow) {
      return {
        ...base,
        marketBias,
        reasonCodes: ["LONG_EXHAUSTION_LOW_FAILED"],
        debug: {
          ...phases,
          latestClose,
          ema10,
          ema20,
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
      setupType: "EXHAUSTION_BOUNCE_LONG",
      type: "EXHAUSTION_BOUNCE_LONG",
      state: "EXHAUSTION_BOUNCE_LONG",
      status,
      readiness: status === "ENTRY_LONG" ? "GO_LONG" : "PROBE",
      direction: "LONG",
      side,
      allowLongEntry: status === "ENTRY_LONG",
      allowShort: false,
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
        ...phases,
        latestClose,
        ema10,
        ema20,
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
  //
  // Shorts are blocked by default during bullish final impulse context.
  // ============================================================

  if (exhaustionTriggerShort && exhaustionPrice !== null) {
    const side = "SHORT";
    const failsHigh = latestClose <= exhaustionPrice;

    if (!failsHigh) {
      return {
        ...base,
        marketBias,
        reasonCodes: ["SHORT_EXHAUSTION_HIGH_FAILED"],
        debug: {
          ...phases,
          latestClose,
          ema10,
          ema20,
          exhaustionPrice,
          failsHigh,
          reactionScore,
          structureState,
        },
      };
    }

    if (marketBias?.blockShorts === true || finalImpulseContext) {
      return {
        ...base,
        active: true,
        setupType: "SHORT_BLOCKED_BY_MARKET_BIAS",
        type: "SHORT_BLOCKED_BY_MARKET_BIAS",
        state: "FINAL_IMPULSE_NO_SHORTS",
        status: "NO_SHORT",
        readiness: "NO_TRADE",
        direction: "NONE",
        side: "SHORT",
        allowLongEntry: false,
        allowShort: false,
        marketBias,
        reasonCodes: [
          "SHORT_EXHAUSTION_TRIGGERED",
          "SHORTS_BLOCKED_BY_W3_W5_LONG_BIAS",
          finalImpulseContext ? "FINAL_IMPULSE_NO_SHORTS" : "MARKET_BIAS_BLOCKS_SHORTS",
          "OBSERVATION_ONLY",
        ],
        debug: {
          ...phases,
          latestClose,
          ema10,
          ema20,
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
      setupType: "EXHAUSTION_REJECTION_SHORT",
      type: "EXHAUSTION_REJECTION_SHORT",
      state: "EXHAUSTION_REJECTION_SHORT",
      status,
      readiness: status === "ENTRY_SHORT" ? "GO_SHORT" : "PROBE",
      direction: "SHORT",
      side,
      allowLongEntry: false,
      allowShort: status === "ENTRY_SHORT",
      marketBias,

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
        ...phases,
        latestClose,
        ema10,
        ema20,
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
    reasonCodes: ["NO_ENGINE22_SCALP_SETUP"],
    debug: {
      ...phases,
      latestClose,
      ema10,
      ema20,
      exhaustionPrice,
      exhaustionTriggerLong,
      exhaustionTriggerShort,
      exhaustionActive,
      continuationWatchLong,
      continuationTriggerLong,
      reactionScore,
      structureState,
      hasWaveReaction: !!wr,
      finalImpulseContext,
      bullishHigherWaveContext,
    },
  };
}

export default computeEngine22ScalpOpportunity;
