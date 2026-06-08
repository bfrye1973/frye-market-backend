// src/pages/rows/RowChart/overlays/Engine17DecisionTimeline.jsx

import React from "react";

/* =========================
   Visual System
========================= */

const TIMELINE_FONT =
  '"Trebuchet MS", "Lucida Grande", "Segoe UI", Arial, sans-serif';

const FONT_REGULAR = 400;
const FONT_MEDIUM = 400;

const CARD_BG = "rgba(6,10,20,0.94)";
const CARD_BG_STRONG = "rgba(6,10,20,0.96)";
const SOFT_TEXT = "#dbeafe";
const MAIN_TEXT = "#f8fafc";
const MUTED_TEXT = "#94a3b8";

/* =========================
   Formatters
========================= */

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatText(value, fallback = "—") {
  if (value == null || value === "") return fallback;
  return String(value).replaceAll("_", " ");
}

function formatUpper(value, fallback = "—") {
  if (value == null || value === "") return fallback;
  return String(value).toUpperCase().replaceAll("_", " ");
}

function formatNumber(value, digits = 2, fallback = "—") {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : fallback;
}

function formatScore(value, fallback = "—") {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n).toString() : fallback;
}

function formatBool(value, fallback = "—") {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return fallback;
}

function titleCase(value, fallback = "—") {
  if (value == null || value === "") return fallback;

  return String(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compactJoin(parts, separator = " | ") {
  return parts.filter(Boolean).join(separator);
}

function severityColor(severity) {
  if (severity === "danger") return "#fb7185";
  if (severity === "warning") return "#fbbf24";
  if (severity === "bullish") return "#22c55e";
  if (severity === "purple") return "#c084fc";
  if (severity === "blue") return "#38bdf8";
  if (severity === "teal") return "#2dd4bf";
  return "#cbd5e1";
}

function severityBorder(severity) {
  if (severity === "danger") return "rgba(244,63,94,0.62)";
  if (severity === "warning") return "rgba(251,191,36,0.58)";
  if (severity === "bullish") return "rgba(34,197,94,0.46)";
  if (severity === "purple") return "rgba(192,132,252,0.48)";
  if (severity === "blue") return "rgba(56,189,248,0.48)";
  if (severity === "teal") return "rgba(45,212,191,0.48)";
  return "rgba(148,163,184,0.34)";
}

function severityBackground(severity) {
  if (severity === "danger") return "rgba(127,29,29,0.15)";
  if (severity === "warning") return "rgba(113,63,18,0.14)";
  if (severity === "bullish") return "rgba(20,83,45,0.13)";
  if (severity === "purple") return "rgba(88,28,135,0.13)";
  if (severity === "blue") return "rgba(12,74,110,0.13)";
  if (severity === "teal") return "rgba(19,78,74,0.13)";
  return "rgba(15,23,42,0.42)";
}

/* =========================
   Data selectors
========================= */

function getFib(overlayData) {
  return overlayData?.fib || overlayData || {};
}

function getStrategyRoot(fib) {
  return fib?.strategy || fib || {};
}

function getEngine22WaveStrategy(fib) {
  const root = getStrategyRoot(fib);

  return (
    root?.engine22WaveStrategy ||
    fib?.engine22WaveStrategy ||
    root?.engine22 ||
    null
  );
}

function getWaveOpportunity(fib) {
  const waveStrategy = getEngine22WaveStrategy(fib);

  return (
    waveStrategy?.waveOpportunity ||
    fib?.waveOpportunity ||
    getStrategyRoot(fib)?.waveOpportunity ||
    null
  );
}

function getBackendTimelineRead(fib) {
  return getEngine22WaveStrategy(fib)?.timelineRead || null;
}

function getBackendTradeContextSummary(fib) {
  return getEngine22WaveStrategy(fib)?.tradeContextSummary || null;
}

function getBackendTimelineSection(fib, title) {
  const sections = getBackendTimelineRead(fib)?.mainSections;

  if (!Array.isArray(sections)) return null;

  return (
    sections.find(
      (section) => String(section?.title || "").trim() === title
    ) || null
  );
}

function getEngine15Decision(fib) {
  const root = getStrategyRoot(fib);

  return (
    root?.engine15Decision ||
    fib?.engine15Decision ||
    root?.engine15ES ||
    null
  );
}

function getFinalPermission(fib) {
  const root = getStrategyRoot(fib);

  return root?.permission || fib?.permission || root?.finalPermission || null;
}

function getConfluence(fib) {
  const root = getStrategyRoot(fib);

  return (
    root?.confluence ||
    fib?.confluence ||
    root?.engine5 ||
    fib?.engine5 ||
    null
  );
}

function getEngine5Reaction(fib) {
  return getConfluence(fib)?.components?.engine3Reaction || null;
}

function getEngine5Volume(fib) {
  return getConfluence(fib)?.components?.engine4Volume || null;
}

function getEngine5Timing(fib) {
  const confluence = getConfluence(fib);

  return (
    confluence?.timingContext ||
    confluence?.analytics?.engine5?.timingContext ||
    fib?.timingContext ||
    null
  );
}

function getTargets(waveOpportunity) {
  const targets = waveOpportunity?.targets || {};

  return [
    ["1.000", targets.e100],
    ["1.272", targets.e1272],
    ["1.618", targets.e1618],
    ["2.000", targets.e200],
    ["2.618", targets.e2618],
  ].filter(([, price]) => price != null);
}

function isWatchState(value) {
  const v = String(value || "").toUpperCase();
  return ["WATCH", "NEAR", "PREP", "ARMING", "POST_EXTENSION"].includes(v);
}

function isReadyState(value) {
  const v = String(value || "").toUpperCase();
  return ["READY", "CONFIRMED", "TRIGGERED"].includes(v);
}

function isDangerChase(value) {
  const v = String(value || "").toUpperCase();
  return v === "HIGH" || v === "EXTREME";
}

/* =========================
   Fallback headline builders
========================= */

function buildFallbackHeadline({ waveOpportunity, engine15 }) {
  const degree = titleCase(waveOpportunity?.degree, "Wave");
  const setup = formatUpper(waveOpportunity?.setupType, "W3/W5");
  const readiness = formatUpper(
    engine15?.readinessLabel || waveOpportunity?.readiness,
    "WATCH"
  );
  const chaseRisk = formatUpper(waveOpportunity?.chaseRisk, "");
  const timing = formatUpper(waveOpportunity?.timing, "");

  if (isDangerChase(chaseRisk)) {
    return `${degree} ${setup} ${readiness} — NO CHASE`;
  }

  if (timing.includes("POST")) {
    return `${degree} ${setup} ${readiness} — POST EXTENSION`;
  }

  return `${degree} ${setup} ${readiness}`;
}

function buildFallbackSubheadline({ waveOpportunity, engine15 }) {
  if (waveOpportunity?.summary) return waveOpportunity.summary;
  if (engine15?.summary) return engine15.summary;

  return "Waiting for a valid Wave 3 / Wave 5 opportunity and final confirmation.";
}

function buildBadges({ waveOpportunity, engine15, permission }) {
  const badges = [];

  badges.push({
    label: waveOpportunity?.symbol || engine15?.symbol || "ES",
    severity: "blue",
  });

  if (waveOpportunity?.degree) {
    badges.push({
      label: `${titleCase(waveOpportunity.degree)} Degree`,
      severity: "neutral",
    });
  }

  if (waveOpportunity?.direction || engine15?.direction) {
    const direction = waveOpportunity?.direction || engine15?.direction;

    badges.push({
      label: formatUpper(direction),
      severity:
        String(direction).toUpperCase() === "LONG" ? "bullish" : "danger",
    });
  }

  if (engine15?.readinessLabel || waveOpportunity?.readiness) {
    const readiness = engine15?.readinessLabel || waveOpportunity?.readiness;

    badges.push({
      label: formatUpper(readiness),
      severity: isReadyState(readiness) ? "bullish" : "warning",
    });
  }

  if (waveOpportunity?.timing) {
    badges.push({
      label: formatUpper(waveOpportunity.timing),
      severity:
        String(waveOpportunity.timing).toUpperCase().includes("POST") ||
        String(waveOpportunity.timing).toUpperCase().includes("LATE")
          ? "warning"
          : "neutral",
    });
  }

  if (waveOpportunity?.chaseRisk) {
    badges.push({
      label: `${formatUpper(waveOpportunity.chaseRisk)} CHASE RISK`,
      severity: isDangerChase(waveOpportunity.chaseRisk)
        ? "danger"
        : "warning",
    });
  }

  if (permission?.permission) {
    badges.push({
      label: `PERMISSION ${formatUpper(permission.permission)}`,
      severity:
        String(permission.permission).toUpperCase() === "ALLOW"
          ? "bullish"
          : String(permission.permission).toUpperCase() === "REDUCE"
          ? "purple"
          : "danger",
    });
  }

  return badges;
}

/* =========================
   Shared section builders
========================= */

function buildBackendTimelineSection(section) {
  if (!section) return null;

  const lines = Array.isArray(section.lines)
    ? section.lines.filter(Boolean)
    : [];

  if (!lines.length) return null;

  return {
    number: 0,
    icon: "◷",
    title: section.title || "Context",
    severity: section.severity || "blue",
    fields: [],
    lines,
  };
}

function buildWaveOpportunitySection(waveOpportunity) {
  if (!waveOpportunity) {
    return {
      number: 1,
      icon: "〽",
      title: "Wave Opportunity — Engine 22",
      severity: "warning",
      fields: [],
      lines: [
        "Engine 22 waveOpportunity is unavailable.",
        "Waiting for a valid Wave 3 / Wave 5 setup.",
      ],
    };
  }

  const targetsText = getTargets(waveOpportunity)
    .map(([level, price]) => `${level}: ${formatNumber(price)}`)
    .join("  |  ");

  return {
    number: 1,
    icon: "〽",
    title: "Wave Opportunity — Engine 22",
    severity: isDangerChase(waveOpportunity.chaseRisk)
      ? "warning"
      : "bullish",
    fields: [
      ["Setup", formatUpper(waveOpportunity.setupType, "NONE")],
      ["Raw Setup", formatUpper(waveOpportunity.rawSetup, "—")],
      ["Degree", titleCase(waveOpportunity.degree, "—")],
      ["Direction", formatUpper(waveOpportunity.direction, "NONE")],
      ["Readiness", formatUpper(waveOpportunity.readiness, "UNKNOWN")],
      ["Timing", formatUpper(waveOpportunity.timing, "UNKNOWN")],
      ["Chase Risk", formatUpper(waveOpportunity.chaseRisk, "UNKNOWN")],
      ["Targets", targetsText || "—"],
    ],
    lines: [
      waveOpportunity.summary
        ? `Summary: ${waveOpportunity.summary}`
        : "Summary: Waiting for Engine 22 wave opportunity summary.",
    ],
  };
}

function buildPostAbcBounceSection(tradeContextSummary) {
  const abcUp = tradeContextSummary?.abcUp || null;
  const reads = tradeContextSummary?.reads || {};

  if (
    String(abcUp?.state || "").toUpperCase() !==
    "A_UP_MARKED_WAITING_FOR_B_PULLBACK"
  ) {
    return null;
  }

  const preferredBZone = abcUp?.preferredBZone || null;
  const preferredBZoneText =
    preferredBZone?.lo != null && preferredBZone?.hi != null
      ? `${formatNumber(preferredBZone.lo)}–${formatNumber(preferredBZone.hi)}`
      : "—";

  const bLow =
    abcUp.effectiveWaveBLow ??
    abcUp.autoWaveBLow ??
    abcUp.waveBLow ??
    null;

  return {
    number: 2,
    icon: "〽",
    title: "Post-ABC Bounce Map — Engine 22",
    severity: "warning",
    fields: [
      ["State", formatUpper(abcUp.state)],
      [
        "A Up",
        `${formatNumber(abcUp.originLow)} → ${formatNumber(abcUp.waveAHigh)}`,
      ],
      ["B Low", formatNumber(bLow)],
      ["Preferred B Zone", preferredBZoneText],
      ["Deep B Support", formatNumber(abcUp.deepBSupport)],
      ["B Status", formatUpper(abcUp.bPullbackStatus, "WAITING")],
    ],
    lines: [
      reads.abcUpRead || null,
      reads.bPullbackRead || null,
      abcUp.read || null,
      reads.actionRead ||
        "No chase. No execution. Wait for B pullback hold and reclaim confirmation.",
    ].filter(Boolean),
  };
}

function buildEngine15Section(engine15) {
  if (!engine15) {
    return {
      number: 3,
      icon: "▣",
      title: "Setup Readiness — Engine 15ES",
      severity: "warning",
      fields: [],
      lines: ["Engine 15ES decision unavailable."],
    };
  }

  const next =
    engine15.nextSetupType ||
    engine15.lifecycle?.nextFocus ||
    "WAIT_FOR_CONFIRMATION";

  const needs = asArray(engine15.needs)
    .map((need) => formatText(need))
    .join(", ");

  return {
    number: 3,
    icon: "▣",
    title: "Setup Readiness — Engine 15ES",
    severity: isReadyState(engine15.readinessLabel)
      ? "bullish"
      : isWatchState(engine15.readinessLabel)
      ? "blue"
      : "warning",
    fields: [
      ["Readiness", formatUpper(engine15.readinessLabel, "UNKNOWN")],
      ["Strategy", formatUpper(engine15.strategyType, "NONE")],
      ["Direction", formatUpper(engine15.direction, "NONE")],
      ["Action", formatUpper(engine15.action, "WATCH")],
      [
        "Quality",
        `${formatScore(engine15.qualityScore)} / ${formatUpper(
          engine15.qualityGrade || engine15.qualityBand,
          "—"
        )}`,
      ],
      ["Next", formatUpper(next)],
    ],
    lines: needs ? [`Needs: ${needs}`] : ["Needs: waiting for confirmation."],
  };
}

function buildEngine5Section(fib) {
  const reaction = getEngine5Reaction(fib);
  const volume = getEngine5Volume(fib);
  const timing = getEngine5Timing(fib);

  const reactionText = reaction
    ? compactJoin(
        [
          formatText(reaction.quality, "UNKNOWN"),
          formatText(reaction.direction, ""),
          reaction.confirmed || reaction.cleanReaction
            ? "confirmed"
            : "not confirmed",
        ],
        " / "
      )
    : "Unavailable";

  const volumeText = volume
    ? compactJoin(
        [
          formatText(volume.quality || volume.participationQuality, "UNKNOWN"),
          volume.cleanParticipation
            ? "clean participation"
            : "clean participation not confirmed",
        ],
        " / "
      )
    : "Unavailable";

  const timingText = timing
    ? compactJoin(
        [
          formatText(timing.entryTiming, "UNKNOWN"),
          timing.chaseRisk ? `chase risk ${formatText(timing.chaseRisk)}` : null,
          timing.suggestedAction ? formatText(timing.suggestedAction) : null,
        ],
        " / "
      )
    : "Unavailable";

  const hasWarning =
    volume?.cleanParticipation === false ||
    timing?.moveAlreadyHappened === true ||
    timing?.noChaseContext === true ||
    isDangerChase(timing?.chaseRisk);

  return {
    number: 4,
    icon: "⚗",
    title: "Ingredients — Engine 5",
    severity: hasWarning ? "purple" : "neutral",
    ingredientCards: [
      {
        label: "Reaction",
        value: reactionText,
        good: reaction?.confirmed === true || reaction?.cleanReaction === true,
      },
      {
        label: "Volume",
        value: volumeText,
        good: volume?.cleanParticipation === true,
      },
      {
        label: "Timing",
        value: timingText,
        good:
          timing &&
          timing.moveAlreadyHappened !== true &&
          timing.noChaseContext !== true &&
          !isDangerChase(timing.chaseRisk),
      },
    ],
  };
}

function buildPermissionSection(permission, engine15) {
  if (!permission) {
    return {
      number: 5,
      icon: "⬟",
      title: "Final Permission — Engine 6",
      severity: "warning",
      fields: [],
      lines: ["Engine 6 final permission unavailable."],
    };
  }

  const executable = permission.executable === true;
  const watchOnly = permission.watchOnly === true;

  let permissionLine = "Engine 6 does not allow execution yet.";

  if (executable) {
    permissionLine =
      "Engine 6 allows execution because setup and permission gates passed.";
  } else if (
    String(permission.permission || "").toUpperCase() === "REDUCE" &&
    watchOnly
  ) {
    permissionLine =
      "REDUCE — watch only, no execution. Engine 15ES is WATCH, not READY.";
  } else if (watchOnly) {
    permissionLine =
      "Engine 6 will not allow execution because this is watch only.";
  }

  return {
    number: 5,
    icon: "⬟",
    title: "Final Permission — Engine 6",
    severity: executable ? "bullish" : "purple",
    fields: [
      ["Permission", formatUpper(permission.permission, "UNKNOWN")],
      ["Executable", formatBool(permission.executable)],
      ["Watch Only", formatBool(permission.watchOnly)],
      [
        "Strategy Type",
        formatUpper(permission.strategyType || engine15?.strategyType, "NONE"),
      ],
      [
        "Direction",
        formatUpper(permission.direction || engine15?.direction, "NONE"),
      ],
      [
        "Authority",
        permission.engine15Authority === true
          ? "Engine 15"
          : permission.engine5Authority === true
          ? "Engine 5"
          : "—",
      ],
    ],
    lines: [
      permissionLine,
      asArray(permission.reasonCodes).length
        ? `Reasons: ${asArray(permission.reasonCodes).map(formatText).join(", ")}`
        : null,
    ].filter(Boolean),
  };
}

function buildNextStepsSection({
  waveOpportunity,
  engine15,
  permission,
  fib,
  tradeContextSummary = null,
}) {
  const actionLevels = [];
  const steps = [];

  const waveNeeds = asArray(waveOpportunity?.needs);
  const engine15Needs = asArray(engine15?.needs);
  const permissionReasons = asArray(permission?.reasonCodes);
  const volume = getEngine5Volume(fib);
  const timing = getEngine5Timing(fib);
  const abcUp = tradeContextSummary?.abcUp || null;

  const engine16 = fib?.engine16 || {};
  const trigger10m = engine16?.regimeLayers?.trigger10m || {};
  const currentPrice = waveOpportunity?.currentPrice || trigger10m?.close || null;

  if (currentPrice != null) {
    actionLevels.push(`Current price: ${formatNumber(currentPrice)}`);
  }

  if (
    String(abcUp?.state || "").toUpperCase() ===
    "A_UP_MARKED_WAITING_FOR_B_PULLBACK"
  ) {
    const bLow =
      abcUp.effectiveWaveBLow ??
      abcUp.autoWaveBLow ??
      abcUp.waveBLow ??
      null;

    if (abcUp?.waveAHigh != null) {
      actionLevels.push(`A high: ${formatNumber(abcUp.waveAHigh)}`);
    }

    if (bLow != null) {
      actionLevels.push(`B low: ${formatNumber(bLow)}`);
    }

    if (abcUp?.preferredBZone?.lo != null && abcUp?.preferredBZone?.hi != null) {
      actionLevels.push(
        `Preferred B zone: ${formatNumber(
          abcUp.preferredBZone.lo
        )}–${formatNumber(abcUp.preferredBZone.hi)}`
      );
    }

    if (abcUp?.deepBSupport != null) {
      actionLevels.push(`Deep B support: ${formatNumber(abcUp.deepBSupport)}`);
    }

    steps.push("Wait for B pullback hold and reclaim");
    steps.push("No chase and no execution");
  }

  if (
    trigger10m?.ema10 != null &&
    trigger10m?.ema20 != null &&
    String(abcUp?.state || "").toUpperCase() !==
      "A_UP_MARKED_WAITING_FOR_B_PULLBACK"
  ) {
    actionLevels.push(
      `10m reclaim zone: ${formatNumber(trigger10m.ema10)} → ${formatNumber(
        trigger10m.ema20
      )}`
    );
  }

  if (
    waveNeeds.some((need) => String(need).toUpperCase().includes("NO_CHASE")) ||
    isDangerChase(waveOpportunity?.chaseRisk)
  ) {
    steps.push("Do not chase the current W5 extension");
  }

  if (
    waveNeeds.some((need) => String(need).toUpperCase().includes("PULLBACK")) ||
    engine15Needs.some((need) => String(need).toUpperCase().includes("PULLBACK")) ||
    timing?.suggestedAction
  ) {
    steps.push("Wait for controlled pullback or reclaim");
  }

  if (
    engine15Needs.some((need) => String(need).toUpperCase().includes("10M")) ||
    permissionReasons.some((reason) =>
      String(reason).toUpperCase().includes("RECLAIM")
    )
  ) {
    steps.push("Need 10m EMA10/EMA20 reclaim");
  }

  if (
    engine15Needs.some((need) => String(need).toUpperCase().includes("ENGINE3")) ||
    engine15?.qualityBreakdown?.reactionConfirmed === false
  ) {
    steps.push("Need Engine 3 reaction confirmation");
  }

  if (
    engine15Needs.some((need) => String(need).toUpperCase().includes("ENGINE4")) ||
    volume?.cleanParticipation === false
  ) {
    steps.push("Need Engine 4 clean participation");
  }

  if (!isReadyState(engine15?.readinessLabel)) {
    steps.push("Engine 15ES must upgrade from WATCH to READY");
  }

  if (!actionLevels.length && !steps.length) {
    steps.push("Wait for the next valid Wave 3 or Wave 5 opportunity");
  }

  return {
    number: 6,
    icon: "✓",
    title: "Next Action Levels",
    severity: "teal",
    checklist: [...actionLevels, ...steps].slice(0, 8),
  };
}

/* =========================
   Market Context builders
========================= */

function buildEngine3ContextSection(fib) {
  const reaction = getEngine5Reaction(fib);

  if (!reaction) {
    return {
      number: 0,
      icon: "③",
      title: "Engine 3 Current State",
      severity: "neutral",
      fields: [],
      lines: ["Engine 3 reaction context unavailable."],
    };
  }

  const quality =
    reaction.quality ||
    reaction.reactionQuality ||
    reaction.state ||
    "UNKNOWN";

  const direction =
    reaction.direction ||
    reaction.executionBias ||
    reaction.bias ||
    "NEUTRAL";

  const confirmed =
    reaction.confirmed === true ||
    reaction.cleanReaction === true ||
    reaction.reactionConfirmed === true;

  return {
    number: 0,
    icon: "③",
    title: "Engine 3 Current State",
    severity: confirmed ? "bullish" : "warning",
    fields: [
      ["Reaction", formatUpper(quality, "UNKNOWN")],
      ["Direction", formatUpper(direction, "NEUTRAL")],
      ["Confirmed", formatBool(confirmed)],
      ["Score", formatScore(reaction.score || reaction.reactionScore)],
    ],
    lines: [
      reaction.message ||
        reaction.traderMessage ||
        (confirmed
          ? "Engine 3 reaction is confirmed."
          : "Engine 3 reaction is not confirmed yet."),
    ].filter(Boolean),
  };
}

function buildEngine4ContextSection(fib) {
  const volume = getEngine5Volume(fib);

  if (!volume) {
    return {
      number: 0,
      icon: "④",
      title: "Engine 4 Current State",
      severity: "neutral",
      fields: [],
      lines: ["Engine 4 volume / participation context unavailable."],
    };
  }

  const quality =
    volume.quality ||
    volume.participationQuality ||
    volume.state ||
    "UNKNOWN";

  const direction =
    volume.direction ||
    volume.participationDirection ||
    "NEUTRAL";

  const confirmed =
    volume.confirmed === true ||
    volume.volumeConfirmed === true ||
    volume.cleanParticipation === true;

  return {
    number: 0,
    icon: "④",
    title: "Engine 4 Current State",
    severity: confirmed ? "bullish" : "warning",
    fields: [
      ["Volume", formatUpper(quality, "UNKNOWN")],
      ["Direction", formatUpper(direction, "NEUTRAL")],
      ["Confirmed", formatBool(confirmed)],
      ["Score", formatScore(volume.score || volume.volumeScore)],
    ],
    lines: [
      volume.message ||
        volume.traderMessage ||
        (confirmed
          ? "Engine 4 participation is confirmed."
          : "Engine 4 participation is not confirmed yet."),
    ].filter(Boolean),
  };
}

function buildCurrentFibExtensionsSection(waveOpportunity) {
  const targets = getTargets(waveOpportunity);

  if (!targets.length) {
    return {
      number: 0,
      icon: "⑸",
      title: "Current Fib Extensions To Watch",
      severity: "neutral",
      fields: [],
      lines: ["No active fib extension targets are available."],
    };
  }

  return {
    number: 0,
    icon: "⑸",
    title: "Current Fib Extensions To Watch",
    severity: "blue",
    fields: targets.map(([level, price]) => [level, formatNumber(price)]),
    lines: [
      "Use these only as target / reaction zones. They are not entry signals by themselves.",
    ],
  };
}

/* =========================
   Normalize timeline data
========================= */

function normalizeTimelineData({ overlayData }) {
  if (!overlayData?.ok) {
    return {
      show: false,
    };
  }

  const fib = getFib(overlayData);
  const waveOpportunity = getWaveOpportunity(fib);
  const engine15 = getEngine15Decision(fib);
  const permission = getFinalPermission(fib);
  const backendTimelineRead = getBackendTimelineRead(fib);
  const tradeContextSummary = getBackendTradeContextSummary(fib);

  const postAbcBounceSection = buildPostAbcBounceSection(tradeContextSummary);

  const targetClusterSection = getBackendTimelineSection(
    fib,
    "Target Cluster Confidence"
  );

  const marketMeterSection = getBackendTimelineSection(
    fib,
    "Market Meter / Tactical Context"
  );

  const headline =
    backendTimelineRead?.headline ||
    tradeContextSummary?.headline ||
    buildFallbackHeadline({ waveOpportunity, engine15 });

  const subheadline =
    backendTimelineRead?.subheadline ||
    tradeContextSummary?.subheadline ||
    buildFallbackSubheadline({ waveOpportunity, engine15 });

  const badges = buildBadges({ waveOpportunity, engine15, permission });

  const sections = [
    buildWaveOpportunitySection(waveOpportunity),
    postAbcBounceSection,
    buildEngine15Section(engine15),
    buildEngine5Section(fib),
    buildPermissionSection(permission, engine15),
    buildNextStepsSection({
      waveOpportunity,
      engine15,
      permission,
      fib,
      tradeContextSummary,
    }),
  ]
    .filter(Boolean)
    .map((section, idx) => ({
      ...section,
      number: idx + 1,
    }));

  const contextSections = [
    buildBackendTimelineSection(targetClusterSection),
    buildBackendTimelineSection(marketMeterSection),
    buildEngine3ContextSection(fib),
    buildEngine4ContextSection(fib),
    buildCurrentFibExtensionsSection(waveOpportunity),
  ]
    .filter(Boolean)
    .map((section, idx) => ({
      ...section,
      number: idx + 1,
    }));

  const severity =
    backendTimelineRead?.severity ||
    tradeContextSummary?.severity ||
    (permission?.executable === true
      ? "bullish"
      : waveOpportunity?.chaseRisk === "EXTREME" ||
        waveOpportunity?.timing === "POST_EXTENSION"
      ? "warning"
      : isWatchState(engine15?.readinessLabel)
      ? "warning"
      : "neutral");

  return {
    show: true,
    severity,
    headline,
    subheadline,
    badges,
    sections,
    contextSections,
    footer: permission?.executable === true ? "EXECUTION ELIGIBLE" : "WATCH",
  };
}

/* =========================
   Shared styles
========================= */

const shellTextStyle = {
  fontFamily: TIMELINE_FONT,
  WebkitFontSmoothing: "antialiased",
  MozOsxFontSmoothing: "grayscale",
  textRendering: "geometricPrecision",
};

const smallCapsStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.045em",
};

/* =========================
   UI Components
========================= */

function Badge({ label, severity = "neutral" }) {
  if (!label) return null;

  return (
    <span
      style={{
        ...shellTextStyle,
        ...smallCapsStyle,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${severityBorder(severity)}`,
        background: severityBackground(severity),
        color: severityColor(severity),
        borderRadius: 8,
        padding: "5px 10px",
        fontSize: 13,
        fontWeight: FONT_REGULAR,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function FieldGrid({ fields }) {
  const safeFields = asArray(fields);

  if (!safeFields.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: "9px 15px",
        marginTop: 7,
      }}
    >
      {safeFields.map(([label, value], idx) => (
        <div key={`${label}-${idx}`}>
          <div
            style={{
              ...shellTextStyle,
              ...smallCapsStyle,
              color: MUTED_TEXT,
              fontSize: 13,
              fontWeight: FONT_REGULAR,
              marginBottom: 3,
            }}
          >
            {label}
          </div>
          <div
            style={{
              ...shellTextStyle,
              color: MAIN_TEXT,
              fontSize: 16,
              fontWeight: FONT_REGULAR,
              lineHeight: 1.35,
              whiteSpace: "pre-line",
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function IngredientCards({ cards }) {
  const safeCards = asArray(cards);

  if (!safeCards.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gap: 10,
        marginTop: 7,
      }}
    >
      {safeCards.map((card, idx) => (
        <div
          key={`${card.label}-${idx}`}
          style={{
            borderLeft: `3px solid ${card.good ? "#22c55e" : "#f59e0b"}`,
            background: "rgba(15,23,42,0.48)",
            borderRadius: 8,
            padding: "9px 10px",
          }}
        >
          <div
            style={{
              ...shellTextStyle,
              ...smallCapsStyle,
              color: "#cbd5e1",
              fontSize: 13,
              fontWeight: FONT_REGULAR,
              marginBottom: 3,
            }}
          >
            {card.label}
          </div>
          <div
            style={{
              ...shellTextStyle,
              color: card.good ? "#86efac" : "#fed7aa",
              fontSize: 15,
              fontWeight: FONT_REGULAR,
              lineHeight: 1.35,
            }}
          >
            {card.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Checklist({ items }) {
  const safeItems = asArray(items);

  if (!safeItems.length) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: "9px 20px",
        marginTop: 7,
      }}
    >
      {safeItems.map((item, idx) => (
        <div
          key={`${item}-${idx}`}
          style={{
            ...shellTextStyle,
            display: "grid",
            gridTemplateColumns: "22px 1fr",
            alignItems: "center",
            gap: 8,
            color: SOFT_TEXT,
            fontSize: 15,
            fontWeight: FONT_REGULAR,
            lineHeight: 1.35,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 6,
              border: "1px solid rgba(45,212,191,0.85)",
              color: "#2dd4bf",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: FONT_MEDIUM,
            }}
          >
            {idx + 1}
          </div>
          <div>{item}</div>
        </div>
      ))}
    </div>
  );
}

function TimelineSection({ section }) {
  if (!section) return null;

  return (
    <div
      style={{
        border: `1px solid ${severityBorder(section.severity)}`,
        background: severityBackground(section.severity),
        borderRadius: 12,
        padding: "12px 13px",
        textAlign: "left",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "38px 1fr",
          gap: 10,
          alignItems: "start",
        }}
      >
        <div
          style={{
            ...shellTextStyle,
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: `1px solid ${severityBorder(section.severity)}`,
            color: severityColor(section.severity),
            background: "rgba(2,6,23,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: FONT_MEDIUM,
            fontSize: 15,
            boxShadow: `0 0 16px ${severityBorder(section.severity)}`,
          }}
        >
          {section.number}
        </div>

        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <span
              style={{
                ...shellTextStyle,
                color: severityColor(section.severity),
                fontSize: 19,
                fontWeight: FONT_MEDIUM,
              }}
            >
              {section.icon}
            </span>
            <div
              style={{
                ...shellTextStyle,
                color: severityColor(section.severity),
                fontSize: 19,
                fontWeight: FONT_MEDIUM,
                letterSpacing: "0.01em",
              }}
            >
              {section.title}
            </div>
          </div>

          <FieldGrid fields={section.fields} />
          <IngredientCards cards={section.ingredientCards} />
          <Checklist items={section.checklist} />

          {asArray(section.lines).length > 0 && (
            <div
              style={{
                ...shellTextStyle,
                display: "grid",
                gap: 5,
                marginTop: 8,
                color: SOFT_TEXT,
                fontSize: 15,
                lineHeight: 1.5,
                fontWeight: FONT_REGULAR,
              }}
            >
              {asArray(section.lines).map((line, idx) => (
                <div key={`${line}-${idx}`}>{line}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MinimalStatusStrip({ timeline }) {
  return (
    <div
      style={{
        ...shellTextStyle,
        position: "absolute",
        top: 88,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 108,
        width: 760,
        maxWidth: "44%",
        border: "1px solid rgba(148,163,184,0.20)",
        borderRadius: 10,
        background: "rgba(6,10,20,0.70)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 0,
        color: "#cbd5e1",
        pointerEvents: "none",
        backdropFilter: "blur(4px)",
      }}
    >
      <div style={stripCellStyle}>
        <span style={stripLabelStyle}>Market Bias</span>
        <span style={{ ...stripValueStyle, color: "#22c55e" }}>↗ LONG</span>
      </div>
      <div style={stripCellStyle}>
        <span style={stripLabelStyle}>Setup</span>
        <span style={{ ...stripValueStyle, color: "#fbbf24" }}>◉ WATCH</span>
      </div>
      <div style={stripCellStyle}>
        <span style={stripLabelStyle}>Permission</span>
        <span style={{ ...stripValueStyle, color: "#c084fc" }}>⬟ REDUCE</span>
      </div>
    </div>
  );
}

const stripCellStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "10px 12px",
  borderRight: "1px solid rgba(148,163,184,0.14)",
};

const stripLabelStyle = {
  ...shellTextStyle,
  ...smallCapsStyle,
  color: MUTED_TEXT,
  fontSize: 13,
  fontWeight: FONT_REGULAR,
};

const stripValueStyle = {
  ...shellTextStyle,
  ...smallCapsStyle,
  fontSize: 14,
  fontWeight: FONT_MEDIUM,
};

function TimelineMainCard({ timeline }) {
  return (
    <div
      style={{
        ...shellTextStyle,
        position: "absolute",
        top: 138,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 109,
        width: 760,
        maxWidth: "44%",
        maxHeight: "calc(100vh - 165px)",
        overflowY: "auto",
        borderRadius: 15,
        border: `1px solid ${severityBorder(timeline.severity)}`,
        background: CARD_BG_STRONG,
        padding: "18px 19px",
        color: "#e5e7eb",
        pointerEvents: "none",
        backdropFilter: "blur(5px)",
        boxShadow: "0 12px 34px rgba(0,0,0,0.34)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          ...shellTextStyle,
          fontSize: 30,
          fontWeight: FONT_MEDIUM,
          color: "#fbbf24",
          letterSpacing: "0.01em",
          marginBottom: 7,
          lineHeight: 1.2,
          textTransform: "none",
        }}
      >
        {timeline.headline}
      </div>

      {timeline.subheadline && (
        <div
          style={{
            ...shellTextStyle,
            color: "#e2e8f0",
            fontSize: 16,
            lineHeight: 1.5,
            fontWeight: FONT_REGULAR,
            maxWidth: 710,
            margin: "0 auto 11px",
          }}
        >
          {timeline.subheadline}
        </div>
      )}

      {asArray(timeline.badges).length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
            marginBottom: 13,
          }}
        >
          {timeline.badges.map((badge, idx) => (
            <Badge
              key={`${badge.label}-${idx}`}
              label={badge.label}
              severity={badge.severity}
            />
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 9 }}>
        {asArray(timeline.sections).map((section, idx) => (
          <TimelineSection
            key={`${section.title || "section"}-${idx}`}
            section={section}
          />
        ))}
      </div>

      {timeline.footer && (
        <div
          style={{
            ...shellTextStyle,
            ...smallCapsStyle,
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid rgba(148,163,184,0.25)",
            color: MUTED_TEXT,
            fontWeight: FONT_MEDIUM,
            fontSize: 13,
            letterSpacing: "0.08em",
          }}
        >
          {timeline.footer}
        </div>
      )}
    </div>
  );
}

function ContextTimelinePanel({ sections }) {
  const safeSections = asArray(sections);

  if (!safeSections.length) return null;

  return (
    <div
      style={{
        ...shellTextStyle,
        position: "absolute",
        top: 138,
        right: "calc(50% + 430px)",
        width: 430,
        maxWidth: "28%",
        maxHeight: "calc(100vh - 165px)",
        overflowY: "auto",
        zIndex: 108,
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: 15,
        background: CARD_BG,
        padding: "14px 14px",
        color: "#e5e7eb",
        pointerEvents: "none",
        boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
        backdropFilter: "blur(5px)",
      }}
    >
      <div
        style={{
          ...shellTextStyle,
          ...smallCapsStyle,
          color: MAIN_TEXT,
          fontWeight: FONT_MEDIUM,
          fontSize: 18,
          marginBottom: 12,
        }}
      >
        Market Context
      </div>

      <div style={{ display: "grid", gap: 9 }}>
        {safeSections.map((section, idx) => (
          <TimelineSection
            key={`${section.title || "context"}-${idx}`}
            section={section}
          />
        ))}
      </div>
    </div>
  );
}

/* =========================
   Main export
========================= */

export default function Engine17DecisionTimeline({
  overlayData,
  visible = true,
  chartMode = "SCALP",
}) {
  const timeline = normalizeTimelineData({ overlayData, chartMode });

  if (!visible || !timeline?.show) return null;

  return (
    <>
      <MinimalStatusStrip timeline={timeline} />
      <ContextTimelinePanel sections={timeline.contextSections} />
      <TimelineMainCard timeline={timeline} />
    </>
  );
}
