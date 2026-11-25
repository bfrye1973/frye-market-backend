// services/core/logic/engine29/groups/buildEnergyInflationGroup.js

import { ENGINE29_GROUP_IDS, ENGINE29_GROUP_STATES } from "../constants.js";
import { ENGINE29_REASON_CODES } from "../canonical/reasonCodes.js";
import {
  groupBase,
  timeframeLabel,
  isBreakingOrWorse,
  isConfirmedBreak,
  isRecovering,
  isWarningOrWorse,
  memberSnapshot,
  getTimeframeView,
} from "./groupUtils.js";

const OIL_DIRECTIONAL_STATES = Object.freeze({
  PRESSURE_INCREASING: "PRESSURE_INCREASING",
  PRESSURE_EASING: "PRESSURE_EASING",
  REACCELERATING: "REACCELERATING",
  RELIEF_CONTINUING: "RELIEF_CONTINUING",
  STABLE: "STABLE",
  UNAVAILABLE: "UNAVAILABLE",
});

function finite(value) {
  return Number.isFinite(Number(value));
}

function pctChange(from, to) {
  const a = Number(from);
  const b = Number(to);

  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) {
    return null;
  }

  return ((b - a) / a) * 100;
}

function median(values = []) {
  const good = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!good.length) return null;

  const mid = Math.floor(good.length / 2);

  return good.length % 2
    ? good[mid]
    : (good[mid - 1] + good[mid]) / 2;
}

function completedBars(symbolEntry, timeframeKey) {
  const view = getTimeframeView(symbolEntry, timeframeKey);
  const bars = Array.isArray(view?.bars) ? view.bars : [];

  return bars.filter((bar) => bar?.completed !== false);
}

function directionalMember(symbolEntry, timeframeKey) {
  const bars = completedBars(symbolEntry, timeframeKey);

  if (bars.length < 3) {
    return {
      canonicalSymbol: symbolEntry?.canonicalSymbol ?? null,
      available: false,
      currentChangePct: null,
      priorChangePct: null,
      adaptiveThresholdPct: null,
      latestClose: null,
      latestTime: null,
    };
  }

  const latest = bars.at(-1);
  const previous = bars.at(-2);
  const prior = bars.at(-3);

  const recentReturns = [];

  const lookback = bars.slice(-41);
  for (let i = 1; i < lookback.length; i += 1) {
    const change = pctChange(
      lookback[i - 1]?.close,
      lookback[i]?.close
    );

    if (Number.isFinite(change)) {
      recentReturns.push(Math.abs(change));
    }
  }

  const baselineMedianAbsReturnPct = median(recentReturns);

  // Adaptive threshold only. No fixed market-price threshold is introduced.
  // 35% of the instrument's own recent median absolute bar return filters
  // trivial noise while allowing the directional layer to react intraday.
  const adaptiveThresholdPct =
    Number.isFinite(baselineMedianAbsReturnPct)
      ? baselineMedianAbsReturnPct * 0.35
      : null;

  return {
    canonicalSymbol: symbolEntry?.canonicalSymbol ?? null,
    available:
      finite(latest?.close) &&
      finite(previous?.close) &&
      finite(prior?.close) &&
      Number.isFinite(adaptiveThresholdPct),
    currentChangePct: pctChange(previous?.close, latest?.close),
    priorChangePct: pctChange(prior?.close, previous?.close),
    adaptiveThresholdPct,
    baselineMedianAbsReturnPct,
    latestClose: Number(latest?.close),
    latestTime: latest?.time ?? null,
  };
}

function averageFinite(values = []) {
  const good = values.filter(Number.isFinite);

  if (!good.length) return null;

  return good.reduce((sum, value) => sum + value, 0) / good.length;
}

function buildDirectionalState(symbols, timeframeKey) {
  if (!["tactical", "fastTactical"].includes(timeframeKey)) {
    return null;
  }

  const members = [
    directionalMember(symbols.WTI, timeframeKey),
    directionalMember(symbols.BRENT, timeframeKey),
  ].filter((member) => member.available);

  if (!members.length) {
    return {
      directionalState: OIL_DIRECTIONAL_STATES.UNAVAILABLE,
      directionalMetrics: {
        currentChangePct: null,
        priorChangePct: null,
        adaptiveThresholdPct: null,
        availableMembers: [],
      },
    };
  }

  const currentChangePct = averageFinite(
    members.map((member) => member.currentChangePct)
  );

  const priorChangePct = averageFinite(
    members.map((member) => member.priorChangePct)
  );

  const adaptiveThresholdPct = averageFinite(
    members.map((member) => member.adaptiveThresholdPct)
  );

  let directionalState = OIL_DIRECTIONAL_STATES.UNAVAILABLE;

  if (
    Number.isFinite(currentChangePct) &&
    Number.isFinite(adaptiveThresholdPct)
  ) {
    if (Math.abs(currentChangePct) <= adaptiveThresholdPct) {
      directionalState = OIL_DIRECTIONAL_STATES.STABLE;
    } else if (currentChangePct > adaptiveThresholdPct) {
      directionalState =
        Number.isFinite(priorChangePct) &&
        priorChangePct < -adaptiveThresholdPct
          ? OIL_DIRECTIONAL_STATES.REACCELERATING
          : OIL_DIRECTIONAL_STATES.PRESSURE_INCREASING;
    } else if (currentChangePct < -adaptiveThresholdPct) {
      directionalState =
        Number.isFinite(priorChangePct) &&
        priorChangePct < -adaptiveThresholdPct
          ? OIL_DIRECTIONAL_STATES.RELIEF_CONTINUING
          : OIL_DIRECTIONAL_STATES.PRESSURE_EASING;
    }
  }

  return {
    directionalState,
    directionalMetrics: {
      currentChangePct,
      priorChangePct,
      adaptiveThresholdPct,
      availableMembers: members.map((member) => ({
        canonicalSymbol: member.canonicalSymbol,
        currentChangePct: member.currentChangePct,
        priorChangePct: member.priorChangePct,
        adaptiveThresholdPct: member.adaptiveThresholdPct,
        latestClose: member.latestClose,
        latestTime: member.latestTime,
      })),
    },
  };
}

function buildOne(symbols, timeframeKey) {
  const wti = memberSnapshot(symbols.WTI, timeframeKey);
  const brent = memberSnapshot(symbols.BRENT, timeframeKey);
  const members = [wti, brent].filter(Boolean);
  const available = members.filter((m) => m.available);

  let state = null;

  if (available.length) {
    const breaking = available.filter(
      (m) => isBreakingOrWorse(m.state)
    ).length;

    const confirmed = available.filter(
      (m) => isConfirmedBreak(m.state)
    ).length;

    const warning = available.filter(
      (m) => isWarningOrWorse(m.state)
    ).length;

    if (available.length === 2 && confirmed === 2) {
      state = ENGINE29_GROUP_STATES.SEVERE;
    } else if (available.length === 2 && breaking === 2) {
      state = ENGINE29_GROUP_STATES.CONFIRMED;
    } else if (breaking >= 1 || warning >= 1) {
      state = ENGINE29_GROUP_STATES.FORMING;
    } else if (available.some((m) => isRecovering(m.state))) {
      state = ENGINE29_GROUP_STATES.RECOVERING;
    } else {
      state = ENGINE29_GROUP_STATES.HEALTHY;
    }
  }

  const reasonCodes = [];

  if (wti?.available && isBreakingOrWorse(wti.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.WTI_BREAKOUT);
  }

  if (brent?.available && isBreakingOrWorse(brent.state)) {
    reasonCodes.push(ENGINE29_REASON_CODES.BRENT_BREAKOUT);
  }

  if (
    [
      ENGINE29_GROUP_STATES.CONFIRMED,
      ENGINE29_GROUP_STATES.SEVERE,
    ].includes(state)
  ) {
    reasonCodes.push(
      ENGINE29_REASON_CODES.ENERGY_OIL_COMPLEX_CONFIRMED
    );
  }

  const missingRequiredMembers = [];

  if (!wti?.available) missingRequiredMembers.push("WTI");
  if (!brent?.available) missingRequiredMembers.push("BRENT");

  const base = groupBase({
    group: ENGINE29_GROUP_IDS.ENERGY_INFLATION,
    timeframe: timeframeLabel(timeframeKey),
    state,
    members,
    subgroups: {
      OIL_COMPLEX: {
        state,
        members,
      },
    },
    reasonCodes,
    missingRequiredMembers,
    notes: [
      "WTI and Brent are treated as one correlated oil complex; one leg alone cannot produce CONFIRMED oil-complex stress.",
    ],
  });

  const directional = buildDirectionalState(
    symbols,
    timeframeKey
  );

  if (!directional) {
    return base;
  }

  return {
    ...base,
    directionalState: directional.directionalState,
    directionalMetrics: directional.directionalMetrics,
  };
}

export function buildEnergyInflationGroup(symbols = {}) {
  return {
    structural: buildOne(symbols, "structural"),
    tactical: buildOne(symbols, "tactical"),
    fastTactical: buildOne(symbols, "fastTactical"),
  };
}
