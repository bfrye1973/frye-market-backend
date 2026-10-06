import { polygonListOptionContracts, polygonOptionsChainSnapshot, polygonLastTrade } from "./polygonClient.js";

const ALLOW_SYMBOL = "SPY";

// Strategy windows (locked)
const STRATEGIES = {
  "intraday_scalp@10m": { exp: "NEAREST", strikeMode: "SCALP_PLUS_ONE", window: 0 },
  "minor_swing@1h":     { exp: "SWING_7_14", strikeMode: "OI_VOL", window: 5 },
  "intermediate_long@4h": { exp: "LONG_28_35", strikeMode: "OI_VOL", window: 10 }
};

function todayYMD() {
  const d = new Date();
  // use UTC date to keep consistent on Render; you can pin TZ later if desired
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function addDaysYMD(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function absDaysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = new Date(Date.UTC(ay, am - 1, ad));
  const db = new Date(Date.UTC(by, bm - 1, bd));
  return Math.abs((db - da) / (24 * 3600 * 1000));
}

function isBetweenInclusive(x, lo, hi) {
  return x >= lo && x <= hi;
}

function normalizeRightFromBias(bias) {
  return bias === "BEAR" ? "PUT" : "CALL";
}

function clampSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (s !== ALLOW_SYMBOL) throw new Error("SPY_ONLY_LOCKED");
  return s;
}

function normalizeChainRow(r) {
  // Polygon snapshot response fields can vary by plan; we normalize defensively.
  // expected: r.details.strike_price, r.details.expiration_date, r.details.contract_type, r.details.ticker
  const details = r?.details || {};
  const strike = Number(details.strike_price ?? r?.strike_price);
  const exp = String(details.expiration_date ?? r?.expiration_date ?? "");
  const contractType = String(details.contract_type ?? r?.contract_type ?? "").toUpperCase(); // CALL/PUT
  const contractSymbol = String(details.ticker ?? r?.ticker ?? "");

  const day = r?.day || {};
  const volume = Number(day.volume ?? day.v ?? r?.volume ?? 0) || 0;

  const oi =
    Number(r?.open_interest ?? r?.openInterest ?? details.open_interest ?? details.openInterest ?? 0) || 0;

  // quote data (may be absent depending on plan)
  const lastQuote = r?.last_quote || r?.lastQuote || {};
  const bid = Number(lastQuote.bid ?? lastQuote.p ?? 0) || 0;
  const ask = Number(lastQuote.ask ?? lastQuote.P ?? 0) || 0;
  const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : (bid || ask || 0);

  return {
    contractSymbol,
    exp,
    right: contractType === "PUT" ? "PUT" : "CALL",
    strike,
    bid: bid || null,
    ask: ask || null,
    mid: mid || null,
    volume,
    openInterest: oi
  };
}

function rank01(values) {
  // rank each value in list to [0,1] based on order (ties handled by average rank)
  const sorted = [...values].slice().sort((a, b) => a - b);
  const n = sorted.length;
  const map = new Map();
  for (let i = 0; i < n; i++) {
    // for duplicates, we want average of first/last index; easiest: store all indices
    const v = sorted[i];
    if (!map.has(v)) map.set(v, []);
    map.get(v).push(i);
  }
  const out = new Map();
  for (const [v, idxs] of map.entries()) {
    const avg = idxs.reduce((s, x) => s + x, 0) / idxs.length;
    out.set(v, n === 1 ? 1 : avg / (n - 1));
  }
  return out; // Map(value->rank01)
}

function chooseByOiVol({ rows, atmStrike, window }) {
  const minS = atmStrike - window;
  const maxS = atmStrike + window;
  const cands = rows.filter(r => r.strike >= minS && r.strike <= maxS && Number.isFinite(r.strike));

  if (!cands.length) return null;

  const oiVals = cands.map(r => r.openInterest || 0);
  const volVals = cands.map(r => r.volume || 0);

  const oiRank = rank01(oiVals);
  const volRank = rank01(volVals);

  let best = null;
  for (const r of cands) {
    const oiR = oiRank.get(r.openInterest || 0) ?? 0;
    const volR = volRank.get(r.volume || 0) ?? 0;

    const score = 0.6 * oiR + 0.4 * volR;
    const distPenalty = 0.05 * Math.abs(r.strike - atmStrike);
    const finalScore = score - distPenalty;

    const cand = { ...r, _score: finalScore, _scoreParts: { oiR, volR, distPenalty } };

    if (!best) best = cand;
    else {
      if (cand._score > best._score) best = cand;
      else if (cand._score === best._score) {
        // tie-breakers
        if ((cand.openInterest || 0) > (best.openInterest || 0)) best = cand;
        else if ((cand.openInterest || 0) === (best.openInterest || 0)) {
          if ((cand.volume || 0) > (best.volume || 0)) best = cand;
          else if ((cand.volume || 0) === (best.volume || 0)) {
            const dc = Math.abs(cand.strike - atmStrike);
            const db = Math.abs(best.strike - atmStrike);
            if (dc < db) best = cand;
            else if (dc === db) {
              if (cand.strike < best.strike) best = cand;
            }
          }
        }
      }
    }
  }
  return best;
}

export async function optionsStatus() {
  const keyPresent = !!process.env.POLYGON_API_KEY;
  return {
    ok: true,
    engine: "options-chain",
    provider: "polygon",
    spyOnly: true,
    polygonKeyPresent: keyPresent,
    ts: new Date().toISOString()
  };
}

export async function listExpirations(symbol) {
  const sym = clampSymbol(symbol);

  const expirations = new Set();
  let nextUrl = null;

  // We use the contracts reference endpoint and extract unique expiration_date. :contentReference[oaicite:2]{index=2}
  do {
    const res = await polygonListOptionContracts({
      underlying_ticker: sym,
      expired: false,
      limit: 1000,
      sort: "expiration_date",
      order: "asc",
      next_url: nextUrl
    });

    for (const c of res.results || []) {
      if (c.expiration_date) expirations.add(c.expiration_date);
    }

    nextUrl = res.next_url || null;
  } while (nextUrl);

  const list = [...expirations].sort();
  return { ok: true, symbol: sym, expirations: list };
}

export async function getChain({ symbol, exp, right }) {
  const sym = clampSymbol(symbol);
  if (!exp) return { ok: false, reason: "MISSING_EXP" };

  const r = String(right || "CALL").toUpperCase();
  const contract_type = r === "PUT" ? "put" : "call";

  // Underlying last trade (spot)
  const spot = await polygonLastTrade(sym);

  // Use chain snapshot endpoint. :contentReference[oaicite:3]{index=3}
  // We page until we have a decent chunk. UI can filter further.
  const rows = [];
  let nextUrl = null;

  do {
    const snap = await polygonOptionsChainSnapshot({
      underlying: sym,
      expiration_date: exp,
      contract_type,
      limit: 250,
      sort: "strike_price",
      order: "asc",
      next_url: nextUrl
    });

    for (const item of snap.results || []) {
      const row = normalizeChainRow(item);
      if (Number.isFinite(row.strike)) rows.push(row);
    }

    nextUrl = snap.next_url || null;

    // Safety: don't pull infinite pages on SPY mega chains
    if (rows.length >= 1500) break;
  } while (nextUrl);

  // de-dupe by contractSymbol
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    if (!row.contractSymbol) continue;
    if (seen.has(row.contractSymbol)) continue;
    seen.add(row.contractSymbol);
    deduped.push(row);
  }

  deduped.sort((a, b) => a.strike - b.strike);

  return {
    ok: true,
    symbol: sym,
    exp,
    right: r,
    underlying: spot,
    chain: deduped
  };
}

function pickExpirationForStrategy(strategyId, expirations) {
  const strat = STRATEGIES[strategyId];
  if (!strat) throw new Error("UNKNOWN_STRATEGY_ID");

  const today = todayYMD();

  if (strat.exp === "NEAREST") {
    // earliest exp >= today
    const e = expirations.find(x => x >= today);
    return e || expirations[0] || null;
  }

  if (strat.exp === "SWING_7_14") {
    const lo = addDaysYMD(today, 7);
    const hi = addDaysYMD(today, 14);
    const target = addDaysYMD(today, 10);

    const inWindow = expirations.filter(x => x >= lo && x <= hi);
    if (inWindow.length) {
      inWindow.sort((a, b) => absDaysBetween(a, target) - absDaysBetween(b, target));
      return inWindow[0];
    }

    // fallback: first exp after hi
    return expirations.find(x => x > hi) || expirations[expirations.length - 1] || null;
  }

  if (strat.exp === "LONG_28_35") {
    const lo = addDaysYMD(today, 28);
    const hi = addDaysYMD(today, 35);
    const target = addDaysYMD(today, 30);

    const inWindow = expirations.filter(x => x >= lo && x <= hi);
    if (inWindow.length) {
      inWindow.sort((a, b) => absDaysBetween(a, target) - absDaysBetween(b, target));
      return inWindow[0];
    }

    return expirations.find(x => x > hi) || expirations[expirations.length - 1] || null;
  }

  throw new Error("UNSUPPORTED_STRATEGY_EXP_RULE");
}

function findNearestStrike(rows, targetStrike) {
  if (!rows.length) return null;
  let best = null;
  for (const r of rows) {
    if (!Number.isFinite(r.strike)) continue;
    const d = Math.abs(r.strike - targetStrike);
    if (!best || d < best._d) best = { ...r, _d: d };
    else if (d === best._d) {
      // prefer higher OI then volume, then closer to ATM tie-break
      if ((r.openInterest || 0) > (best.openInterest || 0)) best = { ...r, _d: d };
      else if ((r.openInterest || 0) === (best.openInterest || 0)) {
        if ((r.volume || 0) > (best.volume || 0)) best = { ...r, _d: d };
      }
    }
  }
  return best ? (delete best._d, best) : null;
}

export async function selectContract({ symbol, strategyId, bias }) {
  const sym = clampSymbol(symbol);
  const strat = STRATEGIES[strategyId];
  if (!strat) return { ok: false, reason: "UNKNOWN_STRATEGY_ID" };

  const biasNorm = String(bias || "BULL").toUpperCase();
  const right = normalizeRightFromBias(biasNorm); // BULL=>CALL, BEAR=>PUT

  const expListRes = await listExpirations(sym);
  const expirations = expListRes.expirations || [];
  if (!expirations.length) return { ok: false, reason: "NO_EXPIRATIONS" };

  const exp = pickExpirationForStrategy(strategyId, expirations);
  if (!exp) return { ok: false, reason: "NO_EXP_PICKED" };

  // pull chain for that exp/right
  const chainRes = await getChain({ symbol: sym, exp, right });
  if (!chainRes.ok) return chainRes;

  const spotLast = Number(chainRes.underlying?.last ?? chainRes.underlying?.price ?? chainRes.underlying?.lastPrice);
  const spot = Number.isFinite(spotLast) ? spotLast : null;

  const rows = chainRes.chain || [];
  if (!rows.length) return { ok: false, reason: "EMPTY_CHAIN", exp, right };

  // compute ATM strike based on spot (fallback to median strike if spot missing)
  const atm = spot != null ? Math.round(spot) : rows[Math.floor(rows.length / 2)].strike;

  // Strike selection rules
  let selected = null;
  let why = {};

  if (strat.strikeMode === "SCALP_PLUS_ONE") {
    if (spot == null) {
      // fallback to nearest ATM+1
      selected = findNearestStrike(rows, atm + 1);
      why = { mode: "SCALP_PLUS_ONE_FALLBACK_NO_SPOT", atm };
    } else {
      const targetStrike = Math.floor(spot) + 1; // locked $1 above SPY
      selected = findNearestStrike(rows, targetStrike);
      why = { mode: "SCALP_PLUS_ONE", spot, targetStrike };
    }
  } else if (strat.strikeMode === "OI_VOL") {
    const best = chooseByOiVol({ rows, atmStrike: atm, window: strat.window });
    selected = best;
    why = {
      mode: "OI_VOL_SCORING",
      atm,
      window: strat.window,
      weights: { oi: 0.6, volume: 0.4, distPenaltyPerDollar: 0.05 },
      scoreParts: best?._scoreParts || null
    };
    if (selected && "_score" in selected) delete selected._score;
    if (selected && "_scoreParts" in selected) delete selected._scoreParts;
  } else {
    return { ok: false, reason: "UNSUPPORTED_STRIKE_MODE" };
  }

  if (!selected) return { ok: false, reason: "NO_CONTRACT_SELECTED", exp, right };

  return {
    ok: true,
    symbol: sym,
    strategyId,
    bias: biasNorm,
    right,
    exp,
    underlyingLast: spot,
    atmStrike: atm,
    selected,
    why
  };
}
