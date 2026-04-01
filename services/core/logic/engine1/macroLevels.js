// services/core/logic/engine1/macroLevels.js
// Engine 1 — SPX macro magnet levels mapped into SPY
// Hybrid model:
// 1) Use LOCKED calibrated SPY zones for known major SPX levels
// 2) Fall back to live ratio conversion for levels not yet calibrated

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// 🔒 LOCKED CALIBRATED LEVELS
// These are the exact SPY reaction zones you want the system to trust.
const CALIBRATED_MACRO_ZONES = {
  6400: { lo: 637.0, hi: 639.5, mid: 638.25 },
  6500: { lo: 647.0, hi: 649.5, mid: 648.25 },
  6600: { lo: 657.0, hi: 658.0, mid: 657.5 },
};

export function computeMacroLevelContext({
  spyPrice,
  spxPrice,
  minLevel = 4000,
  maxLevel = 8000,
  step = 100,
  halfBand = 1.25, // fallback only
}) {
  const spy = toNum(spyPrice);
  const spx = toNum(spxPrice);

  if (!Number.isFinite(spy)) {
    return {
      source: "SPX_MACRO_HYBRID",
      spyPrice: spy,
      spxPrice: toNum(spxPrice),
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

  const ratio =
    Number.isFinite(spx) && spx > 0
      ? spy / spx
      : null;

  const levels = [];

  for (let lvl = minLevel; lvl <= maxLevel; lvl += step) {
    const calibrated = CALIBRATED_MACRO_ZONES[lvl];

    if (calibrated) {
      levels.push({
        spxLevel: lvl,
        spyEquivalent: round2(calibrated.mid),
        lo: round2(calibrated.lo),
        hi: round2(calibrated.hi),
        mid: round2(calibrated.mid),
        source: "CALIBRATED",
      });
      continue;
    }

    if (!Number.isFinite(ratio)) continue;

    const center = lvl * ratio;
    const lo = center - halfBand;
    const hi = center + halfBand;

    levels.push({
      spxLevel: lvl,
      spyEquivalent: round2(center),
      lo: round2(lo),
      hi: round2(hi),
      mid: round2(center),
      source: "LIVE_RATIO",
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
    if (nearest.withinMacroZone) {
      macroStrength = "HIGH";
    } else if (nearest.distancePts <= 2.5) {
      macroStrength = "MEDIUM";
    }
  }

  return {
    source: "SPX_MACRO_HYBRID",
    spyPrice: round2(spy),
    spxPrice: Number.isFinite(spx) ? round2(spx) : null,
    ratio: Number.isFinite(ratio) ? round2(ratio) : null,
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
          source: nearest.source,
        }
      : null,
    zones: levels,
  };
}
