// services/core/logic/engine29/alerts/buildEngine29Alert.js

import { ENGINE29_ALERT_TYPES } from "../aggregate/overallStateConstants.js";

function label(value) {
  return String(value ?? "UNKNOWN").replaceAll("_", " ");
}

export function buildEngine29Alert(event, current) {
  if (!event) return null;

  let title = "ENGINE 29 — MARKET UPDATE";
  if (event.type === ENGINE29_ALERT_TYPES.STATE_UPGRADE) title = "ENGINE 29 — MARKET STRESS UPGRADE";
  if (event.type === ENGINE29_ALERT_TYPES.STATE_DOWNGRADE) title = "ENGINE 29 — STRESS DOWNGRADE";
  if (event.type === ENGINE29_ALERT_TYPES.LIQUIDITY_EVENT) title = "ENGINE 29 — ES LIQUIDITY / SQUEEZE EVENT";
  if (event.type === ENGINE29_ALERT_TYPES.TACTICAL_CHANGE) title = "ENGINE 29 — 1H CONDITION CHANGE";

  return {
    title,
    type: event.type,
    timestamp: current?.timestamp ?? new Date().toISOString(),
    previous: event.previous ?? null,
    current: event.current ?? null,
    message:
      event.type === ENGINE29_ALERT_TYPES.LIQUIDITY_EVENT
        ? `${label(event.current)} detected in ES. Check breadth, leadership and credit confirmation before treating the move as broad.`
        : `${label(event.previous)} → ${label(event.current)}`,
    structuralState: current?.structuralState ?? null,
    tacticalState: current?.tacticalState ?? null,
    fastTacticalState: current?.fastTacticalState ?? null,
    moveCharacter: current?.moveCharacter?.moveCharacter ?? null,
    confirmations: current?.confirmations ?? [],
    missingConfirmations: current?.missingConfirmations ?? [],
    underTheHood: current?.display?.underTheHood ?? null,
  };
}

export function buildEngine29Alerts(events = [], current) {
  return events.map((event) => buildEngine29Alert(event, current)).filter(Boolean);
}
