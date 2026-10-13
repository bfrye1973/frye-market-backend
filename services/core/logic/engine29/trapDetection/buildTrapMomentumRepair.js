// services/core/logic/engine29/trapDetection/buildTrapMomentumRepair.js
// Engine 29 — EMA/momentum confirmation for an existing trap-side auction event.
//
// EMA behavior is confirmation, not a mandatory definition of a trap.

import { ENGINE29_TRAP_SIDES } from "./trapConstants.js";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function completedBars(view) {
  return (Array.isArray(view?.bars) ? view.bars : [])
    .filter((bar) =>
      bar?.completed === true &&
      Number.isFinite(finite(bar?.close))
    )
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function emaRelation(close, ema) {
  if (![close, ema].every(Number.isFinite)) return "UNKNOWN";
  if (close > ema) return "ABOVE";
  if (close < ema) return "BELOW";
  return "AT";
}

function transition(priorClose, latestClose, ema) {
  if (![priorClose, latestClose, ema].every(Number.isFinite)) {
    return "UNKNOWN";
  }

  if (priorClose <= ema && latestClose > ema) return "RECLAIMED";
  if (priorClose >= ema && latestClose < ema) return "LOST";
  return "UNCHANGED";
}

function timeframeRead(view, trapSide) {
  const bars = completedBars(view);
  const latest = bars.at(-1) || null;
  const prior = bars.at(-2) || null;

  const close = finite(latest?.close);
  const priorClose = finite(prior?.close);
  const ema10 = finite(view?.movingAverages?.ema10);
  const ema20 = finite(view?.movingAverages?.ema20);

  const ema10Relation = emaRelation(close, ema10);
  const ema20Relation = emaRelation(close, ema20);

  const ema10Transition = transition(priorClose, close, ema10);
  const ema20Transition = transition(priorClose, close, ema20);

  let supportive = false;

  if (trapSide === ENGINE29_TRAP_SIDES.BEAR) {
    supportive =
      ema10Relation === "ABOVE" ||
      ema20Relation === "ABOVE" ||
      ema10Transition === "RECLAIMED" ||
      ema20Transition === "RECLAIMED";
  } else if (trapSide === ENGINE29_TRAP_SIDES.BULL) {
    supportive =
      ema10Relation === "BELOW" ||
      ema20Relation === "BELOW" ||
      ema10Transition === "LOST" ||
      ema20Transition === "LOST";
  }

  return {
    available: Boolean(latest),
    latestTime: latest?.time ?? null,
    latestClose: close,
    ema10,
    ema20,
    ema10Relation,
    ema20Relation,
    ema10Transition,
    ema20Transition,
    supportive,
  };
}

export function buildEngine29TrapMomentumRepair({
  esAnchor = null,
  trapSide = ENGINE29_TRAP_SIDES.NONE,
} = {}) {
  const thirtyMinute = timeframeRead(
    esAnchor?.structure?.fastTactical,
    trapSide
  );

  const oneHour = timeframeRead(
    esAnchor?.structure?.tactical,
    trapSide
  );

  const supportiveTimeframes = [
    thirtyMinute.supportive,
    oneHour.supportive,
  ].filter(Boolean).length;

  let state = "NEUTRAL";

  if (trapSide === ENGINE29_TRAP_SIDES.NONE) {
    state = "NOT_APPLICABLE";
  } else if (supportiveTimeframes >= 2) {
    state = "STRONG_CONFIRMATION";
  } else if (supportiveTimeframes === 1) {
    state = "PARTIAL_CONFIRMATION";
  } else if (
    thirtyMinute.available ||
    oneHour.available
  ) {
    state = "NO_CONFIRMATION";
  } else {
    state = "UNAVAILABLE";
  }

  return {
    version: "engine29.trapMomentumRepair.v1",
    authority: "CONFIRMATION_ONLY",
    trapSide,
    state,
    supportiveTimeframes,
    thirtyMinute,
    oneHour,
    reasonCodes: [
      thirtyMinute.supportive
        ? "30M_EMA_BEHAVIOR_SUPPORTS_TRAP"
        : null,
      oneHour.supportive
        ? "1H_EMA_BEHAVIOR_SUPPORTS_TRAP"
        : null,
    ].filter(Boolean),
  };
}

export default buildEngine29TrapMomentumRepair;
