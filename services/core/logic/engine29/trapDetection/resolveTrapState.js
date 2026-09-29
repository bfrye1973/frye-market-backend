// services/core/logic/engine29/trapDetection/resolveTrapState.js
// Engine 29 — price/location trap-state resolver.
//
// This Phase-B resolver intentionally caps state at TRAP_FORMING.
// TRAP_CONFIRMED requires the Engine 25 primary scanner-breadth and
// stock-volume participation handoff, which is not connected here yet.

import {
  ENGINE29_TRAP_SIDES,
  ENGINE29_TRAP_STATES,
} from "./trapConstants.js";

export function resolveEngine29TrapState({
  auctionEvent = null,
  macroLiquidityMap = null,
  momentumRepair = null,
} = {}) {
  const side =
    auctionEvent?.trapSide ||
    ENGINE29_TRAP_SIDES.NONE;

  if (
    side === ENGINE29_TRAP_SIDES.NONE ||
    !auctionEvent ||
    auctionEvent.state === ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP
  ) {
    return {
      version: "engine29.trapStateResolver.v1",
      trapSide: ENGINE29_TRAP_SIDES.NONE,
      state: ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
      locationQuality:
        macroLiquidityMap?.locationQuality ?? null,
      confirmationQuality: "NONE",
      confirmationBlockedBy: [],
      reasonCodes: [],
    };
  }

  let state = auctionEvent.state;

  const failedAcceptance =
    auctionEvent?.failedAcceptance === true;

  const momentumSupport =
    momentumRepair?.state === "PARTIAL_CONFIRMATION" ||
    momentumRepair?.state === "STRONG_CONFIRMATION";

  if (failedAcceptance && momentumSupport) {
    state = ENGINE29_TRAP_STATES.TRAP_FORMING;
  }

  const confirmationBlockedBy = [];

  if (state === ENGINE29_TRAP_STATES.TRAP_FORMING) {
    confirmationBlockedBy.push(
      "ENGINE25_SCANNER_BREADTH_NOT_CONNECTED",
      "ENGINE25_STOCK_VOLUME_NOT_CONNECTED"
    );
  }

  const confirmationQuality =
    state === ENGINE29_TRAP_STATES.TRAP_FORMING
      ? momentumRepair?.state === "STRONG_CONFIRMATION"
        ? "STRONG_PRICE_CONFIRMATION"
        : "PARTIAL_PRICE_CONFIRMATION"
      : state === ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE
        ? "FAILED_ACCEPTANCE_PRESENT"
        : state === ENGINE29_TRAP_STATES.LIQUIDITY_SWEEP
          ? "SWEEP_PRESENT"
          : "WATCH";

  return {
    version: "engine29.trapStateResolver.v1",
    trapSide: side,
    state,
    locationQuality:
      macroLiquidityMap?.locationQuality ?? null,
    confirmationQuality,
    confirmationBlockedBy,
    reasonCodes: [
      ...(auctionEvent?.reasonCodes || []),
      ...(macroLiquidityMap?.reasonCodes || []),
      ...(momentumRepair?.reasonCodes || []),
    ].filter(Boolean),
  };
}

export default resolveEngine29TrapState;
