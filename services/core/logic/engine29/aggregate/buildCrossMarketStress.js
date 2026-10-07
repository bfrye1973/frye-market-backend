// services/core/logic/engine29/aggregate/buildCrossMarketStress.js

import { ENGINE29_VERSION } from "../constants.js";
import { buildEngine29MarketDataBundle } from "../data/buildMarketDataBundle.js";
import { buildEngine29StructureBundle } from "../structure/buildStructureBundle.js";
import { buildEngine29GroupStateBundle } from "../groups/buildGroupStateBundle.js";
import { buildEngine29TacticalCharacter } from "../tacticalCharacter/buildTacticalCharacter.js";
import { buildEngine29EsFuturesAnchor } from "../tacticalCharacter/buildEsFuturesAnchor.js";
import { buildEngine29SqueezeTransitionMonitor } from "../tacticalCharacter/buildSqueezeTransitionMonitor.js";
import { buildEngine29SqueezeV2Observation } from "../tacticalCharacter/buildSqueezeV2Observation.js";
import { buildEngine29TrapDetection } from "../trapDetection/buildTrapDetection.js";
import { resolveEngine29StructuralState } from "./resolveStructuralState.js";
import { resolveEngine29TacticalState } from "./resolveTacticalState.js";
import { resolveEngine29FastTacticalShift } from "./resolveFastTacticalShift.js";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function compactView(view) {
  if (!view) return null;

  return {
    state: view.classification?.state ?? null,
    stage: view.classification?.stage ?? null,
    confidence: view.classification?.confidence ?? null,

    // Canonical per-symbol freshness is preserved unchanged from
    // Engine 29's existing validation layer.
    freshness: view.freshness ?? null,

    latest: view.latest ?? null,
    movingAverages: view.movingAverages ?? null,
    levels: view.levels ?? null,
  };
}

function compactSymbols(structureBundle) {
  const out = {};

  for (const [symbol, entry] of Object.entries(
    structureBundle?.symbols || {}
  )) {
    out[symbol] = {
      canonicalSymbol: entry.canonicalSymbol,
      label: entry.label,
      group: entry.group,
      subgroup: entry.subgroup ?? null,
      provider: entry.provider ?? null,
      sourceSymbol: entry.sourceSymbol ?? null,
      sourceSeriesId: entry.sourceSeriesId ?? null,
      isProxy: Boolean(entry.isProxy),
      proxyFor: entry.proxyFor ?? null,
      evidenceQuality: entry.evidenceQuality ?? null,
      structural: compactView(entry.structural),
      tactical: compactView(entry.tactical),
      fastTactical: compactView(entry.fastTactical),
    };
  }

  return out;
}

function plainGroupLabel(key, state, group) {
  if (
    key === "volatility" &&
    !state &&
    group?.structural?.missingRequiredMembers?.includes(
      "VIX_DIRECT"
    )
  ) {
    return "NO DIRECT VIX FEED";
  }

  if (
    key === "financialConditions" &&
    !state
  ) {
    return "NOT ACTIVE YET";
  }

  if (!state) return "NO RELIABLE SIGNAL";
  if (state === "HEALTHY") return "HEALTHY";
  if (state === "RECOVERING") return "RECOVERING";
  if (state === "SEVERE") return "SEVERE STRESS";

  if (state === "FORMING") {
    if (key === "ratesDuration") {
      return "PRESSURE BUILDING";
    }

    if (key === "energyInflation") {
      return "STRESS BUILDING";
    }

    if (key === "credit") {
      return "WEAKENING";
    }

    if (key === "headlineIndex") {
      return "WEAKENING";
    }

    return "WEAKENING";
  }

  if (state === "CONFIRMED") {
    if (
      key === "breadth" ||
      key === "leadership" ||
      key === "headlineIndex"
    ) {
      return "BREAKING";
    }

    if (key === "credit") {
      return "CREDIT STRESS CONFIRMED";
    }

    if (key === "ratesDuration") {
      return "STRESS CONFIRMED";
    }

    if (key === "energyInflation") {
      return "STRESS CONFIRMED";
    }

    if (key === "volatility") {
      return "VOLATILITY CONFIRMED";
    }

    return "CONFIRMED";
  }

  return state;
}

function buildMissingConfirmations(
  groupBundle,
  structural,
  tacticalCharacter
) {
  const missing = [];
  const groups = groupBundle?.groups || {};

  if (!structural?.gates?.creditConfirmed) {
    missing.push("CREDIT");
  }

  if (!tacticalCharacter?.directVixAvailable) {
    missing.push("DIRECT_VIX");
  }

  for (const group of Object.values(groups)) {
    for (
      const member of
      group?.structural?.missingRequiredMembers || []
    ) {
      missing.push(member);
    }
  }

  return unique(missing);
}

function structuralSummary(state) {
  if (state === "NORMAL") {
    return "Cross-market conditions are broadly healthy.";
  }

  if (state === "EARLY_WARNING") {
    return "Early weakness is appearing, but stress is not yet broad.";
  }

  if (state === "BROAD_DETERIORATION") {
    return "Weakness is confirmed across multiple independent parts of the market.";
  }

  if (state === "RISK_OFF_CONFIRMED") {
    return "Credit and volatility have joined broad market deterioration.";
  }

  if (state === "SYSTEMIC_STRESS") {
    return "Stress is broad across indexes, internals, credit, volatility and financial conditions.";
  }

  return "Not enough reliable evidence for a structural state.";
}

function tacticalSummary(state) {
  if (state === "NORMAL") {
    return "Intraday cross-market conditions are calm.";
  }

  if (state === "CAUTION") {
    return "Intraday pressure is present under the surface.";
  }

  if (state === "RISK_OFF_ACTIVE") {
    return "Multiple 1-hour groups are confirming active risk-off pressure.";
  }

  if (state === "STRESS_ACCELERATING") {
    return "1-hour stress is active and the faster ES move is accelerating lower.";
  }

  if (state === "RECOVERING") {
    return "ES is repairing intraday while broader confirmation remains limited.";
  }

  return "No reliable 1-hour state.";
}

export async function buildEngine29CrossMarketStress({
  now = Date.now(),
  marketDataBundle = null,
  structureBundle = null,
  groupBundle = null,
  moveCharacter = null,
  priorMoveParent = null,
  financialConditions = {},
} = {}) {
  const market =
    marketDataBundle ||
    await buildEngine29MarketDataBundle({
      now,
    });

  const structure =
    structureBundle ||
    buildEngine29StructureBundle(
      market,
      { now }
    );

  const groups =
    groupBundle ||
    buildEngine29GroupStateBundle(
      structure,
      {
        now,
        financialConditions,
      }
    );

  const esAnchor =
    moveCharacter
      ? null
      : await buildEngine29EsFuturesAnchor({
          now,
          symbol: "ES",
        });

  const move =
    moveCharacter ||
    buildEngine29TacticalCharacter(
      structure,
      groups,
      {
        now,
        esAnchor,
        priorMoveParent,
      }
    );

  const structural =
    resolveEngine29StructuralState(groups);

  const tactical =
    resolveEngine29TacticalState(
      groups,
      move
    );

  const fastTactical =
    resolveEngine29FastTacticalShift(
      move
    );

  const liveMonitor =
    buildEngine29SqueezeTransitionMonitor(
      market,
      {
        parentMoveCharacter: move,
        fastTacticalState:
          fastTactical.state,
        esLiveMonitor:
          move?.esLiveMonitor || null,
      }
    );

  const squeezeV2Observation =
    await buildEngine29SqueezeV2Observation({
      now,
      esAnchor,
    });

  const trapDetection =
    await buildEngine29TrapDetection({
      now,
      esAnchor,
      moveCharacter: move,
      liveMonitor,
    });

  const missingConfirmations =
    buildMissingConfirmations(
      groups,
      structural,
      move
    );

  const structuralStates =
    groups?.summary?.structuralStates || {};

  const displayGroups = {};

  for (
    const [key, state] of
    Object.entries(structuralStates)
  ) {
    displayGroups[key] =
      plainGroupLabel(
        key,
        state,
        groups?.groups?.[key]
      );
  }

  return {
    version:
      `${ENGINE29_VERSION}.phase5`,

    timestamp:
      new Date(now).toISOString(),

    dataDegraded:
      Boolean(market?.dataDegraded) ||
      Boolean(groups?.dataDegraded) ||
      Boolean(move?.dataDegraded),

    overallState:
      structural.state,

    structuralState:
      structural.state,

    tacticalState:
      tactical.state,

    fastTacticalState:
      fastTactical.state,

    esNqBackdrop:
      structural.backdrop,

    structural,
    tactical,
    fastTactical,
    moveCharacter: move,
    liveMonitor,
    squeezeV2Observation,
    trapDetection,

    marketCharacter: {
      liquidity:
        trapDetection?.liquidity || null,

      move: {
        // Canonical MOVE v2 authority.
        parent:
          move?.parent ||
          move?.directionalMoveParent ||
          null,

        // Companion evidence only; may never overwrite parent.
        character:
          move?.character || null,

        // Diagnostic-only 10m / 20m condition measured against parent.
        liveCondition: {
          timeframe:
            liveMonitor?.timeframe ?? "10m",
          persistenceWindow:
            liveMonitor?.persistenceWindow ?? "20m",
          authority:
            liveMonitor?.authority ?? "DIAGNOSTIC_ONLY",
          direction:
            liveMonitor?.direction ?? null,
          state:
            liveMonitor?.state ?? null,
          contextVsParent:
            liveMonitor?.contextVsParent ?? null,
          persistence20m:
            liveMonitor?.guardrails?.es20Material === true,
          participation:
            liveMonitor?.participation ?? null,
          metrics:
            liveMonitor?.metrics ?? null,
          guardrails:
            liveMonitor?.guardrails ?? null,
          reasonCodes:
            liveMonitor?.reasonCodes || [],
        },

        // One-way compatibility projection FROM parent only.
        moveCharacter:
          move?.moveCharacter ?? "NO_ACTIVE_MOVE",
        direction:
          move?.direction ?? "FLAT",
        fastState:
          fastTactical?.state ?? null,
        liveDirection:
          liveMonitor?.direction ?? null,
        participation:
          liveMonitor?.participation ?? null,
        context:
          liveMonitor?.context ?? null,
      },

      trap:
        trapDetection?.trap || null,
    },

    groups:
      groups?.groups || {},

    symbols:
      compactSymbols(structure),

    confirmations:
      structural.confirmedGroups,

    warnings:
      structural.activeGroups.filter(
        (key) =>
          !structural.confirmedGroups.includes(
            key
          )
      ),

    recoveries:
      Object.entries(
        groups?.groups || {}
      )
        .filter(
          ([, group]) =>
            group?.structural?.state ===
            "RECOVERING"
        )
        .map(([key]) => key),

    missingConfirmations,

    reasonCodes:
      unique([
        ...(structural.reasonCodes || []),
        ...(tactical.reasonCodes || []),
        ...(fastTactical.reasonCodes || []),
        ...(move?.reasonCodes || []),
        ...(liveMonitor?.reasonCodes || []),
      ]),

    dataQuality: {
      marketSummary:
        market?.summary || null,

      degradedGroups:
        groups?.summary?.degradedGroups || [],

      directVixAvailable:
        Boolean(move?.directVixAvailable),

      esResolvedSymbol:
        move?.esResolvedSymbol || null,

      esLiveMonitorAvailable:
        Boolean(move?.esLiveMonitorAvailable),

      esLiveMonitorFreshness:
        move?.esLiveMonitorFreshness || null,

      liveMonitorAvailableSymbols:
        market?.summary
          ?.liveMonitorAvailableSymbols || [],

      trapDetectionAvailable:
        Boolean(trapDetection),
      trapPrimaryParticipationAvailable:
        trapDetection?.dataQuality
          ?.engine25PrimaryParticipationAvailable === true,
    },

    display: {
      overall:
        structural.state,

      overallSummary:
        structuralSummary(
          structural.state
        ),

      oneWeek: {
        state:
          structural.state,

        label:
          structural.state,

        summary:
          structuralSummary(
            structural.state
          ),
      },

      oneHour: {
        state:
          tactical.state,

        label:
          tactical.state,

        summary:
          tacticalSummary(
            tactical.state
          ),
      },

      thirtyMinute: {
        state:
          fastTactical.state,

        moveCharacter:
          move?.moveCharacter ?? null,

        status:
          move?.display?.status ?? null,

        summary:
          move?.display?.summary ?? null,
      },

      liveMonitor: {
        timeframe:
          liveMonitor?.timeframe ??
          "10m",

        persistenceWindow:
          liveMonitor
            ?.persistenceWindow ??
          "20m",

        authority:
          liveMonitor?.authority ??
          "DIAGNOSTIC_ONLY",

        anchor:
          liveMonitor?.anchor ?? null,

        state:
          liveMonitor?.state ?? null,

        direction:
          liveMonitor?.direction ?? null,

        participation:
          liveMonitor?.participation ?? null,

        context:
          liveMonitor?.context ?? null,

        contextVsParent:
          liveMonitor?.contextVsParent ?? null,

        parent30mState:
          liveMonitor
            ?.fastTacticalContext
            ?.state ?? null,

        parent30mDirection:
          liveMonitor
            ?.fastTacticalContext
            ?.direction ?? null,

        headline:
          liveMonitor
            ?.display
            ?.headline ?? null,

        summary:
          liveMonitor
            ?.display
            ?.summary ?? null,

        why:
          liveMonitor
            ?.display
            ?.why ?? [],
      },

      marketCharacter: {
        liquidity: {
          state:
            trapDetection?.liquidity?.state ??
            "NO_LIQUIDITY_EVENT",
          side:
            trapDetection?.liquidity?.side ?? null,
          level:
            trapDetection?.liquidity?.level ?? null,
          auctionResult:
            trapDetection?.liquidity?.auctionResult ??
            "NO_ACTIVE_AUCTION",
          reclaimObserved:
            trapDetection?.liquidity?.reclaimObserved === true,
        },

        move: {
          parent:
            move?.parent ||
            move?.directionalMoveParent ||
            null,
          character:
            move?.character || null,
          liveCondition: {
            state:
              liveMonitor?.state ?? null,
            direction:
              liveMonitor?.direction ?? null,
            contextVsParent:
              liveMonitor?.contextVsParent ?? null,
            persistence20m:
              liveMonitor?.guardrails?.es20Material === true,
            participation:
              liveMonitor?.participation ?? null,
          },

          // Compatibility fields remain parent-derived only.
          moveCharacter:
            move?.moveCharacter ??
            "NO_ACTIVE_MOVE",
          direction:
            move?.direction ??
            "FLAT",
          fastState:
            fastTactical?.state ??
            null,
          liveDirection:
            liveMonitor?.direction ??
            null,
          participation:
            liveMonitor?.participation ??
            null,
        },

        trap: {
          side:
            trapDetection?.trap?.side ??
            trapDetection?.trapSide ??
            "NONE",
          state:
            trapDetection?.trap?.state ??
            trapDetection?.state ??
            "NO_ACTIVE_TRAP",
          locationQuality:
            trapDetection?.trap?.locationQuality ??
            trapDetection?.locationQuality ??
            null,
          confirmationQuality:
            trapDetection?.trap?.confirmationQuality ??
            trapDetection?.confirmationQuality ??
            null,
          confirmationBlockedBy:
            trapDetection?.trap?.confirmationBlockedBy ??
            trapDetection?.confirmationBlockedBy ??
            [],
        },
      },

      trap: {
        side:
          trapDetection?.trapSide ?? "NONE",
        state:
          trapDetection?.state ?? "NO_ACTIVE_TRAP",
        locationQuality:
          trapDetection?.locationQuality ?? null,
        confirmationQuality:
          trapDetection?.confirmationQuality ?? null,
        confirmationBlockedBy:
          trapDetection?.confirmationBlockedBy || [],
      },

      underTheHood: {
        largeIndexes:
          displayGroups.headlineIndex,

        breadth:
          displayGroups.breadth,

        techLeadership:
          displayGroups.leadership,

        credit:
          displayGroups.credit,

        ratesBonds:
          displayGroups.ratesDuration,

        oil:
          displayGroups.energyInflation,

        volatility:
          displayGroups.volatility,

        financialConditions:
          displayGroups.financialConditions,

        pressure:
          move?.display
            ?.underlyingPressure ??
          null,
      },

      missingConfirmation:
        missingConfirmations,
    },
  };
}
