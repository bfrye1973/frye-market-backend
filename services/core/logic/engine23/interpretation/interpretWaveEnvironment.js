cd /opt/render/project/src/services/core

python - <<'PY'
from pathlib import Path

p = Path("logic/engine23/interpretation/interpretWaveEnvironment.js")
s = p.read_text()

old_w2_states = '''const W2_STATES = {
  PULLBACK_ABOVE_ZONE: "W2_PULLBACK_ABOVE_ZONE",
  PULLBACK_IN_ZONE: "W2_PULLBACK_IN_ZONE",
  DEEP_PULLBACK_RISK: "W2_DEEP_PULLBACK_RISK",
  INVALIDATED: "W2_INVALIDATED",
  UNKNOWN: "W2_UNKNOWN",
};'''

new_w2_states = '''const W2_STATES = {
  INVALIDATED: "W2_INVALIDATED",
  DEEP_DANGER: "W2_DEEP_DANGER",
  SUPPORT_TEST: "W2_SUPPORT_TEST",
  PULLBACK_ABOVE_ZONE: "W2_PULLBACK_ABOVE_ZONE",
  PULLBACK_IN_ZONE: "W2_PULLBACK_IN_ZONE",
  DEEP_PULLBACK_RISK: "W2_DEEP_PULLBACK_RISK",
  RECLAIM_ATTEMPT: "W2_RECLAIM_ATTEMPT",
  IN_WEAKNESS_ZONE: "W2_TO_W3_IN_WEAKNESS_ZONE",
  REJECTION_RISK: "W2_TO_W3_REJECTION_RISK",
  ACCEPTANCE_WATCH: "W2_TO_W3_ACCEPTANCE_WATCH",
  EXTENSION_RISK: "W2_TO_W3_EXTENSION_RISK",
  UNKNOWN: "W2_UNKNOWN",
};'''

if old_w2_states not in s:
    raise SystemExit("Could not find W2_STATES block")

s = s.replace(old_w2_states, new_w2_states)

start = s.index("function classifyW2PullbackEnvironment")
end = s.index("function classifyW5Environment", start)

new_classify = r'''function makeW2LocationResult({
  state,
  health,
  preferredEntry,
  pullbackTargets,
  priceLocation,
  reasonCodes,
}) {
  return {
    environment: "W2_PULLBACK",
    state,
    health,
    preferredEntry,
    pullbackTargets,
    priceLocation,
    reasonCodes,
  };
}

function zoneObject(label, level, meaning = null) {
  if (level == null) return null;

  return {
    label,
    level,
    meaning,
    source: "ENGINE22_HIGHER_DEGREE_TARGETS",
  };
}

function distanceToLevel(price, level) {
  const p = asNumber(price);
  const n = asNumber(level);

  if (p === null || n === null) return null;

  return Number((n - p).toFixed(2));
}

function classifyW2PullbackEnvironment({ price, fib, higherTargets }) {
  const currentPrice = asNumber(price);
  const targets = buildPullbackTargetsFromFib(fib);

  const r382 = asNumber(targets.r382);
  const r618 = asNumber(targets.r618);
  const invalidation = asNumber(targets.invalidation);
  const reference786 = asNumber(targets.reference786);

  const firstWeakness = asNumber(higherTargets?.e100);
  const nextWeaknessLo = asNumber(higherTargets?.e1168);
  const nextWeaknessHi = asNumber(higherTargets?.e1272);
  const majorExhaustion = asNumber(higherTargets?.e1618);
  const stretchedExtension = asNumber(higherTargets?.e200);

  const firstWeaknessZone = zoneObject(
    "First Higher-Degree Weakness Zone",
    firstWeakness,
    "First area where continuation can stall or reject."
  );

  const nextReactionZone =
    nextWeaknessLo != null || nextWeaknessHi != null
      ? {
          label: "Next Higher-Degree Reaction Zone",
          level:
            nextWeaknessLo != null && nextWeaknessHi != null
              ? `${nextWeaknessLo}–${nextWeaknessHi}`
              : nextWeaknessLo ?? nextWeaknessHi,
          lo: nextWeaknessLo,
          hi: nextWeaknessHi,
          meaning: "Reaction zone where acceptance or rejection matters.",
          source: "ENGINE22_HIGHER_DEGREE_TARGETS",
        }
      : null;

  const majorExhaustionZone = zoneObject(
    "Later Extension / Chase-Risk Zone",
    majorExhaustion,
    "Major exhaustion zone; chase risk increases."
  );

  const stretchedExtensionZone = zoneObject(
    "Very Stretched Extension Zone",
    stretchedExtension,
    "Very stretched extension; protect gains and avoid chasing."
  );

  const baseReasonCodes = ["MINUTE_W2_TO_W3_ACTIVE"];

  const makeLocation = ({
    state,
    label,
    currentZone = null,
    nextZone = null,
    extra = {},
  }) => ({
    setupFamily: "W2_TO_W3",
    priceLocationState: state,
    priceLocationLabel: label,
    currentPrice,
    currentZone,
    nearestLevel: currentZone?.level ?? null,
    nextZone,
    distanceToNextZone:
      nextZone?.lo != null
        ? distanceToLevel(currentPrice, nextZone.lo)
        : distanceToLevel(currentPrice, nextZone?.level),
    source: "ENGINE22_HIGHER_DEGREE_TARGETS",
    ...extra,
  });

  if (currentPrice === null || r382 === null || r618 === null) {
    return makeW2LocationResult({
      state: W2_STATES.UNKNOWN,
      health: HEALTH.UNKNOWN,
      preferredEntry: "WAIT_FOR_W2_FIB_DATA",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.UNKNOWN,
        label: "Missing W2 price or fib levels.",
      }),
      reasonCodes: [...baseReasonCodes, "MISSING_W2_FIB_LEVELS"],
    });
  }

  if (invalidation !== null && currentPrice <= invalidation) {
    return makeW2LocationResult({
      state: W2_STATES.INVALIDATED,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_NEW_WAVE_STRUCTURE",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.INVALIDATED,
        label: "Price lost W2 invalidation.",
        currentZone: zoneObject("W2 Invalidation", invalidation),
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_BELOW_W2_INVALIDATION",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (reference786 !== null && currentPrice <= reference786) {
    return makeW2LocationResult({
      state: W2_STATES.DEEP_DANGER,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_STRONG_RECLAIM",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.DEEP_DANGER,
        label: "Price is in deep W2 danger near the 0.786 reference.",
        currentZone: zoneObject("W2 Deep Danger / 0.786 Reference", reference786),
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_NEAR_DEEP_786_RETRACE",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (currentPrice <= r382) {
    return makeW2LocationResult({
      state: W2_STATES.SUPPORT_TEST,
      health: HEALTH.CAUTION,
      preferredEntry: "WATCH_W2_SUPPORT_REACTION",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.SUPPORT_TEST,
        label: "Price is testing the W2 support/retrace zone.",
        currentZone: {
          label: "W2 Support Zone",
          level: `${r382} / ${targets.r500} / ${r618}`,
          r382,
          r500: asNumber(targets.r500),
          r618,
          source: "ENGINE2_W2_PULLBACK_FIBS",
        },
        nextZone: firstWeaknessZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_INSIDE_OR_BELOW_W2_SUPPORT_ZONE",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (firstWeakness !== null && currentPrice < firstWeakness) {
    return makeW2LocationResult({
      state: W2_STATES.RECLAIM_ATTEMPT,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_RECLAIM_CONFIRMATION",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.RECLAIM_ATTEMPT,
        label: "Price reclaimed above W2 support but has not reached first weakness.",
        currentZone: {
          label: "Above W2 Support / Reclaim Attempt",
          level: `Above ${r382}`,
          source: "ENGINE2_W2_PULLBACK_FIBS",
        },
        nextZone: firstWeaknessZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_ABOVE_W2_SUPPORT_ZONE",
        "PRICE_BELOW_FIRST_WEAKNESS_ZONE",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (
    firstWeakness !== null &&
    currentPrice >= firstWeakness &&
    (nextWeaknessLo === null || currentPrice < nextWeaknessLo)
  ) {
    return makeW2LocationResult({
      state: W2_STATES.IN_WEAKNESS_ZONE,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_ACCEPTANCE_OR_PULLBACK",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.IN_WEAKNESS_ZONE,
        label: "Price is above first weakness and entering chase-risk territory.",
        currentZone: firstWeaknessZone,
        nextZone: nextReactionZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_ABOVE_W2_SUPPORT_ZONE",
        "PRICE_ABOVE_FIRST_WEAKNESS_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (
    nextWeaknessLo !== null &&
    nextWeaknessHi !== null &&
    currentPrice >= nextWeaknessLo &&
    currentPrice <= nextWeaknessHi
  ) {
    return makeW2LocationResult({
      state: W2_STATES.REJECTION_RISK,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_ACCEPTANCE_OR_REJECTION",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.REJECTION_RISK,
        label: "Price is inside the next higher-degree reaction zone.",
        currentZone: nextReactionZone,
        nextZone: majorExhaustionZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_ABOVE_W2_SUPPORT_ZONE",
        "PRICE_INSIDE_NEXT_REACTION_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (
    majorExhaustion !== null &&
    currentPrice >= majorExhaustion
  ) {
    return makeW2LocationResult({
      state: W2_STATES.EXTENSION_RISK,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_PULLBACK_OR_PROTECT_GAINS",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.EXTENSION_RISK,
        label: "Price is extended into later chase-risk territory.",
        currentZone: majorExhaustionZone,
        nextZone: stretchedExtensionZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_ABOVE_W2_SUPPORT_ZONE",
        "PRICE_IN_LATER_EXTENSION_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (
    nextWeaknessHi !== null &&
    currentPrice > nextWeaknessHi
  ) {
    return makeW2LocationResult({
      state: W2_STATES.ACCEPTANCE_WATCH,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_PULLBACK_OR_ENGINE15_CONFIRMATION",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.ACCEPTANCE_WATCH,
        label: "Price accepted above the next reaction zone; watch for continuation or pullback.",
        currentZone: {
          label: "Above Next Reaction Zone",
          level: `Above ${nextWeaknessHi}`,
          source: "ENGINE22_HIGHER_DEGREE_TARGETS",
        },
        nextZone: majorExhaustionZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_ABOVE_W2_SUPPORT_ZONE",
        "PRICE_ABOVE_NEXT_REACTION_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  return makeW2LocationResult({
    state: W2_STATES.RECLAIM_ATTEMPT,
    health: HEALTH.CAUTION,
    preferredEntry: "WAIT_FOR_RECLAIM_CONFIRMATION",
    pullbackTargets: targets,
    priceLocation: makeLocation({
      state: W2_STATES.RECLAIM_ATTEMPT,
      label: "Price is above W2 support; waiting for clearer higher target context.",
    }),
    reasonCodes: [
      ...baseReasonCodes,
      "PRICE_ABOVE_W2_SUPPORT_ZONE",
      "READ_ONLY_INTERPRETATION",
    ],
  });
}

'''

s = s[:start] + new_classify + s[end:]

old_call = '''    const w2Classification = classifyW2PullbackEnvironment({
      price: currentPrice,
      fib,
    });'''

new_call = '''    const w2Classification = classifyW2PullbackEnvironment({
      price: currentPrice,
      fib,
      higherTargets,
    });'''

if old_call not in s:
    raise SystemExit("Could not find W2 classification call")

s = s.replace(old_call, new_call)

old_summary_fn_start = s.index("function buildMultiDegreeSummary")
old_summary_fn_end = s.index("function buildNeeds", old_summary_fn_start)

new_summary_fn = r'''function buildMultiDegreeSummary({ symbol, multiDegreeContext, priceLocation }) {
  const name = symbol || "ES";
  const recent = multiDegreeContext?.recentCompletion;
  const active = multiDegreeContext?.activeStructure;
  const higher = multiDegreeContext?.higherContext;
  const t = multiDegreeContext?.pullbackTargets || {};
  const weakness = multiDegreeContext?.weaknessZones || [];

  const supportText =
    t.r382 != null && t.r500 != null && t.r618 != null
      ? `${t.r382} / ${t.r500} / ${t.r618}`
      : "the active pullback fib zone";

  const weakText =
    weakness.length > 0
      ? weakness.map((z) => z.level).join(" / ")
      : "higher-degree extension zones";

  const state = String(priceLocation?.priceLocationState || "").toUpperCase();
  const currentZone = priceLocation?.currentZone || null;
  const nextZone = priceLocation?.nextZone || null;

  if (state === W2_STATES.IN_WEAKNESS_ZONE) {
    return `${name} remains in a Minute W2-to-W3 context, but price has already reclaimed above the W2 pullback zone and is now testing higher-degree W5 weakness/chase-risk territory. First weakness near ${currentZone?.level ?? "unknown"} has been reached. Next reaction zone is ${nextZone?.level ?? "unknown"}. Do not chase; watch acceptance/rejection and wait for Engine 15 confirmation.`;
  }

  if (state === W2_STATES.REJECTION_RISK) {
    return `${name} remains in a Minute W2-to-W3 context, but price is now inside the next higher-degree reaction zone near ${currentZone?.level ?? "unknown"}. This is rejection-risk territory, not a fresh chase entry. Watch acceptance/rejection and wait for Engine 15 confirmation.`;
  }

  if (state === W2_STATES.ACCEPTANCE_WATCH) {
    return `${name} remains in a Minute W2-to-W3 context and price has accepted above the early reaction zone. This can support a W3 continuation attempt, but it is still read-only. Watch for controlled pullback, acceptance, and Engine 15 confirmation.`;
  }

  if (state === W2_STATES.EXTENSION_RISK) {
    return `${name} remains in a Minute W2-to-W3 context, but price is now extended into later chase-risk territory near ${currentZone?.level ?? "unknown"}. Do not chase. Protect gains and wait for pullback or fresh confirmation.`;
  }

  if (state === W2_STATES.RECLAIM_ATTEMPT) {
    return `${name} ${recent ? recent.meaning : "has a lower-degree impulse that may be completing."} ${active?.read || ""} ${higher ? `Higher context is ${higher.label}.` : ""} Price has reclaimed above W2 support at ${supportText} but has not reached first weakness yet. Watch acceptance, pullback, and Engine 15 confirmation.`;
  }

  return `${name} ${recent ? recent.meaning : "has a lower-degree impulse that may be completing."} ${active?.read || ""} ${higher ? `Higher context is ${higher.label}.` : ""} Watch pullback support at ${supportText}. Weakness/chase-risk zones begin near ${weakText}. Do not chase; wait for support, reclaim, and Engine 15 confirmation.`;
}

'''

s = s[:old_summary_fn_start] + new_summary_fn + s[old_summary_fn_end:]

old_return_piece = '''      higherTargets: roundedHigherTargets,
      recentCompletion: multiDegreeContext.recentCompletion,'''

new_return_piece = '''      higherTargets: roundedHigherTargets,
      priceLocation: w2Classification.priceLocation,
      recentCompletion: multiDegreeContext.recentCompletion,'''

if old_return_piece not in s:
    raise SystemExit("Could not find W2 return insertion point for priceLocation")

s = s.replace(old_return_piece, new_return_piece, 1)

old_summary_call = '''      summary: buildMultiDegreeSummary({
        symbol,
        multiDegreeContext,
      }),'''

new_summary_call = '''      summary: buildMultiDegreeSummary({
        symbol,
        multiDegreeContext,
        priceLocation: w2Classification.priceLocation,
      }),'''

if old_summary_call not in s:
    raise SystemExit("Could not find W2 summary call")

s = s.replace(old_summary_call, new_summary_call, 1)

p.write_text(s)
print("Engine 23 v3.3 price-location patch applied.")
PY
