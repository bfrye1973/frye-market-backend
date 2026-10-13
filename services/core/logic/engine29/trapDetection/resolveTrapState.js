// services/core/logic/engine29/trapDetection/resolveTrapState.js
// Engine 29 — strict failed-auction trap resolver.
//
// Liquidity sweeps are events, not traps.
// Trap side is assigned only after reclaim / failed acceptance evidence appears.
// 30m failed acceptance + 30m/1H momentum repair advances FORMING.
// Engine25 primary participation + Engine29 secondary confirmation are required
// for TRAP_CONFIRMED.
//
// Observation / confirmation only. No execution or permission authority.

import {
  ENGINE29_TRAP_LOCATION_QUALITY,
  ENGINE29_TRAP_SIDES,
  ENGINE29_TRAP_STATES,
} from "./trapConstants.js";

function highQualityLocation(value) {
  return (
    value === ENGINE29_TRAP_LOCATION_QUALITY.HIGH ||
    value === ENGINE29_TRAP_LOCATION_QUALITY.VERY_HIGH
  );
}

export function resolveEngine29TrapState({
  auctionEvent = null,
  macroLiquidityMap = null,
  momentumRepair = null,
  primaryParticipation = null,
  secondaryConfirmation = null,
} = {}) {
  const locationQuality =
    macroLiquidityMap?.locationQuality ?? null;

  const reclaimObserved =
    auctionEvent?.reclaimObserved === true;

  const failedAcceptance =
    auctionEvent?.failedAcceptance === true;

  const side =
    reclaimObserved
      ? auctionEvent?.trapSide || ENGINE29_TRAP_SIDES.NONE
      : ENGINE29_TRAP_SIDES.NONE;

  if (
    side === ENGINE29_TRAP_SIDES.NONE ||
    !reclaimObserved
  ) {
    return {
      version: "engine29.trapStateResolver.v3.threeLane",
      trapSide: ENGINE29_TRAP_SIDES.NONE,
      state: ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
      locationQuality,
      confirmationQuality: "NONE",
      confirmationBlockedBy: [],
      reasonCodes: [],
    };
  }

  let state = ENGINE29_TRAP_STATES.TRAP_WATCH;

  const momentumSupport =
    momentumRepair?.state === "PARTIAL_CONFIRMATION" ||
    momentumRepair?.state === "STRONG_CONFIRMATION";

  if (failedAcceptance && momentumSupport) {
    state = ENGINE29_TRAP_STATES.TRAP_FORMING;
  }

  const confirmationBlockedBy = [];

  if (state === ENGINE29_TRAP_STATES.TRAP_WATCH) {
    if (!failedAcceptance) {
      confirmationBlockedBy.push(
        "COMPLETED_30M_FAILED_ACCEPTANCE_NOT_CONFIRMED"
      );
    }

    if (!momentumSupport) {
      confirmationBlockedBy.push(
        "30M_1H_MOMENTUM_REPAIR_NOT_CONFIRMED"
      );
    }
  }

  if (state === ENGINE29_TRAP_STATES.TRAP_FORMING) {
    if (!highQualityLocation(locationQuality)) {
      confirmationBlockedBy.push(
        "MACRO_LOCATION_NOT_HIGH_QUALITY"
      );
    }

    if (primaryParticipation?.available !== true) {
      confirmationBlockedBy.push(
        "ENGINE25_PRIMARY_PARTICIPATION_UNAVAILABLE"
      );
    } else if (
      primaryParticipation
        ?.primaryParticipationOpposesTrap === true
    ) {
      confirmationBlockedBy.push(
        "ENGINE25_PRIMARY_PARTICIPATION_OPPOSES_TRAP"
      );
    } else if (
      primaryParticipation
        ?.primaryParticipationSupportsTrap !== true
    ) {
      confirmationBlockedBy.push(
        "ENGINE25_PRIMARY_PARTICIPATION_NOT_CONFIRMED"
      );
    }

    if (
      secondaryConfirmation?.secondaryOpposesTrap === true
    ) {
      confirmationBlockedBy.push(
        "ENGINE29_SECONDARY_CONFIRMATION_OPPOSES_TRAP"
      );
    } else if (
      secondaryConfirmation?.secondarySupportsTrap !== true
    ) {
      confirmationBlockedBy.push(
        "ENGINE29_SECONDARY_CONFIRMATION_NOT_CONFIRMED"
      );
    }

    if (
      confirmationBlockedBy.length === 0 &&
      highQualityLocation(locationQuality) &&
      primaryParticipation
        ?.primaryParticipationSupportsTrap === true &&
      secondaryConfirmation
        ?.secondarySupportsTrap === true
    ) {
      state = ENGINE29_TRAP_STATES.TRAP_CONFIRMED;
    }
  }

  const confirmationQuality =
    state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED
      ? "FULL_CONFIRMATION"
      : state === ENGINE29_TRAP_STATES.TRAP_FORMING
        ? momentumRepair?.state === "STRONG_CONFIRMATION"
          ? "STRONG_PRICE_CONFIRMATION"
          : "PARTIAL_PRICE_CONFIRMATION"
        : "RECLAIM_WATCH";

  return {
    version: "engine29.trapStateResolver.v3.threeLane",
    trapSide: side,
    state,
    locationQuality,
    confirmationQuality,
    confirmationBlockedBy,

    reasonCodes: [
      ...(auctionEvent?.reasonCodes || []),
      ...(macroLiquidityMap?.reasonCodes || []),
      ...(momentumRepair?.reasonCodes || []),
      ...(primaryParticipation?.reasonCodes || []),
      ...(secondaryConfirmation?.reasonCodes || []),
      state === ENGINE29_TRAP_STATES.TRAP_WATCH
        ? "TRAP_WATCH_RECLAIM_SEEN"
        : null,
      state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED
        ? "TRAP_CONFIRMED_BY_MACRO_LOCATION_PRICE_AND_PARTICIPATION"
        : null,
    ].filter(Boolean),
  };
}

export default resolveEngine29TrapState;
