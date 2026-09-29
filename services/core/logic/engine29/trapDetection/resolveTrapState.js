// services/core/logic/engine29/trapDetection/resolveTrapState.js
// Engine 29 — macro-first trap-state resolver.
//
// Required hierarchy:
// 1) meaningful macro/institutional location
// 2) failed auction / failed acceptance
// 3) 30m / 1H momentum confirmation
// 4) Engine 25 scanner breadth + stock-volume participation
// 5) Engine 29 secondary cross-market confirmation
//
// This module creates observation/confirmation state only.
// It never creates trade permission or execution authority.

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
  const side =
    auctionEvent?.trapSide ||
    ENGINE29_TRAP_SIDES.NONE;

  const locationQuality =
    macroLiquidityMap?.locationQuality ?? null;

  if (
    side === ENGINE29_TRAP_SIDES.NONE ||
    !auctionEvent ||
    auctionEvent.state ===
      ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP
  ) {
    return {
      version:
        "engine29.trapStateResolver.v2.participation",
      trapSide: ENGINE29_TRAP_SIDES.NONE,
      state: ENGINE29_TRAP_STATES.NO_ACTIVE_TRAP,
      locationQuality,
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
        ? momentumRepair?.state ===
          "STRONG_CONFIRMATION"
          ? "STRONG_PRICE_CONFIRMATION"
          : "PARTIAL_PRICE_CONFIRMATION"
        : state === ENGINE29_TRAP_STATES.FAILED_ACCEPTANCE
          ? "FAILED_ACCEPTANCE_PRESENT"
          : state === ENGINE29_TRAP_STATES.LIQUIDITY_SWEEP
            ? "SWEEP_PRESENT"
            : "WATCH";

  return {
    version:
      "engine29.trapStateResolver.v2.participation",
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
      state === ENGINE29_TRAP_STATES.TRAP_CONFIRMED
        ? "TRAP_CONFIRMED_BY_MACRO_LOCATION_PRICE_AND_PARTICIPATION"
        : null,
    ].filter(Boolean),
  };
}

export default resolveEngine29TrapState;
