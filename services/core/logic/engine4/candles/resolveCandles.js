import { normalizeCandle } from "./normalizeCandle.js";

export function resolveCurrentCandleClosed({ reaction, tacticalParticipation, currentCandle }) {
  if (reaction?.candleClosed === true || reaction?.currentCandleClosed === true) return true;
  if (reaction?.candleClosed === false || reaction?.currentCandleClosed === false) return false;
  if (reaction?.earlySignal === true) return false;

  if (tacticalParticipation?.currentCandleClosed === true) return true;
  if (tacticalParticipation?.currentCandleClosed === false) return false;

  if (currentCandle?.candleClosed === true) return true;
  if (currentCandle?.candleClosed === false) return false;

  return null;
}

export function resolvePriorBarCompleted({ reaction, priorCandle }) {
  if (reaction?.priorCandleCompleted === true) return true;
  if (reaction?.priorCandleCompleted === false) return false;
  if (priorCandle?.candleClosed === true || priorCandle?.completed === true || priorCandle?.isClosed === true) return true;
  if (priorCandle?.candleClosed === false || priorCandle?.completed === false || priorCandle?.isClosed === false) return false;

  return null;
}

export function resolveCandles(reaction, tacticalParticipation) {
  const currentRaw =
    reaction?.currentCandle ||
    reaction?.lastCandle ||
    reaction?.currentLevelAction?.lastCandle ||
    reaction?.fastImbalanceReaction?.lastCandle ||
    tacticalParticipation?.lastCandle ||
    null;

  const priorRaw =
    reaction?.priorCandle ||
    reaction?.currentLevelAction?.priorCandle ||
    reaction?.fastImbalanceReaction?.priorCandle ||
    tacticalParticipation?.priorCandle ||
    null;

  const currentCandle = normalizeCandle(currentRaw);
  const priorCandle = normalizeCandle(priorRaw);

  const currentCandleClosed = resolveCurrentCandleClosed({
    reaction,
    tacticalParticipation,
    currentCandle,
  });

  const priorBarCompleted = resolvePriorBarCompleted({
    reaction,
    priorCandle,
  });

  return {
    currentCandle,
    priorCandle,
    currentCandleClosed,
    priorBarCompleted,
    formingCandle: currentCandleClosed === false,
    completionKnown: currentCandleClosed !== null,
  };
}
