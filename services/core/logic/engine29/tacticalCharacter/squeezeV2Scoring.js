// services/core/logic/engine29/tacticalCharacter/squeezeV2Scoring.js
//
// Engine 29 Squeeze v2 — Phase 2 pure deterministic scoring functions.
//
// IMPORTANT:
// - Research / shadow implementation only.
// - No production wiring.
// - Does not read or mutate Parent MOVE.
// - Engine 25 values are consumed as canonical inputs and are not recalculated here.

export const SQUEEZE_V2_WEIGHTS = Object.freeze({
  breadth: 0.35,
  sectors: 0.30,
  nhnl: 0.25,
  volume: 0.10,
});

const MAD_SCALE = 1.4826;
const EPSILON_PCT = 0.000001;

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

function median(values = []) {
  const clean = values.map(finite).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2
    ? clean[mid]
    : (clean[mid - 1] + clean[mid]) / 2;
}

function mad(values = []) {
  const clean = values.map(finite).filter(Number.isFinite);
  const center = median(clean);
  if (!Number.isFinite(center)) return null;
  return median(clean.map((value) => Math.abs(value - center)));
}

function directionalPercent(direction, upValue, downValue) {
  if (direction === "UP") return finite(upValue);
  if (direction === "DOWN") return finite(downValue);
  return null;
}

export function scoreBreadthDiv({
  direction,
  advancingBreadthPct,
  decliningBreadthPct,
} = {}) {
  const directionalBreadth = directionalPercent(
    direction,
    advancingBreadthPct,
    decliningBreadthPct,
  );

  if (!Number.isFinite(directionalBreadth)) {
    return { available: false, score: null, directionalBreadth: null };
  }

  const score = clamp(((55 - directionalBreadth) / 20) * 100);

  return {
    available: true,
    score,
    directionalBreadth,
  };
}

export function scoreSectorDiv({
  strongSectorCount,
  weakSectorCount,
  sectorCount = 11,
} = {}) {
  const strong = finite(strongSectorCount);
  const weak = finite(weakSectorCount);
  const count = finite(sectorCount);

  if (
    !Number.isFinite(strong) ||
    !Number.isFinite(weak) ||
    !Number.isFinite(count) ||
    count <= 0
  ) {
    return { available: false, score: null, sectorBalance: null };
  }

  const sectorBalance = (strong - weak) / count;
  const score = clamp(((0.20 - sectorBalance) / 0.80) * 100);

  return {
    available: true,
    score,
    sectorBalance,
  };
}

export function scoreNHNLDiv({
  direction,
  newHighs,
  newLows,
} = {}) {
  const highs = finite(newHighs);
  const lows = finite(newLows);

  if (!Number.isFinite(highs) || !Number.isFinite(lows) || highs < 0 || lows < 0) {
    return {
      available: false,
      score: null,
      nhnlRatio: null,
      directionalNHNL: null,
    };
  }

  const denominator = Math.max(highs + lows, 1);
  const nhnlRatio = (highs - lows) / denominator;

  const directionalNHNL =
    direction === "UP"
      ? nhnlRatio
      : direction === "DOWN"
        ? -nhnlRatio
        : null;

  if (!Number.isFinite(directionalNHNL)) {
    return {
      available: false,
      score: null,
      nhnlRatio,
      directionalNHNL: null,
    };
  }

  const score = clamp(((0.05 - directionalNHNL) / 0.35) * 100);

  return {
    available: true,
    score,
    nhnlRatio,
    directionalNHNL,
  };
}

export function scoreVolumeDiv({
  direction,
  advancingVolumeShare,
  decliningVolumeShare,
} = {}) {
  const directionalVolume = directionalPercent(
    direction,
    advancingVolumeShare,
    decliningVolumeShare,
  );

  if (!Number.isFinite(directionalVolume)) {
    return { available: false, score: null, directionalVolume: null };
  }

  const score = clamp(((55 - directionalVolume) / 20) * 100);

  return {
    available: true,
    score,
    directionalVolume,
  };
}

export function scoreInternalDivergence({
  breadthDiv,
  sectorDiv,
  nhnlDiv,
  volumeDiv,
} = {}) {
  const values = {
    breadth: finite(breadthDiv),
    sectors: finite(sectorDiv),
    nhnl: finite(nhnlDiv),
    volume: finite(volumeDiv),
  };

  if (!Object.values(values).every(Number.isFinite)) {
    return {
      available: false,
      score: null,
      components: values,
    };
  }

  const score = clamp(
    (values.breadth * SQUEEZE_V2_WEIGHTS.breadth) +
    (values.sectors * SQUEEZE_V2_WEIGHTS.sectors) +
    (values.nhnl * SQUEEZE_V2_WEIGHTS.nhnl) +
    (values.volume * SQUEEZE_V2_WEIGHTS.volume),
  );

  return {
    available: true,
    score,
    components: values,
  };
}

export function scoreParticipationConfirmation(internalDivergence) {
  const divergence = finite(internalDivergence);
  if (!Number.isFinite(divergence)) {
    return { available: false, score: null };
  }

  return {
    available: true,
    score: clamp(100 - divergence),
  };
}

export function scoreBroadeningVelocity10({
  currentParticipation,
  previousParticipation,
} = {}) {
  const current = finite(currentParticipation);
  const previous = finite(previousParticipation);

  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return { available: false, value: null };
  }

  return {
    available: true,
    value: current - previous,
  };
}

export function scoreBroadeningVelocity20({
  currentParticipation,
  participationTwoObservationsAgo,
} = {}) {
  const current = finite(currentParticipation);
  const prior = finite(participationTwoObservationsAgo);

  if (!Number.isFinite(current) || !Number.isFinite(prior)) {
    return { available: false, value: null };
  }

  return {
    available: true,
    value: current - prior,
  };
}

export function scoreESAbnormalityHorizon({
  currentReturnPct,
  historicalSameWindowReturnsPct = [],
} = {}) {
  const current = finite(currentReturnPct);
  const historicalAbs = (Array.isArray(historicalSameWindowReturnsPct)
    ? historicalSameWindowReturnsPct
    : [])
    .map(finite)
    .filter(Number.isFinite)
    .map(Math.abs);

  if (!Number.isFinite(current) || historicalAbs.length < 3) {
    return {
      available: false,
      quality: null,
      robustZ: null,
      baselineMedianAbsReturnPct: null,
      baselineMadAbsReturnPct: null,
      sampleSize: historicalAbs.length,
    };
  }

  const baselineMedian = median(historicalAbs);
  const baselineMad = mad(historicalAbs);

  if (!Number.isFinite(baselineMedian) || !Number.isFinite(baselineMad)) {
    return {
      available: false,
      quality: null,
      robustZ: null,
      baselineMedianAbsReturnPct: baselineMedian,
      baselineMadAbsReturnPct: baselineMad,
      sampleSize: historicalAbs.length,
    };
  }

  const denominator = Math.max(MAD_SCALE * baselineMad, EPSILON_PCT);
  const robustZ = (Math.abs(current) - baselineMedian) / denominator;
  const quality = clamp(((robustZ - 0.5) / 2.5) * 100);

  return {
    available: true,
    quality,
    robustZ,
    baselineMedianAbsReturnPct: baselineMedian,
    baselineMadAbsReturnPct: baselineMad,
    sampleSize: historicalAbs.length,
  };
}

export function scoreESAbnormalityQuality({
  quality10,
  quality20,
} = {}) {
  const q10 = finite(quality10);
  const q20 = finite(quality20);

  if (!Number.isFinite(q10) || !Number.isFinite(q20)) {
    return { available: false, score: null };
  }

  return {
    available: true,
    score: clamp((0.60 * q10) + (0.40 * q20)),
  };
}

export function scoreSqueezePressure({
  esAbnormalityQuality,
  internalDivergence,
} = {}) {
  const es = finite(esAbnormalityQuality);
  const divergence = finite(internalDivergence);

  if (!Number.isFinite(es) || !Number.isFinite(divergence)) {
    return { available: false, score: null };
  }

  return {
    available: true,
    score: clamp((es * divergence) / 100),
  };
}

export function scoreSqueezeV2Internals(snapshot = {}, direction) {
  const breadth = scoreBreadthDiv({
    direction,
    advancingBreadthPct: snapshot.advancingBreadthPct,
    decliningBreadthPct: snapshot.decliningBreadthPct,
  });

  const sectors = scoreSectorDiv({
    strongSectorCount: snapshot.strongSectorCount,
    weakSectorCount: snapshot.weakSectorCount,
    sectorCount: 11,
  });

  const nhnl = scoreNHNLDiv({
    direction,
    newHighs: snapshot.newHighs,
    newLows: snapshot.newLows,
  });

  const volume = scoreVolumeDiv({
    direction,
    advancingVolumeShare: snapshot.advancingVolumeShare,
    decliningVolumeShare: snapshot.decliningVolumeShare,
  });

  const internal = scoreInternalDivergence({
    breadthDiv: breadth.score,
    sectorDiv: sectors.score,
    nhnlDiv: nhnl.score,
    volumeDiv: volume.score,
  });

  const participation = scoreParticipationConfirmation(internal.score);

  return {
    available:
      breadth.available &&
      sectors.available &&
      nhnl.available &&
      volume.available &&
      internal.available &&
      participation.available,
    direction,
    breadth,
    sectors,
    nhnl,
    volume,
    internalDivergence: internal,
    participationConfirmation: participation,
  };
}
