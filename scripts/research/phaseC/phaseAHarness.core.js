// Phase A exploratory harness (research only; reads Replay + OHLC, writes nothing to the backend).
// Plan: claude/ENGINE3_ENGINE4_PARALLEL_JOINT_PLAN.md v2 §4b/§6. Report: PHASE_A_EXPLORATORY_REPORT_2026-11-24.md
// Environment-agnostic: give it a fetchJson(path) that resolves against the backend base URL.
//
// Provenance: Replay engine states are as-of VERIFIED. OHLC 5m bars from /api/v1/futures/ohlc are
// RETROSPECTIVE (arrival, finality, contract UNKNOWN). Results are exploratory and cannot pass §6.

export const PHASE_A_RULE = Object.freeze({
  relVolMin: 1.5, baselineBars: 20, lowerWickMin: 0.5, closeLocMin: 0.5,
  zoneFreshMs: 15 * 60 * 1000, freshLookMs: 120 * 60 * 1000, horizonBars: 288, stopPad: 0.25,
});

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const find = (o, k, d = 0) => { if (!o || typeof o !== "object" || d > 12) return undefined; if (k in o) return o[k]; for (const v of Object.values(o)) { const r = find(v, k, d + 1); if (r !== undefined) return r; } return undefined; };
export const azLabel = (ms) => new Date(ms - 7 * 3600e3).toISOString().slice(5, 16).replace("T", " ");

/** Pull compact engine states from Replay for the given days (and optional time list per day). */
export async function pullReplayRows(fetchJson, days, { strategyId = "intraday_scalp@10m", timesByDay = null, onProgress = null } = {}) {
  const rows = [];
  for (const day of days) {
    let times = timesByDay?.[day];
    if (!times) { const t = await fetchJson(`/api/v1/replay/es/times?date=${day}`); times = t.times || t.data || t; }
    for (const tm of times) {
      const s = await fetchJson(`/api/v1/replay/es/snapshot?date=${day}&time=${tm}&strategyId=${encodeURIComponent(strategyId)}`);
      const n = s?.strategies?.[strategyId] || s;
      const e3 = find(n, "engine3V5"); const z = e3?.normalizedZoneInput; const loc = find(n, "engine26LocationCandidate");
      const v1 = find(n, "participation5m"); const v2 = find(n, "engine4V2Shadow"); const perm = n?.permission?.permission;
      rows.push({ day, tm, snap: s?.snapshotTime || s?.now || null, price: loc?.currentPrice ?? null, cand: loc?.candidateId ?? null,
        zid: z?.zone?.zoneId ?? null, zlo: z?.zone?.low ?? null, zhi: z?.zone?.high ?? null, zmid: z?.zone?.midline ?? null, elig: z?.eligible ?? null,
        e3: e3?.canonical?.canonical?.direction ?? null, e3q: e3?.canonical?.canonical?.quality ?? null,
        v1: v1?.state ?? null, v2p: v2?.participationState ?? null, v2c: v2?.confirmationState ?? null, relVol: v2?.evidence?.relVol ?? null,
        e6: typeof perm === "string" ? perm : null });
      onProgress?.(`${day} ${tm} rows=${rows.length}`);
    }
  }
  return rows;
}

/** Score: Engine 3 fresh calls vs pre-registered Engine 4 zone defense. bars: [{t,o,h,l,c,v}] (t = bar start, seconds). */
export function scorePhaseA(replayRows, bars, rule = PHASE_A_RULE) {
  const all = replayRows.filter((r) => r.snap).map((r) => ({ ...r, ms: Date.parse(r.snap) })).sort((a, b) => a.ms - b.ms);
  const fresh = [];
  for (let k = 1; k < all.length; k++) { const a = all[k - 1], b = all[k]; if ((b.e3 === "LONG" || b.e3 === "SHORT") && b.e3 !== a.e3) fresh.push(b); }
  const zrows = all.filter((r) => r.zid && r.zlo != null);
  const zones = {}; zrows.forEach((r) => { zones[r.zid] = { lo: r.zlo, hi: r.zhi }; }); const zl = Object.values(zones);
  const zoneAt = (ms) => { let best = null; for (const r of zrows) { if (r.ms <= ms + 180e3) best = r; else break; } return best; };
  const outcome = (dir, entry, fromMs, lo, hi) => {
    const stop = dir === "LONG" ? lo - rule.stopPad : hi + rule.stopPad; const risk = Math.abs(entry - stop); if (!(risk > 0)) return null;
    const nz = zl.filter((z) => (dir === "LONG" ? z.lo > hi : z.hi < lo)).sort((a, b) => (dir === "LONG" ? a.lo - b.lo : b.hi - a.hi))[0];
    const tgt = nz ? (dir === "LONG" ? nz.lo : nz.hi) : (dir === "LONG" ? entry + 2 * risk : entry - 2 * risk);
    const k0 = bars.findIndex((b) => b.t * 1000 >= fromMs); if (k0 < 0) return null;
    let k = k0;
    for (; k < bars.length && k < k0 + rule.horizonBars; k++) {
      const b = bars[k];
      if (dir === "LONG") { if (b.l <= stop) return { r: -1, how: "stop" }; if (b.h >= tgt) return { r: +((tgt - entry) / risk).toFixed(2), how: "tgt" }; }
      else { if (b.h >= stop) return { r: -1, how: "stop" }; if (b.l <= tgt) return { r: +((entry - tgt) / risk).toFixed(2), how: "tgt" }; }
    }
    const last = bars[k - 1]; return { r: +(((dir === "LONG" ? last.c - entry : entry - last.c)) / risk).toFixed(2), how: "open" };
  };
  const e3Calls = fresh.map((f) => {
    const z = zoneAt(f.ms); if (!z || Math.abs(f.ms - z.ms) > rule.zoneFreshMs || f.price == null) return null;
    const outsideBy = f.price > z.zhi ? +(f.price - z.zhi).toFixed(2) : f.price < z.zlo ? -(+(z.zlo - f.price).toFixed(2)) : 0;
    return { snapshot: `${f.day} ${f.tm}`, az: azLabel(f.ms), dir: f.e3, price: f.price, zoneId: z.zid, zone: [z.zlo, z.zhi], outsideBy, R: outcome(f.e3, f.price, f.ms, z.zlo, z.zhi) };
  }).filter(Boolean);
  const e4Events = [];
  for (let j = rule.baselineBars; j < bars.length; j++) {
    const x = bars[j]; const avail = (x.t + 300) * 1000; const z = zoneAt(avail);
    if (!z || avail - z.ms > rule.zoneFreshMs) continue; if (!(x.l <= z.zhi && x.h >= z.zlo)) continue;
    const rv = x.v / median(bars.slice(j - rule.baselineBars, j).map((q) => q.v)); if (rv < rule.relVolMin) continue;
    const rng = x.h - x.l || 1e-9, lw = Math.min(x.o, x.c) - x.l, uw = x.h - Math.max(x.o, x.c), cl = (x.c - x.l) / rng, mid = z.zmid ?? (z.zlo + z.zhi) / 2;
    let side = null;
    if (x.l >= z.zlo && x.l <= mid + (z.zhi - mid) / 2 && cl >= rule.closeLocMin && x.c >= mid && lw / rng >= rule.lowerWickMin) side = "BUYERS";
    else if (x.h <= z.zhi && x.h >= mid - (mid - z.zlo) / 2 && cl <= 1 - rule.closeLocMin && x.c <= mid && uw / rng >= rule.lowerWickMin) side = "SELLERS";
    if (!side) continue;
    const dir = side === "BUYERS" ? "LONG" : "SHORT";
    const next = fresh.find((f) => f.ms >= avail - 60e3 && f.ms <= avail + rule.freshLookMs) || null;
    e4Events.push({ barStartAz: azLabel(x.t * 1000), availableAz: azLabel(avail), side, price: x.c, relVol: +rv.toFixed(2), zoneId: z.zid, zone: [z.zlo, z.zhi],
      R: outcome(dir, x.c, avail, z.zlo, z.zhi), e3Next: next ? { dir: next.e3, az: azLabel(next.ms), price: next.price, leadMin: Math.round((next.ms - avail) / 60e3), agrees: next.e3 === dir } : null });
  }
  const sum = (a) => +a.filter((x) => x.R).reduce((s, x) => s + x.R.r, 0).toFixed(2);
  const agreeLeads = e4Events.filter((e) => e.e3Next?.agrees).map((e) => e.e3Next.leadMin).sort((a, b) => a - b);
  return {
    schema: "phaseA.exploratory.v1", rule,
    provenance: { replay: "VERIFIED_AS_OF", bars: "RETROSPECTIVE_REST_ARRIVAL_FINALITY_CONTRACT_UNKNOWN" },
    summary: {
      replayRows: replayRows.length, bars: bars.length, freshE3Transitions: fresh.length,
      e3: { signals: e3Calls.length, wins: e3Calls.filter((x) => x.R?.r > 0).length, stops: e3Calls.filter((x) => x.R?.how === "stop").length, netR: sum(e3Calls) },
      e4: { signals: e4Events.length, wins: e4Events.filter((x) => x.R?.r > 0).length, stops: e4Events.filter((x) => x.R?.how === "stop").length, netR: sum(e4Events) },
      agreements: agreeLeads.length, withFollowingE3: e4Events.filter((e) => e.e3Next).length, agreeLeadMinutes: agreeLeads,
    },
    e3Calls, e4Events,
  };
}
