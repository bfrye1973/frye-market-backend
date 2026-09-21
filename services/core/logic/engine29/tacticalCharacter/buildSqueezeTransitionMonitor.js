// services/core/logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js
// Engine 29 — 10m / 20m live squeeze transition monitor
//
// Diagnostic only:
// - does NOT overwrite 30m fast tactical truth
// - does NOT overwrite 1H tactical truth
// - does NOT overwrite 1W structural truth
//
// v1.3 adds explicit 30m context:
// - aligned with 30m
// - countertrend to 30m
// - early broadening that may be trying to overturn 30m
//
// This lets the monitor distinguish:
//   30m selling + 10m broad buying  -> COUNTERTREND_BUYING_BROADENING
//   30m buying  + 10m broad buying  -> BROADENING_INTO_RALLY
//   active squeeze losing momentum  -> SQUEEZE_WEAKENING

const EPS = 1e-9;

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

  COUNTERTREND_BUYING_BROADENING: "COUNTERTREND_BUYING_BROADENING",
  COUNTERTREND_SELLING_BROADENING: "COUNTERTREND_SELLING_BROADENING",
  COUNTERTREND_RALLY_FADING: "COUNTERTREND_RALLY_FADING",
  COUNTERTREND_SELLOFF_FADING: "COUNTERTREND_SELLOFF_FADING",

  BROADENING_INTO_RALLY: "BROADENING_INTO_RALLY",
  BROADENING_INTO_SELLOFF: "BROADENING_INTO_SELLOFF",
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
  if (!good.length) return null;
  return good.reduce((sum, value) => sum + value, 0) / good.length;
}

function closeOf(bar) {
  return bar?.close ?? bar?.c ?? null;
}

function barTime(bar) {
  return bar?.time ?? bar?.t ?? null;
}

function symbolMove(entry) {
  const bars = entry?.liveMonitor?.bars;

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

function resolveDirection(headline10, headline20) {
  const composite = avg([headline10, headline20]);

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

function participationFor({ direction, headline10, breadth10 }) {
  if (!finite(headline10) || !finite(breadth10) || direction === "FLAT") {
    return ENGINE29_PARTICIPATION_STATES.UNKNOWN;
  }

  const h = directionalMagnitude(headline10, direction);
  const b = directionalMagnitude(breadth10, direction);

  if (!finite(h) || h <= 0) return ENGINE29_PARTICIPATION_STATES.MIXED;
  if (!finite(b) || b <= 0) return ENGINE29_PARTICIPATION_STATES.NARROW;

  const ratio = b / Math.max(Math.abs(h), EPS);

  if (ratio >= 0.8) return ENGINE29_PARTICIPATION_STATES.BROAD;
  if (ratio >= 0.5) return ENGINE29_PARTICIPATION_STATES.PARTIAL;
  return ENGINE29_PARTICIPATION_STATES.NARROW;
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

function contraryVix(vix10, direction) {
  if (!finite(vix10)) return false;

  if (direction === "UP") return vix10 >= CONTRARY_VIX_10M_PCT;
  if (direction === "DOWN") return vix10 <= -CONTRARY_VIX_10M_PCT;

  return false;
}

function normalizeParentMove(parentMoveCharacter) {
  if (!parentMoveCharacter) {
    return {
      moveCharacter: null,
      direction: null,
      squeezeActive: false,
      squeezeDirection: null,
    };
  }

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

  return {
    moveCharacter,
    direction,
    squeezeActive: upside || downside,
    squeezeDirection: upside ? "UP" : downside ? "DOWN" : null,
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
  } else if (s.includes("STABILIZING")) {
    direction = "NEUTRAL";
  }

  return {
    state,
    direction,
  };
}

function buildGuardrails({
  direction,
  headline,
  breadth,
  leadership,
  credit,
  financials,
  vix,
}) {
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

  const leadershipOpposing = opposing(leadership.move10, direction);
  const leadershipWeakening = momentumWeakening(
    leadership.move10,
    leadership.prior10,
    direction
  );

  const creditConfirming = aligned(credit.move10, direction);
  const financialsConfirming = aligned(financials.move10, direction);
  const vixContrary = contraryVix(vix.move10, direction);

  return {
    headline10Material,
    headline20Material,
    breadth10Material,
    leadershipOpposing,
    leadershipWeakening,
    creditConfirming,
    financialsConfirming,
    vixContrary,

    broadeningEligible:
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

function resolveContext({
  direction,
  fast,
}) {
  if (direction === "FLAT") return "NO_LIVE_DIRECTION";
  if (fast.direction === "NEUTRAL") return "FAST_NEUTRAL";
  if (fast.direction === direction) return "ALIGNED_WITH_30M";
  return "COUNTERTREND_TO_30M";
}

function resolveState({
  direction,
  participation,
  headline,
  breadth,
  leadership,
  guardrails,
  parent,
  fast,
  context,
}) {
  const effectiveDirection =
    direction !== "FLAT" ? direction : parent.squeezeDirection ?? "FLAT";

  if (effectiveDirection === "FLAT") {
    return ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING;
  }

  const headlineAligned10 = aligned(headline.move10, effectiveDirection);
  const headlineAligned20 = aligned(headline.move20, effectiveDirection);
  const headlineOpposing10 = opposing(headline.move10, effectiveDirection);

  const breadthOpposing10 = opposing(breadth.move10, effectiveDirection);
  const leadershipAligned10 = aligned(leadership.move10, effectiveDirection);
  const leadershipOpposing10 = opposing(
    leadership.move10,
    effectiveDirection
  );

  const headlineWeakening = momentumWeakening(
    headline.move10,
    headline.prior10,
    effectiveDirection
  );

  const headlineAccelerating = momentumAccelerating(
    headline.move10,
    headline.prior10,
    effectiveDirection
  );

  // Existing 30m squeeze management.
  if (
    parent.squeezeActive &&
    parent.squeezeDirection === effectiveDirection &&
    headlineOpposing10 &&
    breadthOpposing10 &&
    (leadershipOpposing10 || guardrails.vixContrary)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FAILED;
  }

  if (
    parent.squeezeActive &&
    parent.squeezeDirection === effectiveDirection &&
    (headlineOpposing10 ||
      (!headlineAligned10 &&
        leadershipOpposing10 &&
        guardrails.vixContrary))
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FADING;
  }

  // A broad 10m move that opposes 30m authority is not yet a confirmed rally/selloff.
  if (
    context === "COUNTERTREND_TO_30M" &&
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    guardrails.broadeningEligible
  ) {
    return effectiveDirection === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_BUYING_BROADENING
      : ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_SELLING_BROADENING;
  }

  // If the countertrend move starts losing material momentum before 30m turns,
  // call it fading rather than allowing it to masquerade as a confirmed reversal.
  if (
    context === "COUNTERTREND_TO_30M" &&
    (!guardrails.headline10Material ||
      !guardrails.headline20Material ||
      headlineOpposing10)
  ) {
    return effectiveDirection === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_RALLY_FADING
      : ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_SELLOFF_FADING;
  }

  // Only aligned/neutral 30m context may promote to broad rally/selloff.
  if (
    context !== "COUNTERTREND_TO_30M" &&
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    guardrails.broadeningEligible
  ) {
    return effectiveDirection === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_RALLY
      : ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_SELLOFF;
  }

  if (
    parent.squeezeActive &&
    parent.squeezeDirection === effectiveDirection &&
    (!guardrails.headline10Material || !guardrails.headline20Material)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_WEAKENING;
  }

  if (
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    headlineAligned20 &&
    (!guardrails.headline10Material ||
      !guardrails.headline20Material ||
      guardrails.leadershipWeakening ||
      guardrails.vixContrary)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_WEAKENING;
  }

  if (
    headlineAligned20 &&
    headlineAligned10 &&
    guardrails.headline10Material &&
    participation === ENGINE29_PARTICIPATION_STATES.NARROW &&
    leadershipAligned10 &&
    headlineAccelerating
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_ACCELERATING;
  }

  if (
    headlineAligned20 &&
    headlineAligned10 &&
    (headlineWeakening ||
      guardrails.leadershipWeakening ||
      leadershipOpposing10 ||
      guardrails.vixContrary)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_WEAKENING;
  }

  if (
    headlineAligned20 &&
    headlineAligned10 &&
    guardrails.headline10Material &&
    participation === ENGINE29_PARTICIPATION_STATES.NARROW
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_HOLDING;
  }

  return ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING;
}

function reasonText({
  direction,
  participation,
  headline,
  leadership,
  guardrails,
  parent,
  fast,
  context,
}) {
  const reasons = [];

  if (parent.squeezeActive) {
    reasons.push("PARENT_30M_SQUEEZE_ACTIVE");
  }

  if (fast.state) {
    reasons.push(`PARENT_30M_STATE_${String(fast.state).toUpperCase()}`);
  }

  if (context === "COUNTERTREND_TO_30M") {
    reasons.push("LIVE_10M_COUNTERTREND_TO_30M");
  } else if (context === "ALIGNED_WITH_30M") {
    reasons.push("LIVE_10M_ALIGNED_WITH_30M");
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.NARROW) {
    reasons.push("HEADLINE_MOVE_OUTRUNNING_BREADTH");
  } else if (participation === ENGINE29_PARTICIPATION_STATES.PARTIAL) {
    reasons.push("BREADTH_PARTIALLY_PARTICIPATING");
  } else if (participation === ENGINE29_PARTICIPATION_STATES.BROAD) {
    reasons.push("BREADTH_BROADENING_WITH_MOVE");
  }

  if (!guardrails.headline10Material) {
    reasons.push("HEADLINE_10M_MOVE_NOT_MATERIAL");
  }

  if (!guardrails.headline20Material) {
    reasons.push("HEADLINE_20M_PERSISTENCE_NOT_MATERIAL");
  }

  if (aligned(leadership.move10, direction)) {
    reasons.push("LEADERSHIP_SUPPORTING_MOVE");
  } else if (opposing(leadership.move10, direction)) {
    reasons.push("LEADERSHIP_OPPOSING_MOVE");
  }

  if (guardrails.leadershipWeakening) {
    reasons.push("LEADERSHIP_MOMENTUM_WEAKENING");
  }

  reasons.push(
    guardrails.creditConfirming
      ? "CREDIT_SUPPORTING_MOVE"
      : "CREDIT_NOT_CONFIRMING_MOVE"
  );

  reasons.push(
    guardrails.financialsConfirming
      ? "FINANCIALS_SUPPORTING_MOVE"
      : "FINANCIALS_NOT_CONFIRMING_MOVE"
  );

  if (guardrails.vixContrary) {
    reasons.push(
      direction === "UP"
        ? "VIX_RISING_AGAINST_UP_MOVE"
        : "VIX_FALLING_AGAINST_DOWN_MOVE"
    );
  }

  if (momentumWeakening(headline.move10, headline.prior10, direction)) {
    reasons.push("HEADLINE_MOMENTUM_WEAKENING");
  }

  if (momentumAccelerating(headline.move10, headline.prior10, direction)) {
    reasons.push("HEADLINE_MOMENTUM_ACCELERATING");
  }

  if (
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    !guardrails.broadeningEligible
  ) {
    reasons.push("BROADENING_PROMOTION_BLOCKED");
  }

  return reasons;
}

function plainEnglish({
  state,
  direction,
  participation,
  leadership,
  guardrails,
  parent,
  fast,
  context,
}) {
  const directionWord = direction === "DOWN" ? "downside" : "upside";
  const why = [];

  if (fast.state) {
    why.push(`The 30-minute tactical state is ${fast.state}.`);
  }

  if (context === "COUNTERTREND_TO_30M") {
    why.push(
      `The 10-minute ${directionWord} move is running against the current 30-minute tactical direction.`
    );
  }

  if (parent.squeezeActive) {
    why.push(`The 30-minute move character still has an active ${directionWord} squeeze.`);
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.NARROW) {
    why.push("Headline indexes are moving faster than the broader market.");
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.PARTIAL) {
    why.push("Breadth is participating, but not strongly enough to call the move broad.");
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.BROAD) {
    why.push("Breadth is participating strongly with the live move.");
  }

  if (!guardrails.headline10Material) {
    why.push("Headline momentum is too small to confirm continued move strength.");
  }

  if (!guardrails.headline20Material) {
    why.push("The headline move does not have enough 20-minute persistence.");
  }

  if (opposing(leadership.move10, direction)) {
    why.push("Tech and semiconductor leadership are moving against the live move.");
  } else if (guardrails.leadershipWeakening) {
    why.push("Tech and semiconductor leadership are losing momentum.");
  }

  if (!guardrails.creditConfirming) {
    why.push("High-yield credit is not confirming the move.");
  }

  if (!guardrails.financialsConfirming) {
    why.push("Financials are not confirming the move.");
  }

  if (guardrails.vixContrary) {
    why.push(
      direction === "UP"
        ? "VIX is rising enough to argue against calling this a healthy broad rally."
        : "VIX is falling enough to argue against calling this a healthy broad selloff."
    );
  }

  const headlineText = {
    [ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_ACCELERATING]:
      `The ${directionWord} squeeze is accelerating.`,
    [ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_HOLDING]:
      `The ${directionWord} squeeze is still holding.`,
    [ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_WEAKENING]:
      `The ${directionWord} squeeze is weakening.`,
    [ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FADING]:
      `The ${directionWord} squeeze is fading.`,
    [ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FAILED]:
      `The ${directionWord} squeeze has failed.`,

    [ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_BUYING_BROADENING]:
      "Countertrend buying is broadening, but 30-minute authority has not turned bullish.",
    [ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_SELLING_BROADENING]:
      "Countertrend selling is broadening, but 30-minute authority has not turned bearish.",
    [ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_RALLY_FADING]:
      "The countertrend rally is fading before 30-minute authority has turned bullish.",
    [ENGINE29_SQUEEZE_MONITOR_STATES.COUNTERTREND_SELLOFF_FADING]:
      "The countertrend selloff is fading before 30-minute authority has turned bearish.",

    [ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_RALLY]:
      "The upside move is broadening into a healthier rally.",
    [ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_SELLOFF]:
      "The downside move is broadening into a healthier selloff.",

    [ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING]:
      "The live monitor does not yet have a decisive transition.",
  }[state];

  return {
    headline: headlineText,
    why,
    summary: why.length ? `${headlineText} ${why.join(" ")}` : headlineText,
  };
}

export function buildEngine29SqueezeTransitionMonitor(
  marketDataBundle,
  {
    parentMoveCharacter = null,
    fastTacticalState = null,
  } = {}
) {
  const moves = buildMoves(marketDataBundle?.symbols);

  const headline = block(moves, ["SPY", "QQQ"]);
  const breadth = block(moves, ["RUT", "IWM", "MDY", "RSP"]);
  const leadership = block(moves, ["SOX", "SMH", "XLK"]);
  const credit = block(moves, ["HYG", "JNK"]);
  const financials = block(moves, ["XLF", "KRE"]);
  const vix = block(moves, ["VIX"]);

  const rawDirection = resolveDirection(headline.move10, headline.move20);
  const parent = normalizeParentMove(parentMoveCharacter);
  const fast = normalizeFastTacticalState(fastTacticalState);

  const direction =
    rawDirection !== "FLAT"
      ? rawDirection
      : parent.squeezeDirection ?? "FLAT";

  const participation = participationFor({
    direction,
    headline10: headline.move10,
    breadth10: breadth.move10,
  });

  const guardrails = buildGuardrails({
    direction,
    headline,
    breadth,
    leadership,
    credit,
    financials,
    vix,
  });

  const context = resolveContext({
    direction,
    fast,
  });

  const state = resolveState({
    direction,
    participation,
    headline,
    breadth,
    leadership,
    guardrails,
    parent,
    fast,
    context,
  });

  const reasonCodes = reasonText({
    direction,
    participation,
    headline,
    leadership,
    guardrails,
    parent,
    fast,
    context,
  });

  const display = plainEnglish({
    state,
    direction,
    participation,
    leadership,
    guardrails,
    parent,
    fast,
    context,
  });

  return {
    version: "engine29.squeezeTransitionMonitor.v1.3",
    generatedAt: marketDataBundle?.generatedAt ?? new Date().toISOString(),
    timeframe: "10m",
    persistenceWindow: "20m",
    authority: "DIAGNOSTIC_ONLY",

    state,
    direction,
    participation,
    context,

    parentMove: parent,
    fastTacticalContext: fast,

    guardrails: {
      ...guardrails,
      thresholds: {
        materialHeadline10mPct: MATERIAL_HEADLINE_10M_PCT,
        materialHeadline20mPct: MATERIAL_HEADLINE_20M_PCT,
        materialBreadth10mPct: MATERIAL_BREADTH_10M_PCT,
        contraryVix10mPct: CONTRARY_VIX_10M_PCT,
      },
    },

    metrics: {
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
