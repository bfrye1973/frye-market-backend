// services/core/logic/engine1/macroLevels.js
// Engine 1 — Macro round-number SPX magnet levels
// Purpose: add macro location context alongside negotiated / institutional / shelves

export function computeMacroLevelContext({
  price,
  symbol = "SPX",
  step = 100,
  strongBand = 5,
  outerBand = 10,
}) {
  const px = Number(price);
  if (!Number.isFinite(px)) {
    return {
      symbol,
      step,
      strongBand,
      outerBand,
      nearestMacroLevel: null,
      distancePts: null,
      withinMagnetZone: false,
      magnetStrength: "NONE",
      magnetBand: null,
      levels: [],
    };
  }

  const nearest = Math.round(px / step) * step;
  const lower = nearest - step;
  const higher = nearest + step;

  const distancePts = Math.abs(px - nearest);
  const withinMagnetZone = distancePts <= outerBand;

  let magnetStrength = "NONE";
  if (distancePts <= strongBand) magnetStrength = "HIGH";
  else if (distancePts <= outerBand) magnetStrength = "MEDIUM";

  return {
    symbol,
    step,
    strongBand,
    outerBand,
    nearestMacroLevel: nearest,
    distancePts: Number(distancePts.toFixed(2)),
    withinMagnetZone,
    magnetStrength,
    magnetBand: {
      lo: nearest - outerBand,
      hi: nearest + outerBand,
    },
    levels: [lower, nearest, higher],
  };
}
