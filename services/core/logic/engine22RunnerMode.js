// services/core/logic/engine22RunnerMode.js
// Engine 22 Runner Mode
//
// Purpose:
// Detect W3/W5 runner environments where the market is too strong to wait
// for a deep pullback.
//
// This file owns:
// - W3/W5 runner mode state
// - A++ option contract plan
// - Profit 1 / Profit 2 / Profit 3 rules
// - Stop-loss and trailing stop rules
//
// Read-only. Does NOT execute trades.
// Called by engine22ScalpOpportunity.js.

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

function firstNumber(...xs) {
  for (const x of xs) {
    const n = Number(x);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function isImpulsePhase(x) {
  return x === "IN_W3" || x === "IN_W5";
}

function getMinutePhase(engine2State) {
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

function getMarketScores(marketMind) {
  const oneHourScore = firstNumber(
    marketMind?.score1h,
    marketMind?.oneHourScore,
    marketMind?.raw?.hourly?.hourly?.overall1h?.score,
    marketMind?.raw?.hourly?.metrics?.overall_hourly_score
  );

  const fourHourScore = firstNumber(
    marketMind?.score4h,
    marketMind?.fourHourScore,
    marketMind?.raw?.h4?.fourHour?.overall4h?.score,
    marketMind?.raw?.h4?.metrics?.trend_strength_4h_pct
  );

  const dailyScore = firstNumber(
    marketMind?.scoreEOD,
    marketMind?.eodScore,
    marketMind?.raw?.eod?.daily?.overallEOD?.score,
    marketMind?.raw?.eod?.metrics?.overall_eod_score
  );

  const masterScore = firstNumber(
    marketMind?.scoreMaster,
    marketMind?.masterScore,
    marketMind?.overallScore,
    marketMind?.raw?.master?.score,
    marketMind?.raw?.eod?.metrics?.masterScore,
    marketMind?.raw?.eod?.daily?.masterScore
  );

  return {
    oneHourScore,
    fourHourScore,
    dailyScore,
    masterScore,
  };
}

function buildProfitPlan({ contracts }) {
  return {
    profit1: {
      name: "PROFIT_1",
      type: "HYBRID_OPTION_GAIN_OR_NEXT_ZONE",
      optionGainPct: 40,
      minPriceMoveR: 1,
      alternate: "NEXT_MAJOR_ZONE",
      action: contracts >= 3 ? "SELL_1_OF_3" : "TAKE_PARTIAL",
      afterHit: "MOVE_STOP_TO_BREAKEVEN",
      rule:
        "Take Profit 1 at +40% option gain after at least 1R price move, or at the next major zone. Move stop to breakeven after Profit 1.",
    },

    profit2: {
      name: "PROFIT_2",
      type: "WAVE_EXTENSION",
      waveExtension: 1.618,
      action: contracts >= 3 ? "SELL_1_OF_3" : "TAKE_SECOND_PARTIAL",
      rule:
        "Take Profit 2 at the 1.618 wave extension.",
    },

    profit3: {
      name: "PROFIT_3",
      type: "RUNNER_TRAIL",
      trail: "THIRTY_MIN_EMA10_CLOSE",
      action: contracts >= 3 ? "HOLD_FINAL_1_OF_3" : "HOLD_REMAINING_RUNNER",
      rule:
        "Hold final runner while 30m candles close above EMA10. Exit final runner on a 30m candle close below EMA10.",
    },
  };
}

function buildStopPlan({ stopCandidate }) {
  return {
    initialStopRule: "BELOW_LAST_30M_LOW_ZONE",
    initialStopLevel: round2(stopCandidate),
    afterProfit1: "MOVE_STOP_TO_BREAKEVEN",
    trailAfterProfit2: "TRAIL_FINAL_RUNNER_BY_30M_EMA10_CLOSE",
    invalidIf:
      "Price breaks below the last 30m low zone or runner closes below the 30m EMA10 after Profit 2.",
  };
}

export function detectRunnerMode({
  engine2State = null,
  engine16 = null,
  marketMind = null,
  trendVsWave = null,
  zoneAbsorption = null,
  engine22State = null,
  engine22Setup = null,
  engine22Status = null,
  latestClose = null,
  ema10 = null,
  ema20 = null,
  structureState = null,
} = {}) {
  const phases = getWavePhases(engine2State);
  const {
    primaryPhase,
    intermediatePhase,
    minorPhase,
    minutePhase,
    confirmedMinutePhase,
  } = phases;

  const close = validPrice(latestClose);
  const e10 = validPrice(ema10);
  const e20 = validPrice(ema20);

  const stateUpper = String(engine22State || "").toUpperCase();
  const setupUpper = String(engine22Setup || "").toUpperCase();
  const statusUpper = String(engine22Status || "").toUpperCase();
  const structureUpper = String(structureState || "").toUpperCase();

  const scores = getMarketScores(marketMind);

  const oneHourScore = firstNumber(
    trendVsWave?.oneHourScore,
    scores.oneHourScore
  );

  const fourHourScore = firstNumber(
    trendVsWave?.fourHourScore,
    scores.fourHourScore
  );

  const dailyScore = firstNumber(
    trendVsWave?.dailyScore,
    scores.dailyScore
  );

  const masterScore = firstNumber(
    trendVsWave?.masterScore,
    scores.masterScore
  );

  const priceAboveDailyEma10 =
    trendVsWave?.priceAboveDailyEma10 === true;

  const priceAbove4hEma10 =
    trendVsWave?.priceAbove4hEma10 === true;

  const priceAbove1hEma10 =
    trendVsWave?.priceAbove1hEma10 === true;

  const priceAboveEma10 =
    close !== null &&
    e10 !== null &&
    close > e10;

  const priceAboveEma20 =
    close !== null &&
    e20 !== null &&
    close > e20;

  const w4NotConfirmed =
    trendVsWave?.trueW4Confirmed !== true;

  const impulseContext =
    (minorPhase === "IN_W3" || minorPhase === "IN_W5") &&
    (minutePhase === "IN_W3" || minutePhase === "IN_W5");

  const higherTimeframeStrong =
    oneHourScore !== null &&
    fourHourScore !== null &&
    dailyScore !== null &&
    oneHourScore >= 65 &&
    fourHourScore >= 65 &&
    dailyScore >= 75 &&
    priceAboveDailyEma10 &&
    priceAbove4hEma10 &&
    priceAbove1hEma10;

  const continuationLongActive =
    statusUpper === "ENTRY_LONG" &&
    (
      stateUpper === "DIP_BUY_CONTINUATION" ||
      stateUpper === "W3_DIP_BUY_TRIGGER_LONG" ||
      setupUpper === "DIP_BUY_CONTINUATION" ||
      setupUpper === "W3_DIP_BUY_CONTINUATION"
    );

  const zoneBuyingActive =
    zoneAbsorption?.state === "NEGOTIATED_ZONE_BUYING_ACTIVE";

  const zoneRejectionRisk =
    zoneAbsorption?.state === "NEGOTIATED_ZONE_REJECTION_WARNING" ||
    zoneAbsorption?.state === "NEGOTIATED_ZONE_LOST";

  const runnerEnvironment =
    impulseContext &&
    higherTimeframeStrong &&
    priceAboveEma10 &&
    priceAboveEma20 &&
    w4NotConfirmed &&
    !zoneRejectionRisk &&
    structureUpper !== "FAILURE";

  const stopCandidate = firstNumber(
    engine16?.last30mLowZone,
    engine16?.lastThirtyMinLowZone,
    engine16?.last30mLow,
    engine16?.lastHigherLow,
    engine16?.structureLow,
    zoneAbsorption?.zoneLo
  );

  const entryQuality =
    runnerEnvironment &&
    continuationLongActive &&
    (
      zoneBuyingActive ||
      zoneAbsorption?.state === "NO_ACTIVE_NEGOTIATED_ZONE" ||
      zoneAbsorption?.state === "NEGOTIATED_ZONE_DECISION_POINT"
    )
      ? "A++"
      : runnerEnvironment
      ? "A"
      : "NONE";

  const contracts =
    entryQuality === "A++" ? 3 :
    entryQuality === "A" ? 1 :
    0;

  const profitPlan = buildProfitPlan({ contracts });
  const stopPlan = buildStopPlan({ stopCandidate });

  const reasonBase = [
    minorPhase === "IN_W3" ? "MINOR_W3_ACTIVE" : null,
    minorPhase === "IN_W5" ? "MINOR_W5_ACTIVE" : null,
    minutePhase === "IN_W3" ? "MINUTE_W3_ACTIVE" : null,
    minutePhase === "IN_W5" ? "MINUTE_W5_ACTIVE" : null,
    isImpulsePhase(primaryPhase) ? "PRIMARY_IMPULSE_CONTEXT" : null,
    isImpulsePhase(intermediatePhase) ? "INTERMEDIATE_IMPULSE_CONTEXT" : null,
    oneHourScore !== null && oneHourScore >= 65 ? "ONE_HOUR_STRONG" : null,
    fourHourScore !== null && fourHourScore >= 65 ? "FOUR_HOUR_STRONG" : null,
    dailyScore !== null && dailyScore >= 75 ? "DAILY_STRONG" : null,
    priceAboveDailyEma10 ? "DAILY_EMA10_HOLDING" : null,
    priceAbove4hEma10 ? "FOUR_HOUR_EMA10_HOLDING" : null,
    priceAbove1hEma10 ? "ONE_HOUR_EMA10_HOLDING" : null,
    priceAboveEma10 ? "PRICE_ABOVE_EMA10" : null,
    priceAboveEma20 ? "PRICE_ABOVE_EMA20" : null,
    w4NotConfirmed ? "W4_NOT_CONFIRMED" : null,
  ].filter(Boolean);

  if (runnerEnvironment && continuationLongActive) {
    return {
      active: true,
      state: "W3_W5_RUNNER_ACTIVE",
      setup: "W3_W5_RUNNER_CONTINUATION",
      entryQuality,
      recommendedContracts: contracts,
      expiration: entryQuality === "A++" ? "1DTE" : "CAUTION",
      strikeStyle: entryQuality === "A++" ? "ITM" : "USER_DISCRETION",
      pullbackExpectation: "SHALLOW_ONLY",
      doNotWaitForDeepPullback: true,
      preferredEntry: "EMA10_HOLD_OR_MICRO_FLAG_BREAK_OR_CONTINUATION_TRIGGER",
      management: "TAKE_40_PERCENT_OR_NEXT_ZONE_THEN_TRAIL_30M_EMA10",
      profitPlan,
      stopPlan,
      reasonCodes: [
        ...reasonBase,
        "CONTINUATION_LONG_ACTIVE",
        "TREND_DAY_RUNNER_MODE",
        "DO_NOT_WAIT_FOR_DEEP_PULLBACK",
        zoneBuyingActive ? "NEGOTIATED_ZONE_BUYING_ACTIVE" : null,
        entryQuality === "A++" ? "A_PLUS_PLUS_RUNNER_ENTRY" : null,
      ].filter(Boolean),
      debug: {
        ...phases,
        latestClose: close,
        ema10: e10,
        ema20: e20,
        oneHourScore,
        fourHourScore,
        dailyScore,
        masterScore,
        priceAboveDailyEma10,
        priceAbove4hEma10,
        priceAbove1hEma10,
        priceAboveEma10,
        priceAboveEma20,
        continuationLongActive,
        zoneBuyingActive,
        zoneAbsorptionState: zoneAbsorption?.state || null,
        structureState: structureUpper,
        stopCandidate,
      },
    };
  }

  if (runnerEnvironment) {
    return {
      active: true,
      state: "RUNNER_WATCH",
      setup: "W3_W5_RUNNER_CONTINUATION",
      entryQuality,
      recommendedContracts: contracts,
      expiration: "WAIT_FOR_TRIGGER",
      strikeStyle: "WAIT_FOR_TRIGGER",
      pullbackExpectation: "SHALLOW_ONLY",
      doNotWaitForDeepPullback: true,
      preferredEntry: "EMA10_HOLD_OR_MICRO_FLAG_BREAK_OR_CONTINUATION_TRIGGER",
      management: "WAIT_FOR_ENTRY_THEN_USE_RUNNER_PLAN",
      profitPlan,
      stopPlan,
      reasonCodes: [
        ...reasonBase,
        "RUNNER_ENVIRONMENT_ACTIVE",
        "WAIT_FOR_CONTINUATION_TRIGGER",
        "DO_NOT_WAIT_FOR_DEEP_PULLBACK",
      ],
      debug: {
        ...phases,
        latestClose: close,
        ema10: e10,
        ema20: e20,
        oneHourScore,
        fourHourScore,
        dailyScore,
        masterScore,
        priceAboveDailyEma10,
        priceAbove4hEma10,
        priceAbove1hEma10,
        priceAboveEma10,
        priceAboveEma20,
        continuationLongActive,
        zoneAbsorptionState: zoneAbsorption?.state || null,
        structureState: structureUpper,
        stopCandidate,
      },
    };
  }

  return {
    active: false,
    state: "RUNNER_OFF",
    setup: "NONE",
    entryQuality: "NONE",
    recommendedContracts: 0,
    expiration: "NONE",
    strikeStyle: "NONE",
    pullbackExpectation: "NORMAL",
    doNotWaitForDeepPullback: false,
    preferredEntry: "NONE",
    management: "NO_RUNNER_MODE",
    profitPlan,
    stopPlan,
    reasonCodes: [
      "RUNNER_MODE_NOT_ACTIVE",
      ...reasonBase,
      !impulseContext ? "NO_W3_W5_IMPULSE_CONTEXT" : null,
      !higherTimeframeStrong ? "HIGHER_TIMEFRAME_NOT_STRONG_ENOUGH" : null,
      !priceAboveEma10 ? "PRICE_NOT_ABOVE_EMA10" : null,
      !priceAboveEma20 ? "PRICE_NOT_ABOVE_EMA20" : null,
      !w4NotConfirmed ? "W4_CONFIRMED_RUNNER_BLOCKED" : null,
      zoneRejectionRisk ? "ZONE_REJECTION_RISK" : null,
      structureUpper === "FAILURE" ? "STRUCTURE_FAILURE" : null,
    ].filter(Boolean),
    debug: {
      ...phases,
      latestClose: close,
      ema10: e10,
      ema20: e20,
      oneHourScore,
      fourHourScore,
      dailyScore,
      masterScore,
      priceAboveDailyEma10,
      priceAbove4hEma10,
      priceAbove1hEma10,
      priceAboveEma10,
      priceAboveEma20,
      continuationLongActive,
      zoneAbsorptionState: zoneAbsorption?.state || null,
      structureState: structureUpper,
      stopCandidate,
    },
  };
}

export default detectRunnerMode;
