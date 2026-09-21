// services/core/logic/engine29/tacticalCharacter/buildSqueezeTransitionMonitor.js
// Engine 29 — 10m / 20m live squeeze transition monitor
//
// Diagnostic only:
// - does NOT overwrite 30m fast tactical truth
// - does NOT overwrite 1H tactical truth
// - does NOT overwrite 1W structural truth
//
// Purpose:
// Measure whether a squeeze-like move is accelerating, holding, weakening,
// fading, failing, or broadening into a healthier rally/selloff.

const EPS = 1e-9;

export const ENGINE29_SQUEEZE_MONITOR_STATES = Object.freeze({
  MONITORING: "MONITORING",
  SQUEEZE_ACCELERATING: "SQUEEZE_ACCELERATING",
  SQUEEZE_HOLDING: "SQUEEZE_HOLDING",
  SQUEEZE_WEAKENING: "SQUEEZE_WEAKENING",
  SQUEEZE_FADING: "SQUEEZE_FADING",
  SQUEEZE_FAILED: "SQUEEZE_FAILED",
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

function participationFor({ direction, headline10, breadth10 }) {
  if (!finite(headline10) || !finite(breadth10) || direction === "FLAT") {
    return ENGINE29_PARTICIPATION_STATES.UNKNOWN;
  }

  const h = direction === "UP" ? headline10 : -headline10;
  const b = direction === "UP" ? breadth10 : -breadth10;

  if (h <= 0) return ENGINE29_PARTICIPATION_STATES.MIXED;

  if (b <= 0) return ENGINE29_PARTICIPATION_STATES.NARROW;

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

  if (direction === "UP") {
    return current10 < prior10;
  }

  if (direction === "DOWN") {
    return current10 > prior10;
  }

  return false;
}

function momentumAccelerating(current10, prior10, direction) {
  if (!finite(current10) || !finite(prior10)) return false;

  if (direction === "UP") {
    return current10 > prior10 && current10 > 0;
  }

  if (direction === "DOWN") {
    return current10 < prior10 && current10 < 0;
  }

  return false;
}

function reasonText({
  direction,
  participation,
  headline,
  breadth,
  leadership,
  credit,
  financials,
  vix,
}) {
  const reasons = [];

  if (participation === ENGINE29_PARTICIPATION_STATES.NARROW) {
    reasons.push("HEADLINE_MOVE_OUTRUNNING_BREADTH");
  } else if (participation === ENGINE29_PARTICIPATION_STATES.PARTIAL) {
    reasons.push("BREADTH_PARTIALLY_PARTICIPATING");
  } else if (participation === ENGINE29_PARTICIPATION_STATES.BROAD) {
    reasons.push("BREADTH_BROADENING_WITH_MOVE");
  }

  if (aligned(leadership.move10, direction)) {
    reasons.push("LEADERSHIP_SUPPORTING_MOVE");
  } else if (opposing(leadership.move10, direction)) {
    reasons.push("LEADERSHIP_OPPOSING_MOVE");
  }

  if (aligned(credit.move10, direction)) {
    reasons.push("CREDIT_SUPPORTING_MOVE");
  } else {
    reasons.push("CREDIT_NOT_CONFIRMING_MOVE");
  }

  if (aligned(financials.move10, direction)) {
    reasons.push("FINANCIALS_SUPPORTING_MOVE");
  } else {
    reasons.push("FINANCIALS_NOT_CONFIRMING_MOVE");
  }

  if (direction === "UP" && finite(vix.move10) && vix.move10 > 0) {
    reasons.push("VIX_RISING_AGAINST_UP_MOVE");
  }

  if (direction === "DOWN" && finite(vix.move10) && vix.move10 < 0) {
    reasons.push("VIX_FALLING_AGAINST_DOWN_MOVE");
  }

  if (momentumWeakening(headline.move10, headline.prior10, direction)) {
    reasons.push("HEADLINE_MOMENTUM_WEAKENING");
  }

  if (momentumWeakening(leadership.move10, leadership.prior10, direction)) {
    reasons.push("LEADERSHIP_MOMENTUM_WEAKENING");
  }

  if (momentumAccelerating(headline.move10, headline.prior10, direction)) {
    reasons.push("HEADLINE_MOMENTUM_ACCELERATING");
  }

  return reasons;
}

function resolveState({
  direction,
  participation,
  headline,
  breadth,
  leadership,
  credit,
  financials,
  vix,
}) {
  if (direction === "FLAT") {
    return ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING;
  }

  const headlineAligned10 = aligned(headline.move10, direction);
  const headlineAligned20 = aligned(headline.move20, direction);
  const headlineOpposing10 = opposing(headline.move10, direction);

  const breadthAligned10 = aligned(breadth.move10, direction);
  const breadthOpposing10 = opposing(breadth.move10, direction);

  const leadershipAligned10 = aligned(leadership.move10, direction);
  const leadershipOpposing10 = opposing(leadership.move10, direction);

  const creditAligned10 = aligned(credit.move10, direction);
  const financialsAligned10 = aligned(financials.move10, direction);

  const headlineWeakening =
    momentumWeakening(headline.move10, headline.prior10, direction);

  const leadershipWeakening =
    momentumWeakening(leadership.move10, leadership.prior10, direction);

  const headlineAccelerating =
    momentumAccelerating(headline.move10, headline.prior10, direction);

  const vixAgainstUpside =
    direction === "UP" && finite(vix.move10) && vix.move10 > 0;

  const vixAgainstDownside =
    direction === "DOWN" && finite(vix.move10) && vix.move10 < 0;

  const volatilityAgainstMove = vixAgainstUpside || vixAgainstDownside;

  if (
    headlineOpposing10 &&
    breadthOpposing10 &&
    (leadershipOpposing10 || volatilityAgainstMove)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FAILED;
  }

  if (
    headlineOpposing10 ||
    (!headlineAligned10 && leadershipOpposing10 && volatilityAgainstMove)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_FADING;
  }

  if (
    participation === ENGINE29_PARTICIPATION_STATES.BROAD &&
    headlineAligned10 &&
    breadthAligned10 &&
    creditAligned10 &&
    financialsAligned10
  ) {
    return direction === "UP"
      ? ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_RALLY
      : ENGINE29_SQUEEZE_MONITOR_STATES.BROADENING_INTO_SELLOFF;
  }

  if (
    headlineAligned20 &&
    headlineAligned10 &&
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
      leadershipWeakening ||
      leadershipOpposing10 ||
      volatilityAgainstMove)
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_WEAKENING;
  }

  if (
    headlineAligned20 &&
    headlineAligned10 &&
    participation === ENGINE29_PARTICIPATION_STATES.NARROW
  ) {
    return ENGINE29_SQUEEZE_MONITOR_STATES.SQUEEZE_HOLDING;
  }

  return ENGINE29_SQUEEZE_MONITOR_STATES.MONITORING;
}

function plainEnglish({
  state,
  direction,
  participation,
  headline,
  breadth,
  leadership,
  credit,
  vix,
}) {
  const directionWord = direction === "DOWN" ? "downside" : "upside";

  const why = [];

  if (participation === ENGINE29_PARTICIPATION_STATES.NARROW) {
    why.push("Headline indexes are moving faster than the broader market.");
  }

  if (participation === ENGINE29_PARTICIPATION_STATES.BROAD) {
    why.push("Breadth is now participating strongly with the headline move.");
  }

  if (opposing(leadership.move10, direction)) {
    why.push("Tech and semiconductor leadership are moving against the squeeze.");
  } else if (momentumWeakening(leadership.move10, leadership.prior10, direction)) {
    why.push("Tech and semiconductor leadership are losing momentum.");
  }

  if (!aligned(credit.move10, direction)) {
    why.push("High-yield credit is not confirming the move.");
  }

  if (direction === "UP" && finite(vix.move10) && vix.move10 > 0) {
    why.push("VIX is rising instead of confirming the rally.");
  }

  if (direction === "DOWN" && finite(vix.move10) && vix.move10 < 0) {
    why.push("VIX is falling instead of confirming the selloff.");
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
    summary:
      why.length > 0
        ? `${headlineText} ${why.join(" ")}`
        : headlineText,
  };
}

export function buildEngine29SqueezeTransitionMonitor(marketDataBundle) {
  const moves = buildMoves(marketDataBundle?.symbols);

  const headline = block(moves, ["SPY", "QQQ"]);
  const breadth = block(moves, ["RUT", "IWM", "MDY", "RSP"]);
  const leadership = block(moves, ["SOX", "SMH", "XLK"]);
  const credit = block(moves, ["HYG", "JNK"]);
  const financials = block(moves, ["XLF", "KRE"]);
  const vix = block(moves, ["VIX"]);

  const direction = resolveDirection(headline.move10, headline.move20);

  const participation = participationFor({
    direction,
    headline10: headline.move10,
    breadth10: breadth.move10,
  });

  const state = resolveState({
    direction,
    participation,
    headline,
    breadth,
    leadership,
    credit,
    financials,
    vix,
  });

  const reasonCodes = reasonText({
    direction,
    participation,
    headline,
    breadth,
    leadership,
    credit,
    financials,
    vix,
  });

  const display = plainEnglish({
    state,
    direction,
    participation,
    headline,
    breadth,
    leadership,
    credit,
    vix,
  });

  return {
    version: "engine29.squeezeTransitionMonitor.v1",
    generatedAt: marketDataBundle?.generatedAt ?? new Date().toISOString(),
    timeframe: "10m",
    persistenceWindow: "20m",
    authority: "DIAGNOSTIC_ONLY",
    state,
    direction,
    participation,
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
