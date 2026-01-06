// src/services/core/logic/smzHierarchyReducer.js
// Frye SMZ / Shelves Hierarchy Reducer — CONTRACT LOCKED (NO FETCH, NO IO)
//
// Inputs:
// - institutional levels from /api/v1/smz-levels (levels[])
//
//   Each zone:
//   - id: details.id (fallback details.zoneId)
//   - bounds: priceRange: [high, low] (authoritative, inclusive)
//   - strength: strength 0–100
//   - tf: details.tf ("30m"|"1h"|"4h")
//
// - shelf levels from /api/v1/smz-shelves (levels[])
//
//   Each shelf:
//   - type: "accumulation" | "distribution"
//   - bounds: priceRange: [high, low] (authoritative, inclusive)
//   - strength: strength
//   - tf: tf OR details.tf
//   - id may be absent (generate stable id)
//
// Runtime:
// - currentPrice (required; inclusive containment)
// - timeframe (30m|1h|4h|1D)  (1D maps -> 4h)
//
// Output (required contract):
// {
//   selectedInstitutionalZone: { zoneId, priceHigh, priceLow, strength } | null,
//   dominantShelves: { accumulation: {...}|null, distribution: {...}|null },
//   suppressed: { institutional: [...], shelves: [...] }
// }
//
// Rules (NON-NEGOTIABLE):
// 1) Institutional is parent authority. If no selected zone => shelves null, trading disabled.
// 2) Select ONE dominant institutional zone in tf by:
//    - zone contains currentPrice
//      - if multiple: highest strength, then closest midpoint to price
//    - if none contain: closest zone BELOW price (support bias)
//      - if none below exist: closest above (failsafe)
// 3) Shelves allowed ONLY if overlap selected zone (any overlap):
//    shelf.hi >= zone.low AND shelf.lo <= zone.high
// 4) Keep max 1 accumulation + 1 distribution shelf:
//    - closest edge distance to price
//    - highest strength
//    - prefer below (accum) / above (dist)
//    - if still tied: narrower width
// 5) suppressed arrays must return FULL original objects

import crypto from "crypto";

function mapTf(tf) {
  const t = String(tf || "").trim();
  if (!t) return "";
  if (t === "1D" || t === "1d") return "4h"; // v1 decision
  return t;
}

function getZoneTf(z) {
  return z?.details?.tf ?? z?.tf ?? "";
}

function getShelfTf(s) {
  return s?.tf ?? s?.details?.tf ?? "";
}

function zoneId(z) {
  return z?.details?.id ?? z?.details?.zoneId ?? null;
}

function toBounds(obj) {
  // authoritative: priceRange [high, low]
  const pr = obj?.priceRange;
  if (!Array.isArray(pr) || pr.length < 2) return null;

  const hi = Number(pr[0]);
  const lo = Number(pr[1]);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;

  const high = Math.max(hi, lo);
  const low = Math.min(hi, lo);

  // allow equal? (zones should have width; but don’t crash)
  return { high, low };
}

function containsInclusive(low, high, price) {
  return low <= price && price <= high;
}

function midpoint(low, high) {
  return (low + high) / 2;
}

function nearestEdgeDistance(low, high, price) {
  return Math.min(Math.abs(price - low), Math.abs(high - price));
}

function width(low, high) {
  return Math.max(0, high - low);
}

function overlapAny(zoneLow, zoneHigh, shelfLow, shelfHigh) {
  // any overlap: shelf.hi >= zone.low AND shelf.lo <= zone.high
  return shelfHigh >= zoneLow && shelfLow <= zoneHigh;
}

function stableShelfId(shelf, tfUsed) {
  // stable id if missing: hash(tf|type|roundedHigh|roundedLow)
  const b = toBounds(shelf);
  const type = String(shelf?.type || "unknown");
  const hiR = b ? Math.round(b.high * 100) / 100 : 0;
  const loR = b ? Math.round(b.low * 100) / 100 : 0;
  const key = `${tfUsed}|${type}|${hiR}|${loR}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

function selectDominantZone(zonesTf, price) {
  if (!zonesTf.length) return null;

  // 1) zones containing price (inclusive)
  const containing = zonesTf.filter((z) => {
    const b = toBounds(z);
    return b ? containsInclusive(b.low, b.high, price) : false;
  });

  if (containing.length) {
    containing.sort((a, b) => {
      const sa = Number(a?.strength ?? 0);
      const sb = Number(b?.strength ?? 0);
      if (sb !== sa) return sb - sa; // highest strength

      const ab = toBounds(a);
      const bb = toBounds(b);
      const da = Math.abs(midpoint(ab.low, ab.high) - price);
      const db = Math.abs(midpoint(bb.low, bb.high) - price);
      return da - db; // closest midpoint
    });
    return containing[0];
  }

  // 2) none contain: closest zone BELOW price (support bias)
  const below = [];
  const above = [];

  for (const z of zonesTf) {
    const b = toBounds(z);
    if (!b) continue;

    if (b.high < price) below.push({ z, dist: price - b.high }); // distance to nearest edge (top)
    else if (b.low > price) above.push({ z, dist: b.low - price }); // distance to nearest edge (bottom)
  }

  below.sort((a, b) => a.dist - b.dist);
  if (below.length) return below[0].z;

  // failsafe: closest above
  above.sort((a, b) => a.dist - b.dist);
  if (above.length) return above[0].z;

  return null;
}

function preferBelow(shelfLow, shelfHigh, price) {
  // “Prefer shelves below price” => shelf entirely below or touching price
  return shelfHigh <= price;
}

function preferAbove(shelfLow, shelfHigh, price) {
  // “Prefer shelves above price” => shelf entirely above or touching price
  return shelfLow >= price;
}

function pickDominantShelf(shelves, price, type) {
  const typed = shelves.filter((s) => String(s?.type).toLowerCase() === type);
  if (!typed.length) return null;

  typed.sort((a, b) => {
    const ab = toBounds(a);
    const bb = toBounds(b);
    if (!ab || !bb) return 0;

    // 1) closest edge distance
    const da = nearestEdgeDistance(ab.low, ab.high, price);
    const db = nearestEdgeDistance(bb.low, bb.high, price);
    if (da !== db) return da - db;

    // 2) highest strength
    const sa = Number(a?.strength ?? 0);
    const sb = Number(b?.strength ?? 0);
    if (sb !== sa) return sb - sa;

    // 3) prefer below/above
    if (type === "accumulation") {
      const pa = preferBelow(ab.low, ab.high, price) ? 1 : 0;
      const pb = preferBelow(bb.low, bb.high, price) ? 1 : 0;
      if (pb !== pa) return pb - pa;
    } else if (type === "distribution") {
      const pa = preferAbove(ab.low, ab.high, price) ? 1 : 0;
      const pb = preferAbove(bb.low, bb.high, price) ? 1 : 0;
      if (pb !== pa) return pb - pa;
    }

    // 4) narrower width
    const wa = width(ab.low, ab.high);
    const wb = width(bb.low, bb.high);
    return wa - wb;
  });

  return typed[0];
}

export function reduceSmzAndShelves({
  institutionalLevels = [],
  shelfLevels = [],
  currentPrice,
  timeframe,
} = {}) {
  const tfUsed = mapTf(timeframe);
  const price = Number(currentPrice);

  if (!tfUsed) throw new Error("timeframe is required");
  if (!Number.isFinite(price)) throw new Error("currentPrice must be a finite number");

  const zonesAll = Array.isArray(institutionalLevels) ? institutionalLevels : [];
  const shelvesAll = Array.isArray(shelfLevels) ? shelfLevels : [];

  // Filter by runtime tf (endpoints return mixed TF lists)
  const zonesTf = zonesAll.filter((z) => getZoneTf(z) === tfUsed && toBounds(z));
  const shelvesTf = shelvesAll.filter((s) => getShelfTf(s) === tfUsed && toBounds(s));

  // Step 1 — select ONE dominant institutional zone
  const selected = selectDominantZone(zonesTf, price);

  // suppressed institutional = ALL zones except selected (FULL originals)
  const selectedId = selected ? zoneId(selected) : null;
  const suppressedInstitutional = zonesAll.filter((z) => {
    const zid = zoneId(z);
    if (!selectedId) return true;
    return zid !== selectedId;
  });

  // If no selected zone => trading disabled, no shelves active
  if (!selected) {
    return {
      selectedInstitutionalZone: null,
      dominantShelves: { accumulation: null, distribution: null },
      suppressed: {
        institutional: suppressedInstitutional,
        shelves: shelvesAll, // FULL originals
      },
    };
  }

  const zb = toBounds(selected);
  const zoneLow = zb.low;
  const zoneHigh = zb.high;

  // Step 2 — filter shelves to selected zone only (any overlap)
  const shelvesInZone = shelvesTf.filter((s) => {
    const sb = toBounds(s);
    return overlapAny(zoneLow, zoneHigh, sb.low, sb.high);
  });

  // suppressed shelves = everything NOT eligible (including other TFs) (FULL originals)
  const suppressedShelves = shelvesAll.filter((s) => {
    const sTf = getShelfTf(s);
    if (sTf !== tfUsed) return true;
    const sb = toBounds(s);
    if (!sb) return true;
    return !overlapAny(zoneLow, zoneHigh, sb.low, sb.high);
  });

  // Step 3 — keep max 1 blue + 1 red
  const domAccumRaw = pickDominantShelf(shelvesInZone, price, "accumulation");
  const domDistRaw = pickDominantShelf(shelvesInZone, price, "distribution");

  const decorateShelf = (s) => {
    if (!s) return null;
    const tf = getShelfTf(s) || tfUsed;
    const id = s?.id ?? s?.details?.id ?? stableShelfId(s, tf);
    return { ...s, id };
  };

  return {
    selectedInstitutionalZone: {
      zoneId: selectedId || "unknown",
      priceHigh: zoneHigh,
      priceLow: zoneLow,
      strength: Number(selected?.strength ?? 0),
    },
    dominantShelves: {
      accumulation: decorateShelf(domAccumRaw),
      distribution: decorateShelf(domDistRaw),
    },
    suppressed: {
      institutional: suppressedInstitutional,
      shelves: suppressedShelves,
    },
  };
}
