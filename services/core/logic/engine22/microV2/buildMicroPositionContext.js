// Micro Position Awareness v1
//
// Read-only comparison between:
// - Engine 22 Micro structural/timing truth
// - Engine 10 canonical OPEN trade truth
//
// This module never mutates positions, permission, sizing, management,
// execution, or journal state.

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDirection(value) {
  const v = upper(value);

  if (["LONG", "UP", "BUY", "BULL", "BULLISH"].includes(v)) {
    return "LONG";
  }

  if (["SHORT", "DOWN", "SELL", "BEAR", "BEARISH"].includes(v)) {
    return "SHORT";
  }

  if (v.includes("LONG")) return "LONG";
  if (v.includes("SHORT")) return "SHORT";

  return "NEUTRAL";
}

function normalizeRoot(value) {
  const v = upper(value)
    .replace(/^\//, "")
    .replace(/:.*$/, "");

  if (v.startsWith("MES")) return "ES";
  if (v.startsWith("ES")) return "ES";

  return v || null;
}

function remainingQty(trade) {
  return (
    num(trade?.qty?.remainingQty) ??
    num(trade?.remainingQty) ??
    num(trade?.entry?.qty) ??
    0
  );
}

function weightedAverageLots(trade) {
  const lots =
    trade?.realBroker?.remainingLots ??
    trade?.brokerImport?.remainingLots ??
    null;

  if (!Array.isArray(lots) || lots.length === 0) {
    return null;
  }

  let qty = 0;
  let notional = 0;

  for (const lot of lots) {
    const q = num(lot?.qty) ?? 1;
    const p = num(lot?.price);

    if (q <= 0 || p == null) continue;

    qty += q;
    notional += q * p;
  }

  return qty > 0
    ? Number((notional / qty).toFixed(2))
    : null;
}

function entryPrice(trade) {
  return (
    weightedAverageLots(trade) ??
    num(trade?.entry?.price) ??
    num(trade?.openingPlan?.officialEntryPrice) ??
    null
  );
}

function tradeOpenTime(trade) {
  return (
    trade?.summary?.openTime ??
    trade?.entry?.time ??
    trade?.createdAt ??
    null
  );
}

function waveDirectionToTradeDirection(value) {
  const v = upper(value);
  if (v === "UP") return "LONG";
  if (v === "DOWN") return "SHORT";
  return "NEUTRAL";
}

function normalizeOpenTrade(trade) {
  const status =
    upper(trade?.status);

  const qty =
    remainingQty(trade);

  if (
    status !== "OPEN" ||
    qty <= 0
  ) {
    return null;
  }

  const root =
    normalizeRoot(
      trade?.normalizedInstrumentRoot ??
      trade?.symbol ??
      trade?.brokerSymbol
    );

  if (root !== "ES") {
    return null;
  }

  return {
    tradeId:
      trade?.tradeId ??
      trade?.identity?.tradeId ??
      null,

    accountMode:
      upper(trade?.accountMode) ||
      "UNKNOWN",

    journalAccount:
      trade?.journalAccount ??
      trade?.realBroker?.journalAccount ??
      null,

    symbol:
      trade?.symbol ??
      trade?.normalizedInstrumentRoot ??
      null,

    normalizedRoot:
      root,

    futuresContractCode:
      trade?.futuresContractCode ??
      trade?.realBroker?.futuresContractCode ??
      null,

    direction:
      normalizeDirection(
        trade?.direction ??
        trade?.identity?.direction
      ),

    remainingQty:
      qty,

    averageEntry:
      entryPrice(trade),

    openedAt:
      tradeOpenTime(trade),

    source:
      trade?.source ??
      (
        upper(trade?.accountMode) === "REAL"
          ? "ENGINE10_REAL_JOURNAL"
          : "ENGINE10_PAPER_JOURNAL"
      ),
  };
}

function toMs(value) {
  if (value == null || value === "") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12
      ? numeric
      : numeric * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function realPositionFreshness({
  position,
  realFillObserverState,
  evaluationTimeMs,
  realMaxStalenessSec,
} = {}) {
  if (position?.accountMode !== "REAL") {
    return {
      status: "NOT_REQUIRED",
      reliableForAlerts: true,
      lastSuccessfulPollAt: null,
      ageSeconds: null,
    };
  }

  const accounts =
    realFillObserverState?.accounts &&
    typeof realFillObserverState.accounts === "object"
      ? Object.values(realFillObserverState.accounts)
      : [];

  const account =
    accounts.find(
      (item) =>
        String(item?.journalAccount || "").trim().toUpperCase() ===
        String(position?.journalAccount || "").trim().toUpperCase()
    ) || null;

  const lastSuccessfulPollAt =
    account?.lastSuccessfulPollAt ?? null;

  const lastMs =
    toMs(lastSuccessfulPollAt);

  const nowMs =
    toMs(evaluationTimeMs) ??
    Date.now();

  const maxAge =
    Math.max(
      30,
      Number(realMaxStalenessSec) || 120
    );

  if (lastMs == null) {
    return {
      status: "UNKNOWN",
      reliableForAlerts: false,
      lastSuccessfulPollAt,
      ageSeconds: null,
    };
  }

  const ageSeconds =
    Math.max(
      0,
      Math.floor(
        (nowMs - lastMs) / 1000
      )
    );

  return {
    status:
      ageSeconds <= maxAge
        ? "FRESH"
        : "STALE",

    reliableForAlerts:
      ageSeconds <= maxAge,

    lastSuccessfulPollAt,

    ageSeconds,

    maxStalenessSeconds:
      maxAge,
  };
}

function severityRank(value) {
  return {
    NONE: 0,
    LOW: 1,
    MODERATE: 2,
    HIGH: 3,
    CRITICAL: 4,
  }[value] ?? 0;
}

function severityForConflict({
  timingState,
  engine3Aligned,
  engine4Aligned,
} = {}) {
  switch (upper(timingState)) {
    case "SETUP_DEVELOPING":
      return "LOW";

    case "REVERSAL_WINDOW":
      return "MODERATE";

    case "TRANSITION_CONFIRMING":
      return "HIGH";

    case "TIMING_READY":
      return (
        engine3Aligned === true &&
        engine4Aligned === true
      )
        ? "CRITICAL"
        : "HIGH";

    default:
      return "LOW";
  }
}

function guidanceFor({
  conflict,
  positionDirection,
  microDirection,
  severity,
} = {}) {
  if (!conflict) {
    return {
      posture:
        microDirection === "LONG"
          ? "LONG_FAVORING"
          : microDirection === "SHORT"
          ? "SHORT_FAVORING"
          : "NEUTRAL",

      doNotAddAgainstImpulse: false,

      actions: [
        "POSITION_ALIGNED_OR_NO_DIRECTIONAL_CONFLICT",
      ],
    };
  }

  const doNotAdd =
    ["HIGH", "CRITICAL"].includes(
      severity
    );

  const oppositeLabel =
    positionDirection === "SHORT"
      ? "SHORT"
      : "LONG";

  return {
    posture:
      "POSITION_CONFLICT",

    doNotAddAgainstImpulse:
      doNotAdd,

    actions: [
      doNotAdd
        ? `DO_NOT_ADD_${oppositeLabel}S`
        : `CAUTION_ADDING_${oppositeLabel}S`,

      `REVIEW_EXISTING_${oppositeLabel}_RISK`,

      microDirection === "LONG"
        ? "WAIT_FOR_MICRO_UP_IMPULSE_FAILURE_BEFORE_NEW_SHORT"
        : "WAIT_FOR_MICRO_DOWN_IMPULSE_FAILURE_BEFORE_NEW_LONG",
    ],
  };
}

export function buildMicroPositionContext({
  engine22WaveStrategy = null,
  engine3Reaction = null,
  engine4Participation = null,
  openTrades = [],
  currentPrice = null,
  realFillObserverState = null,
  evaluationTimeMs = null,
  realMaxStalenessSec = 120,
} = {}) {
  const micro =
    engine22WaveStrategy
      ?.microExecutionContext ||
    null;

  const positions =
    (Array.isArray(openTrades) ? openTrades : [])
      .map(normalizeOpenTrade)
      .filter(Boolean);

  const microTradeDirection =
    waveDirectionToTradeDirection(
      micro?.waveDirection
    );

  const microAvailable =
    micro &&
    micro.available !== false &&
    micro?.sourceCountId != null &&
    ![
      "INVALIDATED",
      "RECOUNT_REQUIRED",
      "HISTORICAL",
    ].includes(
      upper(micro?.countStatus)
    );

  const engine3Direction =
    normalizeDirection(
      engine3Reaction?.direction
    );

  const engine4Direction =
    normalizeDirection(
      engine4Participation?.direction
    );

  const engine3Aligned =
    ["LONG", "SHORT"].includes(
      microTradeDirection
    ) &&
    engine3Reaction?.allowed === true &&
    engine3Reaction?.reactionConfirmed === true &&
    engine3Direction === microTradeDirection;

  const engine4Aligned =
    ["LONG", "SHORT"].includes(
      microTradeDirection
    ) &&
    engine4Participation?.allowed === true &&
    engine4Participation?.participationConfirmed === true &&
    engine4Direction === microTradeDirection;

  const price =
    num(currentPrice);

  const positionReads =
    positions.map(
      (position) => {
        const conflict =
          microAvailable &&
          ["LONG", "SHORT"].includes(
            microTradeDirection
          ) &&
          ["LONG", "SHORT"].includes(
            position.direction
          ) &&
          position.direction !==
            microTradeDirection;

        const severity =
          conflict
            ? severityForConflict({
                timingState:
                  micro?.microTimingState,
                engine3Aligned,
                engine4Aligned,
              })
            : "NONE";

        const positionTruthFreshness =
          realPositionFreshness({
            position,
            realFillObserverState,
            evaluationTimeMs,
            realMaxStalenessSec,
          });

        const guidance =
          guidanceFor({
            conflict,
            positionDirection:
              position.direction,
            microDirection:
              microTradeDirection,
            severity,
          });

        const pointsFromEntry =
          price != null &&
          position.averageEntry != null
            ? Number(
                (
                  position.direction === "LONG"
                    ? price - position.averageEntry
                    : position.averageEntry - price
                ).toFixed(2)
              )
            : null;

        return {
          ...position,

          currentPrice:
            price,

          pointsFromEntry,

          microAlignment:
            !microAvailable
              ? "UNKNOWN"
              : conflict
              ? "CONFLICT"
              : (
                  position.direction ===
                  microTradeDirection
                )
              ? "ALIGNED"
              : "NEUTRAL",

          conflict,
          conflictSeverity:
            severity,

          positionTruthFreshness,

          posture:
            guidance.posture,

          doNotAddAgainstImpulse:
            guidance.doNotAddAgainstImpulse,

          guidance:
            guidance.actions,

          alertPreview:
            conflict
              ? {
                  eligible:
                    ["MODERATE", "HIGH", "CRITICAL"].includes(
                      severity
                    ) &&
                    positionTruthFreshness
                      .reliableForAlerts === true,

                  severity,

                  positionTruthStatus:
                    positionTruthFreshness.status,

                  suppressedReason:
                    positionTruthFreshness
                      .reliableForAlerts === true
                      ? null
                      : "REAL_POSITION_TRUTH_NOT_FRESH",

                  title:
                    `Micro position conflict — ${severity}`,

                  message:
                    position.direction === "SHORT"
                      ? `I see you are SHORT while Micro is ${micro?.activeWave ?? "an active wave"} ${micro?.waveDirection ?? ""} with timing state ${micro?.microTimingState ?? "UNKNOWN"}. The market structure is turning against the short. ${guidance.doNotAddAgainstImpulse ? "Do not add shorts unless the Micro impulse fails. " : ""}Review the existing short risk.`
                      : `I see you are LONG while Micro is ${micro?.activeWave ?? "an active wave"} ${micro?.waveDirection ?? ""} with timing state ${micro?.microTimingState ?? "UNKNOWN"}. The market structure is turning against the long. ${guidance.doNotAddAgainstImpulse ? "Do not add longs unless the Micro impulse fails. " : ""}Review the existing long risk.`,
                }
              : {
                  eligible: false,
                  severity: "NONE",
                  title: null,
                  message: null,
                  positionTruthStatus:
                    positionTruthFreshness.status,
                  suppressedReason: null,
                },
        };
      }
    );

  const highestSeverity =
    positionReads.reduce(
      (best, position) =>
        severityRank(
          position.conflictSeverity
        ) >
        severityRank(best)
          ? position.conflictSeverity
          : best,
      "NONE"
    );

  const anyConflict =
    positionReads.some(
      (position) =>
        position.conflict === true
    );

  const anyDoNotAdd =
    positionReads.some(
      (position) =>
        position
          .doNotAddAgainstImpulse ===
        true
    );

  return {
    active: true,

    engine:
      "micro.positionAwareness.v1",

    mode:
      "READ_ONLY",

    source:
      "ENGINE10_OPEN_TRADES_PLUS_ENGINE22_MICRO",

    sourceCountId:
      micro?.sourceCountId ??
      null,

    canonicalStateVersion:
      micro?.canonicalStateVersion ??
      null,

    microAvailable:
      Boolean(microAvailable),

    micro: {
      activeWave:
        micro?.activeWave ??
        null,

      waveDirection:
        micro?.waveDirection ??
        null,

      tradeDirection:
        microTradeDirection,

      lifecycle:
        micro?.lifecycle ??
        null,

      microTimingState:
        micro?.microTimingState ??
        null,

      countStatus:
        micro?.countStatus ??
        null,

      sourceTimestamp:
        micro?.sourceTimestamp ??
        null,
    },

    confirmation: {
      engine3Aligned,
      engine4Aligned,
    },

    positionPresent:
      positions.length > 0,

    openPositionCount:
      positions.length,

    positions:
      positionReads,

    positionConflict:
      anyConflict,

    conflictSeverity:
      highestSeverity,

    tradePosture:
      anyConflict
        ? "POSITION_CONFLICT"
        : microTradeDirection === "LONG"
        ? "LONG_FAVORING"
        : microTradeDirection === "SHORT"
        ? "SHORT_FAVORING"
        : "NEUTRAL",

    doNotAddAgainstImpulse:
      anyDoNotAdd,

    alertsPreview:
      positionReads
        .map(
          (position) =>
            position.alertPreview
        )
        .filter(
          (alert) =>
            alert?.eligible === true
        ),

    alertsSuppressed:
      positionReads
        .map(
          (position) => ({
            tradeId:
              position.tradeId,
            accountMode:
              position.accountMode,
            severity:
              position.conflictSeverity,
            positionTruthStatus:
              position.positionTruthFreshness?.status ?? null,
            reason:
              position.alertPreview?.suppressedReason ?? null,
          })
        )
        .filter(
          (item) =>
            item.reason != null
        ),

    trainingTags: [
      micro?.activeWave
        ? `MICRO_${upper(micro.activeWave)}`
        : null,

      micro?.microTimingState
        ? `MICRO_TIMING_${upper(micro.microTimingState)}`
        : null,

      anyConflict
        ? `POSITION_CONFLICT_${highestSeverity}`
        : "POSITION_NO_CONFLICT",

      anyDoNotAdd
        ? "DO_NOT_ADD_AGAINST_MICRO_IMPULSE"
        : null,
    ].filter(Boolean),

    noPermissionCreated: true,
    noPositionMutation: true,
    noOrderCreated: true,
    noSizingMutation: true,
    noManagementMutation: true,
    noExecution: true,
    noJournalMutation: true,

    reasonCodes: [
      "MICRO_POSITION_AWARENESS_EVALUATED",
      positions.length > 0
        ? "ENGINE10_OPEN_POSITION_PRESENT"
        : "ENGINE10_NO_OPEN_ES_FAMILY_POSITION",
      anyConflict
        ? "OPEN_POSITION_CONFLICTS_WITH_MICRO"
        : "NO_OPEN_POSITION_MICRO_CONFLICT",
      anyDoNotAdd
        ? "DO_NOT_ADD_AGAINST_EMERGING_MICRO_IMPULSE"
        : null,
      "READ_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_POSITION_MUTATION",
      "NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default buildMicroPositionContext;
