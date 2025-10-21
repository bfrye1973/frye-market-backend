#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Frye / Ferrari Dashboard — make_dashboard.py
Intraday 10-minute builder with:
  • Breadth (10m) = 60% Alignment (EMA10>EMA20) + 40% Bar Breadth (close>open) across 11 sector ETFs,
    smoothed L=2 and persisted across runs
  • Momentum (SPY-only) = 0.60 EMA posture (gap + fresh-cross bonus) + 0.15 SMI(10m) + 0.25 SMI(1h live rolling 60m)
  • Squeeze (10m) = Compression % on SPY 10m bars (lookback=6 bars): **100 = tight**, **0 = expanded**
  • Liquidity PSI, Volatility %ATR (plus scaled)
  • Overall(10m) uses EMA40 / Momentum25 / Breadth10 / **Squeeze10 (via Expansion = 100−Compression)** / Liquidity10 / Risk-On5

Never blank tiles; print small debug lines for Breadth inputs.
"""

from __future__ import annotations

import argparse, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

# ---------------------------- Config ----------------------------
HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"
POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

# 11 sector ETFs for Breadth 10m universe
SECTOR_ETFS = ["XLK","XLY","XLC","XLP","XLU","XLV","XLRE","XLE","XLF","XLB","XLI"]

# Squeeze parameters (10-minute candles only)
SQUEEZE_LOOKBACK_10M = 6   # 6×10m bars ≈ 1h window on 10m timeframe

# Overall weights
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60  # % distance to reach full ±40pts (EMA component)

OFFENSIVE = {"information technology","consumer discretionary","communication services"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

# ------------------------- Utils -------------------------
def now_iso_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_10m(key: str, sym: str, lookback_days: int = 4) -> List[dict]:
    """
    Fetch 10-minute bars (UTC) for a symbol; drop the in-flight bucket.
    """
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_10M_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url)
    except Exception:
        return []
    rows = js.get("results") or []
    bars = []
    for r in rows:
        try:
            t = int(r["t"]) // 1000  # ms → s
            bars.append({"time": t,
                         "open": float(r["o"]),
                         "high": float(r["h"]),
                         "low":  float(r["l"]),
                         "close":float(r["c"]),
                         "volume": float(r.get("v",0.0))})
        except Exception:
            continue
    # drop in-flight 10m bar
    BUCKET = 600
    if bars:
        now = int(time.time())
        curr_bucket = (now // BUCKET) * BUCKET
        if (bars[-1]["time"] // BUCKET) * BUCKET == curr_bucket:
            bars = bars[:-1]
    return bars

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out = []
    e = None
    for v in vals:
        e = v if e is None else e + k*(v - e)
        out.append(e)
    return out

def ema_last(vals: List[float], span: int) -> Optional[float]:
    k = 2.0 / (span + 1.0)
    e = None
    for v in vals:
        e = v if e is None else e + k*(v - e)
    return e

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1,len(C))]

def jread(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

# Persist L=2 smoothing across runs (for Breadth components)
def ema_blend(prev_val: Optional[float], new_val: Optional[float], L: int = 2) -> Optional[float]:
    if new_val is None:
        return prev_val
    if prev_val is None:
        return float(new_val)
    alpha = 2.0 / (L + 1.0)  # L=2 => 0.666...
    return float(prev_val + alpha * (float(new_val) - float(prev_val)))

# ------------------------- Slow (counts) -------------------------
def summarize_counts(cards: List[dict]) -> Tuple[float,float,float,float]:
    """
    Slow counts for daily/right panel (and as emergency fallback).
    """
    NH = NL = UP = DN = 0.0
    for c in cards or []:
        NH += float(c.get("nh",0))
        NL += float(c.get("nl",0))
        UP += float(c.get("up",0))
        DN += float(c.get("down",0))
    breadth_slow  = round(pct(NH, NH+NL), 2)
    momentum_slow = round(pct(UP, UP+DN), 2)

    # rising %
    good = total = 0
    for c in cards or []:
        bp = c.get("breadth_pct")
        if isinstance(bp,(int,float)):
            total += 1
            if bp > 50.0: good += 1
    rising = round(pct(good, total), 2)

    # risk-on (offensive >50 + defensive <50)
    by = {(c.get("sector") or "").strip().lower(): c for c in cards or []}
    score=considered=0
    for s in OFFENSIVE:
        bp = by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)):
            considered += 1
            if bp > 50.0: score += 1
    for s in DEFENSIVE:
        bp = by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)):
            considered += 1
            if bp < 50.0: score += 1
    risk_on = round(pct(score, considered), 2)
    return breadth_slow, momentum_slow, rising, risk_on

# ------------------------- SPY intraday computations -------------------------
def squeeze_raw_bbkc(H: List[float], L: List[float], C: List[float], lookback: int) -> Optional[float]:
    """
    Return BB/KC * 100 (0..100) on the last `lookback` 10m bars. **Lower = tighter**.
    """
    if min(len(H),len(L),len(C)) < lookback: return None
    n = lookback
    cn, hn, ln = C[-n:], H[-n:], L[-n:]
    mean = sum(cn)/n
    sd = (sum((x-mean)**2 for x in cn)/n) ** 0.5
    bb_w = (mean+2*sd) - (mean-2*sd)          # 4σ band width

    prevs = cn[:-1] + [cn[-1]]
    trs = [max(h-l, abs(h-p), abs(l-p)) for h,l,p in zip(hn,ln,prevs)]
    kc_w = 2.0 * (sum(trs)/len(trs)) if trs else 0.0
    if kc_w <= 0.0: return None

    ratio = 100.0 * (bb_w / kc_w)
    return clamp(ratio, 0.0, 100.0)

def liquidity_pct_spy(V: List[float]) -> Optional[float]:
    if not V: return None
    v3 = ema_last(V,3); v12 = ema_last(V,12)
    if not v12 or v12 <= 0: return 0.0
    return clamp(100.0 * (v3 / v12), 0.0, 200.0)

def volatility_pct_spy(H: List[float], L: List[float], C: List[float]) -> Optional[float]:
    if not C: return None
    if len(C) >= 2:
        trs = tr_series(H,L,C)
        atr = ema_last(trs,3) if trs else None
        if atr and C[-1] > 0: return max(0.0, 100.0 * atr / C[-1])
    else:
        tr = max(H[-1]-L[-1], abs(H[-1]-C[-1]), abs(L[-1]-C[-1]))
        if C[-1] > 0: return max(0.0, 100.0 * tr / C[-1])
    return None

# --------- SMI (EMA variant, %K=12, %D=7, EMA=5) ----------
def smi_kd(H: List[float], L: List[float], C: List[float],
           k_len: int = 12, d_len: int = 7, ema_len: int = 5) -> Tuple[Optional[float], Optional[float]]:
    n = len(C)
    if n < max(k_len, d_len) + 6:
        return None, None
    HH, LL = [], []
    for i in range(n):
        i0 = max(0, i - (k_len - 1))
        HH.append(max(H[i0:i+1]))
        LL.append(min(L[i0:i+1]))
    mid = [(HH[i] + LL[i]) / 2.0 for i in range(n)]
    rng = [(HH[i] - LL[i])        for i in range(n)]
    m = [C[i] - mid[i] for i in range(n)]
    m1 = ema_series(m, k_len);   m2 = ema_series(m1, ema_len)
    r1 = ema_series(rng, k_len); r2 = ema_series(r1, ema_len)
    k_vals = []
    for i in range(n):
        denom = (r2[i] or 0.0) / 2.0
        val = 0.0 if denom == 0 else 100.0 * (m2[i] / denom)
        if not (val == val): val = 0.0
        if val > 100: val = 100.0
        if val < -100: val = -100.0
        k_vals.append(val)
    d_vals = ema_series(k_vals, d_len)
    return float(k_vals[-1]), float(d_vals[-1])

def smi_1h_live_from_10m(bars10m: List[dict]) -> Tuple[Optional[float], Optional[float]]:
    """
    Rolling 60-minute SMI using last 6×10m bars (includes AH if present).
    """
    if len(bars10m) < 6:
        return None, None
    win = bars10m[-6:]
    H = [b["high"] for b in win]
    L = [b["low"]  for b in win]
    C = [b["close"] for b in win]
    return smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)

# --------- SPY EMA posture (gap + fresh-cross) 0..100 ----------
def spy_ema_posture_score(C: List[float], max_gap_pct: float = 0.50,
                          cross_age_10m: int = 0, max_bonus_pts: float = 6.0, fade_bars: int = 6) -> float:
    e10 = ema_series(C, 10); e20 = ema_series(C, 20)
    e10_prev, e20_prev = e10[-2], e20[-2]
    e10_now,  e20_now  = e10[-1], e20[-1]
    diff_pct = 0.0 if e20_now == 0 else 100.0 * (e10_now - e20_now) / e20_now
    sign = 1.0 if diff_pct > 0 else (-1.0 if diff_pct < 0 else 0.0)
    mag  = min(1.0, abs(diff_pct) / max_gap_pct)  # 0..1
    posture = 50.0 + 50.0 * sign * mag            # 0..100

    # fresh cross bonus decays over fade_bars
    bonus = 0.0
    age = min(max(cross_age_10m, 0), fade_bars)
    if e10_prev <= e20_prev and e10_now > e20_now:
        bonus = max_bonus_pts * (1.0 - age / fade_bars)
    elif e10_prev >= e20_prev and e10_now < e20_now:
        bonus = -max_bonus_pts * (1.0 - age / fade_bars)

    return float(clamp(posture + bonus, 0.0, 100.0))

# ------------------------- FAST Breadth/Momentum via sector ETFs -------------------------
def fast_breadth_momentum_10m(all_bars: Dict[str, List[dict]]) -> Tuple[
    Optional[float],  # alignment_raw_pct (EMA10>EMA20 across ETFs)
    Optional[float],  # bar_raw_pct       (close>open across ETFs)
    Optional[float],  # momentum_10m_pct  (legacy sector momentum)
    Optional[float],  # cross_up_10m_pct
    Optional[float],  # cross_down_10m_pct
]:
    syms = [s for s in SECTOR_ETFS if s in all_bars and len(all_bars[s]) >= 2]
    if not syms:
        return None, None, None, None, None

    total = len(syms)
    aligned_up = 0
    bar_rising = 0
    ema10_gt_ema20 = 0
    cross_up = cross_down = 0

    for s in syms:
        bars = all_bars[s]
        c_now = bars[-1]["close"]; o_now = bars[-1]["open"]
        C = [b["close"] for b in bars]
        e10 = ema_series(C, 10); e20 = ema_series(C, 20)
        e10_now, e20_now = e10[-1], e20[-1]
        e10_prev, e20_prev = e10[-2], e20[-2]

        if e10_now > e20_now: aligned_up += 1
        if c_now > o_now:     bar_rising += 1

        if e10_now > e20_now: ema10_gt_ema20 += 1
        if e10_prev <= e20_prev and e10_now > e20_now: cross_up += 1
        if e10_prev >= e20_prev and e10_now < e20_now: cross_down += 1

    alignment_raw = round(100.0 * aligned_up / total, 2)
    bar_raw       = round(100.0 * bar_rising / total, 2)

    base_mom = 100.0 * ema10_gt_ema20 / total
    up_pct   = 100.0 * cross_up / total
    dn_pct   = 100.0 * cross_down / total
    momentum_10m = round(clamp(base_mom + 0.5*up_pct - 0.5*dn_pct, 0.0, 100.0), 2)

    return alignment_raw, bar_raw, momentum_10m, round(up_pct,2), round(dn_pct,2)

# ------------------------- Overall scoring -------------------------
def lin_points(percent: float, weight: int) -> int:
    return int(round(weight * ((float(percent) - 50.0) / 50.0)))

def compute_overall10m(ema_sign: int, ema10_dist_pct: float,
                       momentum_pct: float, breadth_pct: float,
                       squeeze_compression_pct: float, liquidity_pct: float, riskon_pct: float):
    # Use **Expansion %** for scoring (100 = expanded, 0 = tight)
    squeeze_expansion_pct = clamp(100.0 - squeeze_compression_pct, 0.0, 100.0)

    dist_unit = clamp(ema10_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = round(abs(dist_unit) * W_EMA) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)
    momentum_pts = lin_points(momentum_pct, W_MOM)
    breadth_pts  = lin_points(breadth_pct,  W_BR)
    squeeze_pts  = lin_points(squeeze_expansion_pct,  W_SQ)  # expansion boosts, tight reduces
    liq_pts      = lin_points(min(100.0, clamp(liquidity_pct, 0.0, 200.0)), W_LIQ)
    riskon_pts   = lin_points(riskon_pct,   W_RISK)

    total = ema_pts + momentum_pts + breadth_pts + squeeze_pts + liq_pts + riskon_pts
    score = int(clamp(50 + total, 0, 100))
    state = "bull" if (ema_sign > 0 and score >= 60) else ("bear" if (ema_sign < 0 and score < 60) else "neutral")
    components = {"ema10": ema_pts, "momentum": momentum_pts, "breadth": breadth_pts,
                  "squeeze": squeeze_pts, "liquidity": liq_pts, "riskOn": riskon_pts}
    return state, score, components

# ------------------------- Engine Lights (unchanged logic) -------------------------
def build_engine_lights_signals(curr: dict, prev: Optional[dict], ts_local: str) -> dict:
    m  = curr.get("metrics", {})
    it = curr.get("intraday", {})
    ov = it.get("overall10m", {}) if isinstance(it, dict) else {}
    pm = (prev or {}).get("metrics", {}) if isinstance(prev, dict) else {}

    # Deltas use legacy fast keys (sector ETF alignment & momentum)
    db = (m.get("breadth_10m_pct") or 0) - (pm.get("breadth_10m_pct") or 0)
    dm = (m.get("momentum_10m_pct") or 0) - (pm.get("momentum_10m_pct") or 0)
    accel = (db or 0) + (dm or 0)

    risk_fast   = float(it.get("riskOn10m", {}).get("riskOnPct", 50.0))
    rising_fast = float(it.get("sectorDirection10m", {}).get("risingPct", 0.0))

    ACCEL_INFO = 4.0; RISK_INFO = 58.0; RISK_WARN = 42.0; THRUST_ON = 58.0; THRUST_OFF = 42.0
    sig = {}
    state = str(ov.get("state") or "neutral").lower()
    score = int(ov.get("score") or 0)

    sig["sigOverallBull"] = {"active": state == "bull" and score >= 10, "severity":"info",
                             "reason": f"state={state} score={score}",
                             "lastChanged": ts_local if state == "bull" and score >= 10 else None}
    sig["sigOverallBear"] = {"active": state == "bear" and score <= -10, "severity":"warn",
                             "reason": f"state={state} score={score}",
                             "lastChanged": ts_local if state == "bear" and score <= -10 else None}

    ema_cross = str(m.get("ema_cross") or "none")
    just_crossed = bool(ov.get("just_crossed"))
    sig["sigEMA10BullCross"] = {"active": just_crossed and ema_cross=="bull", "severity":"info",
                                "reason": f"ema_cross={ema_cross}", "lastChanged": ts_local if (just_crossed and ema_cross=='bull') else None}
    sig["sigEMA10BearCross"] = {"active": just_crossed and ema_cross=="bear", "severity":"warn",
                                "reason": f"ema_cross={ema_cross}", "lastChanged": ts_local if (just_crossed and ema_cross=='bear') else None}

    sig["sigAccelUp"]   = {"active": accel >=  ACCEL_INFO, "severity":"info",
                           "reason": f"Δb+Δm={accel:.1f}", "lastChanged": ts_local if accel >=  ACCEL_INFO else None}
    sig["sigAccelDown"] = {"active": accel <= -ACCEL_INFO, "severity":"warn",
                           "reason": f"Δb+Δm={accel:.1f}", "lastChanged": ts_local if accel <= -ACCEL_INFO else None}

    sig["sigRiskOn"]  = {"active": risk_fast >= RISK_INFO, "severity":"info",
                         "reason": f"riskOn={risk_fast:.1f}", "lastChanged": ts_local if risk_fast >= RISK_INFO else None}
    sig["sigRiskOff"] = {"active": risk_fast <= RISK_WARN, "severity":"warn",
                         "reason": f"riskOn={risk_fast:.1f}", "lastChanged": ts_local if risk_fast <= RISK_WARN else None}

    sig["sigSectorThrust"] = {"active": rising_fast >= THRUST_ON,  "severity":"info",
                              "reason": f"rising%={rising_fast:.1f}", "lastChanged": ts_local if rising_fast >= THRUST_ON else None}
    sig["sigSectorWeak"]   = {"active": rising_fast <= THRUST_OFF, "severity":"warn",
                              "reason": f"rising%={rising_fast:.1f}", "lastChanged": ts_local if rising_fast <= THRUST_OFF else None}
    return sig

# ------------------------- Core builder -------------------------
def build_intraday(source_js: Optional[dict] = None,
                   hourly_url: str = HOURLY_URL_DEFAULT,
                   prev_out: Optional[dict] = None) -> dict:

    # 1) sectorCards (backstop)
    sector_cards: List[dict] = []
    if isinstance(source_js, dict):
        sector_cards = source_js.get("sectorCards") or source_js.get("outlook", {}).get("sectorCards") or []
    if not sector_cards:
        try:
            hourly = fetch_json(hourly_url)
            sector_cards = hourly.get("sectorCards") or hourly.get("sectors") or []
        except Exception:
            sector_cards = []
    breadth_slow, momentum_slow, rising_pct, risk_on_pct = summarize_counts(sector_cards)

    # 2) Polygon 10m bars
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    bars_main: Dict[str, List[dict]] = {}
    if key:
        bars_main["SPY"] = fetch_polygon_10m(key, "SPY")
        for s in SECTOR_ETFS:
            bars_main[s] = fetch_polygon_10m(key, s)

    # 3) SPY intraday metrics
    H=L=C=V=[]
    squeeze_comp_pct = None  # Compression % (100=tight, 0=expanded)
    liquidity_pct = None; volatility_pct = None; vol_scaled = 0.0
    ema_cross="none"; just_crossed=False; ema_sign=0; ema10_dist_pct=0.0

    spy_bars = bars_main.get("SPY", [])
    if len(spy_bars) >= 2:
        H = [b["high"] for b in spy_bars]
        L = [b["low"]  for b in spy_bars]
        C = [b["close"] for b in spy_bars]
        V = [b["volume"] for b in spy_bars]

        # --- Squeeze (Compression %) on 10m bars (lookback=6) ---
        sq_raw = squeeze_raw_bbkc(H, L, C, lookback=SQUEEZE_LOOKBACK_10M)  # BB/KC * 100, low = tight
        if sq_raw is not None:
            squeeze_comp_pct = clamp(100.0 - sq_raw, 0.0, 100.0)  # 100 = tight, 0 = expanded

        liquidity_pct  = liquidity_pct_spy(V)
        volatility_pct = volatility_pct_spy(H, L, C)
        vol_scaled     = 0.0 if volatility_pct is None else round(volatility_pct * 6.25, 2)

        # EMA cross/sign/dist
        e10 = ema_series(C,10); e20 = ema_series(C,20)
        e10_prev, e20_prev = e10[-2], e20[-2]
        e10_now,  e20_now  = e10[-1], e20[-1]
        close_now = C[-1]
        if e10_prev <= e20_prev and e10_now > e20_now: ema_cross, just_crossed = "bull", True
        elif e10_prev >= e20_prev and e10_now < e20_now: ema_cross, just_crossed = "bear", True
        ema_sign = 1 if e10_now > e20_now else (-1 if e10_now < e20_now else 0)
        ema10_dist_pct = 0.0 if e10_now == 0 else 100.0 * (close_now - e10_now) / e10_now

    # --- SPY Momentum blend (EMA posture + SMI10m + SMI1h live) ---
    cross_age_10m = 0
    ema_score = spy_ema_posture_score(C, max_gap_pct=0.50, cross_age_10m=cross_age_10m,
                                      max_bonus_pts=6.0, fade_bars=6)

    smi10_k = smi10_d = smi1h_k = smi1h_d = None
    smi10_score = smi1h_score = None
    if H and L and C:
        smi10_k, smi10_d = smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)
        if smi10_k is not None and smi10_d is not None:
            smi10_score = clamp(50.0 + 0.5 * (smi10_k - smi10_d), 0.0, 100.0)
    if spy_bars:
        smi1h_k, smi1h_d = smi_1h_live_from_10m(spy_bars)
        if smi1h_k is not None and smi1h_d is not None:
            smi1h_score = clamp(50.0 + 0.5 * (smi1h_k - smi1h_d), 0.0, 100.0)

    w_ema, w_smi10, w_smi1h = 0.60, 0.15, 0.25
    if smi10_score is None and smi1h_score is None:
        momentum_combo = ema_score
    else:
        momentum_combo = (
            w_ema   * ema_score +
            w_smi10 * (smi10_score if smi10_score is not None else ema_score) +
            w_smi1h * (smi1h_score if smi1h_score is not None else ema_score)
        )
    momentum_combo = round(clamp(momentum_combo, 0.0, 100.0), 2)

    # 4) FAST Breadth/Momentum via sector ETFs
    alignment_raw = bar_raw = momentum_10m = cross_up_pct = cross_down_pct = None
    if key:
        bars_by_sym = {s: bars_main.get(s, []) for s in SECTOR_ETFS}
        alignment_raw, bar_raw, momentum_10m, cross_up_pct, cross_down_pct = fast_breadth_momentum_10m(bars_by_sym)

    if squeeze_comp_pct is None: squeeze_comp_pct = 50.0  # safe mid
    if liquidity_pct    is None: liquidity_pct    = 50.0
    if volatility_pct   is None: volatility_pct   = 0.0
    if momentum_10m     is None: momentum_10m     = momentum_slow

    # --- Breadth smoothing + 60/40 blend (persist L=2 via prev_out) ---
    prev_metrics = (prev_out or {}).get("metrics") or {}

    align_fast = ema_blend(prev_metrics.get("breadth_align_pct_fast"), alignment_raw, L=2) \
                 if alignment_raw is not None else prev_metrics.get("breadth_align_pct_fast")
    bar_fast   = ema_blend(prev_metrics.get("breadth_bar_pct_fast"),   bar_raw,       L=2) \
                 if bar_raw is not None else prev_metrics.get("breadth_bar_pct_fast")

    a_val = align_fast if align_fast is not None else alignment_raw
    b_val = bar_fast   if bar_fast   is not None else bar_raw

    if a_val is None and b_val is None:
        breadth_final = breadth_slow  # last resort
    else:
        if a_val is None: a_val = 0.0
        if b_val is None: b_val = 0.0
        breadth_final = clamp(0.60 * float(a_val) + 0.40 * float(b_val), 0.0, 100.0)
    breadth_final = round(breadth_final, 2)

    # Small debug line to Actions log
    etf_ready = sum(1 for s in SECTOR_ETFS if bars_main.get(s))
    print(f"[breadth] ETFs ready={etf_ready}/11 | align_raw={alignment_raw} | bar_raw={bar_raw} | final={breadth_final}")

    # 5) Overall (use Momentum combo; Squeeze as Expansion = 100 - Compression)
    state, score, components = compute_overall10m(
        ema_sign=ema_sign,
        ema10_dist_pct=ema10_dist_pct,
        momentum_pct=momentum_combo,
        breadth_pct=breadth_final,
        squeeze_compression_pct=squeeze_comp_pct,
        liquidity_pct=liquidity_pct,
        riskon_pct=risk_on_pct,
    )

    # 6) Pack metrics
    metrics = {
        # Breadth final + components
        "breadth_pct": breadth_final,
        "breadth_align_pct": round(alignment_raw, 2) if isinstance(alignment_raw,(int,float)) else None,
        "breadth_align_pct_fast": round(align_fast, 2) if isinstance(align_fast,(int,float)) else None,
        "breadth_bar_pct": round(bar_raw, 2) if isinstance(bar_raw,(int,float)) else None,
        "breadth_bar_pct_fast": round(bar_fast, 2) if isinstance(bar_fast,(int,float)) else None,

        # Momentum (SPY-only blended + raw)
        "momentum_pct": round(ema_score, 2),
        "momentum_combo_pct": momentum_combo,
        "smi10m": {"k": round(smi10_k,2) if smi10_k is not None else None,
                   "d": round(smi10_d,2) if smi10_d is not None else None},
        "smi1h_live": {"k": round(smi1h_k,2) if smi1h_k is not None else None,
                       "d": round(smi1h_d,2) if smi1h_d is not None else None},

        # Legacy sector-ETF momentum (for deltas/other rows)
        "momentum_10m_pct": momentum_10m,
        "cross_up_10m_pct": cross_up_pct,
        "cross_down_10m_pct": cross_down_pct,

        # Slow counts (daily/right panel)
        "breadth_slow_pct": breadth_slow,
        "momentum_slow_pct": momentum_slow,

        # EMA posture
        "ema_cross": ("bull" if just_crossed and ema_sign>0 else "bear" if just_crossed and ema_sign<0 else "none"),
        "ema10_dist_pct": round(ema10_dist_pct, 2),
        "ema_sign": int(ema_sign),

        # Gauges
        # Squeeze: Compression % (100=tight, 0=expanded) + alias for compat
        "squeeze_pct": round(squeeze_comp_pct, 2),
        "squeeze_intraday_pct": round(squeeze_comp_pct, 2),
        "liquidity_pct": round(liquidity_pct, 2),
        "liquidity_psi": round(liquidity_pct, 2),   # PSI preferred; mirror for compat if needed
        "volatility_pct": round(volatility_pct, 3),
        "volatility_scaled": 0.0 if volatility_pct is None else round(volatility_pct * 6.25, 2),
    }

    # Optional mirror: some tools expect breadth_10m_pct to be "alignment"
    if metrics.get("breadth_align_pct") is not None:
        metrics["breadth_10m_pct"] = metrics["breadth_align_pct"]

    intraday = (source_js or {}).get("intraday", {}) or {}
    intraday.setdefault("sectorDirection10m", {})
    intraday["sectorDirection10m"]["risingPct"] = rising_pct
    intraday.setdefault("riskOn10m", {})
    intraday["riskOn10m"]["riskOnPct"] = risk_on_pct
    intraday["overall10m"] = {
        "state": state,
        "score": score,
        "components": components,
        "just_crossed": bool(metrics["ema_cross"] in ("bull","bear")),
    }

    out = {
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S"),
        "updated_at_utc": now_iso_utc(),
        "timestamp": now_iso_utc(),
        "metrics": metrics,
        "intraday": intraday,
        "sectorCards": sector_cards,
    }
    return out

# ------------------------------ CLI -------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")
    ap.add_argument("--source", help="optional source json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--hourly_url", default=os.environ.get("HOURLY_URL", HOURLY_URL_DEFAULT))
    args = ap.parse_args()

    if (args.mode or "intraday").lower() != "intraday":
        print("[warn] only 'intraday' supported; continuing", file=sys.stderr)

    prev_out = jread(args.out)

    source_js = None
    if args.source and os.path.isfile(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                source_js = json.load(f)
        except Exception:
            source_js = None

    out = build_intraday(source_js=source_js, hourly_url=args.hourly_url, prev_out=prev_out)

    ts_local = out.get("updated_at") or datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        signals = build_engine_lights_signals(curr=out, prev=prev_out, ts_local=ts_local)
        out["engineLights"] = {"updatedAt": ts_local, "mode": "intraday", "live": True, "signals": signals}
    except Exception as e:
        print("[warn] engineLights build failed:", e, file=sys.stderr)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    ov = out["intraday"]["overall10m"]
    print("[ok] wrote", args.out,
          "| overall10m.state=", ov["state"], "score=", ov["score"],
          "| breadth_pct=", out["metrics"]["breadth_pct"],
          "| momentum_combo_pct=", out["metrics"]["momentum_combo_pct"],
          "| squeeze_compression_pct=", out["metrics"]["squeeze_pct"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
