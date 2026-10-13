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
// - Engine 2D forward extension target interpretation
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
        "Take Profit 2 at the 1.618 wave extension zone. This turns the trade into runner-only management, not an automatic bearish signal.",
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

function formatZone(zone) {
  if (!zone) return null;

  return {
    name: zone?.name || null,
    level: Number.isFinite(Number(zone?.level)) ? Number(zone.level) : null,
    price: round2(validPrice(zone?.price)),
    lo: round2(validPrice(zone?.lo)),
    hi: round2(validPrice(zone?.hi)),
  };
}

function getScalpExtensionPlan({ engine2State, currentPrice }) {
  const scalpExt = engine2State?.activeExtensions?.scalp || null;

  const zone1618 =
    scalpExt?.targetZones?.e1618 ||
    scalpExt?.targetZone ||
    null;

  const zone200 = scalpExt?.targetZones?.e200 || null;
  const zone2618 = scalpExt?.targetZones?.e2618 || null;

  const price = validPrice(currentPrice);

  const inZone = (zone) => {
    if (!zone || price === null) return false;

    const lo = validPrice(zone.lo);
    const hi = validPrice(zone.hi);

    if (lo === null || hi === null) return false;

    return price >= Math.min(lo, hi) && price <= Math.max(lo, hi);
  };

  const aboveZone = (zone) => {
    if (!zone || price === null) return false;

    const lo = validPrice(zone.lo);
    const targetPrice = validPrice(zone.price);
    const cutoff = lo ?? targetPrice;

    if (cutoff === null) return false;

    return price >= cutoff;
  };

  const in1618Zone = inZone(zone1618);
  const above1618 = aboveZone(zone1618);

  const in200Zone = inZone(zone200);
  const above200 = aboveZone(zone200);

  const in2618Zone = inZone(zone2618);
  const above2618 = aboveZone(zone2618);

  let state = "BEFORE_1618";
  let extensionMode = "BUILDING_TO_1618";
  let entryQualityOverride = null;
  let management = "HOLD_FOR_1618";
  let reasonCode = "BEFORE_1618_EXTENSION_ZONE";
  let noNewAPlusPlusEntry = false;
  let runnerStillValidIf30mEma10Holds = false;
  let watchForHeaviness = false;

  if (above2618) {
    state = "RUNNER_2618_FINAL_EXTENSION";
    extensionMode = "FINAL_EXTENSION_ZONE";
    entryQualityOverride = "EXTENDED";
    management = "FINAL_PROFIT_ZONE_OR_EXIT_RUNNER";
    reasonCode = "PRICE_AT_OR_ABOVE_2618_EXTENSION_ZONE";
    noNewAPlusPlusEntry = true;
    runnerStillValidIf30mEma10Holds = true;
    watchForHeaviness = true;

  } else if (above200) {
    state = "RUNNER_200_PROFIT_ZONE";
    extensionMode = "SECOND_EXTENSION_PROFIT_ZONE";
    entryQualityOverride = "EXTENDED";
    management = "TAKE_PROFIT_OR_TIGHT_TRAIL";
    reasonCode = "PRICE_AT_OR_ABOVE_200_EXTENSION_ZONE";
    noNewAPlusPlusEntry = true;
    runnerStillValidIf30mEma10Holds = true;
    watchForHeaviness = true;

  } else if (above1618) {
    state = "RUNNER_1618_PROFIT_ZONE";
    extensionMode = "PROFIT_2_ZONE_RUNNER_ONLY";
    entryQualityOverride = "EXTENDED";
    management = "TAKE_PROFIT_2_OR_TRAIL_FINAL_RUNNER";
    reasonCode = "PRICE_AT_OR_ABOVE_1618_EXTENSION_ZONE";
    noNewAPlusPlusEntry = true;
    runnerStillValidIf30mEma10Holds = true;
    watchForHeaviness = false;
  }

  return {
    active: scalpExt?.active === true,
    source: scalpExt?.source || null,
    degree: scalpExt?.degree || null,
    tf: scalpExt?.tf || null,
    wave: scalpExt?.wave || null,
    phase: scalpExt?.phase || null,

    state,
    extensionMode,
    management,
    entryQualityOverride,
    noNewAPlusPlusEntry,
    runnerStillValidIf30mEma10Holds,
    watchForHeaviness,
    reasonCode,

    currentPrice: round2(price),

    zones: {
      e1618: formatZone(zone1618),
      e200: formatZone(zone200),
      e2618: formatZone(zone2618),
    },

    flags: {
      in1618Zone,
      above1618,
      in200Zone,
      above200,
      in2618Zone,
      above2618,
    },

    rule:
      above1618
        ? "1.618 is a profit-management zone, not an automatic bearish signal. No new A++ entry; keep final runner only while 30m EMA10 holds."
        : "Before 1.618, A++ runner entry can remain valid if all other filters align.",
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

  const extensionPlan = getScalpExtensionPlan({
    engine2State,
    currentPrice: close,
  });

  const extendedPast1618 =
    extensionPlan?.flags?.above1618 === true;

  const entryQuality =
    extendedPast1618
      ? "EXTENDED"
      : runnerEnvironment &&
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

  if (runnerEnvironment && extendedPast1618) {
    return {
      active: true,
      state: extensionPlan?.state || "RUNNER_1618_PROFIT_ZONE",
      setup: "W3_W5_RUNNER_CONTINUATION",
      entryQuality: "EXTENDED",
      recommendedContracts: 0,
      expiration: "NO_NEW_FULL_SIZE_ENTRY",
      strikeStyle: "NO_NEW_FULL_SIZE_ENTRY",
      pullbackExpectation: "EXTENDED_MOVE",
      doNotWaitForDeepPullback: false,
      doNotOpenNewFullSize: true,
      runnerStillValidIf30mEma10Holds:
        extensionPlan?.runnerStillValidIf30mEma10Holds === true,
      watchForHeaviness:
        extensionPlan?.watchForHeaviness === true,
      preferredEntry: "NO_NEW_A_PLUS_PLUS_ENTRY_AT_EXTENSION",
      management: extensionPlan?.management || "TAKE_PROFIT_2_OR_TRAIL_FINAL_RUNNER",
      profitPlan,
      stopPlan,
      extensionPlan,
      reasonCodes: [
        ...reasonBase,
        extensionPlan?.reasonCode || "PRICE_AT_OR_ABOVE_1618_EXTENSION_ZONE",
        "A_PLUS_PLUS_ENTRY_DISABLED",
        "RECOMMENDED_CONTRACTS_ZERO",
        "PROFIT_MANAGEMENT_MODE",
        "RUNNER_VALID_ONLY_IF_30M_EMA10_HOLDS",
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
        extensionPlan,
      },
    };
  }

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
      doNotOpenNewFullSize: false,
      runnerStillValidIf30mEma10Holds: true,
      watchForHeaviness: false,
      preferredEntry: "EMA10_HOLD_OR_MICRO_FLAG_BREAK_OR_CONTINUATION_TRIGGER",
      management: "TAKE_40_PERCENT_OR_NEXT_ZONE_THEN_TRAIL_30M_EMA10",
      profitPlan,
      stopPlan,
      extensionPlan,
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
        extensionPlan,
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
      doNotOpenNewFullSize: false,
      runnerStillValidIf30mEma10Holds: true,
      watchForHeaviness: false,
      preferredEntry: "EMA10_HOLD_OR_MICRO_FLAG_BREAK_OR_CONTINUATION_TRIGGER",
      management: "WAIT_FOR_ENTRY_THEN_USE_RUNNER_PLAN",
      profitPlan,
      stopPlan,
      extensionPlan,
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
        extensionPlan,
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
    doNotOpenNewFullSize: false,
    runnerStillValidIf30mEma10Holds: false,
    watchForHeaviness: false,
    preferredEntry: "NONE",
    management: "NO_RUNNER_MODE",
    profitPlan,
    stopPlan,
    extensionPlan,
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
      extensionPlan,
    },
  };
}

export default detectRunnerMode;
