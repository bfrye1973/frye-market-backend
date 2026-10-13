// Engine 22 Micro V2 — dual W2/W3 transition Fib projection.
//
// Purpose:
// While W3 is still structurally developing, preserve BOTH:
//   1) completed/locked W2 retracement map
//   2) provisional W3 extension map
//
// This is display/intelligence only. It never changes lifecycle state,
// permission, sizing, management, execution, or journal state.

const RETRACEMENTS = Object.freeze([
  ["r236", "0.236", 0.236],
  ["r382", "0.382", 0.382],
  ["r500", "0.500", 0.5],
  ["r618", "0.618", 0.618],
  ["r786", "0.786", 0.786],
]);

const EXTENSIONS = Object.freeze([
  ["e382", "0.382", 0.382],
  ["e500", "0.500", 0.5],
  ["e618", "0.618", 0.618],
  ["e1000", "1.000", 1],
  ["e1272", "1.272", 1.272],
  ["e1618", "1.618", 1.618],
  ["e2000", "2.000", 2],
]);

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) && x > 0
    ? x
    : null;
}

function tick(value, tickSize = 0.25) {
  const v = n(value);
  const t = n(tickSize);

  if (v == null) return null;
  if (t == null) return Number(v.toFixed(2));

  return Number(
    (
      Math.round(v / t) * t
    ).toFixed(2)
  );
}

function level({
  key,
  label,
  price,
  status,
  source,
} = {}) {
  return {
    key,
    label,
    price,
    status,
    source,
  };
}

function waveAnchor(
  canonicalState,
  wave,
  fieldPriority = []
) {
  const record =
    canonicalState?.waves?.[wave];

  if (!record) return null;

  for (const field of fieldPriority) {
    const value =
      n(record?.[field]);

    if (value != null) {
      return value;
    }
  }

  return null;
}

export function buildMicroW2W3TransitionFibs({
  canonicalState = null,
  currentPrice = null,
  tickSize = 0.25,
} = {}) {
  const activeWave =
    String(
      canonicalState?.activeWave || ""
    )
      .trim()
      .toUpperCase();

  const w3Lifecycle =
    String(
      canonicalState
        ?.waves
        ?.W3
        ?.lifecycle || ""
    )
      .trim()
      .toUpperCase();

  const w1High =
    waveAnchor(
      canonicalState,
      "W1",
      [
        "lockedAnchor",
        "confirmedAnchor",
      ]
    );

  const w2Low =
    waveAnchor(
      canonicalState,
      "W2",
      [
        "lockedAnchor",
        "confirmedAnchor",
        "candidateAnchor",
        "developingAnchor",
      ]
    );

  const origin =
    n(
      canonicalState
        ?.origin
        ?.price
    );

  const price =
    n(
      currentPrice ??
      canonicalState
        ?.currentPrice
    );

  const validAnchors =
    origin != null &&
    w1High != null &&
    w2Low != null &&
    w1High > origin &&
    w2Low < w1High;

  const transitionVisible =
    validAnchors &&
    activeWave === "W3" &&
    w3Lifecycle === "DEVELOPING";

  if (!transitionVisible) {
    return {
      available: false,
      version:
        "engine22.microW2W3TransitionFibs.v1",
      transition:
        "W2_TO_W3",
      sourceCountId:
        canonicalState?.countId ??
        null,
      activeWave:
        activeWave || null,
      w3Lifecycle:
        w3Lifecycle || null,
      reasonCodes: [
        !validAnchors
          ? "W2_W3_FIB_ANCHORS_INCOMPLETE"
          : activeWave !== "W3"
          ? "MICRO_NOT_IN_W3"
          : "W3_NO_LONGER_IN_LAUNCH_DEVELOPING_STATE",
      ],
      noPermissionCreated: true,
      noExecution: true,
    };
  }

  const w1Length =
    w1High - origin;

  const w2Retracements =
    RETRACEMENTS.map(
      ([key, label, ratio]) => {
        const target =
          tick(
            w1High -
              w1Length * ratio,
            tickSize
          );

        return level({
          key,
          label,
          price:
            target,
          status:
            w2Low <= target
              ? "TOUCHED"
              : "WATCH",
          source:
            "LOCKED_W1_RANGE_RETRACEMENT_FROM_W1_HIGH",
        });
      }
    );

  const w3Extensions =
    EXTENSIONS.map(
      ([key, label, ratio]) => {
        const target =
          tick(
            w2Low +
              w1Length * ratio,
            tickSize
          );

        return level({
          key,
          label,
          price:
            target,
          status:
            price != null &&
            price >= target
              ? "TOUCHED"
              : "WATCH",
          source:
            "W1_LENGTH_PROJECTED_FROM_W2_LOW",
        });
      }
    );

  const nextW3 =
    w3Extensions.find(
      (item) =>
        item.status === "WATCH"
    ) || null;

  const lastTouchedW3 =
    [...w3Extensions]
      .reverse()
      .find(
        (item) =>
          item.status === "TOUCHED"
      ) || null;

  return {
    available: true,

    version:
      "engine22.microW2W3TransitionFibs.v1",

    transition:
      "W2_TO_W3",

    displayMode:
      "DUAL_FIB_TRANSITION",

    headline:
      "W2 DOWN + W3 UP — transition confirming",

    sourceCountId:
      canonicalState.countId,

    canonicalStateVersion:
      canonicalState
        .canonicalStateVersion,

    revision:
      canonicalState.revision,

    activeWave:
      "W3",

    w3Lifecycle,

    currentPrice:
      price,

    anchors: {
      origin,
      w1High,
      w2Low,
      w1Length:
        Number(
          w1Length.toFixed(2)
        ),
    },

    w2Down: {
      state:
        canonicalState
          ?.waves
          ?.W2
          ?.lifecycle ??
        null,

      anchor:
        w2Low,

      levels:
        w2Retracements,

      interpretation:
        "Preserve completed W2 retracement context while W3 launch is still developing.",
    },

    w3Up: {
      state:
        "LAUNCH_DEVELOPING",

      anchor:
        w2Low,

      levels:
        w3Extensions,

      lastTouchedLevel:
        lastTouchedW3,

      nextLevel:
        nextW3,

      interpretation:
        "Provisional W3 extension ladder using locked W1 length projected from the W2 low.",
    },

    collapseRule:
      "KEEP_DUAL_FIBS_WHILE_CANONICAL_W3_LIFECYCLE_IS_DEVELOPING",

    trainingTags: [
      "MICRO_W2_W3_DUAL_FIB_TRANSITION",
      "W2_RETRACEMENT_CONTEXT_PRESERVED",
      "W3_EXTENSION_LADDER_PROVISIONAL",
    ],

    noPermissionCreated: true,
    noSizing: true,
    noManagement: true,
    noExecution: true,
    noJournalMutation: true,

    reasonCodes: [
      "W2_W3_TRANSITION_DUAL_FIBS_ACTIVE",
      "LOCKED_W1_RANGE_USED",
      "W2_LOW_USED_AS_W3_PROJECTION_ORIGIN",
      "DISPLAY_INTELLIGENCE_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildMicroW2W3TransitionFibs;
