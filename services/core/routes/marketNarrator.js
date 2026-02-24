// services/core/routes/marketNarrator.js
// Engine 14A (Read-only) — Market Narrator (SPY only)
//
// CLEAN REWRITE (v6):
// ✅ Primary + Intermediate + Minor stack included (Primary=1d, Intermediate=1h, Minor=1h)
// ✅ Policy (LOCKED): Neutral until MINOR resets
//    - If minor is invalidated → overall bias stays NEUTRAL (even if primary/intermediate are bullish)
// ✅ style=descriptive → EXACTLY 3 paragraphs separated by \n\n
// ✅ Deterministic defended support/resistance tags + structured levels over last 24h (ATR-based clustering)
// ✅ SPX macro shelves (6800/6900/7000) mapped to SPY using fixed ratio (SPX 6900 ↔ SPY 688)
// ✅ Engine 2 parsing uses fib-levels@3 truth (anchors.waveMarks + fib.r382/r500/r618/invalidation + signals.tag)
// ✅ W3 pending behavior (locked): if tag=W2 and waveMarks.W3.p==0 → project W3 targets from W2 using 1.0/1.272/1.618
//
// Uses ONLY:
// - OHLCV bars: /api/v1/ohlc?symbol=SPY&tf=1h&limit=250
// - Zone context: /api/v1/engine5-context?symbol=SPY&tf=1h
// - Engine 2 truth: /api/v1/fib-levels?... (primary/intermediate/minor)
//
// Not a signal generator. Narration-only.

import express from "express";

export const marketNarratorRouter = express.Router();

/* ---------------- CORE_BASE (Render-safe loopback) ---------------- */
const PORT = Number(process.env.PORT) || 8080;
const CORE_BASE =
  process.env.CORE_BASE && process.env.CORE_BASE.trim().length
    ? process.env.CORE_BASE.trim()
    : `http://127.0.0.1:${PORT}`;

/* ---------------- helpers ---------------- */

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

function isoFromBarTime(barTime) {
  const t = toNum(barTime);
  if (t == null) return null;
  const ms = t > 3_000_000_000 ? t : t * 1000;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function computeATR(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high,
      l = bars[i].low,
      pc = bars[i - 1].close;
    if (![h, l, pc].every(Number.isFinite)) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length < len) return null;

  let atr = trs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < trs.length; i++) atr = atr * ((len - 1) / len) + trs[i] * (1 / len);
  return atr;
}

function candleStats(bar) {
  const o = toNum(bar?.open),
    h = toNum(bar?.high),
    l = toNum(bar?.low),
    c = toNum(bar?.close);
  if ([o, h, l, c].some((v) => v == null)) return null;

  const range = h - l;
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const bodyPct = range > 0 ? body / range : 0;
  const closePos = range > 0 ? (c - l) / range : 0.5;

  return { o, h, l, c, range, body, upperWick, lowerWick, bodyPct, closePos };
}

/* ---------------- zone proximity helpers ---------------- */

function distToZone(price, z) {
  const p = toNum(price);
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (p == null || lo == null || hi == null) return null;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  if (p >= a && p <= b) return 0;
  return p < a ? a - p : p - b;
}

function nearestAllowedZone({ price, negotiated = [], institutional = [] }) {
  let best = null;

  const scan = (arr, zoneType) => {
    const list = Array.isArray(arr) ? arr : [];
    for (const z of list) {
      const d = distToZone(price, z);
      if (d == null) continue;
      if (!best || d < best.distancePts) {
        best = {
          zoneType,
          id: z?.id ?? null,
          lo: z?.lo ?? null,
          hi: z?.hi ?? null,
          mid: z?.mid ?? null,
          strength: z?.strength ?? null,
          distancePts: d,
        };
      }
    }
  };

  scan(negotiated, "NEGOTIATED");
  scan(institutional, "INSTITUTIONAL");

  return best;
}

/* ---------------- SPX macro shelves (fixed mapping) ---------------- */
// User locked: SPX 6900 ↔ SPY 688
const SPX_SHELVES = [6800, 6900, 7000];
const SPX_TO_SPY_RATIO = 6900 / 688;

function buildMacroShelves({ price }) {
  const p = toNum(price);
  const mapped = SPX_SHELVES.map((lvl) => ({ spx: lvl, spy: lvl / SPX_TO_SPY_RATIO }));

  let nearest = null;
  if (p != null) {
    for (const m of mapped) {
      const d = Math.abs(p - m.spy);
      if (!nearest || d < nearest.distancePts) {
        nearest = {
          spx: m.spx,
          spy: m.spy,
          distancePts: d,
          side: p > m.spy ? "ABOVE" : p < m.spy ? "BELOW" : "ON",
        };
      }
    }
  }

  return {
    source: "SPX_ROUND_NUMBERS_FIXED",
    ratio: round2(SPX_TO_SPY_RATIO),
    spxLevels: SPX_SHELVES.slice(),
    spyMapped: mapped.map((m) => round2(m.spy)),
    nearest: nearest
      ? {
          spx: nearest.spx,
          spy: round2(nearest.spy),
          distancePts: round2(nearest.distancePts),
          side: nearest.side,
        }
      : null,
  };
}

/* ---------------- Engine 2 (Fib/Wave) truth parsing ---------------- */

// Degrees we want inside narrator
const ENGINE2_CTX = {
  primary: { tf: "1d", degree: "primary", wave: "W1" },
  intermediate: { tf: "1h", degree: "intermediate", wave: "W1" },
  minor: { tf: "1h", degree: "minor", wave: "W1" },
};

function isRealPrice(p) {
  const n = Number(p);
  return Number.isFinite(n) && n > 0;
}

// Robust fetch:
// 1) try CORE_BASE loopback
// 2) fallback to the same host that served this request (req host)
// Returns { ok, baseUsed, payload, errors[] }
async function fetchFibLevelsRobust(req, { symbol, tf, degree, wave }) {
  const bases = [];

  // 1) Loopback base (fast)
  if (CORE_BASE) bases.push(String(CORE_BASE));

  // 2) Same request host (most reliable on Render)
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").toString();
  const host = req.get?.("host");
  if (host) bases.push(`${proto}://${host}`);

  const errors = [];

  for (const base of bases) {
    try {
      const u = new URL(`${base}/api/v1/fib-levels`);
      u.searchParams.set("symbol", symbol);
      u.searchParams.set("tf", tf);
      u.searchParams.set("degree", degree);
      u.searchParams.set("wave", wave);

      const r = await fetchJson(u.toString(), { timeoutMs: 15000 });

      // We accept only a valid fib-levels payload: HTTP OK + json.ok === true
      if (r?.ok && r?.json && r.json.ok === true) {
        return { ok: true, baseUsed: base, payload: r.json, errors };
      }

      errors.push({
        base,
        httpOk: Boolean(r?.ok),
        status: r?.status ?? 0,
        sample: String(r?.text || "").slice(0, 160),
      });
    } catch (e) {
      errors.push({
        base,
        httpOk: false,
        status: 0,
        sample: String(e?.message || e).slice(0, 160),
      });
    }
  }

  return { ok: false, baseUsed: null, payload: null, errors };
}

function getWaveMark(payload, key) {
  const p = payload?.anchors?.waveMarks?.[key]?.p;
  return isRealPrice(p) ? Number(p) : null;
}

function parseFibLevelsV3(payload) {
  if (!payload || payload.ok !== true) return { ok: false };

  const schema = payload?.meta?.schema || null;

  const low = payload?.anchors?.low;
  const high = payload?.anchors?.high;

  return {
    ok: true,
    schema,
    meta: payload?.meta || null,
    degree: payload?.meta?.degree || null,
    tf: payload?.meta?.tf || null,
    wave: payload?.meta?.wave || null,
    direction: payload?.anchors?.direction || null,
    tag: payload?.signals?.tag ?? payload?.anchors?.context ?? null,
    signals: payload?.signals || null,
    diagnostics: payload?.diagnostics || null,
    anchors: {
      low: isRealPrice(low) ? Number(low) : null,
      high: isRealPrice(high) ? Number(high) : null,
      context: payload?.anchors?.context ?? null,
    },
    waveMarks: {
      W1: getWaveMark(payload, "W1"),
      W2: getWaveMark(payload, "W2"),
      W3: getWaveMark(payload, "W3"),
      W4: getWaveMark(payload, "W4"),
      W5: getWaveMark(payload, "W5"),
    },
    fib: {
      r382: isRealPrice(payload?.fib?.r382) ? Number(payload.fib.r382) : null,
      r500: isRealPrice(payload?.fib?.r500) ? Number(payload.fib.r500) : null,
      r618: isRealPrice(payload?.fib?.r618) ? Number(payload.fib.r618) : null,
      invalidation: isRealPrice(payload?.fib?.invalidation) ? Number(payload.fib.invalidation) : null,
      reference_786: isRealPrice(payload?.fib?.reference_786) ? Number(payload.fib.reference_786) : null,
    },
  };
}

function buildFibLevelsList(e2Parsed) {
  if (!e2Parsed?.ok) return null;

  const levels = [];

  if (e2Parsed.anchors?.low != null)
    levels.push({ tag: "LOW", kind: "ANCHOR", price: round2(e2Parsed.anchors.low) });
  if (e2Parsed.anchors?.high != null)
    levels.push({ tag: "HIGH", kind: "ANCHOR", price: round2(e2Parsed.anchors.high) });

  if (e2Parsed.fib?.r382 != null)
    levels.push({ tag: "38.2%", kind: "RETRACEMENT", price: round2(e2Parsed.fib.r382) });
  if (e2Parsed.fib?.r500 != null)
    levels.push({ tag: "50.0%", kind: "RETRACEMENT", price: round2(e2Parsed.fib.r500) });
  if (e2Parsed.fib?.r618 != null)
    levels.push({ tag: "61.8%", kind: "RETRACEMENT", price: round2(e2Parsed.fib.r618) });
  if (e2Parsed.fib?.reference_786 != null)
    levels.push({ tag: "78.6%", kind: "RETRACEMENT", price: round2(e2Parsed.fib.reference_786) });

  if (e2Parsed.fib?.invalidation != null)
    levels.push({ tag: "INVALIDATION", kind: "RISK_LINE", price: round2(e2Parsed.fib.invalidation) });

  const uniq = [];
  for (const l of levels) {
    if (l?.price == null) continue;
    const key = `${l.kind}|${l.tag}|${l.price}`;
    if (!uniq.find((x) => `${x.kind}|${x.tag}|${x.price}` === key)) uniq.push(l);
  }
  uniq.sort((a, b) => a.price - b.price);

  return { ok: true, levels: uniq };
}

function computeProjectedW3(e2Parsed) {
  if (!e2Parsed?.ok) return null;

  const tag = String(e2Parsed.tag || "").toUpperCase();
  const w3 = e2Parsed.waveMarks?.W3;
  const w2 = e2Parsed.waveMarks?.W2;
  const lo = e2Parsed.anchors?.low;
  const hi = e2Parsed.anchors?.high;

  const w3Missing = !isRealPrice(w3);
  const isW2 = tag === "W2";

  if (!isW2 || !w3Missing) return { pending: false };

  if (w2 == null || lo == null || hi == null) return { pending: true, error: "MISSING_ANCHORS_FOR_PROJECTION" };

  const wave1Len = Math.abs(hi - lo);
  if (!(wave1Len > 0)) return { pending: true, error: "BAD_W1_LEN" };

  const dir = String(e2Parsed.direction || "up").toLowerCase();
  const ratios = [1.0, 1.272, 1.618];

  const targets = ratios.map((r) => {
    const px = dir === "down" ? w2 - r * wave1Len : w2 + r * wave1Len;
    return { ratio: r, price: round2(px) };
  });

  const primary618 = targets.find((t) => t.ratio === 1.618)?.price ?? null;

  return {
    pending: true,
    w2: round2(w2),
    wave1Len: round2(wave1Len),
    direction: dir,
    targets,
    primary618,
  };
}

function nearestLevel({ price, levelList, atr }) {
  const p = toNum(price);
  if (p == null || !levelList?.ok || !Array.isArray(levelList.levels) || levelList.levels.length === 0) return null;

  let best = null;
  for (const lvl of levelList.levels) {
    const d = Math.abs(p - lvl.price);
    if (!best || d < best.distancePts) best = { ...lvl, distancePts: d };
  }

  const dPts = best ? best.distancePts : null;
  const nearPts = dPts != null ? round2(dPts) : null;
  const nearAtr = dPts != null && Number.isFinite(atr) && atr > 0 ? round2(dPts / atr) : null;

  return best
    ? { tag: best.tag, kind: best.kind, price: best.price, distancePts: nearPts, distanceAtr: nearAtr }
    : null;
}

/* ---------------- defended levels (deterministic tags) ---------------- */

function roundToBand(x, band) {
  const n = toNum(x);
  const b = toNum(band);
  if (n == null || b == null || b <= 0) return null;
  return Math.round(n / b) * b;
}

function detectDefendedLevels({ bars, atr, windowBars = 24 }) {
  if (!Array.isArray(bars) || bars.length < 10 || !Number.isFinite(atr) || atr <= 0) {
    return { tags: [], defendedSupportLevels: [], defendedResistanceLevels: [] };
  }

  const tol = 0.15 * atr;
  const slice = bars.slice(-windowBars);

  const supportEvents = [];
  const resistEvents = [];

  for (const b of slice) {
    const s = candleStats(b);
    if (!s) continue;

    const lowerWickToBody = s.body > 0 ? s.lowerWick / s.body : s.lowerWick > 0 ? 99 : 0;
    const upperWickToBody = s.body > 0 ? s.upperWick / s.body : s.upperWick > 0 ? 99 : 0;

    const supportCandidate = lowerWickToBody >= 1.25 && s.closePos >= 0.60 ? roundToBand(s.l, tol) : null;
    const resistCandidate = upperWickToBody >= 1.25 && s.closePos <= 0.40 ? roundToBand(s.h, tol) : null;

    if (supportCandidate != null) {
      supportEvents.push({ level: supportCandidate, time: b.time });
    }
    if (resistCandidate != null) {
      resistEvents.push({ level: resistCandidate, time: b.time });
    }
  }

  const cluster = (events) => {
    const m = new Map();
    for (const ev of events) {
      const k = round2(ev.level);
      if (k == null) continue;
      if (!m.has(k)) m.set(k, { price: k, touches: 0, lastSeenUtc: null });
      const item = m.get(k);
      item.touches += 1;
      item.lastSeenUtc = isoFromBarTime(ev.time) || item.lastSeenUtc;
    }
    return Array.from(m.values())
      .filter((x) => x.touches >= 3)
      .sort((a, b) => b.touches - a.touches);
  };

  const defendedSupportLevels = cluster(supportEvents);
  const defendedResistanceLevels = cluster(resistEvents);

  const tags = [];
  if (defendedSupportLevels.length) tags.push("DEFENDED_SUPPORT");
  if (defendedResistanceLevels.length) tags.push("DEFENDED_RESISTANCE");

  return { tags, defendedSupportLevels, defendedResistanceLevels };
}

/* ---------------- market structure helpers ---------------- */

function rangeHiLo(bars) {
  let hi = -Infinity,
    lo = Infinity;
  for (const b of bars) {
    const h = toNum(b.high),
      l = toNum(b.low);
    if (h == null || l == null) continue;
    if (h > hi) hi = h;
    if (l < lo) lo = l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo)) return null;
  return { hi, lo, mid: (hi + lo) / 2, width: hi - lo };
}

function detectBalance({ bars, atr, n = 12, maxWidthAtr = 2.25 }) {
  if (!Array.isArray(bars) || bars.length < n || !Number.isFinite(atr) || atr <= 0) return null;
  const slice = bars.slice(-n);
  const r = rangeHiLo(slice);
  if (!r) return null;

  const widthAtr = r.width / atr;
  const isBalance = widthAtr <= maxWidthAtr;

  const bandLo = r.mid - 0.25 * r.width;
  const bandHi = r.mid + 0.25 * r.width;

  let inside = 0;
  for (const b of slice) {
    const c = toNum(b.close);
    if (c != null && c >= bandLo && c <= bandHi) inside++;
  }
  const overlapPct = inside / slice.length;

  return {
    isBalance: Boolean(isBalance && overlapPct >= 0.55),
    n,
    hi: r.hi,
    lo: r.lo,
    mid: r.mid,
    width: r.width,
    widthAtr,
    overlapPct,
  };
}

function summarizeImpulse(bar, atr) {
  const s = candleStats(bar);
  if (!s || !Number.isFinite(atr) || atr <= 0) {
    return { impulseScore: 0, direction: "FLAT", rangeAtr: null, bodyPct: null };
  }

  const dir = s.c > s.o ? "UP" : s.c < s.o ? "DOWN" : "FLAT";
  const rangeAtr = s.range / atr;
  const bodyDominant = s.bodyPct;

  let score = 0;
  score += clamp(rangeAtr / 2.0, 0, 1) * 5;
  score += clamp(bodyDominant, 0, 1) * 5;

  return {
    impulseScore: Math.round(score),
    direction: dir,
    rangeAtr: round2(rangeAtr),
    bodyPct: round2(bodyDominant),
  };
}

function phaseFromBalanceAndLast({ balance, lastBar, prevBar, atr }) {
  const last = candleStats(lastBar);
  const prev = candleStats(prevBar);
  if (!last || !prev || !balance || !Number.isFinite(atr) || atr <= 0) {
    return { phase: "UNKNOWN", details: {} };
  }

  const { hi, lo } = balance;
  const lastClose = last.c;
  const prevClose = prev.c;

  const outsideUp = lastClose > hi;
  const outsideDown = lastClose < lo;
  const backInside = lastClose <= hi && lastClose >= lo;

  const lastRangeAtr = last.range / atr;
  const lastBodyPct = last.bodyPct;
  const strongImpulse = lastRangeAtr >= 1.1 && lastBodyPct >= 0.55;

  const acceptanceUp = prevClose > hi && lastClose > hi;
  const acceptanceDown = prevClose < lo && lastClose < lo;

  const wickAbove = last.h > hi && backInside;
  const wickBelow = last.l < lo && backInside;

  const weakBreak = (outsideUp || outsideDown) && !strongImpulse;

  if (balance.isBalance) {
    if (acceptanceUp) return { phase: "ACCEPTANCE_UP", details: { hi, lo } };
    if (acceptanceDown) return { phase: "ACCEPTANCE_DOWN", details: { hi, lo } };

    if ((outsideUp || outsideDown) && strongImpulse) {
      return { phase: "EXPANSION", details: { dir: outsideUp ? "UP" : "DOWN", hi, lo } };
    }

    if (wickAbove || wickBelow) {
      return { phase: "REJECTION", details: { dir: wickAbove ? "DOWN" : "UP", hi, lo } };
    }

    if (weakBreak) return { phase: "TRAP_RISK", details: { hi, lo } };

    return { phase: "BALANCE", details: { hi, lo } };
  }

  if (strongImpulse) return { phase: "IMPULSE", details: { dir: lastClose > prevClose ? "UP" : "DOWN" } };
  return { phase: "CORRECTION", details: {} };
}

/* ---------------- Narration helpers (stack + neutral-until-reset policy) ---------------- */

function stackLine({ primary, intermediate, minor }) {
  const fmt = (x) => {
    if (!x?.ok) return "N/A";
    const tag = x.tag ? String(x.tag).toUpperCase() : "UNKNOWN";
    const inv = x.signals?.invalidated ? " (invalidated)" : "";
    return `${tag}${inv}`;
  };
  return `Alignment: Primary=${fmt(primary)}, Intermediate=${fmt(intermediate)}, Minor=${fmt(minor)}.`;
}

function minorResetRuleText(minorParsed) {
  if (!minorParsed?.ok) return "Minor wave/fib unavailable; stay neutral until execution layer is readable.";
  if (!minorParsed.signals?.invalidated) return null;

  const inv = minorParsed.fib?.invalidation;
  const ref786 = minorParsed.fib?.reference_786;

  // Keep it simple and actionable
  if (inv != null) {
    return `Execution layer: Minor is invalidated (74% gate breached). Stay neutral on minor/minute longs until price resets above the minor invalidation line near ${inv.toFixed(2)} and holds.`;
  }
  if (ref786 != null) {
    return `Execution layer: Minor is invalidated (74% gate breached). Stay neutral on minor/minute longs until price resets above ~${ref786.toFixed(2)} and holds.`;
  }
  return `Execution layer: Minor is invalidated (74% gate breached). Stay neutral until minor resets.`;
}

/* ---------------- Layer narratives ---------------- */

function buildLayer1RecentNarrative({ last24, defended }) {
  let text = "Last 24 hours: mixed rotation with no clean directional dominance.";

  if (defended?.defendedSupportLevels?.length) {
    const top = defended.defendedSupportLevels[0];
    text += ` Defended support formed near ${top.price.toFixed(2)} (touches: ${top.touches}).`;
  }
  if (defended?.defendedResistanceLevels?.length) {
    const top = defended.defendedResistanceLevels[0];
    text += ` Defended resistance formed near ${top.price.toFixed(2)} (touches: ${top.touches}).`;
  }

  const last = last24[last24.length - 1];
  const s = candleStats(last);
  if (s) {
    const dir = s.c > s.o ? "up" : s.c < s.o ? "down" : "flat";
    text += ` Latest bar closed ${dir} at ${s.c.toFixed(2)}.`;
  }

  return { text };
}

function buildLayer2CurrentNarrative({ price, phase, zones, macroShelves, impulse, stack, minorReset }) {
  const inAllowed = Boolean(zones?.inAllowedZone);
  const near = zones?.nearestAllowed?.distancePts != null ? zones.nearestAllowed.distancePts : null;

  let text = `Right now: phase is ${phase}. `;

  if (inAllowed && zones?.activeZone) {
    text += `Price ${price != null ? price.toFixed(2) : ""} is inside ${zones.activeZone.zoneType} zone ${Number(
      zones.activeZone.lo
    ).toFixed(2)}–${Number(zones.activeZone.hi).toFixed(2)}. `;
  } else if (near != null) {
    text += `Price ${price != null ? price.toFixed(2) : ""} is outside allowed zones, but near ${
      zones.nearestAllowed.zoneType
    } by ${near.toFixed(2)} pts. `;
  } else {
    text += `Price ${price != null ? price.toFixed(2) : ""} is not near an allowed zone. `;
  }

  if (macroShelves?.nearest?.spx != null && macroShelves?.nearest?.spy != null) {
    text += `Macro shelf: SPX ${macroShelves.nearest.spx} maps to ~SPY ${macroShelves.nearest.spy.toFixed(
      2
    )} (price is ${macroShelves.nearest.side} by ${macroShelves.nearest.distancePts.toFixed(2)}). `;
  }

  if (stack) text += `${stack} `;

  if (minorReset) text += `${minorReset} `;

  if (impulse?.impulseScore != null) {
    text += `Latest impulse score is ${impulse.impulseScore}/10 (${impulse.direction}). `;
  }

  return { text: text.trim() };
}

function buildLayer3NextNarrative({ zones, balance, macroShelves, minorReset, e2NextRules }) {
  const bHi = toNum(balance?.hi);
  const bLo = toNum(balance?.lo);

  // If minor is invalidated, "next" should emphasize reset conditions first.
  if (minorReset) {
    let t = `What I'm watching next: ${minorReset} `;
    if (bHi != null && bLo != null) {
      t += `Also watch balance guardrails: close above ${bHi.toFixed(2)} for acceptance, or below ${bLo.toFixed(2)} for acceptance down. `;
    }
    if (macroShelves?.nearest?.spx != null && macroShelves?.nearest?.spy != null) {
      t += `Macro friction remains around ~${macroShelves.nearest.spy.toFixed(2)} (SPX ${macroShelves.nearest.spx}). `;
    }
    if (Array.isArray(e2NextRules) && e2NextRules.length) t += e2NextRules.join(" ");
    return { text: t.trim() };
  }

  if (bHi != null && bLo != null) {
    let t = `What I'm watching next: a decisive close above ${bHi.toFixed(
      2
    )} favors acceptance up, while a decisive close below ${bLo.toFixed(2)} favors acceptance down. `;

    if (zones?.activeZone?.lo != null && zones?.activeZone?.hi != null) {
      const lo = Number(zones.activeZone.lo);
      const hi = Number(zones.activeZone.hi);
      const mid = (Math.min(lo, hi) + Math.max(lo, hi)) / 2;
      t += `Within zones, hold above ${hi.toFixed(2)} for acceptance, or lose midline ${mid.toFixed(
        2
      )} for rejection risk. `;
    } else if (
      zones?.nearestAllowed?.distancePts != null &&
      zones?.nearestAllowed?.lo != null &&
      zones?.nearestAllowed?.hi != null
    ) {
      const lo = Number(zones.nearestAllowed.lo);
      const hi = Number(zones.nearestAllowed.hi);
      t += `I want a clean re-entry into ${lo.toFixed(2)}–${hi.toFixed(2)} before upgrading the read. `;
    } else {
      t += `No nearby allowed zone — wait for price to approach negotiated/institutional structure. `;
    }

    if (macroShelves?.nearest?.spx != null && macroShelves?.nearest?.spy != null) {
      t += `Macro friction remains around ~${macroShelves.nearest.spy.toFixed(2)} (SPX ${macroShelves.nearest.spx}). `;
    }

    if (Array.isArray(e2NextRules) && e2NextRules.length) t += e2NextRules.join(" ");

    return { text: t.trim() };
  }

  let t = "What I'm watching next: keep it simple — wait for clear acceptance or rejection at nearby structure.";
  if (Array.isArray(e2NextRules) && e2NextRules.length) t += " " + e2NextRules.join(" ");
  return { text: t };
}

function buildNarrativeTextDescriptive({ layer1, layer2, layer3 }) {
  const p1 = layer1?.text || "Last 24 hours: no recent narrative available.";
  const p2 = layer2?.text || "Right now: no current narrative available.";
  const p3 = layer3?.text || "What I'm watching next: no next-step narrative available.";
  return `${p1}\n\n${p2}\n\n${p3}`;
}

/* ---------------- route ---------------- */
// GET /api/v1/market-narrator?symbol=SPY&tf=1h&style=descriptive
marketNarratorRouter.get("/market-narrator", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tf = String(req.query.tf || "1h");
  const style = String(req.query.style || "").toLowerCase().trim();

  if (symbol !== "SPY") {
    return res.json({ ok: false, error: "SPY_ONLY_V1", meta: { symbol, supported: ["SPY"] } });
  }

  try {
    // 1) Bars (1h)
    const ohlcUrl = new URL(`${CORE_BASE}/api/v1/ohlc`);
    ohlcUrl.searchParams.set("symbol", symbol);
    ohlcUrl.searchParams.set("tf", tf);
    ohlcUrl.searchParams.set("limit", "250");

    const barsResp = await fetchJson(ohlcUrl.toString(), { timeoutMs: 20000 });
    if (!barsResp.ok || !Array.isArray(barsResp.json) || barsResp.json.length < 30) {
      return res.status(502).json({
        ok: false,
        error: "BARS_UNAVAILABLE",
        meta: { symbol, tf, coreBase: CORE_BASE },
        detail: barsResp.text?.slice(0, 200) || "no bars",
      });
    }

    const bars = barsResp.json
      .map((b) => ({
        time: b.time ?? b.t ?? null,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume ?? 0),
      }))
      .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite));

    const atr = computeATR(bars, 14) || computeATR(bars, 10) || null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const last24 = bars.slice(-24);

    // 2) Zones (engine5-context) — degrade gracefully if missing
    const ctxUrl = new URL(`${CORE_BASE}/api/v1/engine5-context`);
    ctxUrl.searchParams.set("symbol", symbol);
    ctxUrl.searchParams.set("tf", tf);

    const ctxResp = await fetchJson(ctxUrl.toString(), { timeoutMs: 15000 });
    const ctx = ctxResp.ok && ctxResp.json ? ctxResp.json : null;

    const price =
      toNum(ctx?.meta?.current_price) ?? toNum(ctx?.meta?.currentPrice) ?? toNum(last?.close) ?? null;

    const negotiated = ctx?.render?.negotiated || [];
    const institutional = ctx?.render?.institutional || [];

    const nearest = nearestAllowedZone({ price, negotiated, institutional });

    const inAllowed =
      Boolean(ctx?.active?.negotiated && price != null) || Boolean(ctx?.active?.institutional && price != null);

    const zones = {
      zonesOk: Boolean(ctxResp.ok && ctx),
      inAllowedZone: Boolean(inAllowed),
      activeZone: ctx?.active?.negotiated
        ? { zoneType: "NEGOTIATED", ...ctx.active.negotiated }
        : ctx?.active?.institutional
        ? { zoneType: "INSTITUTIONAL", ...ctx.active.institutional }
        : null,
      nearestAllowed: nearest
        ? {
            zoneType: nearest.zoneType,
            zoneId: nearest.id,
            lo: nearest.lo,
            hi: nearest.hi,
            distancePts: nearest.distancePts,
          }
        : null,
    };

    const macroShelves = buildMacroShelves({ price });

    // 3) Engine 2 (primary + intermediate + minor) — NEVER 500 on failure
    let primaryRaw = null;
    let interRaw = null;
    let minorRaw = null;

   const [pRes, iRes, mRes] = await Promise.all([
     fetchFibLevelsRobust(req, { symbol, ...ENGINE2_CTX.primary }),
     fetchFibLevelsRobust(req, { symbol, ...ENGINE2_CTX.intermediate }),
     fetchFibLevelsRobust(req, { symbol, ...ENGINE2_CTX.minor }),
   ]);

   primaryRaw = pRes.ok ? pRes.payload : null;
   interRaw   = iRes.ok ? iRes.payload : null;
   minorRaw   = mRes.ok ? mRes.payload : null; 
    
    const e2Primary = parseFibLevelsV3(primaryRaw);
    const e2Inter = parseFibLevelsV3(interRaw);
    const e2Minor = parseFibLevelsV3(minorRaw);

    const listPrimary = buildFibLevelsList(e2Primary);
    const listInter = buildFibLevelsList(e2Inter);
    const listMinor = buildFibLevelsList(e2Minor);

    const nearestPrimary = nearestLevel({ price, levelList: listPrimary, atr });
    const nearestInter = nearestLevel({ price, levelList: listInter, atr });
    const nearestMinor = nearestLevel({ price, levelList: listMinor, atr });

    const projPrimaryW3 = computeProjectedW3(e2Primary);
    const projInterW3 = computeProjectedW3(e2Inter);
    const projMinorW3 = computeProjectedW3(e2Minor);

    const engine2 = {
      primary: {
        tf: ENGINE2_CTX.primary.tf,
        degree: ENGINE2_CTX.primary.degree,
        wave: ENGINE2_CTX.primary.wave,
        ok: Boolean(e2Primary.ok),
        schema: e2Primary.schema ?? null,
        tag: e2Primary.tag ?? null,
        direction: e2Primary.direction ?? null,
        waveMarks: e2Primary.waveMarks ?? null,
        fib: e2Primary.fib ?? null,
        invalidated: Boolean(e2Primary.signals?.invalidated),
        nearestLevel: nearestPrimary,
        projectedW3: projPrimaryW3,
      },
      intermediate: {
        tf: ENGINE2_CTX.intermediate.tf,
        degree: ENGINE2_CTX.intermediate.degree,
        wave: ENGINE2_CTX.intermediate.wave,
        ok: Boolean(e2Inter.ok),
        schema: e2Inter.schema ?? null,
        tag: e2Inter.tag ?? null,
        direction: e2Inter.direction ?? null,
        waveMarks: e2Inter.waveMarks ?? null,
        fib: e2Inter.fib ?? null,
        invalidated: Boolean(e2Inter.signals?.invalidated),
        nearestLevel: nearestInter,
        projectedW3: projInterW3,
      },
      minor: {
        tf: ENGINE2_CTX.minor.tf,
        degree: ENGINE2_CTX.minor.degree,
        wave: ENGINE2_CTX.minor.wave,
        ok: Boolean(e2Minor.ok),
        schema: e2Minor.schema ?? null,
        tag: e2Minor.tag ?? null,
        direction: e2Minor.direction ?? null,
        waveMarks: e2Minor.waveMarks ?? null,
        fib: e2Minor.fib ?? null,
        invalidated: Boolean(e2Minor.signals?.invalidated),
        nearestLevel: nearestMinor,
        projectedW3: projMinorW3,
      },
    };

    // Next rules (include invalidation lines for each degree)
    const e2NextRules = [];
    const addRules = (label, e2) => {
      if (!e2?.ok) return;
      if (e2.fib?.invalidation != null) e2NextRules.push(`${label} invalidation: ${e2.fib.invalidation.toFixed(2)}.`);
      if (String(e2.tag || "").toUpperCase() === "W2" && e2.projectedW3?.pending && e2.projectedW3?.primary618 != null) {
        e2NextRules.push(`${label} W3 (proj 1.618): ~${e2.projectedW3.primary618.toFixed(2)}.`);
      }
    };
    addRules("Primary", engine2.primary);
    addRules("Intermediate", engine2.intermediate);
    addRules("Minor", engine2.minor);

    // Stack + policy: neutral until minor resets
    const stack = stackLine({ primary: e2Primary, intermediate: e2Inter, minor: e2Minor });
    const minorReset = minorResetRuleText(e2Minor);

    // 4) Market regime (1h)
    const balance = detectBalance({ bars, atr, n: 12, maxWidthAtr: 2.25 });
    const { phase, details } = phaseFromBalanceAndLast({ balance, lastBar: last, prevBar: prev, atr });
    const impulse = summarizeImpulse(last, atr);

    // 5) Defended levels tags (deterministic)
    const defended = detectDefendedLevels({ bars, atr, windowBars: 24 });

    // 6) Bias override (LOCKED): neutral until minor resets
    const baseBias =
      phase === "ACCEPTANCE_UP"
        ? "BULLISH"
        : phase === "ACCEPTANCE_DOWN"
        ? "BEARISH"
        : phase === "EXPANSION"
        ? details?.dir === "UP"
          ? "BULLISH"
          : "BEARISH"
        : phase === "REJECTION"
        ? details?.dir === "UP"
          ? "BULLISH_REVERSAL_RISK"
          : "BEARISH_REVERSAL_RISK"
        : "NEUTRAL";

    const bias = minorReset ? "NEUTRAL" : baseBias;

    // 7) Layers
    const layer1 = buildLayer1RecentNarrative({ last24, defended });
    const layer2 = buildLayer2CurrentNarrative({ price, phase, zones, macroShelves, impulse, stack, minorReset });
    const layer3 = buildLayer3NextNarrative({ zones, balance, macroShelves, minorReset, e2NextRules });

    const narrativeText =
      style === "descriptive"
        ? buildNarrativeTextDescriptive({ layer1, layer2, layer3 })
        : `${layer1.text} ${layer2.text} ${layer3.text}`;

    return res.json({
      ok: true,
      symbol,
      tf,
      asOf: new Date().toISOString(),

      price,
      atr,

      phase,
      bias,

      engine2,
      engine2Fetch: {
        primary: { ok: pRes.ok, baseUsed: pRes.baseUsed, errors: pRes.errors },
        intermediate: { ok: iRes.ok, baseUsed: iRes.baseUsed, errors: iRes.errors },
        minor: { ok: mRes.ok, baseUsed: mRes.baseUsed, errors: mRes.errors },
      },
      // DO NOT CLOSE HERE.
      confidence: clamp(...),
      balance: ...,
      ...
      narrativeText,
    });
      

      confidence: clamp(
        balance?.isBalance
          ? Math.round(50 + clamp(1 - (balance.widthAtr || 0) / 2.25, 0, 1) * 25 + impulse.impulseScore * 2)
          : Math.round(40 + impulse.impulseScore * 4),
        0,
        100
      ),

      balance: balance
        ? {
            isBalance: balance.isBalance,
            n: balance.n,
            hi: round2(balance.hi),
            lo: round2(balance.lo),
            mid: round2(balance.mid),
            width: round2(balance.width),
            widthAtr: round2(balance.widthAtr),
            overlapPct: round2(balance.overlapPct),
          }
        : null,

      impulse: {
        direction: impulse.direction,
        impulseScore: impulse.impulseScore,
        rangeAtr: impulse.rangeAtr,
        bodyPct: impulse.bodyPct,
      },

      zones,
      macroShelves,

      engine2,

      tags: defended.tags,
      defendedSupportLevels: defended.defendedSupportLevels,
      defendedResistanceLevels: defended.defendedResistanceLevels,

      layer1,
      layer2,
      layer3,

      narrativeText,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "MARKET_NARRATOR_ERROR",
      message: String(e?.message || e),
    });
  }
});

export default marketNarratorRouter;
