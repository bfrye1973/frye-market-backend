// src/services/core/logic/smzHierarchyReducer.js
// Frye SMZ + Shelves Hierarchy Reducer (NO FETCH, NO IO)
// Input: institutional levels + shelves levels
// Output: clean render lists + debug suppression lists
//
// Goals:
// - TradingView-clean: minimal overlaps
// - Institutional zones are parents
// - Shelves inherit permission from institutional zones
// - Max 1 dominant accumulation + 1 dominant distribution per institutional zone
//
// This module does NOT change detection or scoring.
// It only decides what to SHOW vs SUPPRESS.

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function toRange(obj) {
  // expects { priceRange:[hi,lo] } or { high, low }
  if (Array.isArray(obj?.priceRange) && obj.priceRange.length === 2) {
    return { hi: Number(obj.priceRange[0]), lo: Number(obj.priceRange[1]) };
  }
  return { hi: Number(obj?.high), lo: Number(obj?.low) };
}

function normRange(hi, lo) {
  const H = Number(hi);
  const L = Number(lo);
  if (!Number.isFinite(H) || !Number.isFinite(L)) return null;
  const top = Math.max(H, L);
  const bot = Math.min(H, L);
  if (top <= bot) return null;
  return { hi: top, lo: bot, mid: (top + bot) / 2, width: top - bot };
}

function overlapPct(a, b) {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(a.width, b.width);
  return denom > 0 ? inter / denom : 0;
}

function contains(a, b) {
  // a contains b
  return a.lo <= b.lo && a.hi >= b.hi;
}

function distanceToRange(price, r) {
  if (price < r.lo) return r.lo - price;
  if (price > r.hi) return price - r.hi;
  return 0;
}

function mergeSameType(list, { overlapMin = 0.6, centerTol = 0.75 } = {}) {
  // list must all be same type
  if (!Array.isArray(list) || list.length === 0) return [];
  const sorted = list
    .map((x) => ({ ...x, _r: normRange(toRange(x).hi, toRange(x).lo) }))
    .filter((x) => x._r)
    .sort((a, b) => a._r.lo - b._r.lo);

  const out = [];
  let cur = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const nxt = sorted[i];

    const ov = overlapPct(cur._r, nxt._r);
    const centersClose = Math.abs(cur._r.mid - nxt._r.mid) <= centerTol;

    if (ov >= overlapMin || centersClose) {
      // merge bounds
      const hi = Math.max(cur._r.hi, nxt._r.hi);
      const lo = Math.min(cur._r.lo, nxt._r.lo);
      const merged = { ...cur };
      merged.priceRange = [Number(hi.toFixed(2)), Number(lo.toFixed(2))];
      merged.price = Number(((hi + lo) / 2).toFixed(2));

      // keep strongest
      merged.strength = Math.max(Number(cur.strength || 0), Number(nxt.strength || 0));

      // track debug
      merged._mergedFrom = (cur._mergedFrom || [cur.details?.id || cur.details?.zoneId || "x"])
        .concat(nxt._mergedFrom || [nxt.details?.id || nxt.details?.zoneId || "y"]);

      merged._r = normRange(hi, lo);
      cur = merged;
    } else {
      out.push(cur);
      cur = nxt;
    }
  }

  out.push(cur);
  return out.map(({ _r, ...rest }) => rest);
}

function pickDominantByScore(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.reduce((best, cur) => {
    if (!best) return cur;
    const bs = Number(best.strength ?? 0);
    const cs = Number(cur.strength ?? 0);
    if (cs !== bs) return cs > bs ? cur : best;

    // tie-breaker: prefer clear 4H if present
    const b4 = best?.details?.flags?.hasClear4H ? 1 : 0;
    const c4 = cur?.details?.flags?.hasClear4H ? 1 : 0;
    if (c4 !== b4) return c4 > b4 ? cur : best;

    // tie-breaker: tighter width
    const br = normRange(toRange(best).hi, toRange(best).lo);
    const cr = normRange(toRange(cur).hi, toRange(cur).lo);
    if (br && cr && cr.width !== br.width) return cr.width < br.width ? cur : best;

    return best;
  }, null);
}

/**
 * Cluster institutional zones by loose overlap, then keep one winner per cluster.
 * If a currentPrice is given, prefer clusters near price (but still keep top N).
 */
function reduceInstitutional(instZones, {
  clusterOverlap = 0.35,
  maxOut = 3,
  currentPrice = null
} = {}) {
  const zones = (Array.isArray(instZones) ? instZones : [])
    .map((z) => ({ ...z, _r: normRange(toRange(z).hi, toRange(z).lo) }))
    .filter((z) => z._r)
    .sort((a, b) => Number(b.strength || 0) - Number(a.strength || 0));

  // build overlap clusters
  const clusters = [];
  for (const z of zones) {
    let placed = false;
    for (const c of clusters) {
      if (c.members.some((m) => overlapPct(m._r, z._r) >= clusterOverlap || contains(m._r, z._r) || contains(z._r, m._r))) {
        c.members.push(z);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [z] });
  }

  // pick dominant per cluster
  const winners = clusters.map((c) => pickDominantByScore(c.members)).filter(Boolean);

  // sort winners by: distance to price (if provided) then strength
  const scored = winners.map((w) => {
    const dist = Number.isFinite(currentPrice) ? distanceToRange(currentPrice, normRange(toRange(w).hi, toRange(w).lo)) : null;
    return { w, dist };
  });

  scored.sort((a, b) => {
    // nearer clusters first (if price known)
    if (a.dist != null && b.dist != null && a.dist !== b.dist) return a.dist - b.dist;
    // otherwise higher strength
    return Number(b.w.strength || 0) - Number(a.w.strength || 0);
  });

  const render = scored.slice(0, maxOut).map((x) => x.w);
  const suppressed = zones
    .map(({ _r, ...z }) => z)
    .filter((z) => !render.some((r) => (r.details?.id || r.details?.zoneId) === (z.details?.id || z.details?.zoneId)));

  return { render, suppressed };
}

/**
 * Assign shelves to an institutional parent using overlap or tolerance.
 * Then per parent: merge same-type shelves and keep 1 dominant per type.
 */
function reduceShelvesForInstitutional(instZone, shelves, {
  tolerancePts = 0.75,
  overlapMin = 0.15,
  shelfMergeOverlap = 0.6,
  shelfCenterTol = 0.75
} = {}) {
  const parentR = normRange(toRange(instZone).hi, toRange(instZone).lo);
  if (!parentR) return { domAccum: null, domDist: null, suppressed: shelves || [] };

  const inOrNearParent = (s) => {
    const sr = normRange(toRange(s).hi, toRange(s).lo);
    if (!sr) return false;

    // rule A: overlap
    const ov = overlapPct(parentR, sr);
    if (ov >= overlapMin) return true;

    // rule B: within tolerance of zone boundary
    const dist = Math.min(
      Math.abs(sr.mid - parentR.lo),
      Math.abs(sr.mid - parentR.hi),
      distanceToRange(sr.mid, parentR)
    );
    return dist <= tolerancePts;
  };

  const eligible = (Array.isArray(shelves) ? shelves : [])
    .map((s) => ({ ...s, _r: normRange(toRange(s).hi, toRange(s).lo) }))
    .filter((s) => s._r && inOrNearParent(s));

  const ignored = (Array.isArray(shelves) ? shelves : [])
    .filter((s) => !eligible.includes(s));

  // Split by type
  const acc = eligible.filter((s) => String(s.type).toLowerCase() === "accumulation");
  const dist = eligible.filter((s) => String(s.type).toLowerCase() === "distribution");

  // Merge per type to remove overlaps
  const accMerged = mergeSameType(acc, { overlapMin: shelfMergeOverlap, centerTol: shelfCenterTol });
  const distMerged = mergeSameType(dist, { overlapMin: shelfMergeOverlap, centerTol: shelfCenterTol });

  // Pick dominant per type
  const domAccum = pickDominantByScore(accMerged);
  const domDist = pickDominantByScore(distMerged);

  // Suppressed = eligible that are not dominant + ignored
  const suppressed = []
    .concat(accMerged.filter((x) => x !== domAccum))
    .concat(distMerged.filter((x) => x !== domDist))
    .concat(ignored);

  return { domAccum, domDist, suppressed };
}

/**
 * Main reducer:
 * - Reduce institutional zones first
 * - For each selected institutional zone, reduce shelves inside it
 * - Output tradingview-clean render lists
 */
export function reduceSmzAndShelves({
  institutionalLevels = [],
  shelfLevels = [],
  currentPrice = null,
  maxInstitutionalOut = 3,
  tolerancePts = 0.75
} = {}) {
  const inst = reduceInstitutional(institutionalLevels, {
    clusterOverlap: 0.35,
    maxOut: maxInstitutionalOut,
    currentPrice
  });

  const renderInstitutional = inst.render;

  // For each rendered institutional zone, compute dominant shelves
  const renderShelves = [];
  const suppressedShelves = [];

  for (const z of renderInstitutional) {
    const { domAccum, domDist, suppressed } = reduceShelvesForInstitutional(z, shelfLevels, {
      tolerancePts,
      overlapMin: 0.15,
      shelfMergeOverlap: 0.6,
      shelfCenterTol: 0.75
    });

    if (domAccum) {
      renderShelves.push({ ...domAccum, _parentZoneId: z.details?.id || z.details?.zoneId || null });
    }
    if (domDist) {
      renderShelves.push({ ...domDist, _parentZoneId: z.details?.id || z.details?.zoneId || null });
    }

    suppressedShelves.push(...suppressed.map((s) => ({ ...s, _parentZoneId: z.details?.id || z.details?.zoneId || null })));
  }

  // Final de-dupe shelves by (type + priceRange)
  const seen = new Set();
  const dedupShelves = [];
  for (const s of renderShelves) {
    const r = normRange(toRange(s).hi, toRange(s).lo);
    if (!r) continue;
    const key = `${String(s.type)}|${r.hi.toFixed(2)}|${r.lo.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupShelves.push(s);
  }

  return {
    ok: true,
    meta: {
      asOfUtc: new Date().toISOString(),
      currentPrice: Number.isFinite(currentPrice) ? Number(currentPrice.toFixed(2)) : null,
      tolerancePts
    },
    render: {
      institutional: renderInstitutional,
      shelves: dedupShelves
    },
    suppressed: {
      institutional: inst.suppressed,
      shelves: suppressedShelves
    }
  };
}
