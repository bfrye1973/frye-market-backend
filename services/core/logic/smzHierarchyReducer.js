// services/core/logic/smzHierarchyReducer.js
// Frye SMZ Hierarchy Reducer — LOCKED RULESET (NO FETCH, NO IO)
//
// RULES (LOCKED):
// 1) Institutional zones (yellow):
//    - ONLY strength 90–100
//    - ONLY zones that overlap window [currentPrice-40, currentPrice+40]
//    - filter by timeframe (1D -> 4h)
//    - render ALL qualifying zones
//
// 2) Shelves (red/blue):
//    - Between each adjacent pair of institutional zones: keep TOP 2 shelves by strength
//      (type does not matter)
//    - Additionally: max 1 shelf inside each institutional zone (strongest overlap)
//      only if not already selected
//
// Output:
// {
//   ok: true,
//   meta: {...},
//   render: { institutional: [...], shelves: [...] },
//   suppressed: { institutional: [...], shelves: [...] }
// }

import crypto from "crypto";

function mapTf(tf) {
  const t = String(tf || "").trim();
  if (!t) return "";
  if (t === "1D" || t === "1d") return "4h";
  return t;
}

function getZoneTf(z) {
  return z?.details?.tf ?? z?.tf ?? "";
}

function getShelfTf(s) {
  return s?.tf ?? s?.details?.tf ?? "";
}

function zoneId(z) {
  return z?.details?.id ?? z?.details?.zoneId ?? z?.id ?? z?.zoneId ?? null;
}

function toBounds(obj) {
  // Authoritative: priceRange [high, low]
  const pr = obj?.priceRange;
  if (!Array.isArray(pr) || pr.length < 2) return null;

  const hi = Number(pr[0]);
  const lo = Number(pr[1]);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;

  const high = Math.max(hi, lo);
  const low = Math.min(hi, lo);

  return { high, low };
}

function overlapAny(aLow, aHigh, bLow, bHigh) {
  return bHigh >= aLow && bLow <= aHigh;
}

function stableShelfId(shelf, tfUsed) {
  const b = toBounds(shelf);
  const type = String(shelf?.type || "unknown");
  const hiR = b ? Math.round(b.high * 100) / 100 : 0;
  const loR = b ? Math.round(b.low * 100) / 100 : 0;
  const key = `${tfUsed}|${type}|${hiR}|${loR}`;
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
}

function shelfKey(s, tfUsed) {
  const b = toBounds(s);
  if (!b) return "";
  const type = String(s?.type || "unknown");
  return `${tfUsed}|${type}|${b.high.toFixed(2)}|${b.low.toFixed(2)}`;
}

function pickTopNShelvesByStrength(shelves, n) {
  return [...shelves].sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0)).slice(0, n);
}

export function reduceSmzAndShelves({
  institutionalLevels = [],
  shelfLevels = [],
  currentPrice,
  timeframe,
  windowPts = 40, // locked default, can override if needed later
} = {}) {
  const tfUsed = mapTf(timeframe);
  const price = Number(currentPrice);

  if (!tfUsed) throw new Error("timeframe is required");
  if (!Number.isFinite(price)) throw new Error("currentPrice must be a finite number");

  const zonesAll = Array.isArray(institutionalLevels) ? institutionalLevels : [];
  const shelvesAll = Array.isArray(shelfLevels) ? shelfLevels : [];

  // ----- 1) Institutional zones: 90–100 within ±40 window -----
  const winLow = price - Number(windowPts);
  const winHigh = price + Number(windowPts);

  const institutionalCandidates = zonesAll
    .filter((z) => getZoneTf(z) === tfUsed)
    .filter((z) => {
      const b = toBounds(z);
      if (!b) return false;
      const s = Number(z?.strength ?? 0);
      if (s < 90 || s > 100) return false;
      // must overlap window
      return overlapAny(winLow, winHigh, b.low, b.high);
    })
    .map((z) => ({ z, b: toBounds(z) }))
    .filter((x) => x.b);

  // Sort institutional zones by price (low -> high)
  institutionalCandidates.sort((a, b) => a.b.low - b.b.low);

  const renderInstitutional = institutionalCandidates.map((x) => x.z);

  const renderInstitutionalIds = new Set(renderInstitutional.map((z) => zoneId(z)).filter(Boolean));

  const suppressedInstitutional = zonesAll.filter((z) => {
    const id = zoneId(z);
    return !id || !renderInstitutionalIds.has(id);
  });

  // If no institutional zones, we still return clean output
  if (renderInstitutional.length === 0) {
    return {
      ok: true,
      meta: {
        asOfUtc: new Date().toISOString(),
        tf_input: timeframe,
        tf_used: tfUsed,
        currentPrice: Number(price.toFixed(2)),
        windowPts,
      },
      render: {
        institutional: [],
        shelves: [],
      },
      suppressed: {
        institutional: suppressedInstitutional,
        shelves: shelvesAll,
      },
    };
  }

  // ----- 2) Shelves eligible by timeframe -----
  const shelvesTf = shelvesAll
    .filter((s) => getShelfTf(s) === tfUsed)
    .filter((s) => toBounds(s));

  // Ensure shelf IDs exist (stable)
  const shelvesTfWithId = shelvesTf.map((s) => {
    const id = s?.id ?? s?.details?.id ?? stableShelfId(s, tfUsed);
    return { ...s, id };
  });

  const selectedShelfKeys = new Set();
  const renderShelves = [];

  function addShelfIfNew(s) {
    const k = shelfKey(s, tfUsed);
    if (!k) return;
    if (selectedShelfKeys.has(k)) return;
    selectedShelfKeys.add(k);
    renderShelves.push(s);
  }

  // ----- 3) Between each adjacent pair of institutional zones: top 2 shelves -----
  for (let i = 0; i < institutionalCandidates.length - 1; i++) {
    const a = institutionalCandidates[i].b;   // lower zone
    const b = institutionalCandidates[i + 1].b; // higher zone

    // Gap is between top of lower zone and bottom of higher zone
    const gapLow = a.high;
    const gapHigh = b.low;

    // If zones overlap/touch, there is no “between” gap
    if (!(gapLow < gapHigh)) continue;

    const shelvesInGap = shelvesTfWithId.filter((s) => {
      const sb = toBounds(s);
      if (!sb) return false;
      return overlapAny(gapLow, gapHigh, sb.low, sb.high);
    });

    const top2 = pickTopNShelvesByStrength(shelvesInGap, 2);
    top2.forEach(addShelfIfNew);
  }

  // ----- 4) Inside each institutional zone: max 1 shelf (strongest overlap) -----
  for (const ic of institutionalCandidates) {
    const zb = ic.b;

    const shelvesInsideZone = shelvesTfWithId.filter((s) => {
      const sb = toBounds(s);
      if (!sb) return false;
      return overlapAny(zb.low, zb.high, sb.low, sb.high);
    });

    if (shelvesInsideZone.length === 0) continue;

    const strongest = pickTopNShelvesByStrength(shelvesInsideZone, 1)[0];
    addShelfIfNew(strongest);
  }

  // suppressed shelves = everything not in renderShelves (FULL originals)
  const renderShelfIdSet = new Set(renderShelves.map((s) => s.id));
  const suppressedShelves = shelvesAll.filter((s) => {
    const tf = getShelfTf(s);
    if (tf !== tfUsed) return true;
    const id = s?.id ?? s?.details?.id ?? stableShelfId(s, tfUsed);
    return !renderShelfIdSet.has(id);
  });

  return {
    ok: true,
    meta: {
      asOfUtc: new Date().toISOString(),
      tf_input: timeframe,
      tf_used: tfUsed,
      currentPrice: Number(price.toFixed(2)),
      windowPts,
      counts: {
        institutional_render: renderInstitutional.length,
        shelves_render: renderShelves.length,
      },
    },
    render: {
      institutional: renderInstitutional,
      shelves: renderShelves,
    },
    suppressed: {
      institutional: suppressedInstitutional,
      shelves: suppressedShelves,
    },
  };
}
