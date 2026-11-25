// services/core/logic/engine29/tacticalCharacter/detectFailedMove.js

import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_REASON_CODES,
} from "./moveCharacterConstants.js";
import { completedBars, finite } from "./tacticalCharacterUtils.js";

export function detectFailedMove(symbolEntry) {
  const view = symbolEntry?.fastTactical;
  const bars = completedBars(view);
  if (bars.length < 2) return { detected: false, character: null, reasonCode: null };

  const prior = bars.at(-2);
  const latest = bars.at(-1);
  const support = finite(view?.levels?.recentSupport);
  const resistance = finite(view?.levels?.recentResistance);

  const priorClose = finite(prior?.close);
  const latestClose = finite(latest?.close);

  const failedBreakout = Number.isFinite(resistance)
    && Number.isFinite(priorClose)
    && Number.isFinite(latestClose)
    && priorClose > resistance
    && latestClose <= resistance;

  const failedBreakdown = Number.isFinite(support)
    && Number.isFinite(priorClose)
    && Number.isFinite(latestClose)
    && priorClose < support
    && latestClose >= support;

  if (failedBreakout) {
    return {
      detected: true,
      character: ENGINE29_MOVE_CHARACTERS.FAILED_BREAKOUT,
      reasonCode: ENGINE29_MOVE_REASON_CODES.BREAKOUT_FAILED_RECLAIM,
      symbol: symbolEntry?.canonicalSymbol ?? null,
      level: resistance,
      priorClose,
      latestClose,
      time: latest.time ?? null,
    };
  }

  if (failedBreakdown) {
    return {
      detected: true,
      character: ENGINE29_MOVE_CHARACTERS.FAILED_BREAKDOWN,
      reasonCode: ENGINE29_MOVE_REASON_CODES.BREAKDOWN_FAILED_RECLAIM,
      symbol: symbolEntry?.canonicalSymbol ?? null,
      level: support,
      priorClose,
      latestClose,
      time: latest.time ?? null,
    };
  }

  return { detected: false, character: null, reasonCode: null };
}
