// services/core/logic/engine29/tacticalCharacter/detectBroadConfirmation.js

import {
  ENGINE29_MOVE_DIRECTIONS,
  ENGINE29_MOVE_REASON_CODES,
} from "./moveCharacterConstants.js";
import { deriveDirectionalMove, sameDirection } from "./tacticalCharacterUtils.js";

function block(symbols, names, direction, options = {}) {
  const members = names
    .map((name) => symbols?.[name])
    .filter((entry) => entry?.fastTactical)
    .map((entry) => ({
      symbol: entry.canonicalSymbol,
      move: deriveDirectionalMove(entry.fastTactical, options),
    }));

  const available = members.filter((m) => m.move.available);
  const directional = direction === ENGINE29_MOVE_DIRECTIONS.UP || direction === ENGINE29_MOVE_DIRECTIONS.DOWN;
  const confirming = directional ? available.filter((m) => sameDirection(direction, m.move)) : [];

  return {
    availableCount: available.length,
    confirmingCount: confirming.length,
    confirmationRatio: available.length ? confirming.length / available.length : null,
    members,
    confirmingSymbols: confirming.map((m) => m.symbol),
  };
}

export function detectBroadConfirmation(structureBundle, direction, options = {}) {
  const symbols = structureBundle?.symbols || {};
  const directional = direction === ENGINE29_MOVE_DIRECTIONS.UP || direction === ENGINE29_MOVE_DIRECTIONS.DOWN;

  // SPY/QQQ confirm whether the cash/ETF headline market is following ES.
  // They are intentionally NOT counted as an independent macro confirmation block.
  const headlineEtfs = block(symbols, ["SPY", "QQQ"], direction, options);
  const breadth = block(symbols, ["IWM", "MDY", "RSP"], direction, options);
  const leadership = block(symbols, ["SMH", "SOX", "XLK"], direction, options);
  const credit = block(symbols, ["HYG", "JNK", "LQD"], direction, options);
  const financials = block(symbols, ["XLF", "KRE"], direction, options);

  const headlineEtfsConfirmed = directional && headlineEtfs.availableCount >= 1 && headlineEtfs.confirmingCount >= 1;
  const breadthConfirmed = directional && breadth.availableCount >= 2 && breadth.confirmingCount >= 2;
  const leadershipConfirmed = directional && leadership.availableCount >= 1 && leadership.confirmingCount >= 1;
  const creditConfirmed = directional && credit.availableCount >= 1 && credit.confirmingCount >= 1;
  const financialsConfirmed = directional && financials.availableCount >= 1 && financials.confirmingCount >= 1;

  const broadConfirmed = directional
    && breadthConfirmed
    && leadershipConfirmed
    && (creditConfirmed || financialsConfirmed);

  const reasonCodes = [];
  if (!directional) {
    reasonCodes.push(ENGINE29_MOVE_REASON_CODES.BROAD_CONFIRMATION_NOT_APPLICABLE);
  } else {
    reasonCodes.push(
      headlineEtfsConfirmed
        ? ENGINE29_MOVE_REASON_CODES.SPY_QQQ_CONFIRM_MOVE
        : ENGINE29_MOVE_REASON_CODES.SPY_QQQ_NOT_CONFIRMING,
    );
    reasonCodes.push(
      breadthConfirmed
        ? ENGINE29_MOVE_REASON_CODES.BREADTH_CONFIRMS_MOVE
        : ENGINE29_MOVE_REASON_CODES.BREADTH_NOT_CONFIRMING,
    );
    reasonCodes.push(
      leadershipConfirmed
        ? ENGINE29_MOVE_REASON_CODES.LEADERSHIP_CONFIRMS_MOVE
        : ENGINE29_MOVE_REASON_CODES.LEADERSHIP_NOT_CONFIRMING,
    );
    reasonCodes.push(
      creditConfirmed
        ? ENGINE29_MOVE_REASON_CODES.CREDIT_CONFIRMS_MOVE
        : ENGINE29_MOVE_REASON_CODES.CREDIT_NOT_CONFIRMING,
    );
    reasonCodes.push(
      broadConfirmed
        ? ENGINE29_MOVE_REASON_CODES.BROAD_CONFIRMATION_PRESENT
        : ENGINE29_MOVE_REASON_CODES.BROAD_CONFIRMATION_MISSING,
    );
  }

  return {
    direction: directional ? direction : ENGINE29_MOVE_DIRECTIONS.FLAT,
    broadConfirmed,
    headlineEtfsConfirmed,
    independentBlocksConfirmed: [breadthConfirmed, leadershipConfirmed, creditConfirmed || financialsConfirmed]
      .filter(Boolean).length,
    blocks: {
      headlineEtfs: { ...headlineEtfs, confirmed: headlineEtfsConfirmed },
      breadth: { ...breadth, confirmed: breadthConfirmed },
      leadership: { ...leadership, confirmed: leadershipConfirmed },
      credit: { ...credit, confirmed: creditConfirmed },
      financials: { ...financials, confirmed: financialsConfirmed },
    },
    reasonCodes,
    usable: directional,
  };
}
