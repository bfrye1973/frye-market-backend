// scripts/build_accdist_levels.js
//
// Usage:
//   node scripts/build_accdist_levels.js input-bars.json public/smz-levels.json
//
// input-bars.json should be an array of bars:
//   [{ time, open, high, low, close, volume }, ...] in ascending time order.

const fs = require("fs");
const path = require("path");

/**
 * Standalone version of computeAccDistLevelsFromBars
 * (same logic as engine.js, but copied here so we don't depend on React build).
 */
function computeAccDistLevelsFromBars(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 20) return [];

  const swingLookback = opts.swingLookback ?? 3;
  const lookaheadBars = opts.lookaheadBars ?? 15;
  const minMovePct = opts.minMovePct ?? 0.006;
  const clusterTolerance = opts.clusterTolerance ?? 1.0;

  const levels = [];

  const isSwingHigh = (i) => {
    const h = bars[i].high;
    for (let k = 1; k <= swingLookback; k++) {
      if (i - k < 0 || i + k >= bars.length) return false;
      if (bars[i - k].high >= h || bars[i + k].high >= h) return false;
    }
    return true;
  };

  const isSwingLow = (i) => {
    const l = bars[i].low;
    for (let k = 1; k <= swingLookback; k++) {
      if (i - k < 0 || i + k >= bars.length) return false;
      if (bars[i - k].low <= l || bars[i + k].low <= l) return false;
    }
    return true;
  };

  for (let i = swingLookback; i < bars.length - swingLookback; i++) {
    const b = bars[i];

    // Distribution: swing high → downside reaction
    if (isSwingHigh(i)) {
      const anchor = b.high;
      let maxDropPct = 0;
      let touchCount = 0;

      for (let j = i + 1; j < Math.min(bars.length, i + 1 + lookaheadBars); j++) {
        const bj = bars[j];

        const dropPct = (anchor - bj.low) / anchor;
        if (dropPct > maxDropPct) maxDropPct = dropPct;

        const mid = (bj.high + bj.low) / 2;
        if (Math.abs(mid - anchor) <= 0.4) touchCount++;
      }

      if (maxDropPct >= minMovePct && touchCount >= 2) {
        const strength = Math.round(
          40 * Math.min(maxDropPct / minMovePct, 2) +
          10 * Math.min(touchCount, 5)
        );
        levels.push({
          type: "distribution",
          price: anchor,
          strength: Math.min(strength, 100),
        });
      }
    }

    // Accumulation: swing low → upside reaction
    if (isSwingLow(i)) {
      const anchor = b.low;
      let maxRallyPct = 0;
      let touchCount = 0;

      for (let j = i + 1; j < Math.min(bars.length, i + 1 + lookaheadBars); j++) {
        const bj = bars[j];

        const rallyPct = (bj.high - anchor) / anchor;
        if (rallyPct > maxRallyPct) maxRallyPct = rallyPct;

        const mid = (bj.high + bj.low) / 2;
        if (Math.abs(mid - anchor) <= 0.4) touchCount++;
      }

      if (maxRallyPct >= minMovePct && touchCount >= 2) {
        const hi = anchor + 1; // $1 band for now
        const lo = anchor;

        const strength = Math.round(
          40 * Math.min(maxRallyPct / minMovePct, 2) +
          10 * Math.min(touchCount, 5)
        );

        levels.push({
          type: "accumulation",
          priceRange: [hi, lo],
          strength: Math.min(strength, 100),
        });
      }
    }
  }

  // Cluster nearby levels (within $1)
  levels.sort((a, b) => {
    const pa = a.price ?? ((a.priceRange[0] + a.priceRange[1]) / 2);
    const pb = b.price ?? ((b.priceRange[0] + b.priceRange[1]) / 2);
    return pa - pb;
  });

  const clustered = [];
  for (const lvl of levels) {
    const center = lvl.price ?? (lvl.priceRange[0] + lvl.priceRange[1]) / 2;
    const last = clustered[clustered.length - 1];

    if (
      last &&
      Math.abs(center - last._center) <= clusterTolerance &&
      lvl.type === last.type
    ) {
      last.strength = Math.max(last.strength ?? 0, lvl.strength ?? 0);

      if (lvl.priceRange && last.priceRange) {
        last.priceRange = [
          Math.max(last.priceRange[0], lvl.priceRange[0]),
          Math.min(last.priceRange[1], lvl.priceRange[1]),
        ];
      } else if (typeof lvl.price === "number" && typeof last.price === "number") {
        last.price = (last.price + lvl.price) / 2;
      }

      last._center = (last._center + center) / 2;
    } else {
      clustered.push({ ...lvl, _center: center });
    }
  }

  return clustered.map(({ _center, ...rest }) => rest);
}

// ------------- CLI wrapper -------------

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("Usage: node scripts/build_accdist_levels.js input-bars.json output-smz-levels.json");
    process.exit(1);
  }

  const inAbs = path.resolve(inputPath);
  const outAbs = path.resolve(outputPath);

  const raw = fs.readFileSync(inAbs, "utf8");
  const bars = JSON.parse(raw);

  const levels = computeAccDistLevelsFromBars(bars);

  const payload = { levels };
  fs.writeFileSync(outAbs, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${levels.length} levels to ${outAbs}`);
}

if (require.main === module) {
  main();
}
