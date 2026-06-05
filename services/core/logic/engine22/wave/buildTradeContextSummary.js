// services/core/logic/engine22/wave/buildTradeContextSummary.js
// Engine 22G — Trade Context Summary Builder
//
// Purpose:
// Convert raw waveFibState facts into one clean trader-facing summary object.
// This is read-only.
// It does not create trades.
// It does not change readiness/status/entries.

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function fmt(x, fallback = "—") {
  const n = Number(x);
  return Number.isFinite(n) && n !== 0 ? n.toFixed(2) : fallback;
}

function validLevel(x) {
  const n = Number(x);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).replaceAll("_", " ");
}

function getLevel(waveFibState, degree, key) {
  return waveFibState?.degrees?.[degree]?.fibProjection?.levels?.[key] ?? null;
}

function getPhase(waveFibState, degree) {
  return waveFibState?.degrees?.[degree]?.phase ?? "UNKNOWN";
}

function labelDegree(degree) {
  return String(degree || "wave").trim().toUpperCase();
}

function buildClusterSummary(waveFibState) {
  const primary1272 = getLevel(waveFibState, "primary", "e1272");
  const intermediate1618 = getLevel(waveFibState, "intermediate", "e1618");
  const microTop =
    waveFibState?.microW4AbcRisk?.topCandidate ??
    waveFibState?.abcCorrection?.priorImpulse?.end ??
    null;

  const primary1618 = getLevel(waveFibState, "primary", "e1618");
  const minor1618 = getLevel(waveFibState, "minor", "e1618");
  const intermediate2618 = getLevel(waveFibState, "intermediate", "e2618");

  const firstClusterValues = [primary1272, intermediate1618, microTop]
    .map(validLevel)
    .filter((x) => x !== null);

  const firstClusterLo = firstClusterValues.length
    ? Math.min(...firstClusterValues)
    : null;

  const firstClusterHi = firstClusterValues.length
    ? Math.max(...firstClusterValues)
    : null;

  const firstCluster = {
    label: "FIRST_MAJOR_REACTION_CLUSTER",
    lo: round2(firstClusterLo),
    hi: round2(firstClusterHi),
    primary1272: round2(validLevel(primary1272)),
    intermediate1618: round2(validLevel(intermediate1618)),
    microTop: round2(validLevel(microTop)),
    display:
      Number.isFinite(firstClusterLo) && Number.isFinite(firstClusterHi)
        ? `${fmt(firstClusterLo)}–${fmt(firstClusterHi)}`
        : "—",
    message: `First major W5 fib cluster was hit near 745–750: Primary 1.272 near ${fmt(
      primary1272
    )}, Intermediate 1.618 near ${fmt(intermediate1618)}, Micro W3 top candidate near ${fmt(
      microTop
    )}.`,
  };

  const nextClusterValues = [primary1618, minor1618, intermediate2618]
    .map(validLevel)
    .filter((x) => x !== null);

  const nextClusterLo = nextClusterValues.length
    ? Math.min(...nextClusterValues)
    : null;

  const nextClusterHi = nextClusterValues.length
    ? Math.max(...nextClusterValues)
    : null;

  const nextCluster = {
    label: "NEXT_MAJOR_W5_REACTION_CLUSTER",
    lo: round2(nextClusterLo),
    hi: round2(nextClusterHi),
    primary1618: round2(validLevel(primary1618)),
    minor1618: round2(validLevel(minor1618)),
    intermediate2618: round2(validLevel(intermediate2618)),
    display:
      Number.isFinite(nextClusterLo) && Number.isFinite(nextClusterHi)
        ? `${fmt(nextClusterLo)}–${fmt(nextClusterHi)}`
        : "—",
    message: `Next major higher-degree cluster is ${fmt(nextClusterLo)}–${fmt(
      nextClusterHi
    )}: Primary 1.618 near ${fmt(primary1618)}, Minor 1.618 near ${fmt(
      minor1618
    )}, Intermediate 2.618 near ${fmt(intermediate2618)}.`,
  };

  return {
    firstCluster,
    nextCluster,
  };
}

function buildWaveStackSummary(waveFibState) {
  const primary = getPhase(waveFibState, "primary");
  const intermediate = getPhase(waveFibState, "intermediate");
  const minor = getPhase(waveFibState, "minor");
  const minute = getPhase(waveFibState, "minute");
  const micro = getPhase(waveFibState, "micro");

  const higherW5Active =
    primary === "IN_W5" &&
    intermediate === "IN_W5";

  const longTermBullish =
    higherW5Active &&
    (minor === "IN_W5" || minor === "IN_W4");

  return {
    primary,
    intermediate,
    minor,
    minute,
    micro,
    longTermBullish,
    display: `Primary ${text(primary).replace("IN ", "")} | Intermediate ${text(
      intermediate
    ).replace("IN ", "")} | Minor ${text(minor).replace("IN ", "")} | Minute ${text(
      minute
    ).replace("IN ", "")} | Micro ${text(micro).replace("IN ", "")}`,
    message: longTermBullish
      ? minor === "IN_W4"
        ? "Higher wave structure is still bullish because Primary and Intermediate are in W5 while Minor W4 is forming."
        : "Long-term structure is still bullish because Primary / Intermediate / Minor / Minute are in W5."
      : "Long-term wave stack is mixed or not fully aligned.",
  };
}

function buildDamagedMicroSummary({ waveFibState, waveStack, clusters }) {
  const abc = waveFibState?.abcCorrection || {};
  const risk = waveFibState?.microW4AbcRisk || {};
  const duration = waveFibState?.waveDuration || {};

  const topCandidate =
    risk?.topCandidate ??
    abc?.priorImpulse?.end ??
    clusters?.firstCluster?.microTop ??
    null;

  const hardInvalidation =
    abc?.hardInvalidation ??
    risk?.hardInvalidation ??
    null;

  const reclaimDisplay =
    abc?.reclaimDisplay ??
    "738.10 → 740.54/740.67 → 742.25 → 743.00/743.96";

  const aLow = abc?.abc?.aLow;
  const bHigh = abc?.abc?.bHigh;
  const cLow = abc?.abc?.cLow;

  const cBelow786 =
    abc?.cZone === "BELOW_786_ABOVE_INVALIDATION" ||
    risk?.currentZone === "BELOW_786_DEEP_DAMAGE_ZONE";

  const microDuration = duration?.degrees?.micro || {};
  const elapsedHours = microDuration?.elapsedHours;

  const durationRead =
    elapsedHours != null
      ? `Micro W4 has been active for ${Number(elapsedHours).toFixed(
          2
        )} clock hours, so this correction is overdue by clock time.`
      : "Micro W4 duration is unavailable.";

  const summary =
    `${waveStack.message}\n\n` +
    `But the first major fib cluster was hit near 745–750:\n` +
    `Primary 1.272 near ${fmt(clusters.firstCluster.primary1272)}\n` +
    `Intermediate 1.618 near ${fmt(clusters.firstCluster.intermediate1618)}\n` +
    `Micro W3 top candidate near ${fmt(topCandidate)}\n\n` +
    `That cluster caused a reaction.\n\n` +
    `Micro W4 then formed an ABC correction:\n` +
    `A = ${fmt(aLow)}\n` +
    `B = ${fmt(bHigh)}\n` +
    `C = ${fmt(cLow)}\n\n` +
    `C is below the 78.6% retrace but still above ${fmt(
      hardInvalidation
    )} hard invalidation.\n\n` +
    `So ${fmt(topCandidate)}–750 is the working short-term top unless price reclaims.\n\n` +
    `Micro W5 is not dead, but it is not valid yet.\n` +
    `It needs reclaim first.\n\n` +
    `If ${fmt(hardInvalidation)} breaks, the Micro impulse is invalidated and the ${fmt(
      topCandidate
    )} high becomes much more important as a confirmed local top.`;

  return {
    headline: `MICRO W4 ABC DAMAGED — ${fmt(topCandidate)} WORKING TOP`,
    subheadline: "No chase long. Micro W5 is not dead, but it is not valid yet. It needs reclaim first.",
    bias: "BULLISH_BUT_DAMAGED",
    action: "WAIT_FOR_RECLAIM",
    direction: "NONE",
    chaseAllowed: false,
    severity: "danger",

    topCandidate: round2(topCandidate),
    hardInvalidation: round2(hardInvalidation),
    reclaimLadder: reclaimDisplay,

    firstCluster: clusters.firstCluster,
    nextCluster: clusters.nextCluster,

    abc: {
      aLow: round2(aLow),
      bHigh: round2(bHigh),
      cLow: round2(cLow),
      abcStatus: abc?.abcStatus || null,
      cZone: abc?.cZone || null,
      cBelow786,
    },

    duration: {
      activeDegree: duration?.activeDegree || null,
      activeWave: duration?.activeWave || null,
      activePhase: duration?.activePhase || null,
      elapsedHours: round2(elapsedHours),
      activeMaturityState: duration?.activeMaturityState || null,
      activeTimeRisk: duration?.activeTimeRisk || null,
      activeMaturityStateByBars: duration?.activeMaturityStateByBars || null,
      activeTimeRiskByBars: duration?.activeTimeRiskByBars || null,
      durationRead,
    },

    reads: {
      structureRead: waveStack.message,
      clusterRead: clusters.firstCluster.message,
      nextClusterRead: clusters.nextCluster.message,
      abcRead: `Micro W4 formed an ABC correction: A = ${fmt(aLow)}, B = ${fmt(
        bHigh
      )}, C = ${fmt(cLow)}.`,
      damageRead: `C is below the 78.6% retrace but still above ${fmt(
        hardInvalidation
      )} hard invalidation.`,
      workingTopRead: `${fmt(topCandidate)}–750 is the working short-term top unless price reclaims.`,
      reclaimRead: `Micro W5 is only valid after reclaim: ${reclaimDisplay}.`,
      invalidationRead: `If ${fmt(
        hardInvalidation
      )} breaks, the Micro impulse is invalidated and the ${fmt(
        topCandidate
      )} high becomes the confirmed local top.`,
      actionRead: "No chase long. Wait for reclaim before Micro W5 trigger.",
    },

    summary,

    reasonCodes: [
      "TRADE_CONTEXT_SUMMARY_BUILT",
      "LONG_TERM_W5_STRUCTURE_ACTIVE",
      "FIRST_MAJOR_CLUSTER_HIT_745_750",
      "MICRO_W4_ABC_DAMAGED",
      "C_LOW_BELOW_786",
      "MICRO_W5_REQUIRES_RECLAIM",
      "NO_CHASE_LONG",
    ],
  };
}

function buildActiveW4PullbackSummary({ waveFibState, waveStack, clusters }) {
  const activeDegree = waveFibState?.activeTradingDegree || "unknown";
  const activeSetup = waveFibState?.activeSetup || "NO_SETUP";
  const activeBlock = waveFibState?.degrees?.[activeDegree] || {};

  const priorHigh =
    activeBlock?.anchors?.w3 ??
    activeBlock?.fibProjection?.anchors?.w3 ??
    null;

  const minuteMissing = waveFibState?.degrees?.minute?.phase === "UNKNOWN";
  const microMissing = waveFibState?.degrees?.micro?.phase === "UNKNOWN";

  const degreeLabel = labelDegree(activeDegree);

  const summary =
    `${waveStack.message}\n\n` +
    `${degreeLabel} W4 pullback is active after W3 completed${
      priorHigh ? ` near ${fmt(priorHigh)}` : ""
    }.\n\n` +
    (minuteMissing || microMissing
      ? `Minute/Micro execution waves are not marked yet.\n\n`
      : "") +
    `${clusters.nextCluster.message}\n\n` +
    `This is not a clean long yet. Wait for reclaim and lower-timeframe confirmation.`;

  return {
    headline: `${degreeLabel} W4 PULLBACK — WAIT FOR RECLAIM`,
    subheadline:
      "Higher wave structure is still active, but the current W4 pullback needs reclaim confirmation.",
    bias: "BULLISH_BUT_PULLING_BACK",
    action: "WAIT_FOR_RECLAIM",
    direction: "NONE",
    chaseAllowed: false,
    severity: "warning",

    topCandidate: round2(priorHigh),
    hardInvalidation: null,
    reclaimLadder: null,

    firstCluster: clusters.firstCluster,
    nextCluster: clusters.nextCluster,

    abc: null,

    reads: {
      structureRead: waveStack.message,
      activePullbackRead: `${degreeLabel} W4 pullback is active after W3 completed${
        priorHigh ? ` near ${fmt(priorHigh)}` : ""
      }.`,
      lowerWaveRead:
        minuteMissing || microMissing
          ? "Minute/Micro execution waves are not marked yet."
          : "Lower execution waves are available.",
      nextClusterRead: clusters.nextCluster.message,
      actionRead:
        "No chase long. Wait for reclaim and lower-timeframe confirmation.",
    },

    summary,

    reasonCodes: [
      "TRADE_CONTEXT_SUMMARY_BUILT",
      "ACTIVE_W4_PULLBACK",
      minuteMissing || microMissing
        ? "LOWER_EXECUTION_WAVES_MISSING"
        : "LOWER_EXECUTION_WAVES_AVAILABLE",
      "WAIT_FOR_RECLAIM",
      activeSetup,
    ],
  };
}

function buildActiveW5ExtensionSummary({ waveFibState, waveStack, clusters }) {
  const activeDegree = waveFibState?.activeTradingDegree || "unknown";
  const activeSetup = waveFibState?.activeSetup || "NO_SETUP";
  const activeBlock = waveFibState?.degrees?.[activeDegree] || {};

  const degreeLabel = labelDegree(activeDegree);

  const extensionLevels = activeBlock?.fibProjection?.levels || {};
  const e100 = validLevel(extensionLevels?.e100);
  const e1272 = validLevel(extensionLevels?.e1272);
  const e1618 = validLevel(extensionLevels?.e1618);

  const microMissing = waveFibState?.degrees?.micro?.phase === "UNKNOWN";

  const summary =
    `${waveStack.message}\n\n` +
    `${degreeLabel} W5 extension is active.\n\n` +
    `Continuation is possible, but this is not a chase entry.\n\n` +
    (e100 || e1272 || e1618
      ? `Key ${degreeLabel} W5 extension levels: 1.000 near ${fmt(e100)}, 1.272 near ${fmt(
          e1272
        )}, 1.618 near ${fmt(e1618)}.\n\n`
      : "") +
    (microMissing
      ? `Micro execution waves are not marked yet, so keep this as WATCH only.\n\n`
      : "") +
    `${clusters.nextCluster.message}\n\n` +
    `Watch for controlled pullback, reclaim, or continuation trigger confirmation. Do not chase extended price.`;

  return {
    headline: `${degreeLabel} W5 EXTENSION ACTIVE — WATCH CONTINUATION`,
    subheadline:
      "W5 extension is active. Continuation is possible, but this is not a chase entry.",
    bias: "BULLISH_CONTINUATION",
    action: "WATCH",
    direction: "LONG",
    chaseAllowed: false,
    severity: "info",

    topCandidate: null,
    hardInvalidation: null,
    reclaimLadder: null,

    firstCluster: clusters.firstCluster,
    nextCluster: clusters.nextCluster,

    activeExtension: {
      degree: activeDegree,
      setup: activeSetup,
      e100: round2(e100),
      e1272: round2(e1272),
      e1618: round2(e1618),
    },

    abc: null,

    reads: {
      structureRead: waveStack.message,
      activeExtensionRead: `${degreeLabel} W5 extension is active.`,
      continuationRead:
        "Continuation is possible, but this is not a chase entry.",
      lowerWaveRead: microMissing
        ? "Micro execution waves are not marked yet. Keep this as WATCH only."
        : "Lower execution waves are available.",
      nextClusterRead: clusters.nextCluster.message,
      actionRead:
        "Watch for controlled pullback, reclaim, or continuation trigger confirmation. Do not chase extended price.",
    },

    summary,

    needs: [
      "NO_CHASE_LONG",
      "CONTROLLED_PULLBACK_OR_RECLAIM",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE15_READY_OR_PAPER_READY",
    ],

    reasonCodes: [
      "TRADE_CONTEXT_SUMMARY_BUILT",
      "ACTIVE_W5_EXTENSION",
      "BULLISH_CONTINUATION_WATCH",
      microMissing ? "MICRO_EXECUTION_WAVES_MISSING" : "MICRO_EXECUTION_WAVES_AVAILABLE",
      "NO_CHASE_LONG",
      activeSetup,
    ],
  };
}

function buildLifecycleSummary({ waveFibState, waveStack, clusters }) {
  const lifecycle = waveFibState?.lifecycle || {};
  const abc = lifecycle?.abcCorrection || null;

  const summary =
    `${waveStack.message}\n\n` +
    `${lifecycle.summary || "Lower-degree W5 completion / ABC correction is active."}\n\n` +
    `This blocks fresh parent W5 continuation. Wait for ABC completion or a new lower-degree W2/W4 setup.`;

  return {
    headline:
      lifecycle?.headline ||
      "LOWER-DEGREE W5 COMPLETE — ABC CORRECTION WATCH",
    subheadline:
      "Parent W5 is context only. No fresh long from parent W5 while ABC correction is active.",
    bias: "BULLISH_CONTEXT_ONLY",
    action: "WAIT",
    direction: "NONE",
    chaseAllowed: false,
    severity: "warning",

    topCandidate: null,
    hardInvalidation: null,
    reclaimLadder: null,

    firstCluster: clusters.firstCluster,
    nextCluster: clusters.nextCluster,

    lifecycleState: lifecycle?.lifecycleState || null,
    parentContextOnly: lifecycle?.parentContextOnly === true,
    tradeableOpportunityBlocked:
      lifecycle?.tradeableOpportunityBlocked === true,
    nextAllowedSetup: lifecycle?.nextAllowedSetup || null,

    abcCorrection: abc,
    abc: abc
      ? {
          degree: abc?.degree || null,
          state: abc?.state || null,
          a: abc?.a || null,
          b: abc?.b || null,
          c: abc?.c || null,
          range: abc?.range ?? null,
          reclaimLevels: abc?.reclaimLevels || null,
          downsideTargets: abc?.downsideTargets || null,
        }
      : null,

    reads: {
      structureRead: waveStack.message,
      lifecycleRead:
        lifecycle?.summary ||
        "Lower-degree W5 completion / ABC correction is active.",
      abcRead: abc?.active
        ? `${String(abc.degree || "lower").toUpperCase()} ABC correction is ${abc.state}.`
        : "No active ABC correction map is available.",
      actionRead:
        "No new long from parent W5 context. Wait for ABC completion or a new lower-degree W2/W4 setup.",
    },

    summary,

    needs:
      lifecycle?.needs || [
        "WAIT_FOR_ABC_COMPLETION",
        "WAIT_FOR_NEW_W2_OR_W4_SETUP",
        "NO_NEW_LONG_FROM_PARENT_W5_CONTEXT",
      ],

    reasonCodes: [
      "TRADE_CONTEXT_SUMMARY_BUILT",
      ...(lifecycle?.reasonCodes || []),
    ],
  };
}

function buildDefaultSummary({ waveFibState, waveStack, clusters }) {
  return {
    headline: "WAVE/FIB STATE",
    subheadline: "Waiting for a clearer wave/fib context.",
    bias: "MIXED_OR_UNKNOWN",
    action: "WAIT",
    direction: "NONE",
    chaseAllowed: false,
    severity: "neutral",
    topCandidate: waveFibState?.microW4AbcRisk?.topCandidate ?? null,
    hardInvalidation: waveFibState?.abcCorrection?.hardInvalidation ?? null,
    reclaimLadder: waveFibState?.abcCorrection?.reclaimDisplay ?? null,
    firstCluster: clusters.firstCluster,
    nextCluster: clusters.nextCluster,
    reads: {
      structureRead: waveStack.message,
      clusterRead: clusters.firstCluster.message,
      nextClusterRead: clusters.nextCluster.message,
      actionRead: "Wait for clearer confirmation.",
    },
    summary: waveFibState?.summary || "Wave/fib context is still developing.",
    reasonCodes: ["TRADE_CONTEXT_SUMMARY_DEFAULT"],
  };
}

export function buildTradeContextSummary({ waveFibState = null } = {}) {
  if (!waveFibState || typeof waveFibState !== "object") {
    return {
      ok: false,
      headline: "WAVE/FIB STATE UNAVAILABLE",
      bias: "UNKNOWN",
      action: "WAIT",
      chaseAllowed: false,
      severity: "neutral",
      summary: "Wave/fib state is unavailable.",
      reasonCodes: ["MISSING_WAVE_FIB_STATE"],
    };
  }

  const waveStack = buildWaveStackSummary(waveFibState);
  const clusters = buildClusterSummary(waveFibState);

  const lifecycle = waveFibState?.lifecycle || null;

  if (lifecycle?.tradeableOpportunityBlocked === true) {
    return {
      ok: true,
      ...buildLifecycleSummary({
        waveFibState,
        waveStack,
        clusters,
      }),
    };
  }

  const abc = waveFibState?.abcCorrection || null;
  const risk = waveFibState?.microW4AbcRisk || null;

  const isDamagedAbc =
    abc?.active === true &&
    abc?.state === "ABC_C_LEG_DEEP_DAMAGED";

  const isDamagedRisk =
    risk?.active === true &&
    String(risk?.state || "").toUpperCase().includes("DAMAGED");

  if (isDamagedAbc || isDamagedRisk) {
    return {
      ok: true,
      ...buildDamagedMicroSummary({
        waveFibState,
        waveStack,
        clusters,
      }),
    };
  }

  const activeDegree = waveFibState?.activeTradingDegree || null;
  const activePhase = activeDegree
    ? waveFibState?.degrees?.[activeDegree]?.phase
    : null;

  const activeSetup = String(waveFibState?.activeSetup || "").toUpperCase();

  const isW5Extension =
    activeSetup.includes("W5_EXTENSION") ||
    activeSetup.includes("W5_CONTINUATION");

  if (activePhase === "IN_W4") {
    return {
      ok: true,
      ...buildActiveW4PullbackSummary({
        waveFibState,
        waveStack,
        clusters,
      }),
    };
  }

  if (isW5Extension) {
    return {
      ok: true,
      ...buildActiveW5ExtensionSummary({
        waveFibState,
        waveStack,
        clusters,
      }),
    };
  }

  return {
    ok: true,
    ...buildDefaultSummary({
      waveFibState,
      waveStack,
      clusters,
    }),
  };
}

export default buildTradeContextSummary;
