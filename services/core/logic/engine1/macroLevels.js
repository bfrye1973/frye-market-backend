// services/core/logic/engine1/macroLevels.js
// Engine 1 — SPX macro magnet levels mapped into SPY
// Purpose:
// - Keep SPX as source of truth
// - Convert major SPX round numbers into SPY zones
// - Expose nearest macro decision zone for downstream engines

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function computeMacroLevelContext({
  spyPrice,
  spxPrice,
  minLevel = 4000,
  maxLevel = 8000,
  step = 100,
  halfBand = 1.25,
}) {
  const spy = toNum(spyPrice);
  const spx = toNum(spxPrice);

  if (!Number.isFinite(spy) || !Number.isFinite(spx) || spx <= 0) {
    return {
      source: "SPX_ROUND_NUMBER_LIVE_RATIO",
      spyPrice: spy,
      spxPrice: spx,
      ratio: null,
      nearestMacroLevel: null,
      nearestSpyEquivalent: null,
      distancePts: null,
      withinMacroZone: false,
      macroStrength: "NONE",
      activeZone: null,
      zones: [],
    };
  }

  const ratio = spy / spx;

  const levels = [];
  for (let lvl = minLevel; lvl <= maxLevel; lvl += step) {
    const center = lvl * ratio;
    const lo = center - halfBand;
    const hi = center + halfBand;

    levels.push({
      spxLevel: lvl,
      spyEquivalent: round2(center),
      lo: round2(lo),
      hi: round2(hi),
      mid: round2(center),
    });
  }

  let nearest = null;
  for (const z of levels) {
    const dist = Math.abs(spy - z.mid);
    if (!nearest || dist < nearest.distancePts) {
      nearest = {
        ...z,
        distancePts: round2(dist),
        withinMacroZone: spy >= z.lo && spy <= z.hi,
      };
    }
  }

  let macroStrength = "NONE";
  if (nearest) {
    if (nearest.withinMacroZone) macroStrength = "HIGH";
    else if (nearest.distancePts <= 2.5) macroStrength = "MEDIUM";
  }

  return {
    source: "SPX_ROUND_NUMBER_LIVE_RATIO",
    spyPrice: round2(spy),
    spxPrice: round2(spx),
    ratio: round2(ratio),
    nearestMacroLevel: nearest?.spxLevel ?? null,
    nearestSpyEquivalent: nearest?.spyEquivalent ?? null,
    distancePts: nearest?.distancePts ?? null,
    withinMacroZone: nearest?.withinMacroZone ?? false,
    macroStrength,
    activeZone: nearest
      ? {
          spxLevel: nearest.spxLevel,
          lo: nearest.lo,
          hi: nearest.hi,
          mid: nearest.mid,
          spyEquivalent: nearest.spyEquivalent,
        }
      : null,
    zones: levels,
  };
}
