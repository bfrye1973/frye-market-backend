// services/core/logic/engine22/decisions/buildWaveTradeDecision.js
// Engine 22G Paper Trade Decision Builder
//
// Purpose:
// Convert the clean Engine 22G wave/fib read into a PAPER_ONLY trade decision.
//
// This file does NOT:
// - place trades
// - route orders
// - call brokers
// - choose option contracts
// - execute live trades
//
// It only produces:
// engine22WaveStrategy.tradeDecision

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(x) {
  return String(x || "").trim().toUpperCase();
}

function compact(arr = []) {
  return arr.filter(Boolean);
}

function unique(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function isEngine3Confirmed(reactionContext = null) {
  if (!reactionContext || typeof reactionContext !== "object") return false;

  const score = toNum(
    reactionContext?.score ??
      reactionContext?.reactionScore ??
      reactionContext?.qualityScore
  );

  return (
    reactionContext?.breakoutIgnition?.active === true ||
    reactionContext?.confirmed === true ||
    reactionContext?.armed === true ||
    (score !== null && score >= 70)
  );
}

function isEngine4Confirmed(volumeContext = null) {
  if (!volumeContext || typeof volumeContext !== "object") return false;

  const score = toNum(
    volumeContext?.score ??
      volumeContext?.volumeScore ??
      volumeContext?.breakoutParticipation?.score
  );

  return (
    volumeContext?.breakoutParticipation?.confirmed === true ||
    volumeContext?.confirmed === true ||
    volumeContext?.volumeConfirmed === true ||
    (score !== null && score >= 10)
  );
}

function isEngine15Ready(engine15 = null) {
  if (!engine15 || typeof engine15 !== "object") return false;

  const readiness = upper(
    engine15?.readinessLabel ??
      engine15?.readiness ??
      engine15?.status
  );

  return ["READY", "PAPER_READY"].includes(readiness);
}

function mapActionToDecision(actionRaw) {
  const action = upper(actionRaw);

  if (action === "WAIT_FOR_RECLAIM") return "WAIT";
  if (action === "WATCH_FOR_RECLAIM") return "WATCH";
  if (action === "PAPER_READY") return "PAPER_READY";
  if (action === "BLOCKED") return "BLOCKED";
  if (action === "WAIT") return "WAIT";
  if (action === "WATCH") return "WATCH";

  return "WAIT";
}

function isShortSetup(activeSetup, directionRaw) {
  const setup = upper(activeSetup);
  const direction = upper(directionRaw);

  return (
    direction === "SHORT" ||
    setup.includes("SHORT") ||
    setup.includes("BEAR") ||
    setup.includes("BREAKDOWN")
  );
}

function buildNeeds({
  abcDamaged,
  action,
  engine3Confirmed,
  engine4Confirmed,
  engine15Ready,
} = {}) {
  const needs = [];

  if (abcDamaged || action === "WAIT_FOR_RECLAIM" || action === "WATCH_FOR_RECLAIM") {
    needs.push("RECLAIM_LADDER");
  }

  if (!engine3Confirmed) {
    needs.push("ENGINE3_REACTION_CONFIRMATION");
  }

  if (!engine4Confirmed) {
    needs.push("ENGINE4_PARTICIPATION_CONFIRMATION");
  }

  if (!engine15Ready) {
    needs.push("ENGINE15_READY_OR_PAPER_READY");
  }

  return unique(needs);
}

function buildTargets({ waveFibState = null } = {}) {
  const activeExtension =
    waveFibState?.activeExtension ??
    waveFibState?.waveExtension ??
    waveFibState?.activeWaveExtension ??
    waveFibState?.extensions?.active ??
    null;

  const targetZones =
    activeExtension?.targetZones ??
    activeExtension?.targets ??
    null;

  const defaultTarget =
    activeExtension?.targetZone ??
    null;

  return {
    p1:
      targetZones?.e1618 ??
      defaultTarget ??
      null,
    p2:
      targetZones?.e200 ??
      null,
    p3:
      targetZones?.e2618 ??
      null,
    raw: {
      activeExtension,
      targetZones,
      defaultTarget,
    },
  };
}

function buildEntryPlan({
  decision,
  direction,
  topCandidate,
  reclaimLadder,
  action,
  setupType,
} = {}) {
  return {
    decision,
    direction,
    setupType,
    entryStyle:
      decision === "PAPER_READY"
        ? "PAPER_ENTRY_ALLOWED_AFTER_RECLAIM_CONFIRMATION"
        : action === "WAIT_FOR_RECLAIM"
          ? "WAIT_FOR_RECLAIM"
          : action === "WATCH_FOR_RECLAIM"
            ? "WATCH_RECLAIM_LADDER"
            : "NO_ENTRY",
    topCandidate,
    reclaimLadder,
    chaseAllowed: false,
    notes:
      decision === "PAPER_READY"
        ? "Paper entry is allowed only because reclaim and confirmation gates passed."
        : "No paper entry yet. Wait for reclaim and confirmation gates.",
  };
}

function buildInvalidation({ hardInvalidation } = {}) {
  return {
    hardInvalidation,
    stopReference: hardInvalidation,
    rule:
      hardInvalidation !== null
        ? "Block or invalidate setup if price loses hard invalidation."
        : "No hard invalidation available yet.",
  };
}

function currentPriceFromEngine22(engine22WaveStrategy = null) {
  return round2(
    engine22WaveStrategy?.currentPrice ??
      engine22WaveStrategy?.waveFibState?.currentPrice ??
      engine22WaveStrategy?.tradeContextSummary?.currentPrice
  );
}

export function buildWaveTradeDecision({
  engine22WaveStrategy = null,
  engine15 = null,
  engine16 = null,
  reactionContext = null,
  volumeContext = null,
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
} = {}) {
  const action = upper(engine22WaveStrategy?.action || "WAIT");
  const mappedDecision = mapActionToDecision(action);

  const waveFibState = engine22WaveStrategy?.waveFibState || null;
  const abcCorrection = waveFibState?.abcCorrection || null;

  const setupType =
    engine22WaveStrategy?.activeSetup ||
    waveFibState?.activeSetup ||
    "UNKNOWN";

  const topCandidate = round2(
    engine22WaveStrategy?.topCandidate ??
      waveFibState?.microW4AbcRisk?.topCandidate
  );

  const hardInvalidation = round2(
    engine22WaveStrategy?.hardInvalidation ??
      abcCorrection?.hardInvalidation ??
      waveFibState?.microW4AbcRisk?.hardInvalidation
  );

  const reclaimLadder =
    engine22WaveStrategy?.reclaimLadder ??
    abcCorrection?.reclaimDisplay ??
    null;

  const currentPrice = currentPriceFromEngine22(engine22WaveStrategy);

  const abcDamaged =
    abcCorrection?.state === "ABC_C_LEG_DEEP_DAMAGED" ||
    abcCorrection?.cleanW5PathDamaged === true;

  const microW5NeedsReclaim =
    abcCorrection?.microW5NeedsReclaim === true ||
    action === "WAIT_FOR_RECLAIM" ||
    action === "WATCH_FOR_RECLAIM";

  const hardInvalidationBroken =
    currentPrice !== null &&
    hardInvalidation !== null &&
    currentPrice < hardInvalidation;

  const engine3Confirmed = isEngine3Confirmed(reactionContext);
  const engine4Confirmed = isEngine4Confirmed(volumeContext);
  const engine15Ready = isEngine15Ready(engine15);

  const allConfirmationGatesPassed =
    engine3Confirmed &&
    engine4Confirmed &&
    engine15Ready;

  let decision = mappedDecision;
  let direction = "NONE";
  let grade = "NO_TRADE";
  let entryAllowed = false;
  let chaseAllowed = false;
  let reason = "No paper trade decision available yet.";

  const reasonCodes = ["PAPER_ONLY"];

  if (hardInvalidationBroken) {
    decision = "BLOCKED";
    direction = "NONE";
    grade = "BLOCKED";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "Hard invalidation is broken. Setup is blocked.";
    reasonCodes.push("HARD_INVALIDATION_BROKEN", "BLOCKED");

  } else if (abcDamaged) {
    decision = "WAIT";
    direction = "NONE";
    grade = "NO_TRADE";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "Micro W4 ABC is damaged. Micro W5 needs reclaim first.";
    reasonCodes.push("MICRO_W4_ABC_DAMAGED", "NO_CHASE_LONG", "WAIT_FOR_RECLAIM");

  } else if (microW5NeedsReclaim && !allConfirmationGatesPassed) {
    decision = "WATCH";
    direction = "LONG";
    grade = "WATCH";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "Micro W5 reclaim is on watch, but confirmation gates are not complete.";
    reasonCodes.push("WATCH_FOR_RECLAIM", "NO_CHASE_LONG");

  } else if (
    ["PAPER_READY", "WATCH_FOR_RECLAIM", "WATCH"].includes(action) &&
    allConfirmationGatesPassed
  ) {
    decision = "PAPER_READY";
    direction = "LONG";
    grade = "PAPER_READY";
    entryAllowed = true;
    chaseAllowed = false;
    reason = "Reclaim and confirmation gates passed. Paper trade is ready only.";
    reasonCodes.push(
      "RECLAIM_CONFIRMED",
      "ENGINE3_CONFIRMED",
      "ENGINE4_CONFIRMED",
      "ENGINE15_READY_OR_PAPER_READY"
    );

  } else if (decision === "BLOCKED") {
    direction = "NONE";
    grade = "BLOCKED";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "Engine 22G action is blocked.";
    reasonCodes.push("ENGINE22_ACTION_BLOCKED");

  } else if (decision === "WATCH") {
    direction = "LONG";
    grade = "WATCH";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "Setup is on watch. Confirmation is still required.";
    reasonCodes.push("WATCH", "NO_CHASE_LONG");

  } else {
    decision = "WAIT";
    direction = "NONE";
    grade = "NO_TRADE";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "No paper entry yet. Wait for reclaim and confirmation.";
    reasonCodes.push("WAIT", "NO_CHASE_LONG");
  }

  // Safety: no blind shorts in v1.
  if (direction === "SHORT" && !isShortSetup(setupType, direction)) {
    decision = "BLOCKED";
    direction = "NONE";
    grade = "BLOCKED";
    entryAllowed = false;
    chaseAllowed = false;
    reason = "Short setup blocked. Engine 22G did not explicitly confirm a short setup.";
    reasonCodes.push("NO_BLIND_SHORT", "SHORT_BLOCKED_V1");
  }

  const needs = buildNeeds({
    abcDamaged,
    action,
    engine3Confirmed,
    engine4Confirmed,
    engine15Ready,
  });

  const entryPlan = buildEntryPlan({
    decision,
    direction,
    topCandidate,
    reclaimLadder,
    action,
    setupType,
  });

  const invalidation = buildInvalidation({
    hardInvalidation,
  });

  const targets = buildTargets({
    waveFibState,
  });

  return {
    mode: "PAPER_ONLY",
    engine: "engine22.tradeDecision.v1",
    symbol,
    strategyId,

    decision,
    direction,
    setupType,
    grade,

    entryAllowed,
    chaseAllowed,

    reason,

    currentPrice,
    topCandidate,
    hardInvalidation,
    reclaimLadder,

    entryPlan,
    invalidation,
    targets,

    needs,
    reasonCodes: unique(reasonCodes),

    confirmations: {
      engine3Confirmed,
      engine4Confirmed,
      engine15Ready,
      allConfirmationGatesPassed,
    },

    context: {
      action,
      bias: engine22WaveStrategy?.bias || null,
      severity: engine22WaveStrategy?.severity || null,
      activeTradingDegree: engine22WaveStrategy?.activeTradingDegree || null,
      abcCorrectionState: abcCorrection?.state || null,
      abcDamaged,
      microW5NeedsReclaim,
      hardInvalidationBroken,
      engine15Readiness:
        engine15?.readinessLabel ??
        engine15?.readiness ??
        null,
      engine16State:
        engine16?.state ??
        engine16?.readinessLabel ??
        null,
    },

    safety: {
      liveTradingEnabled: false,
      brokerCallsEnabled: false,
      orderRoutingEnabled: false,
      optionsExecutionEnabled: false,
      paperOnly: true,
      noBlindShorts: true,
    },
  };
}

export default buildWaveTradeDecision;
