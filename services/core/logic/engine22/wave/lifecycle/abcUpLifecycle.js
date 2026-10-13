// services/core/logic/engine22/wave/lifecycle/abcUpLifecycle.js

import {
  toNum,
  upper,
  tickSizeForSymbol,
  roundToTick,
  parseManualTimeSec,
  getBarsForDegree,
  formatTimeSec,
  findLatestAnchorTouch,
  findSwingLowsAfterTime,
  findLowestLowAfterTime,
  pickLowestCandidate,
} from "./lifecycleUtils.js";

import { buildCUpProgress } from "./abcUpCProgress.js";
import { buildAbcUpMarketContextRisk } from "./abcUpMarketContextRisk.js";

function findStructuralBLowAfterA({
  bars = [],
  afterSec = null,
  originLow = null,
  preferredBZone = null,
} = {}) {
  const origin = toNum(originLow);
  const preferredLo = toNum(preferredBZone?.lo);

  const swingLows = findSwingLowsAfterTime({
    bars,
    afterSec,
  });

  const undercutOriginLows =
    origin !== null
      ? swingLows.filter(
          (item) => toNum(item?.price) !== null && toNum(item.price) < origin
        )
      : [];

  const selectedUndercut = pickLowestCandidate(
    undercutOriginLows,
    "AUTO_STRUCTURAL_B_UNDERCUT_ORIGIN"
  );

  if (selectedUndercut) return selectedUndercut;

  const belowPreferredLows =
    preferredLo !== null
      ? swingLows.filter(
          (item) =>
            toNum(item?.price) !== null && toNum(item.price) < preferredLo
        )
      : [];

  const selectedBelowPreferred = pickLowestCandidate(
    belowPreferredLows,
    "AUTO_STRUCTURAL_B_BELOW_PREFERRED_B_ZONE"
  );

  if (selectedBelowPreferred) return selectedBelowPreferred;

  if (swingLows.length) {
    return {
      ...swingLows[swingLows.length - 1],
      source: "AUTO_CANDLE_SWING_LOW",
    };
  }

  return findLowestLowAfterTime({
    bars,
    afterSec,
  });
}

function findFirstCompletedStructuralBLowAfterA({
  bars = [],
  afterSec = null,
  originLow = null,
  preferredBZone = null,
} = {}) {
  const origin = toNum(originLow);
  const preferredLo = toNum(preferredBZone?.lo);

  if (!Array.isArray(bars) || bars.length < 3 || origin === null) {
    return null;
  }

  const scopedBars =
    afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(afterSec))
      : bars;

  if (scopedBars.length < 3) return null;

  const swingLows = findSwingLowsAfterTime({
    bars: scopedBars,
    afterSec: null,
  });

  const structuralCandidates = swingLows.filter((item) => {
    const price = toNum(item?.price);
    if (price === null) return false;

    if (price < origin) return true;
    if (preferredLo !== null && price < preferredLo) return true;

    return false;
  });

  for (const candidate of structuralCandidates) {
    const candidatePrice = toNum(candidate?.price);
    const candidateSec = Number(candidate?.timeSec);

    if (candidatePrice === null || !Number.isFinite(candidateSec)) continue;

    const barsAfterCandidate = scopedBars.filter(
      (bar) => Number(bar.timeSec) > candidateSec
    );

    const reclaimBar = barsAfterCandidate.find((bar) => {
      const close = toNum(bar?.close);
      return close !== null && close > origin;
    });

    if (!reclaimBar) continue;

    return {
      ...candidate,
      source:
        candidatePrice < origin
          ? "AUTO_STRUCTURAL_B_COMPLETE_ORIGIN_RECLAIM"
          : "AUTO_STRUCTURAL_B_COMPLETE_PREFERRED_ZONE_RECLAIM",
      bCompletion: {
        completed: true,
        status: "B_COMPLETE_ON_ORIGIN_RECLAIM",
        completedLevel: origin,
        completedTimeSec: reclaimBar.timeSec,
        completedTime: formatTimeSec(reclaimBar.timeSec),
        completedClose: toNum(reclaimBar.close),
        read:
          "Wave B is complete because price reclaimed the ABC_UP origin after the structural B low.",
        reasonCodes: [
          "ABC_UP_STRUCTURAL_B_FOUND",
          "ABC_UP_ORIGIN_RECLAIM_AFTER_B",
          "B_COMPLETE_ON_ORIGIN_RECLAIM",
        ],
      },
    };
  }

  return null;
}

function findLatestSwingHighAfterTime({ bars = [], afterSec = null } = {}) {
  if (!Array.isArray(bars) || bars.length < 3) return null;

  const scopedBars =
    afterSec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(afterSec))
      : bars;

  if (scopedBars.length < 3) return null;

  let latest = null;

  for (let i = 1; i < scopedBars.length - 1; i++) {
    const prevHigh = toNum(scopedBars[i - 1]?.high);
    const high = toNum(scopedBars[i]?.high);
    const nextHigh = toNum(scopedBars[i + 1]?.high);

    if (prevHigh === null || high === null || nextHigh === null) continue;

    if (high >= prevHigh && high >= nextHigh) {
      latest = {
        price: high,
        timeSec: scopedBars[i].timeSec,
        time: formatTimeSec(scopedBars[i].timeSec),
        close: scopedBars[i].close,
        source: "AUTO_CANDLE_SWING_HIGH",
      };
    }
  }

  return latest;
}

function classifyAbcUpBStructure({
  originLow = null,
  waveAHigh = null,
  bCandidateLow = null,
} = {}) {
  const origin = toNum(originLow);
  const aHigh = toNum(waveAHigh);
  const bLow = toNum(bCandidateLow);

  if (origin === null || aHigh === null || bLow === null || aHigh <= origin) {
    return {
      bRetracePct: null,
      bRetraceRatio: null,
      correctionType: "B_PULLBACK_PENDING",
      correctionFamily: "UNKNOWN",
      quality: "PENDING",
      reasonCodes: ["ABC_UP_B_RETRACE_UNAVAILABLE"],
    };
  }

  const range = aHigh - origin;
  const retraceRatio = (aHigh - bLow) / range;
  const retracePct = Number((retraceRatio * 100).toFixed(1));

  let correctionType = "B_PULLBACK_PENDING";
  let correctionFamily = "UNKNOWN";
  let quality = "PENDING";

  if (retracePct < 38.2) {
    correctionType = "SHALLOW_B_PULLBACK";
    correctionFamily = "SHALLOW_ZIGZAG_OR_STRONG_BOUNCE";
    quality = "CONSTRUCTIVE";
  } else if (retracePct < 61.8) {
    correctionType = "NORMAL_B_PULLBACK";
    correctionFamily = "NORMAL_ZIGZAG_OR_SIMPLE_ABC";
    quality = "CONSTRUCTIVE";
  } else if (retracePct < 78.6) {
    correctionType = "DEEP_B_PULLBACK";
    correctionFamily = "DEEP_ZIGZAG_OR_COMPLEX_ABC";
    quality = "CAUTION";
  } else if (retracePct < 100) {
    correctionType = "VERY_DEEP_B_PULLBACK";
    correctionFamily = "FLAT_CANDIDATE";
    quality = "CAUTION";
  } else if (retracePct < 105) {
    correctionType = "B_ORIGIN_UNDERCUT";
    correctionFamily = "FLAT_OR_UNDERCUT_B";
    quality = "LOWER_QUALITY_UNTIL_RECLAIM";
  } else if (retracePct <= 138) {
    correctionType = "EXPANDED_FLAT_CANDIDATE";
    correctionFamily = "EXPANDED_FLAT";
    quality = "LOWER_QUALITY_UNTIL_RECLAIM";
  } else {
    correctionType = "EXTREME_EXPANDED_B_OR_STRUCTURE_REVIEW";
    correctionFamily = "EXTREME_EXPANDED_OR_NEW_STRUCTURE";
    quality = "STRUCTURE_REVIEW";
  }

  return {
    bRetracePct: retracePct,
    bRetraceRatio: Number(retraceRatio.toFixed(4)),
    correctionType,
    correctionFamily,
    quality,
    reasonCodes: [
      "ABC_UP_B_RETRACE_CLASSIFIED",
      correctionType,
      correctionFamily,
      quality,
    ],
  };
}

function buildAbcUpPriceAction({
  originLow = null,
  waveAHigh = null,
  currentPrice,
  latestClose = null,
  bCandidateLow = null,
  bCandidateTime = null,
  bSource = "PENDING",
  preferredBZone = null,
  deepBSupport = null,
  barsScanned = 0,
  scanStartSec = null,
  scanStartTime = null,
} = {}) {
  const origin = toNum(originLow);
  const price = toNum(currentPrice);
  const close = toNum(latestClose) ?? price;
  const bLow = toNum(bCandidateLow);
  const zoneLo = toNum(preferredBZone?.lo);
  const zoneHi = toNum(preferredBZone?.hi);
  const deepSupport = toNum(deepBSupport);

  const bStructure = classifyAbcUpBStructure({
    originLow,
    waveAHigh,
    bCandidateLow,
  });

  const touchedPreferredBZone =
    bLow !== null &&
    zoneLo !== null &&
    zoneHi !== null &&
    bLow <= zoneHi;

  const tradedBelowPreferredBZone =
    bLow !== null &&
    zoneLo !== null &&
    bLow < zoneLo;

  const heldDeepBSupport =
    bLow !== null &&
    deepSupport !== null &&
    bLow >= deepSupport;

  const tradedBelowDeepBSupport =
    bLow !== null &&
    deepSupport !== null &&
    bLow < deepSupport;

  const undercutOrigin =
    bLow !== null &&
    origin !== null &&
    bLow < origin;

  const reclaimedOrigin =
    close !== null &&
    origin !== null &&
    close > origin;

  const reclaimedDeepBSupport =
    close !== null &&
    deepSupport !== null &&
    close > deepSupport;

  const reclaimedPreferredBZone =
    close !== null &&
    zoneHi !== null &&
    close > zoneHi;

  const correctionType = bStructure.correctionType;

  let status = "WAITING_FOR_B_PULLBACK";
  let read = "Waiting for B pullback into the preferred B zone.";

  if (bLow === null) {
    status = "WAITING_FOR_B_PULLBACK";
    read = "Waiting for B pullback into the preferred B zone.";
  } else if (
    correctionType === "EXPANDED_FLAT_CANDIDATE" ||
    correctionType === "B_ORIGIN_UNDERCUT" ||
    correctionType === "EXTREME_EXPANDED_B_OR_STRUCTURE_REVIEW"
  ) {
    if (reclaimedPreferredBZone) {
      status = "EXPANDED_B_UNDERCUT_PREFERRED_ZONE_RECLAIMING";
      read =
        "Wave B undercut the origin and is now reclaiming the preferred B zone. Expanded-flat C-up watch improves, but still requires confirmation.";
    } else if (reclaimedDeepBSupport) {
      status = "EXPANDED_B_UNDERCUT_DEEP_SUPPORT_RECLAIMING";
      read =
        "Wave B undercut the origin and reclaimed deep B support. Structure is improving, but preferred B zone reclaim is still needed.";
    } else if (reclaimedOrigin) {
      status = "EXPANDED_B_UNDERCUT_ORIGIN_RECLAIMING";
      read =
        "Wave B undercut the origin and reclaimed the origin area. This can still be expanded-flat behavior, but quality remains lower until 7415 and the preferred B zone reclaim.";
    } else {
      status = "EXPANDED_B_UNDERCUT_WAIT_FOR_RECLAIM";
      read =
        "Wave B undercut the origin. This can still be expanded-flat behavior, but it needs reclaim before C-up can be trusted.";
    }
  } else if (tradedBelowDeepBSupport) {
    if (reclaimedPreferredBZone) {
      status = "EXTENDED_B_PULLBACK_PREFERRED_ZONE_RECLAIMING";
      read =
        "Wave B extended below the deep zone and reclaimed the preferred B zone. C-up watch improves, but confirmation is still required.";
    } else if (reclaimedDeepBSupport) {
      status = "EXTENDED_B_PULLBACK_DEEP_SUPPORT_RECLAIMING";
      read =
        "Wave B extended below the deep zone and reclaimed deep B support. Wait for preferred B zone reclaim.";
    } else {
      status = "EXTENDED_B_PULLBACK_WAIT_FOR_RECLAIM";
      read =
        "Wave B extended below the deep B zone. This is not an automatic failure. Wait for reclaim confirmation.";
    }
  } else if (tradedBelowPreferredBZone && heldDeepBSupport) {
    status = reclaimedPreferredBZone
      ? "B_PULLBACK_DEEP_TEST_RECLAIMING"
      : "B_PULLBACK_DEEP_SUPPORT_TEST";

    read = reclaimedPreferredBZone
      ? "Price traded below the preferred B zone, held above deep B support, and is reclaiming the B zone."
      : "Price traded below the preferred B zone but is still holding above deep B support.";
  } else if (touchedPreferredBZone) {
    status = reclaimedPreferredBZone
      ? "B_PULLBACK_PREFERRED_ZONE_RECLAIMING"
      : "B_PULLBACK_REACHED_PREFERRED_ZONE";

    read = reclaimedPreferredBZone
      ? "Price pulled into the preferred B zone and is reclaiming."
      : "Price pulled into the preferred B zone. Waiting for hold/reclaim confirmation.";
  } else if (
    correctionType === "SHALLOW_B_PULLBACK" ||
    correctionType === "NORMAL_B_PULLBACK" ||
    correctionType === "DEEP_B_PULLBACK" ||
    correctionType === "VERY_DEEP_B_PULLBACK"
  ) {
    if (reclaimedPreferredBZone) {
      status = `${correctionType}_C_UP_ATTEMPT_ACTIVE`;
      read =
        "Wave B candidate is marked and price is above the preferred B zone. C-up attempt is active, but confirmation is still required.";
    } else if (reclaimedDeepBSupport) {
      status = `${correctionType}_DEEP_SUPPORT_RECLAIMING`;
      read =
        "Wave B candidate is marked and price reclaimed deep B support. Preferred B zone reclaim is still needed.";
    } else if (reclaimedOrigin) {
      status = `${correctionType}_ORIGIN_RECLAIMING`;
      read =
        "Wave B candidate is marked and price reclaimed the origin area. Deep support and preferred B zone reclaim are still needed.";
    } else {
      status = `${correctionType}_WAIT_FOR_RECLAIM`;
      read =
        "Wave B candidate is marked. Wait for reclaim confirmation before trusting C-up.";
    }
  }
  else if (
    correctionType === "SHALLOW_B_PULLBACK" ||
    correctionType === "NORMAL_B_PULLBACK" ||
    correctionType === "DEEP_B_PULLBACK" ||
    correctionType === "VERY_DEEP_B_PULLBACK"
  ) {
    if (reclaimedPreferredBZone) {
      status = `${correctionType}_C_UP_ATTEMPT_ACTIVE`;
      read =
        "Wave B candidate is marked and price is above the preferred B zone. C-up attempt is active, but confirmation is still required.";
    } else if (reclaimedDeepBSupport) {
      status = `${correctionType}_DEEP_SUPPORT_RECLAIMING`;
      read =
        "Wave B candidate is marked and price reclaimed deep B support. Preferred B zone reclaim is still needed.";
    } else if (reclaimedOrigin) {
      status = `${correctionType}_ORIGIN_RECLAIMING`;
      read =
        "Wave B candidate is marked and price reclaimed the origin area. Deep support and preferred B zone reclaim are still needed.";
    } else {
      status = `${correctionType}_WAIT_FOR_RECLAIM`;
      read =
        "Wave B candidate is marked. Wait for reclaim confirmation before trusting C-up.";
    }
  }

  return {
    currentPrice: price,
    latestClose: close,
    bCandidateLow: bLow,
    bCandidateTime,
    bSource,

    bRetracePct: bStructure.bRetracePct,
    bRetraceRatio: bStructure.bRetraceRatio,
    correctionType: bStructure.correctionType,
    correctionFamily: bStructure.correctionFamily,
    correctionQuality: bStructure.quality,

    preferredBZone,
    deepBSupport,
    originLow: origin,

    scanStartSec,
    scanStartTime,
    barsScanned,

    touchedPreferredBZone,
    tradedBelowPreferredBZone,
    heldDeepBSupport,
    tradedBelowDeepBSupport,
    undercutOrigin,
    reclaimedOrigin,
    reclaimedDeepBSupport,
    reclaimedPreferredBZone,

    status,
    read,

    reasonCodes: [
      bLow !== null ? "ABC_UP_B_CANDIDATE_FOUND" : null,
      touchedPreferredBZone ? "ABC_UP_B_ZONE_TOUCHED" : null,
      tradedBelowPreferredBZone ? "ABC_UP_BELOW_PREFERRED_B_ZONE" : null,
      heldDeepBSupport ? "ABC_UP_DEEP_SUPPORT_HOLDING" : null,
      tradedBelowDeepBSupport ? "ABC_UP_EXTENDED_BELOW_DEEP_B_ZONE" : null,
      undercutOrigin ? "ABC_UP_B_UNDERCUT_ORIGIN" : null,
      reclaimedOrigin ? "ABC_UP_ORIGIN_RECLAIMING" : null,
      reclaimedDeepBSupport ? "ABC_UP_DEEP_SUPPORT_RECLAIMING" : null,
      reclaimedPreferredBZone ? "ABC_UP_PREFERRED_B_ZONE_RECLAIMING" : null,
      bSource,
      ...(Array.isArray(bStructure.reasonCodes) ? bStructure.reasonCodes : []),
    ].filter(Boolean),
  };
}

export function buildPostAbcBounceMap({
  symbol,
  degree = "minute",
  currentPrice = null,
  abcUpMarks = null,
  barsByTf = {},
  marketMeterContext = null,
} = {}) {
  const tickSize = tickSizeForSymbol(symbol);

  const originLow = toNum(abcUpMarks?.originLow);
  const aHigh = toNum(abcUpMarks?.aHigh);
  const manualBLow = toNum(abcUpMarks?.bLow);
  const manualCHigh = toNum(abcUpMarks?.cHigh);

  const originTime = abcUpMarks?.originTime || null;
  const aTime = abcUpMarks?.aTime || null;
  const bTime = abcUpMarks?.bTime || null;
  const cTime = abcUpMarks?.cTime || null;

  if (originLow === null || originLow <= 0 || aHigh === null || aHigh <= 0) {
    return {
      active: false,
      state: "ABC_UP_MARKS_UNAVAILABLE",

      originLow: originLow !== null ? roundToTick(originLow, tickSize) : null,
      originTime,

      waveAHigh: aHigh !== null ? roundToTick(aHigh, tickSize) : null,
      aTime,

      waveBLow: manualBLow !== null ? roundToTick(manualBLow, tickSize) : null,
      bTime,

      waveCHigh: manualCHigh !== null ? roundToTick(manualCHigh, tickSize) : null,
      cTime,

      autoWaveBLow: null,
      autoBTime: null,
      effectiveWaveBLow: null,
      effectiveBTime: null,
      bSource: "PENDING",

      range: null,
      bPullbackLevels: null,
      preferredBZone: null,
      deepBSupport: null,
      bPullbackStatus: "ORIGIN_LOW_AND_A_HIGH_REQUIRED",
      priceAction: null,
      read: null,

      reasonCodes: ["ABC_UP_ORIGIN_LOW_AND_A_HIGH_REQUIRED"],
    };
  }

  const range = Math.abs(aHigh - originLow);

  const pullbackFromAHigh = (fib) =>
    roundToTick(aHigh - range * fib, tickSize);

  const r236 = pullbackFromAHigh(0.236);
  const r382 = pullbackFromAHigh(0.382);
  const r500 = pullbackFromAHigh(0.5);
  const r618 = pullbackFromAHigh(0.618);
  const r786 = pullbackFromAHigh(0.786);

  const preferredBZone = {
    lo: r618,
    hi: r500,
  };

  const bars = getBarsForDegree({
    degree,
    barsByTf,
    fallbackTf: "10m",
  });

  const originSec = parseManualTimeSec(originTime);
  const manualASec = parseManualTimeSec(aTime);

  const aTouch = findLatestAnchorTouch({
    bars,
    anchorPrice: aHigh,
    afterSec: null,
    direction: "HIGH",
    tolerance: tickSize * 2,
  });

  // IMPORTANT:
  // For ABC_UP, manual A_HIGH is the structural A anchor.
  // Do not keep moving scan start to the latest A-high retouch,
  // or Engine 22 will forget the already-detected structural B pullback.
  const effectiveASec = manualASec ?? originSec ?? null;
  const effectiveATime = aTime || originTime || null;

  const completedStructuralB =
    manualBLow === null && effectiveASec !== null
      ? findFirstCompletedStructuralBLowAfterA({
          bars,
          afterSec: effectiveASec,
          originLow,
          preferredBZone,
        })
      : null;

  const autoB =
    manualBLow === null && effectiveASec !== null
      ? completedStructuralB ||
        findStructuralBLowAfterA({
          bars,
          afterSec: effectiveASec,
          originLow,
          preferredBZone,
        })
      : null;

  const effectiveBLow = manualBLow !== null ? manualBLow : toNum(autoB?.price);
  const effectiveBTime = manualBLow !== null ? bTime : autoB?.time || null;
  const effectiveBSec =
    manualBLow !== null ? parseManualTimeSec(bTime) : autoB?.timeSec ?? null;

  const bCompletion =
    manualBLow !== null
      ? {
          completed: true,
          status: "B_COMPLETE_MANUAL",
          completedLevel: originLow,
          completedTimeSec: parseManualTimeSec(bTime),
          completedTime: bTime || null,
          completedClose: manualBLow,
          read: "Wave B is manually marked.",
          reasonCodes: ["ABC_UP_B_LOW_MANUAL_MARK"],
        }
      : autoB?.bCompletion || {
          completed: false,
          status:
            effectiveBLow !== null
              ? "B_CANDIDATE_MARKED_WAITING_FOR_ORIGIN_RECLAIM"
              : "B_PENDING",
          completedLevel: originLow,
          completedTimeSec: null,
          completedTime: null,
          completedClose: null,
          read:
            effectiveBLow !== null
              ? "Wave B candidate is marked, but origin reclaim has not confirmed B completion yet."
              : "Waiting for Wave B candidate.",
          reasonCodes: [
            effectiveBLow !== null
              ? "ABC_UP_B_CANDIDATE_WAITING_FOR_ORIGIN_RECLAIM"
              : "ABC_UP_B_PENDING",
          ],
        };

  const bSource =
    manualBLow !== null
      ? "MANUAL_ABC_UP_B_LOW"
      : effectiveBLow !== null
      ? autoB?.source || "AUTO_CANDLE_SWING_LOW"
      : "PENDING";

  const manualBMarked = manualBLow !== null && manualBLow > 0;
  const cMarked = manualCHigh !== null && manualCHigh > 0;

  const state = manualBMarked
    ? cMarked
      ? "ABC_UP_COMPLETE"
      : "B_PULLBACK_MARKED_WAITING_FOR_C_UP"
    : "A_UP_MARKED_WAITING_FOR_B_PULLBACK";

  const latestClose =
    bars.length && bars[bars.length - 1]?.close != null
      ? bars[bars.length - 1].close
      : currentPrice;

  const scanBars =
    effectiveASec !== null
      ? bars.filter((bar) => Number(bar.timeSec) >= Number(effectiveASec))
      : bars.slice(-80);

  const cUpTargets =
    effectiveBLow !== null
      ? {
          c100: roundToTick(effectiveBLow + range * 1, tickSize),
          c1272: roundToTick(effectiveBLow + range * 1.272, tickSize),
          c1618: roundToTick(effectiveBLow + range * 1.618, tickSize),
          c200: roundToTick(effectiveBLow + range * 2, tickSize),
          c2618: roundToTick(effectiveBLow + range * 2.618, tickSize),
        }
      : null;

  const cUpProgress =
    effectiveBLow !== null
      ? buildCUpProgress({
          bars,
          afterSec: effectiveBSec,
          bLow: effectiveBLow,
          originLow,
          range,
          cUpTargets,
          currentPrice,
          tickSize,
        })
      : {
          active: false,
          state: "C_UP_PROGRESS_PENDING_B",
          reasonCodes: ["ABC_UP_B_REQUIRED_FOR_C_UP_PROGRESS"],
        };

  const marketContextRisk = buildAbcUpMarketContextRisk({
    marketMeterContext,
    cUpProgress,
    currentPrice,
    originLow,
    bLow: effectiveBLow,
  });

  const priceAction = buildAbcUpPriceAction({
    originLow,
    waveAHigh: aHigh,
    currentPrice,
    latestClose,
    bCandidateLow: effectiveBLow,
    bCandidateTime: effectiveBTime,
    bSource,
    preferredBZone,
    deepBSupport: r786,
    barsScanned: scanBars.length,
    scanStartSec: effectiveASec,
    scanStartTime: effectiveATime,
  });

  const preliminaryBStatus = manualBMarked
    ? cMarked
      ? "ABC_UP_COMPLETE"
      : "B_PULLBACK_MARKED_WAITING_FOR_C_UP"
    : "WAITING_FOR_B_PULLBACK";

  const bPullbackStatus =
    effectiveBLow !== null && priceAction?.status
      ? priceAction.status
      : preliminaryBStatus;

  return {
    active: true,
    state,

    originLow: roundToTick(originLow, tickSize),
    originTime,

    waveAHigh: roundToTick(aHigh, tickSize),
    aTime,
    effectiveATime,
    effectiveASec,
    aSource:
      manualASec !== null
        ? "MANUAL_ABC_UP_A_HIGH"
        : originSec !== null
        ? "MANUAL_ABC_UP_ORIGIN_TIME_FALLBACK"
        : aTouch
        ? "AUTO_A_HIGH_TOUCH_DIAGNOSTIC_ONLY"
        : "A_HIGH_TIME_UNAVAILABLE",

    waveBLow: manualBMarked ? roundToTick(manualBLow, tickSize) : null,
    bTime: manualBMarked ? bTime : null,
    autoWaveBLow:
      !manualBMarked && effectiveBLow !== null
        ? roundToTick(effectiveBLow, tickSize)
        : null,
    autoBTime: !manualBMarked ? effectiveBTime : null,
    effectiveWaveBLow:
      effectiveBLow !== null ? roundToTick(effectiveBLow, tickSize) : null,
    effectiveBTime,
    effectiveBSec,
    bSource,
    bCompletion,

    waveCHigh: cMarked ? roundToTick(manualCHigh, tickSize) : null,
    cTime: cMarked ? cTime : null,

    range: roundToTick(range, tickSize),

    bPullbackLevels: {
      r236,
      r382,
      r500,
      r618,
      r786,
    },

    cUpTargets,
    cUpProgress,
    marketContextRisk,

    preferredBZone,
    deepBSupport: r786,

    bRetracePct: priceAction?.bRetracePct ?? null,
    bRetraceRatio: priceAction?.bRetraceRatio ?? null,
    correctionType: priceAction?.correctionType || null,
    correctionFamily: priceAction?.correctionFamily || null,
    correctionQuality: priceAction?.correctionQuality || null,

    bPullbackStatus,
    priceAction,
    read: priceAction?.read || null,

    reasonCodes: [
      "POST_ABC_BOUNCE_MARKS_FOUND",
      "ABC_UP_A_HIGH_MARKED",
      manualBMarked ? "ABC_UP_B_LOW_MARKED" : "ABC_UP_B_LOW_AUTO_OR_PENDING",
      cMarked ? "ABC_UP_C_HIGH_MARKED" : "ABC_UP_C_HIGH_PENDING",
      bSource,
      ...(Array.isArray(bCompletion?.reasonCodes)
        ? bCompletion.reasonCodes
        : []),
      ...(Array.isArray(cUpProgress?.reasonCodes)
        ? cUpProgress.reasonCodes
        : []),
      ...(Array.isArray(marketContextRisk?.reasonCodes)
        ? marketContextRisk.reasonCodes
        : []),
      ...(Array.isArray(priceAction?.reasonCodes)
        ? priceAction.reasonCodes
        : []),
    ],
  };
}
