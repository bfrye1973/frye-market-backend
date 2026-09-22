// services/core/logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js
//
// Engine 29 — 10m / 20m live transition monitor v1.4
//
// Authority:
// - diagnostic only
// - never overwrites 30m, 1H, or 1W
//
// v1.4 fixes three live-session issues:
// 1) ES 10m/20m is the PRIMARY live direction/momentum anchor.
// 2) SQUEEZE_* labels are reserved for an actual parent 30m squeeze.
// 3) A confirmed 30m broad move can transition to BROAD_MOVE_NARROWING
//    when the newest 10m participation deteriorates.

const EPS = 1e-9;

const MATERIAL_ES_10M_PCT = 0.03;
const MATERIAL_ES_20M_PCT = 0.05;
const MATERIAL_HEADLINE_10M_PCT = 0.03;
const MATERIAL_HEADLINE_20M_PCT = 0.05;
const MATERIAL_BREADTH_10M_PCT = 0.02;
const CONTRARY_VIX_10M_PCT = 0.10;

export const ENGINE29_SQUEEZE_MONITOR_STATES = Object.freeze({
  MONITORING: "MONITORING",

  SQUEEZE_ACCELERATING: "SQUEEZE_ACCELERATING",
  SQUEEZE_HOLDING: "SQUEEZE_HOLDING",
  SQUEEZE_WEAKENING: "SQUEEZE_WEAKENING",
  SQUEEZE_FADING: "SQUEEZE_FADING",
  SQUEEZE_FAILED: "SQUEEZE_FAILED",

  UPSIDE_MOMENTUM_ACCELERATING: "UPSIDE_MOMENTUM_ACCELERATING",
  DOWNSIDE_MOMENTUM_ACCELERATING: "DOWNSIDE_MOMENTUM_ACCELERATING",
  UPSIDE_MOMENTUM_WEAKENING: "UPSIDE_MOMENTUM_WEAKENING",
  DOWNSIDE_MOMENTUM_WEAKENING: "DOWNSIDE_MOMENTUM_WEAKENING",

  COUNTERTREND_BUYING_BROADENING: "COUNTERTREND_BUYING_BROADENING",
  COUNTERTREND_SELLING_BROADENING: "COUNTERTREND_SELLING_BROADENING",
  COUNTERTREND_RALLY_FADING: "COUNTERTREND_RALLY_FADING",
  COUNTERTREND_SELLOFF_FADING: "COUNTERTREND_SELLOFF_FADING",

  BROADENING_INTO_RALLY: "BROADENING_INTO_RALLY",
  BROADENING_INTO_SELLOFF: "BROADENING_INTO_SELLOFF",
  BROAD_MOVE_NARROWING: "BROAD_MOVE_NARROWING",
});

export const ENGINE29_PARTICIPATION_STATES = Object.freeze({
  BROAD: "BROAD",
  PARTIAL: "PARTIAL",
  NARROW: "NARROW",
  MIXED: "MIXED",
  UNKNOWN: "UNKNOWN",
});

function finite(value) {
  return Number.isFinite(value);
}

function pct(from, to) {
  if (!finite(from) || !finite(to) || Math.abs(from) < EPS) return null;
  return ((to - from) / from) * 100;
}

function avg(values) {
  const good = values.filter(finite);
  return good.length
    ? good.reduce((sum, value) => sum + value, 0) / good.length
    : null;
}

function closeOf(bar) {
  return bar?.close ?? bar?.c ?? null;
}

function barTime(bar) {
  return bar?.time ?? bar?.t ?? null;
}

function moveFromBars(bars) {
  if (!Array.isArray(bars) || bars.length < 4) {
    return {
      available: false,
      move10: null,
      move20: null,
      prior10: null,
      latestClose: null,
      latestTime: null,
    };
  }

  const b0 = bars.at(-1);
  const b1 = bars.at(-2);
  const b2 = bars.at(-3);

  return {
    available: true,
    move10: pct(closeOf(b1), closeOf(b0)),
    move20: pct(closeOf(b2), closeOf(b0)),
    prior10: pct(closeOf(b2), closeOf(b1)),
    latestClose: closeOf(b0),
    latestTime: barTime(b0),
  };
}

function symbolMove(entry) {
  return moveFromBars(entry?.liveMonitor?.bars);
}

function buildMoves(symbols) {
  const result = {};
  for (const [symbol, entry] of Object.entries(symbols || {})) {
    result[symbol] = symbolMove(entry);
  }
  return result;
}

function block(moves, names) {
  const available = names
    .map((symbol) => ({ symbol, ...moves[symbol] }))
    .filter((item) => item.available);

  return {
    symbols: available,
    availableCount: available.length,
    move10: avg(available.map((item) => item.move10)),
    move20: avg(available.map((item) => item.move20)),
    prior10: avg(available.map((item) => item.prior10)),
  };
}

function resolveDirection(primaryMove) {
  const composite = avg([
    primaryMove?.move10,
    primaryMove?.move20,
  ]);

  if (!finite(composite)) return "FLAT";
  if (composite > 0.015) return "UP";
  if (composite < -0.015) return "DOWN";
  return "FLAT";
}

function directionalMagnitude(value, direction) {
  if (!finite(value)) return null;
  if (direction === "UP") return value;
  if (direction === "DOWN") return -value;
  return 0;
}

function materiallyAligned(value, direction, minimumPct) {
  const magnitude = directionalMagnitude(value, direction);
  return finite(magnitude) && magnitude >= minimumPct;
}

function aligned(value, direction) {
  if (!finite(value)) return false;
  if (direction === "UP") return value > 0;
  if (direction === "DOWN") return value < 0;
  return false;
}

function opposing(value, direction) {
  if (!finite(value)) return false;
  if (direction === "UP") return value < 0;
  if (direction === "DOWN") return value > 0;
  return false;
}

function momentumWeakening(current10, prior10, direction) {
  if (!finite(current10) || !finite(prior10)) return false;
  if (direction === "UP") return current10 < prior10;
  if (direction === "DOWN") return current10 > prior10;
  return false;
}

function momentumAccelerating(current10, prior10, direction) {
  if (!finite(current10) || !finite(prior10)) return false;
  if (direction === "UP") return current10 > prior10 && current10 > 0;
  if (direction === "DOWN") return current10 < prior10 && current10 < 0;
  return false;
}

function participationFor({ direction, headline10, breadth10 }) {
  if (
    direction === "FLAT" ||
    !finite(headline10) ||
    !finite(breadth10)
  ) {
    return ENGINE29_PARTICIPATION_STATES.UNKNOWN;
  }

  const h = directionalMagnitude(headline10, direction);
  const b = directionalMagnitude(breadth10, direction);

  if (!finite(h) || h <= 0) {
    return ENGINE29_PARTICIPATION_STATES.MIXED;
  }

  if (!finite(b) || b <= 0) {
    return ENGINE29_PARTICIPATION_STATES.NARROW;
  }

  const ratio = b / Math.max(Math.abs(h), EPS);

  if (ratio >= 0.8) return ENGINE29_PARTICIPATION_STATES.BROAD;
  if (ratio >= 0.5) return ENGINE29_PARTICIPATION_STATES.PARTIAL;
  return ENGINE29_PARTICIPATION_STATES.NARROW;
}

function contraryVix(vix10, direction) {
  if (!finite(vix10)) return false;
  if (direction === "UP") return vix10 >= CONTRARY_VIX_10M_PCT;
  if (direction === "DOWN") return vix10 <= -CONTRARY_VIX_10M_PCT;
  return false;
}

function normalizeParentMove(parentMoveCharacter) {
  const moveCharacter =
    typeof parentMoveCharacter === "string"
      ? parentMoveCharacter
      : parentMoveCharacter?.moveCharacter ?? null;

  const direction =
    typeof parentMoveCharacter === "object"
      ? parentMoveCharacter?.direction ?? null
      : null;

  const upside = moveCharacter === "POSSIBLE_UPSIDE_SQUEEZE";
  const downside = moveCharacter === "POSSIBLE_DOWNSIDE_SQUEEZE";
  const broadConfirmed = moveCharacter === "BROAD_MOVE_CONFIRMED";

  return {
    moveCharacter,
    direction,
    squeezeActive: upside || downside,
    squeezeDirection: upside ? "UP" : downside ? "DOWN" : null,
    broadMoveActive: broadConfirmed,
  };
}

function normalizeFastTacticalState(fastTacticalState) {
  const state =
    typeof fastTacticalState === "string"
      ? fastTacticalState
      : fastTacticalState?.state ?? null;

  const s = String(state || "").toUpperCase();

  let direction = "NEUTRAL";

  if (
    s.includes("BUYING_PRESSURE") ||
    s.includes("BROAD_MOVE_UP") ||
    s.includes("UPSIDE_SQUEEZE") ||
    s.includes("RECOVERY_ATTEMPT")
  ) {
    direction = "UP";
  } else if (
    s.includes("SELLING_PRESSURE") ||
    s.includes("BROAD_MOVE_DOWN") ||
    s.includes("DOWNSIDE_SQUEEZE")
  ) {
    direction = "DOWN";
  }

  return {
    state,
    direction,
    broadMove:
      s.includes("BROAD_MOVE_UP") ||
      s.includes("BROAD_MOVE_DOWN"),
  };
}

function buildGuardrails({
  direction,
  es,
  headline,
  breadth,
  leadership,
  credit,
  financials,
  vix,
}) {
  const es10Material = materiallyAligned(
    es.move10,
    direction,
    MATERIAL_ES_10M_PCT
  );

  const es20Material = materiallyAligned(
    es.move20,
    direction,
    MATERIAL_ES_20M_PCT
  );

  const headline10Material = materiallyAligned(
    headline.move10,
    direction,
    MATERIAL_HEADLINE_10M_PCT
  );

  const headline20Material = materiallyAligned(
    headline.move20,
    direction,
    MATERIAL_HEADLINE_20M_PCT
  );

  const breadth10Material = materiallyAligned(
    breadth.move10,
    direction,
    MATERIAL_BREADTH_10M_PCT
  );

  const leadershipOpposing = opposing(
    leadership.move10,
    direction
  );

  const leadershipWeakening = momentumWeakening(
    leadership.move10,
    leadership.prior10,
    direction
  );

  const creditConfirming = aligned(credit.move10, direction);
  const financialsConfirming = aligned(financials.move10, direction);
  const vixContrary = contraryVix(vix.move10, direction);

  return {
    es10Material,
    es20Material,
    headline10Material,
    headline20Material,
    breadth10Material,
    leadershipOpposing,
    leadershipWeakening,
    creditConfirming,
    financialsConfirming,
    vixContrary,

    broadeningEligible:
      es10Material &&
      es20Material &&
      headline10Material &&
      headline20Material &&
      breadth10Material &&
      !leadershipOpposing &&
      !leadershipWeakening &&
      creditConfirming &&
      financialsConfirming &&
      !vixContrary,
  };
}

function resolveContext(direction, fast) {
  if (direction === "FLAT") return "NO_LIVE_DIRECTION";
  if (fast.direction === "NEUTRAL") return "FAST_NEUTRAL";
  if (fast.direction === direction) return "ALIGNED_WITH_30M";
  return "COUNTERTREND_TO_30M";
}

function resolveState({
  direction,
  participation,
  es,
  headline,
  breadth,
  leadership,
  guardrails,
  parent,
  fast,
  context,
}) {
  if (direction === "FLAT") {
    return ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING;
  }

  const esAligned10 = aligned(es.move10, direction);
  const esAligned20 = aligned(es.move20, direction);
  const esOpposing10 = opposing(es.move10, direction);

  const breadthOpposing10 = opposing(breadth.move10, direction);
  const leadershipOpposing10 = opposing(leadership.move10, direction);

  const esWeakening = momentumWeakening(
    es.move10,
    es.prior10,
    direction
  );

  const esAccelerating = momentumAccelerating(
    es.move10,
    es.prior10,
    direction
  );

  // 1) SQUEEZE semantics only when a real parent 30m squeeze exists.
  if (parent.squeezeActive) {
    if (
      esOpposing10 &&
      breadthOpposing10 &&
      (leadershipOpposing10 || guardrails.vixContrary)
    ) {
      return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FAILED;
    }

    if (esOpposing10) {
      return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FADING;
    }

    if (
      !guardrails.es10Material ||
      !guardrails.es20Material ||
      esWeakening ||
      guardrails.leadershipWeakening ||
      guardrails.vixContrary
    ) {
      return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_WEAKENING;
    }

    if (
      esAligned10 &&
      esAligned20 &&
      participation === ENGINE29_PARTICIPATION_STATES.NARROW &&
      esAccelerating
    ) {
      return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_ACCELERATING;
    }

    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_HOLDING;
  }

  // 2) Broad-move narrowing.
  if (
    (parent.broadMoveActive || fast.broadMove) &&
    context === "ALIGNED_WITH_30M" &&
    (
      participation === ENGINE29_PARTICIPATION_STATES.NARROW ||
      participation === ENGINE29_PARTICIPATION_STATES.PARTIAL ||
      !guardrails.creditConfirming ||
      !guardrails.financialsConfirming ||
      guardrails.leadershipWeakening
    )
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.BROAD_MOVE_NARROWING;
  }

  // 3) Countertrend broadening / fading.
  if (
    context === "COUNTERTREND_TO_30M" &&
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    guardrails.broadeningEligible
  ) {
    return direction === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_BUYING_BROADENING
      : ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_SELLING_BROADENING;
  }

  if (
    context === "COUNTERTREND_TO_30M" &&
    (
      !guardrails.es10Material ||
      !guardrails.es20Material ||
      esOpposing10
    )
  ) {
    return direction === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_RALLY_FADING
      : ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_SELLOFF_FADING;
  }

  // 4) Broadening when 10m agrees with 30m/neutral context.
  if (
    context !== "COUNTERTREND_TO_30M" &&
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    guardrails.broadeningEligible
  ) {
    return direction === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_RALLY
      : ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_SELLOFF;
  }

  // 5) Non-squeeze momentum semantics.
  if (
    esAligned20 &&
    (
      !guardrails.es10Material ||
      esWeakening ||
      guardrails.leadershipWeakening ||
      guardrails.vixContrary
    )
  ) {
    return direction === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.UPSIDE_MOMENTUM_WEAKENING
      : ENGINE29_SQUEEZE_MONITOR_STATES.DOWNSIDE_MOMENTUM_WEAKENING;
  }

  if (
    esAligned10 &&
    esAligned20 &&
    guardrails.es10Material &&
    esAccelerating
  ) {
    return direction === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.UPSIDE_MOMENTUM_ACCELERATING
      : ENGINE29_SQUEEZE_MONITOR_STATES.DOWNSIDE_MOMENTUM_ACCELERATING;
  }

  return ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING;
}

function buildReasons({
  direction,
  participation,
  es,
  headline,
  leadership,
  guardrails,
  parent,
  fast,
  context,
}) {
  const reasons = [];

  reasons.push("ES_10M_PRIMARY_ANCHOR");

  if (parent.squeezeActive) reasons.push("PARENT_30M_SQUEEZE_ACTIVE");
  if (parent.broadMoveActive) reasons.push("PARENT_30M_BROAD_MOVE_ACTIVE");

  if (fast.state) {
    reasons.push(`PARENT_30M_STATE_${String(fast.state).toUpperCase()}`);
  }

  if (context === "COUNTERTREND_TO_30M") {
    reasons.push("LIVE_10M_COUNTERTREND_TO_30M");
  }

  if (context === "ALIGNED_WITH_30M") {
    reasons.push("LIVE_10M_ALIGNED_WITH_30M");
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.NARROW) {
    reasons.push("HEADLINE_MOVE_OUTRUNNING_BREADTH");
  } else if (
    participation === ENGINE29_PARTICIPATION_STATES.PARTIAL
  ) {
    reasons.push("BREADTH_PARTIALLY_PARTICIPATING");
  } else if (
    participation === ENGINE29_PARTICIPATION_STATES.BROAD
  ) {
    reasons.push("BREADTH_BROADENING_WITH_MOVE");
  }

  if (!guardrails.es10Material) {
    reasons.push("ES_10M_MOVE_NOT_MATERIAL");
  }

  if (!guardrails.es20Material) {
    reasons.push("ES_20M_PERSISTENCE_NOT_MATERIAL");
  }

  if (aligned(headline.move10, direction)) {
    reasons.push("HEADLINE_CONFIRMING_ES");
  } else if (opposing(headline.move10, direction)) {
    reasons.push("HEADLINE_DIVERGING_FROM_ES");
  }

  if (aligned(leadership.move10, direction)) {
    reasons.push("LEADERSHIP_SUPPORTING_MOVE");
  } else if (opposing(leadership.move10, direction)) {
    reasons.push("LEADERSHIP_OPPOSING_MOVE");
  }

  if (guardrails.creditConfirming) {
    reasons.push("CREDIT_SUPPORTING_MOVE");
  } else {
    reasons.push("CREDIT_NOT_CONFIRMING_MOVE");
  }

  if (guardrails.financialsConfirming) {
    reasons.push("FINANCIALS_SUPPORTING_MOVE");
  } else {
    reasons.push("FINANCIALS_NOT_CONFIRMING_MOVE");
  }

  if (guardrails.vixContrary) {
    reasons.push(
      direction === "UP"
        ? "VIX_RISING_AGAINST_UP_MOVE"
        : "VIX_FALLING_AGAINST_DOWN_MOVE"
    );
  }

  if (momentumWeakening(es.move10, es.prior10, direction)) {
    reasons.push("ES_MOMENTUM_WEAKENING");
  }

  if (momentumAccelerating(es.move10, es.prior10, direction)) {
    reasons.push("ES_MOMENTUM_ACCELERATING");
  }

  return reasons;
}

function displayFor({
  state,
  direction,
  participation,
  es,
  headline,
  guardrails,
  parent,
  fast,
  context,
}) {
  const why = [];

  why.push(
    `ES is the primary 10-minute anchor (${finite(es.move10) ? es.move10.toFixed(3) : "—"}% over 10m).`
  );

  if (fast.state) {
    why.push(`The 30-minute tactical state is ${fast.state}.`);
  }

  if (context === "COUNTERTREND_TO_30M") {
    why.push(
      `The live ES ${direction === "UP" ? "upside" : "downside"} move is running against the current 30-minute direction.`
    );
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.NARROW) {
    why.push("Breadth is not keeping pace with the ES/headline move.");
  } else if (
    participation === ENGINE29_PARTICIPATION_STATES.PARTIAL
  ) {
    why.push("Breadth is only partially participating.");
  } else if (
    participation === ENGINE29_PARTICIPATION_STATES.BROAD
  ) {
    why.push("Breadth is participating broadly with the move.");
  }

  if (opposing(headline.move10, direction)) {
    why.push("SPY/QQQ are diverging from the live ES direction.");
  }

  if (!guardrails.creditConfirming) {
    why.push("High-yield credit is not confirming the move.");
  }

  if (!guardrails.financialsConfirming) {
    why.push("Financials are not confirming the move.");
  }

  if (guardrails.leadershipWeakening) {
    why.push("Tech and semiconductor leadership are losing momentum.");
  }

  if (guardrails.vixContrary) {
    why.push(
      direction === "UP"
        ? "VIX is rising against the upside move."
        : "VIX is falling against the downside move."
    );
  }

  const headlineText = {
    SQUEEZE_ACCELERATING: `The ${direction === "UP" ? "upside" : "downside"} squeeze is accelerating.`,
    SQUEEZE_HOLDING: `The ${direction === "UP" ? "upside" : "downside"} squeeze is holding.`,
    SQUEEZE_WEAKENING: `The ${direction === "UP" ? "upside" : "downside"} squeeze is weakening.`,
    SQUEEZE_FADING: `The ${direction === "UP" ? "upside" : "downside"} squeeze is fading.`,
    SQUEEZE_FAILED: `The ${direction === "UP" ? "upside" : "downside"} squeeze has failed.`,

    UPSIDE_MOMENTUM_ACCELERATING: "Upside momentum is accelerating.",
    DOWNSIDE_MOMENTUM_ACCELERATING: "Downside momentum is accelerating.",
    UPSIDE_MOMENTUM_WEAKENING: "Upside momentum is weakening.",
    DOWNSIDE_MOMENTUM_WEAKENING: "Downside momentum is weakening.",

    COUNTERTREND_BUYING_BROADENING:
      "Countertrend buying is broadening, but 30-minute authority has not turned bullish.",
    COUNTERTREND_SELLING_BROADENING:
      "Countertrend selling is broadening, but 30-minute authority has not turned bearish.",
    COUNTERTREND_RALLY_FADING:
      "The countertrend rally is fading before 30-minute authority has turned bullish.",
    COUNTERTREND_SELLOFF_FADING:
      "The countertrend selloff is fading before 30-minute authority has turned bearish.",

    BROADENING_INTO_RALLY:
      "The upside move is broadening into a healthier rally.",
    BROADENING_INTO_SELLOFF:
      "The downside move is broadening into a healthier selloff.",

    BROAD_MOVE_NARROWING:
      "The 30-minute broad move is losing fresh 10-minute participation.",

    MONITORING:
      "The live monitor does not yet have a decisive transition.",
  }[state] || "The live monitor does not yet have a decisive transition.";

  return {
    headline: headlineText,
    why,
    summary: why.length
      ? `${headlineText} ${why.join(" ")}`
      : headlineText,
  };
}

export function buildEngine29SqueezeTransitionMonitor(
  marketDataBundle,
  {
    parentMoveCharacter = null,
    fastTacticalState = null,
    esLiveMonitor = null,
  } = {}
) {
  const moves = buildMoves(marketDataBundle?.symbols);

  const es = moveFromBars(esLiveMonitor?.bars);

  const headline = block(moves, ["SPY", "QQQ"]);
  const breadth = block(moves, ["RUT", "IWM", "MDY", "RSP"]);
  const leadership = block(moves, ["SOX", "SMH", "XLK"]);
  const credit = block(moves, ["HYG", "JNK"]);
  const financials = block(moves, ["XLF", "KRE"]);
  const vix = block(moves, ["VIX"]);

  // ES is primary. Only fall back to headline if ES 10m is unavailable.
  const primary = es.available ? es : headline;
  const anchor = es.available ? "ES" : "SPY_QQQ_FALLBACK";

  const direction = resolveDirection(primary);

  const parent = normalizeParentMove(parentMoveCharacter);
  const fast = normalizeFastTacticalState(fastTacticalState);

  const participation = participationFor({
    direction,
    headline10: headline.move10,
    breadth10: breadth.move10,
  });

  const guardrails = buildGuardrails({
    direction,
    es: primary,
    headline,
    breadth,
    leadership,
    credit,
    financials,
    vix,
  });

  const context = resolveContext(direction, fast);

  const state = resolveState({
    direction,
    participation,
    es: primary,
    headline,
    breadth,
    leadership,
    guardrails,
    parent,
    fast,
    context,
  });

  const reasonCodes = buildReasons({
    direction,
    participation,
    es: primary,
    headline,
    leadership,
    guardrails,
    parent,
    fast,
    context,
  });

  const display = displayFor({
    state,
    direction,
    participation,
    es: primary,
    headline,
    guardrails,
    parent,
    fast,
    context,
  });

  return {
    version: "engine29.squeezeTransitionMonitor.v1.4",
    generatedAt:
      marketDataBundle?.generatedAt ||
      new Date().toISOString(),

    timeframe: "10m",
    persistenceWindow: "20m",
    authority: "DIAGNOSTIC_ONLY",
    anchor,

    state,
    direction,
    participation,
    context,

    parentMove: parent,
    fastTacticalContext: fast,

    guardrails: {
      ...guardrails,
      thresholds: {
        materialEs10mPct: MATERIAL_ES_10M_PCT,
        materialEs20mPct: MATERIAL_ES_20M_PCT,
        materialHeadline10mPct: MATERIAL_HEADLINE_10M_PCT,
        materialHeadline20mPct: MATERIAL_HEADLINE_20M_PCT,
        materialBreadth10mPct: MATERIAL_BREADTH_10M_PCT,
        contraryVix10mPct: CONTRARY_VIX_10M_PCT,
      },
    },

    metrics: {
      es: primary,
      headline,
      breadth,
      leadership,
      credit,
      financials,
      vix,

      headlineBreadthGap:
        finite(headline.move10) && finite(breadth.move10)
          ? headline.move10 - breadth.move10
          : null,

      leadershipBreadthGap:
        finite(leadership.move10) && finite(breadth.move10)
          ? leadership.move10 - breadth.move10
          : null,
    },

    reasonCodes,
    display,
    symbolMoves: moves,
  };
}
