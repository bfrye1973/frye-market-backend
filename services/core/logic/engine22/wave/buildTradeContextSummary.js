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
  const postAbcReset = lifecycle?.postAbcReset || null;
  const postAbcState = String(postAbcReset?.state || "").toUpperCase();

    if (postAbcState === "POST_ABC_W2_BOUNCE_WATCH") {
    const supportLevel = postAbcReset?.supportLevel ?? 7400;
    const cLow = postAbcReset?.cLow ?? abc?.c?.price ?? null;
    const currentPrice =
      postAbcReset?.currentPrice ?? waveFibState?.currentPrice ?? null;

    const abcUp = postAbcReset?.abcUp || null;
    const abcUpState = String(abcUp?.state || "").toUpperCase();

    const hasAUpMarked =
      abcUpState === "A_UP_MARKED_WAITING_FOR_B_PULLBACK";

    const originLow = abcUp?.originLow ?? null;
    const waveAHigh = abcUp?.waveAHigh ?? null;
    const preferredBZone = abcUp?.preferredBZone || null;
    const deepBSupport = abcUp?.deepBSupport ?? null;
    const effectiveWaveBLow =
      abcUp?.effectiveWaveBLow ??
      abcUp?.autoWaveBLow ??
      abcUp?.waveBLow ??
      null; 

    if (hasAUpMarked) {
      const bZoneDisplay =
        preferredBZone?.lo != null && preferredBZone?.hi != null
          ? `${fmt(preferredBZone.lo)}–${fmt(preferredBZone.hi)}`
          : "—";

      const bStatus = String(abcUp?.bPullbackStatus || "").toUpperCase();
      const correctionType = String(abcUp?.correctionType || "").toUpperCase();
      const correctionQuality = String(abcUp?.correctionQuality || "").toUpperCase();

      const cUpTargets = abcUp?.cUpTargets || null;
      const cUpTargetDisplay = cUpTargets
        ? [
            ["C 1.000", cUpTargets.c100],
            ["C 1.272", cUpTargets.c1272],
            ["C 1.618", cUpTargets.c1618],
            ["C 2.000", cUpTargets.c200],
            ["C 2.618", cUpTargets.c2618],
          ]
            .filter(([, price]) => price != null)
            .map(([label, price]) => `${label}: ${fmt(price)}`)
            .join(" | ")
        : "—";

      const hasEffectiveB = validLevel(effectiveWaveBLow) !== null;

      let headline = "POST ABC COMPLETE — A UP MARKED, WAIT FOR B PULLBACK";
      let subheadline =
        "A-up is marked after ABC completion. Waiting for B pullback hold and reclaim confirmation.";
      let action = "WAIT_FOR_B_PULLBACK_HOLD_AND_RECLAIM";
      let lifecycleRead =
        "W5 and ABC correction are complete. A-up is marked and Engine 22 is waiting for B pullback.";
      let actionRead =
        "No chase. No execution. Wait for B pullback hold and reclaim confirmation.";

      if (
        bStatus === "EXPANDED_B_UNDERCUT_PREFERRED_ZONE_RECLAIMING" ||
        bStatus === "EXPANDED_B_UNDERCUT_DEEP_SUPPORT_RECLAIMING"
      ) {
        headline = "POST ABC COMPLETE — EXPANDED B RECLAIMING, C-UP WATCH";
        subheadline =
          "Structural B undercut the origin and is reclaiming. C-up watch improves, but this remains WATCH only.";
        action = "WAIT_FOR_EXPANDED_B_RECLAIM_CONFIRMATION";
        lifecycleRead =
          "W5 and ABC correction are complete. Structural B undercut the origin and is reclaiming.";
        actionRead =
          "No chase. No execution. Wait for reclaim confirmation and Engine 6 permission.";
      } else if (bStatus === "EXPANDED_B_UNDERCUT_ORIGIN_RECLAIMING") {
        headline = "POST ABC COMPLETE — EXPANDED B UNDERCUT, WAIT FOR RECLAIM";
        subheadline =
          "Structural B undercut the origin and reclaimed the origin area. Preferred B zone reclaim is still needed.";
        action = "WAIT_FOR_EXPANDED_B_PREFERRED_ZONE_RECLAIM";
        lifecycleRead =
          "W5 and ABC correction are complete. Structural B undercut the origin and reclaimed the origin area.";
        actionRead =
          "No chase. No execution. Wait for preferred B zone reclaim confirmation.";
      } else if (String(bStatus).includes("C_UP_ATTEMPT_ACTIVE")) {
        headline = "POST ABC COMPLETE — C-UP ATTEMPT ACTIVE";
        subheadline =
          "Structural B is marked and price is above the preferred B zone. C-up attempt is active, but not executable.";
        action = "WATCH_C_UP_ATTEMPT_WAIT_FOR_CONFIRMATION";
        lifecycleRead =
          "W5 and ABC correction are complete. Structural B is marked and C-up attempt is active.";
        actionRead =
          "No chase. No execution. Watch C-up targets, but wait for confirmation and Engine 6 permission.";
      } else if (bStatus === "B_PULLBACK_REACHED_PREFERRED_ZONE") {
        headline = "POST ABC COMPLETE — B ZONE TOUCHED, WAIT FOR RECLAIM";
        subheadline =
          "A-up is marked and B has reached the preferred B zone. Waiting for hold/reclaim confirmation.";
        action = "WAIT_FOR_B_ZONE_HOLD_AND_RECLAIM";
        lifecycleRead =
          "W5 and ABC correction are complete. B has reached the preferred B zone.";
        actionRead =
          "No chase. No execution. Wait for B-zone hold and reclaim confirmation.";
      } else if (hasEffectiveB) {
        headline =
          correctionType === "EXPANDED_FLAT_CANDIDATE"
            ? "POST ABC COMPLETE — EXPANDED B MARKED, C-UP WATCH"
            : "POST ABC COMPLETE — STRUCTURAL B MARKED, C-UP WATCH";
        subheadline =
          "Structural B is marked automatically. Watching for C-up behavior, but this remains WATCH only.";
        action = "WATCH_C_UP_WAIT_FOR_RECLAIM_CONFIRMATION";
        lifecycleRead =
          "W5 and ABC correction are complete. Structural B is marked automatically.";
        actionRead =
          "No chase. No execution. Wait for reclaim confirmation and Engine 6 permission.";
      }

      const summary =
        `${waveStack.message}\n\n` +
        `W5 and ABC correction are complete.\n\n` +
        `A up is marked from ${fmt(originLow)} to ${fmt(waveAHigh)}.\n\n` +
        `Structural B low: ${fmt(effectiveWaveBLow)}.\n\n` +
        `B retrace: ${
          abcUp?.bRetracePct != null ? `${abcUp.bRetracePct}%` : "—"
        }.\n\n` +
        `Correction type: ${text(abcUp?.correctionType)}.\n\n` +
        `Correction quality: ${text(correctionQuality)}.\n\n` +
        `Preferred B zone is ${bZoneDisplay}.\n\n` +
        `Deep B support is ${fmt(deepBSupport)}.\n\n` +
        `C-up targets: ${cUpTargetDisplay}.\n\n` +
        `No chase. No execution.\n\n` +
        `${actionRead}`;

      return {
        headline,
        subheadline,
        bias: "RESET_BOUNCE_WATCH",
        action,
        direction: "NONE",
        chaseAllowed: false,
        severity: "warning",

        topCandidate: round2(waveAHigh),
        hardInvalidation: round2(cLow),
        reclaimLadder: null,

        firstCluster: clusters.firstCluster,
        nextCluster: clusters.nextCluster,

        lifecycleState: lifecycle?.lifecycleState || null,
        postAbcReset,
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

        abcUp: {
          state: abcUp?.state || null,

          originLow: round2(originLow),
          originTime: abcUp?.originTime || null,

          waveAHigh: round2(waveAHigh),
          aTime: abcUp?.aTime || null,

          waveBLow:
            validLevel(abcUp?.waveBLow) !== null
              ? round2(abcUp?.waveBLow)
              : null,
          bTime: abcUp?.bTime || null,

          autoWaveBLow:
            validLevel(abcUp?.autoWaveBLow) !== null
              ? round2(abcUp?.autoWaveBLow)
              : null,
          autoBTime: abcUp?.autoBTime || null,

          effectiveWaveBLow:
            validLevel(abcUp?.effectiveWaveBLow) !== null
              ? round2(abcUp?.effectiveWaveBLow)
              : validLevel(abcUp?.autoWaveBLow) !== null
              ? round2(abcUp?.autoWaveBLow)
              : validLevel(abcUp?.waveBLow) !== null
              ? round2(abcUp?.waveBLow)
              : null,
          effectiveBTime:
            abcUp?.effectiveBTime ||
            abcUp?.autoBTime ||
            abcUp?.bTime ||
            null,
          effectiveBSec: abcUp?.effectiveBSec ?? null,
          bSource: abcUp?.bSource || null,

          waveCHigh:
            validLevel(abcUp?.waveCHigh) !== null
              ? round2(abcUp?.waveCHigh)
              : null,
          cTime: abcUp?.cTime || null,

          range: round2(abcUp?.range),

          bPullbackLevels: abcUp?.bPullbackLevels || null,
          cUpTargets: abcUp?.cUpTargets || null,

          preferredBZone: abcUp?.preferredBZone || null,
          deepBSupport: round2(deepBSupport),

          bRetracePct: abcUp?.bRetracePct ?? null,
          bRetraceRatio: abcUp?.bRetraceRatio ?? null,
          correctionType: abcUp?.correctionType || null,
          correctionFamily: abcUp?.correctionFamily || null,
          correctionQuality: abcUp?.correctionQuality || null,

          bPullbackStatus: abcUp?.bPullbackStatus || null,
          priceAction: abcUp?.priceAction || null,
          read: abcUp?.read || null,
        },

        reads: {
          structureRead: waveStack.message,
          lifecycleRead,
          abcUpRead: `A up is marked from ${fmt(originLow)} to ${fmt(
            waveAHigh
          )}. Structural B low is ${fmt(effectiveWaveBLow)}.`,
          bPullbackRead: `Preferred B zone is ${bZoneDisplay}. Deep B support is ${fmt(
            deepBSupport
          )}. B status: ${text(abcUp?.bPullbackStatus)}.`,
          cUpTargetsRead: `C-up targets: ${cUpTargetDisplay}.`,
          supportRead: `Current price ${fmt(
            currentPrice
          )} is being evaluated against support near ${fmt(
            supportLevel
          )} and C low near ${fmt(cLow)}.`,
          actionRead,
        },
        summary,

        needs:
          postAbcReset?.needs || [
            "7400_SUPPORT_HOLD",
            "RECLAIM_CONFIRMATION_REQUIRED",
            "ENGINE15_READY",
            "ENGINE6_FINAL_PERMISSION",
          ],

        reasonCodes: [
          "TRADE_CONTEXT_SUMMARY_BUILT",
          hasEffectiveB
            ? "POST_ABC_STRUCTURAL_B_MARKED_C_UP_WATCH"
            : "POST_ABC_A_UP_MARKED_WAITING_FOR_B_PULLBACK",
          "NO_CHASE_LONG",
          "NO_EXECUTION",
          ...(lifecycle?.reasonCodes || []),
          ...(postAbcReset?.reasonCodes || []),
          ...(abcUp?.reasonCodes || []),
        ],
      };
    }

    const summary =
      `${waveStack.message}\n\n` +
      `W5 and ABC correction are complete.\n\n` +
      `Price is testing/holding the ${fmt(
        supportLevel
      )} institutional support area above the marked C low near ${fmt(
        cLow
      )}.\n\n` +
      `If support holds, the next expected move is a Wave 2 bounce.\n\n` +
      `This is not a fresh W3 long and not a W5 continuation long.\n\n` +
      `No automatic long. Wait for reclaim confirmation, Engine 15 readiness, and Engine 6 final permission.`;

    return {
      headline: "POST ABC COMPLETE — WATCH WAVE 2 BOUNCE",
      subheadline:
        "ABC is complete into institutional support. Watching for Wave 2 bounce only after hold/reclaim confirmation.",
      bias: "RESET_BOUNCE_WATCH",
      action: "WAIT_FOR_7400_HOLD_AND_RECLAIM",
      direction: "NONE",
      chaseAllowed: false,
      severity: "warning",

      topCandidate: null,
      hardInvalidation: round2(cLow),
      reclaimLadder: null,

      firstCluster: clusters.firstCluster,
      nextCluster: clusters.nextCluster,

      lifecycleState: lifecycle?.lifecycleState || null,
      postAbcReset,
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
          "W5 and ABC correction are complete. Price is testing/holding institutional support.",
        supportRead: `Current price ${fmt(
          currentPrice
        )} is being evaluated against support near ${fmt(
          supportLevel
        )} and C low near ${fmt(cLow)}.`,
        nextMoveRead:
          "If support holds, the next expected move is a Wave 2 bounce.",
        actionRead:
          "No automatic long. Wait for 7400 hold/reclaim confirmation and Engine 6 permission.",
      },

      summary,

      needs:
        postAbcReset?.needs || [
          "7400_SUPPORT_HOLD",
          "RECLAIM_CONFIRMATION_REQUIRED",
          "ENGINE15_READY",
          "ENGINE6_FINAL_PERMISSION",
        ],

      reasonCodes: [
        "TRADE_CONTEXT_SUMMARY_BUILT",
        ...(lifecycle?.reasonCodes || []),
        ...(postAbcReset?.reasonCodes || []),
      ],
    };
  }

  if (postAbcState === "POST_ABC_LOW_FAILED") {
    const cLow = postAbcReset?.cLow ?? abc?.c?.price ?? null;

    return {
      headline: "POST ABC LOW FAILED — WAIT FOR LOWER SUPPORT",
      subheadline:
        "The marked C low failed. No Wave 2 bounce watch is active.",
      bias: "RESET_FAILED",
      action: "WAIT_FOR_LOWER_SUPPORT",
      direction: "NONE",
      chaseAllowed: false,
      severity: "danger",

      topCandidate: null,
      hardInvalidation: round2(cLow),
      reclaimLadder: null,

      firstCluster: clusters.firstCluster,
      nextCluster: clusters.nextCluster,

      lifecycleState: lifecycle?.lifecycleState || null,
      postAbcReset,
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
          "W5 and ABC correction are complete, but the marked C low has failed.",
        actionRead:
          "No Wave 2 bounce watch. Wait for lower support or new structure.",
      },

      summary:
        `${waveStack.message}\n\n` +
        `W5 and ABC correction are complete, but price lost the marked C low near ${fmt(
          cLow
        )}.\n\n` +
        `This means the C leg or Wave 1 down may be extending. No Wave 2 bounce signal is active.`,

      needs:
        postAbcReset?.needs || [
          "WAIT_FOR_LOWER_SUPPORT",
          "WAIT_FOR_NEW_STRUCTURE",
          "NO_WAVE_2_BOUNCE_SIGNAL",
        ],

      reasonCodes: [
        "TRADE_CONTEXT_SUMMARY_BUILT",
        ...(lifecycle?.reasonCodes || []),
        ...(postAbcReset?.reasonCodes || []),
      ],
    };
  }

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
    postAbcReset,
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
      ...(postAbcReset?.reasonCodes || []),
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
