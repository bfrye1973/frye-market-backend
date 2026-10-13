// services/core/logic/engine29/trapDetection/buildTrapDetection.js
// Engine 29 — macro-first trap-detection foundation.
//
// Phase B scope:
// WHERE:
//   4H / derived 2H / 1H structure + institutional green zones
// AUCTION:
//   10m observation + completed 30m failed acceptance
// MOMENTUM:
//   30m / 1H EMA behavior
//
// TRAP_CONFIRMED is intentionally blocked until Engine 25 primary
// scanner-breadth + stock-volume evidence is connected.

import { buildEngine29EsFuturesAnchor } from "../tacticalCharacter/buildEsFuturesAnchor.js";
import { readEngine29InstitutionalLiquidity } from "./readInstitutionalLiquidity.js";
import { buildEngine29MacroLiquidityMap } from "./buildMacroLiquidityMap.js";
import { detectEngine29TrapAuctionEvent } from "./detectTrapAuctionEvent.js";
import { buildEngine29TrapMomentumRepair } from "./buildTrapMomentumRepair.js";
import { readEngine25TrapParticipation } from "./readEngine25TrapParticipation.js";
import { buildEngine29TrapCrossMarketConfirmation } from "./buildTrapCrossMarketConfirmation.js";
import { resolveEngine29TrapState } from "./resolveTrapState.js";

export async function buildEngine29TrapDetection({
  now = Date.now(),
  esAnchor = null,
  institutionalInventory = null,
  engine25Participation = null,
  moveCharacter = null,
  liveMonitor = null,
} = {}) {
  const anchor =
    esAnchor ||
    await buildEngine29EsFuturesAnchor({
      now,
      symbol: "ES",
    });

  const institutional =
    institutionalInventory ||
    readEngine29InstitutionalLiquidity();

  const currentPrice =
    anchor?.liveMonitor?.latest?.close ??
    anchor?.structure?.fastTactical?.latest?.close ??
    anchor?.structure?.tactical?.latest?.close ??
    null;

  const macroLiquidityMap =
    buildEngine29MacroLiquidityMap({
      currentPrice,
      fourHourBars:
        anchor?.macroContext?.fourHour?.bars || [],
      twoHourBars:
        anchor?.macroContext?.twoHour?.bars || [],
      oneHourBars:
        anchor?.structure?.tactical?.bars || [],
      thirtyMinuteBars:
        anchor?.structure?.fastTactical?.bars || [],
      institutionalInventory: institutional,
    });

  const auctionEvent =
    detectEngine29TrapAuctionEvent({
      macroLiquidityMap,
      esAnchor: anchor,
      now,
    });

  const momentumRepair =
    buildEngine29TrapMomentumRepair({
      esAnchor: anchor,
      trapSide: auctionEvent?.trapSide,
    });

  const primaryParticipation =
    engine25Participation ||
    readEngine25TrapParticipation({
      trapSide: auctionEvent?.trapSide,
      now,
    });

  const secondaryConfirmation =
    buildEngine29TrapCrossMarketConfirmation({
      moveCharacter,
      liveMonitor,
      trapSide: auctionEvent?.trapSide,
    });

  const resolved =
    resolveEngine29TrapState({
      auctionEvent,
      macroLiquidityMap,
      momentumRepair,
      primaryParticipation,
      secondaryConfirmation,
    });

  return {
    version: "engine29.trapDetection.v2.threeLane",
    timestamp: new Date(now).toISOString(),
    authority: "OBSERVATION_CONFIRMATION_ONLY",

    trapSide: resolved.trapSide,
    state: resolved.state,
    locationQuality: resolved.locationQuality,
    confirmationQuality: resolved.confirmationQuality,

    liquidity: {
      state:
        auctionEvent?.liquidityEvent?.state ??
        "NO_LIQUIDITY_EVENT",
      side:
        auctionEvent?.liquidityEvent?.side ?? null,
      level:
        auctionEvent?.liquidityLevel ?? null,
      sweep:
        auctionEvent?.sweep ?? null,
      auctionResult:
        auctionEvent?.auctionResult ??
        "NO_ACTIVE_AUCTION",
      reclaimObserved:
        auctionEvent?.reclaimObserved === true,
    },

    moveCharacterLane: {
      moveCharacter:
        moveCharacter?.moveCharacter ?? "NO_ACTIVE_MOVE",
      direction:
        moveCharacter?.direction ?? null,
      fastState:
        liveMonitor?.state ?? null,
      liveDirection:
        liveMonitor?.direction ?? null,
      participation:
        liveMonitor?.participation ?? null,
      context:
        liveMonitor?.context ?? null,
    },

    trap: {
      side: resolved.trapSide,
      state: resolved.state,
      locationQuality: resolved.locationQuality,
      confirmationQuality:
        resolved.confirmationQuality,
      confirmationBlockedBy:
        resolved.confirmationBlockedBy,
    },

    macroLiquidityMap,
    auctionEvent,
    momentumRepair,

    participation: {
      primary: primaryParticipation,
      secondary: secondaryConfirmation,
    },

    confirmationBlockedBy:
      resolved.confirmationBlockedBy,

    reasonCodes:
      resolved.reasonCodes,

    dataQuality: {
      esResolvedSymbol:
        anchor?.resolvedSymbol ?? null,
      institutionalAvailable:
        institutional?.available === true,
      institutionalZoneCount:
        institutional?.zoneCount ?? 0,
      oneHourAvailable:
        anchor?.tacticalAvailable === true,
      thirtyMinuteAvailable:
        anchor?.fastTacticalAvailable === true,
      tenMinuteAvailable:
        anchor?.liveMonitorAvailable === true,
      twoHourAvailable:
        (anchor?.macroContext?.twoHour?.count || 0) > 0,
      fourHourAvailable:
        (anchor?.macroContext?.fourHour?.count || 0) > 0,
      engine25PrimaryParticipationAvailable:
        primaryParticipation?.available === true,
      engine29SecondaryConfirmationAvailable:
        Boolean(moveCharacter),
    },

    noPermissionCreated: true,
    noExecution: true,
  };
}

export default buildEngine29TrapDetection;
