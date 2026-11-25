// src/services/core/logic/smzStructureRegistry.js
// Sticky registry for STRUCTURE zones so major zones don't disappear between runs.

import fs from "fs";
import path from "path";

const round2 = (x) => Math.round(Number(x) * 100) / 100;

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const nowIso = () => new Date().toISOString();

const getHiLo = (z) => {
  const pr = z?.priceRange;
  if (!Array.isArray(pr) || pr.length < 2) return null;
  let hi = safeNum(pr[0]);
  let lo = safeNum(pr[1]);
  if (hi == null || lo == null) return null;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (!(hi > lo)) return null;
  return { hi, lo, mid: (hi + lo) / 2, width: hi - lo };
};

const overlapRatio = (a, b) => {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(a.hi - a.lo, b.hi - b.lo);
  return denom > 0 ? inter / denom : 0;
};

const touchesInRecentBars = (bars1h, lo, hi, lookbackBars) => {
  if (!Array.isArray(bars1h) || bars1h.length === 0) return false;
  const start = Math.max(0, bars1h.length - lookbackBars);
  for (let i = bars1h.length - 1; i >= start; i--) {
    const b = bars1h[i];
    if (!b) continue;
    if (Number.isFinite(b.high) && Number.isFinite(b.low)) {
      if (b.high >= lo && b.low <= hi) return true;
    }
  }
  return false;
};

export function loadRegistry(registryPath) {
  try {
    if (!fs.existsSync(registryPath)) {
      return { ok: true, meta: { created_at_utc: nowIso() }, structures: [] };
    }
    const raw = fs.readFileSync(registryPath, "utf8");
    const json = JSON.parse(raw);
    const structures = Array.isArray(json?.structures) ? json.structures : [];
    return { ...json, structures };
  } catch {
    return { ok: true, meta: { created_at_utc: nowIso(), recovered: true }, structures: [] };
  }
}

export function saveRegistry(registryPath, registryObj) {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registryObj, null, 2), "utf8");
}

export function mergeStructuresIntoRegistry({
  registry,
  freshStructures,
  bars1h,
  currentPrice,
  atr1h,
  opts = {},
}) {
  const {
    MATCH_OVERLAP = 0.5,
    MATCH_MID_ATR = 0.9, // mid distance threshold in ATR
    LOCK_STRENGTH = 90,
    LOCK_CONFIRMATIONS = 2,

    ARCHIVE_DIST_ATR = 10,     // how far from price before eligible
    ARCHIVE_TOUCH_LOOKBACK = 160, // 1h bars
  } = opts;

  const reg = Array.isArray(registry?.structures) ? registry.structures.slice() : [];
  const atr = Number.isFinite(atr1h) && atr1h > 0 ? atr1h : 1;

  // normalize registry items
  const normReg = reg
    .map((z, i) => {
      const r = getHiLo(z);
      if (!r) return null;
      return {
        ...z,
        tier: "structure",
        status: z.status ?? "active",
        zoneId: z.zoneId ?? `smz_reg_${i + 1}`,
        priceRange: [round2(r.hi), round2(r.lo)],
        strength: Number(z.strength ?? 0),
        meta: z.meta ?? {},
      };
    })
    .filter(Boolean);

  // normalize fresh structures
  const normFresh = (Array.isArray(freshStructures) ? freshStructures : [])
    .map((z) => {
      const r = getHiLo(z);
      if (!r) return null;
      return {
        tier: "structure",
        priceRange: [round2(r.hi), round2(r.lo)],
        strength: Number(z.strength ?? 0),
        details: z.details ?? {},
      };
    })
    .filter(Boolean);

  const touchedNow = (z) => {
    const r = getHiLo(z);
    if (!r) return false;
    return touchesInRecentBars(bars1h, r.lo, r.hi, 160);
  };

  // helper: find best match in registry
  const findMatchIdx = (fresh) => {
    const fr = getHiLo(fresh);
    if (!fr) return -1;
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < normReg.length; i++) {
      const rz = normReg[i];
      const rr = getHiLo(rz);
      if (!rr) continue;

      const ov = overlapRatio(
        { lo: fr.lo, hi: fr.hi },
        { lo: rr.lo, hi: rr.hi }
      );

      const midDist = Math.abs(fr.mid - rr.mid);
      const midOk = midDist <= MATCH_MID_ATR * atr;

      const ok = ov >= MATCH_OVERLAP || midOk;
      if (!ok) continue;

      // Score prefers overlap, then closer mids
      const score = ov * 1.0 + (1 - Math.min(1, midDist / (MATCH_MID_ATR * atr + 1e-9))) * 0.25;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  // Merge fresh into registry
  for (const f of normFresh) {
    const idx = findMatchIdx(f);
    const fr = getHiLo(f);
    if (!fr) continue;

    if (idx >= 0) {
      const existing = normReg[idx];
      const er = getHiLo(existing);

      // Merge rule: keep union to prevent losing major edges
      const newLo = round2(Math.min(er.lo, fr.lo));
      const newHi = round2(Math.max(er.hi, fr.hi));

      const times = Number(existing.meta?.timesConfirmed ?? 0) + 1;
      const maxStrength = Math.max(Number(existing.strength ?? 0), Number(f.strength ?? 0));

      const locked =
        Boolean(existing.meta?.locked) ||
        maxStrength >= LOCK_STRENGTH ||
        times >= LOCK_CONFIRMATIONS;

      normReg[idx] = {
        ...existing,
        status: "active",
        priceRange: [newHi, newLo],
        strength: round2(maxStrength),
        meta: {
          ...existing.meta,
          lastSeenUtc: nowIso(),
          timesConfirmed: times,
          locked,
        },
      };

      // Touch bookkeeping
      if (touchedNow(normReg[idx])) {
        normReg[idx].meta.lastTouchUtc = nowIso();
      }
    } else {
      const zoneId = `smz_reg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const locked = Number(f.strength ?? 0) >= LOCK_STRENGTH;

      const entry = {
        type: "institutional",
        tier: "structure",
        status: "active",
        zoneId,
        priceRange: [round2(fr.hi), round2(fr.lo)],
        strength: round2(Number(f.strength ?? 0)),
        details: {
          // keep the last computed facts for debug
          ...(f.details ?? {}),
        },
        meta: {
          firstSeenUtc: nowIso(),
          lastSeenUtc: nowIso(),
          lastTouchUtc: touchedNow(f) ? nowIso() : null,
          timesConfirmed: 1,
          locked,
        },
      };
      normReg.push(entry);
    }
  }

  // Archive rules (never hard-delete; locked zones are never auto-archived)
  const cp = safeNum(currentPrice) ?? null;

  for (const z of normReg) {
    if (z.status !== "active") continue;

    const r = getHiLo(z);
    if (!r) continue;

    const locked = Boolean(z.meta?.locked);
    if (locked) continue;

    if (cp != null) {
      const dist = Math.abs(r.mid - cp);
      const far = dist >= ARCHIVE_DIST_ATR * atr;

      if (far) {
        const touched = touchesInRecentBars(bars1h, r.lo, r.hi, ARCHIVE_TOUCH_LOOKBACK);
        if (!touched) {
          z.status = "archived";
          z.meta.archivedUtc = nowIso();
          z.meta.archiveReason = {
            distPts: round2(dist),
            distAtr: round2(dist / atr),
            touchLookbackBars: ARCHIVE_TOUCH_LOOKBACK,
          };
        }
      }
    }
  }

  // Return active structures for chart + full registry stored
  const active = normReg
    .filter((z) => z.status === "active")
    .map((z) => ({
      type: "institutional",
      tier: "structure",
      price: round2((getHiLo(z).hi + getHiLo(z).lo) / 2),
      priceRange: z.priceRange,
      strength: z.strength,
      details: {
        ...(z.details ?? {}),
        facts: {
          ...(z.details?.facts ?? {}),
          registry: {
            zoneId: z.zoneId,
            locked: Boolean(z.meta?.locked),
            timesConfirmed: Number(z.meta?.timesConfirmed ?? 0),
            firstSeenUtc: z.meta?.firstSeenUtc ?? null,
            lastSeenUtc: z.meta?.lastSeenUtc ?? null,
            lastTouchUtc: z.meta?.lastTouchUtc ?? null,
          },
        },
      },
    }));

  const updatedRegistry = {
    ok: true,
    meta: {
      ...(registry?.meta ?? {}),
      updated_at_utc: nowIso(),
    },
    structures: normReg,
  };

  return { updatedRegistry, activeStructures: active };
}
