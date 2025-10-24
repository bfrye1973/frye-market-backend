#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard.py (Intraday 10m, R12 v5 • Lux PSI on tile + Engine Lights)

What this file does
===================
- Computes SPY EMA10/EMA20 on 10-minute bars (Polygon)
- Computes LuxAlgo Squeeze Index (PSI) on SPY 10m and 1h
- Publishes:
    * metrics.squeeze_pct           = Lux PSI 10m  (0..100, HIGH = TIGHT)  <-- used by Intraday Squeeze tile
    * metrics.squeeze_expansion_pct = 100 - PSI    (0..100, HIGH = WIDE)
    * metrics.squeeze_compression_pct = PSI        (mirror of tightness)
    * metrics.squeeze_psi_10m_pct   = Lux PSI 10m (explicit)
    * intraday.squeeze1h_pct        = Lux PSI 1h
- Keeps R12 Market Meter logic (ETF fast breadth/momentum, SMI blend, EMA posture)
- Bridges source['groups'] -> sectorCards when cards are missing; adds outlook labels
- Publishes R11-style engineLights (Overall, EMA10 crosses, Accel, RiskOn/Off, SectorThrust/Weak)
- Uses previous output once (if present) to compute acceleration deltas (Δbreadth_10m + Δmomentum_10m)

Output (JSON) is written to --out (e.g., data/outlook_intraday.json) and served by /live/intraday.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

# ============================ CONFIG ============================

VERSION_TAG = "r12.5-psi-on-tile"

HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"

POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

# 11 sector ETFs for Breadth universe
SECTOR_ETFS = [
    "XLK", "XLY", "XLC", "XLP", "XLU", "XLV", "XLRE", "XLE", "XLF", "XLB", "XLI"
]

# Canonical order + alias map for sector card names
CANON_ORDER = [
    "information technology", "materials", "health care", "communication services",
    "real estate", "energy", "consumer staples", "consumer discretionary",
    "financials", "utilities", "industrials",
]
ALIASES = {
    "healthcare": "health care", "health care": "health care", "health-care": "health care",
    "info tech": "information technology", "technology": "information technology", "tech": "information technology",
    "communications": "communication services", "comm services": "communication services", "telecom": "communication services",
    "staples": "consumer staples", "discretionary": "consumer discretionary",
    "finance": "financials", "industry": "industrials", "reit": "real estate", "reits": "real estate",
}

# Overall weights (unchanged)
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60  # % distance to reach full ±40pts on the EMA component

OFFENSIVE = {"information technology", "consumer discretionary", "communication services"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

# LuxAlgo PSI params (from the TradingView script you provided)
LUX_CONV = 50
LUX_LEN  = 20

# ============================ UTILS ============================

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "make-dashboard/1.0", "Cache-Control": "no-store"})
    with open(os.devnull, "wb"):
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_10m(key: str, sym: str, lookback_days: int = 4) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_CONSTRUCT = POLY_10M_URL.format(handwave="", sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(POLY_CONSTRUCT)
    except Exception:
        return []
    rows = js.get("results") or []
    bars: List[dict] = []
    for r in rows:
        try:
            t = int(r["id"] if "id" in r else r.get("t", 0)) // 1000
            bars.append({
                "time":   t,
                "open":   float(r.get("o", 0.0)),
                "high":   float(r.get("h", 0.0)),
                "low":    float(r.get("l", 0.0)),
                "close":  float(r.get("c", 0.0)),
                "volume": float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    # Drop in-flight 10m bar
    BUCKET = 600
    if bars:
        now = int(time.time())
        cur = (now // BUCKET) * BUCKET
        if (bars[-1]["time"] // BUCKET) * BUCKET == cur:
            bars = bars[:-1]
    return bars

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out

def ema_last(vals: List[float], span: int) -> Optional[float]:
    k = 2.0 / (span + 1.0)
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
    return e

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1, len(C))]

def jread(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def ema_blend(prev_val: Optional[float], new_val: Optional[float], L: int = 2) -> Optional[float]:
    if new_val is None:
        return prev_val
    if prev_val is None:
        return float(new_val)
    alpha = 2.0 / (L + 1.0)
    return float(prev_val + alpha * (float(new_val) - float(prev_val)))

# ======================= LuxAlgo Squeeze Index (PSI) =======================

def lux_psi_from_closes(closes: List[float], conv: int = LUX_CONV, length: int = LUX_LEN) -> float:
    """
    Port of LuxAlgo "Squeeze Index [LuxAlgo]" (PSI):
      max := max(src, max - (max - src)/conv)
      min := min(src, min + (src - min)/conv)
      diff = log(max - min)
      psi  = -50 * correlation(diff, bar_index, length) + 50
    Returns PSI on the last bar (0..100 typical; HIGH = tight)
    """
    n = len(closes)
    if n < max(length + 2, 5):
        return 50.0

    max_arr = [0.0] * n
    min_arr = [0.0] * n
    max_val = closes[0]
    min_val = closes[0]
    for i, v in enumerate(closes):
        max_val = max(v, max_val - (max_val - v) / float(conv))
        min_val = min(v, min_val + (v - min_val) / float(conv))
        max_arr[i] = max_val
        min_arr[i] = min_val

    # diff = log(span)
    diff = [0.0] * n
    for i in range(n):
        span = max(max_arr[i] - min_arr[i], 1e-12)
        diff[i] = math.log(span)

    # correlation with bar index over 'length'
    w = length
    xs = list(range(n - w, n))
    ys = diff[-w:]
    mx = sum(xs) / w
    my = sum(ys) / w
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    deny = math.sqrt(sum((y - my) ** 2 for y in ys))
    corr = (num / (denx * deny)) if (denx > 0 and deny > 0) else 0.0

    psi = -50.0 * corr + 50.0
    return float(psi)

def resample_10m_to_1h(bars_10m: List[dict]) -> List[dict]:
    """10m → 1h OHLC resample for SPY bars (close each completed 1h)."""
    if not bars_10m:
        return []
    out: List[dict] = []
    bucket = 3600
    cur_key = None
    agg = None
    for b in bars10m := bars_10m:
        t = int(b["time"])
        k = (t // bucket) * bucket
        if cur_key is None or k != cur_key:
            if agg: out.append(agg)
            agg = {"time": k, **{k2: b[k2] for k2 in ("open","high","low","close")}, "volume": b.get("volume",0.0)}
            cur_key = k
        else:
            agg["high"] = max(agg["high"], b["high"])
            agg["low"]  = min(agg["low"],  b["low"])
            agg["close"]= b["close"]
            agg["volume"] = agg.get("volume", 0.0) + b.get("volume", 0.0)
    if agg: out.append(agg)
    if out:
        now = int(time.time()); cur = (now // bucket) * bucket
        if (out[-1]["time"] // bucket) * bucket == cur:
            out = out[:-1]
    return out

# ======================= DAILY/RIGHT SIDE =======================

def summarize_counts(cards: List[dict]) -> Tuple[float, float, float, float]:
    NH = NL = UP = DN = 0.0
    for c in cards or []:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0)))
    breadth_slow  = round(pct(NH, NH + NL), 2)
    momentum_slow = round(pct(UP, DN + UP), 2)

    good = total = 0
    for c in cards or []:
        bp = c.get("breadth_pct")
        if isinstance(bp, (int, float)):
            total += 1
            if bp > 50.0: good += 1
    rising = round(pct(good, total), 2)

    by = {(c.get("sector") or "").strip().lower(): c for c in cards or []}
    score = cons = 0
    for s in OFFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            cons += 1
            if bp > 50.0: score += 1
    for s in DEFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            cons += 1
            if bp < 50.0: score += 1
    risk_on = round(pct(score, cons), 2)
    return breadth_slow, momentum_slow, rising, risk_on

# ======================= SMI (10m & 1h live) =======================

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
    rng = [(HH[i] - LL[i]) for i in range(n)]
    m = [C[i] - mid[i] for i in range(n)]
    m1 = ema_series(m, k_len)
    m2 = ema_series(m1, ema_len)
    r1 = ema_series(rng, k_len)
    r2 = ema_series(r1, ema_len)
    k_vals: List[float] = []
    for i in range(n):
        denom = (r2[i] or 0.0) / 2.0
        val = 0.0 if denom == 0 else 100.0 * (m2[i] / denom)
        if not (val == val):  # NaN guard
            val = 0.0
        val = max(-100.0, min(100.0, val))
        k_vals.append(val)
    d_vals = ema_series(k_vals, d_len)
    return float(k_vals[-1]), float(d_vals[-1])

def smi_1h_live_from_10m(bars10m: List[dict]) -> Tuple[Optional[float], Optional[float]]:
    if len(bars10m) < 6:
        return None, None
    win = bars10m[-6:]
    H = [b["high"] for b in win]
    L = [b["low"]  for b in win]
    C = [b["close"] for b in win]
    return smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)

# ======================= EMA POSTURE =======================

def spy_ema_posture_score(C: List[float], max_gap_pct: float = 0.50,
                          cross_age_10m: int = 0, max_bonus_pts: float = 6.0, fade_bars: int = 6) -> float:
    e10 = ema_series(C, 10); e20 = ema_series(C, 20)
    e10_prev, e20_prev = e10[-2], e20[-2]
    e10_now,  e20_now  = e10[-1], e20[-1]
    diff_pct = 0.0 if e20_now == 0 else 100.0 * (e10_now - e20_now) / e20_now
    sign = 1.0 if diff_pct > 0 else (-1.0 if diff_pct < 0 else 0.0)
    mag  = min(1.0, abs(diff_pct) / max_gap_pct)
    posture = 50.0 + 50.0 * sign * mag
    bonus = 0.0
    age = min(max(cross_age_10m, 0), fade_bars)
    if e10_prev <= e20_prev and e10_now > e20_now:
        bonus = max_bonus_pts * (1.0 - age / fade_bars)
    elif e10_prev >= e20_prev and e10_now < e20_now:
        bonus = -max_bonus_pts * (1.0 - age / fade_bars)
    return float(clamp(posture + bonus, 0.0, 100.0))

# ======================= FAST BREADTH & MOMENTUM =======================

def fast_components_etfs(bars_by_sym: Dict[str, List[dict]]) -> Tuple[Optional[float], Optional[float]]:
    syms = [s for s in SECTOR_ETFS if s in bars_by_sym and len(bars_by_sym[s]) >= 2]
    if not syms:
        return None, None
    total = len(syms)
    aligned_up = 0; bar_up = 0
    for s in syms:
        bars = bars_by_sym[s]
        C = [b["close"] for b in bars]
        O = [b["open"]  for b in bars]
        e10 = ema_series(C, 10); e20 = ema_series(C, 20)
        if e10[-1] > e20[-1]:
            aligned_up += 1
        if C[-1] > O[-1]:
            bar_up += 1
    return round(100.0 * aligned_up / total, 2), round(100.0 * bar_up / total, 2)

def fast_momentum_sector(bars_by_sym: Dict[str, List[dict]]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    syms = [s for s in SECTOR_ETFS if s in bars_by_sym and len(bars_by_sym[s]) >= 2]
    if not syms:
        return None, None, None
    total = len(syms)
    gt = up = dn = 0
    for s in syms:
        bars = bars_by_sym[s]
        C = [b["close"] for b in bars]
        e10 = ema_series(C, 10); e20 = ema_series(C, 20)
        if e10[-1] > e20[-1]: gt += 1
        if e10[-2] <= e20[-2] and e10[-1] > e20[-1]: up += 1
        if e10[-2] >= e20[-2] and e10[-1] < e20[-1]:  dn += 1
    base = 100.0 * gt / total
    upx  = 100.0 * up / total
    dnx  = 100.0 * dn / total
    return round(clamp(base + 0.5*upx - 0.5*dnx, 0.0, 100.0), 2), round(upx,2), round(dnx,2)

# ======================= OUTLOOK LABELS & GROUPS->CARDS =======================

def _label_outlook(card: dict) -> str:
    b = float(card.get("breadth_pct", 0.0)); m = float(card.get("momentum_pct", 0.0))
    if b >= 55.0 and m >= 55.0: return "Bullish"
    if b <= 45.0 and m <= 45.0: return "Bearish"
    return "Neutral"

def _apply_outlooks(cards: List[dict]) -> List[dict]:
    out: List[dict] = []
    for c in cards or []:
        d = dict(c); d["outlook"] = _label_outlook(d); out.append(d)
    return out

def canon_name(name: str) -> str:
    return ALIASES.get(name.strip().lower(), name.strip().lower())

def groups_to_cards(groups: Dict[str, Dict[str, int]]) -> List[dict]:
    bykey: Dict[str, dict] = {}
    for raw_name, g in (groups or {}).items():
        k = canon_name(raw_name)
        nh = int(g.get("nh", 0)); nl = int(g.get("nl", 0))
        u  = int(g.get("u", 0));  d  = int(g.get("d", 0))
        b = pct(nh, nh + nl); m = pct(u,  u + d)
        bykey[k] = {"sector": k.title(), "breadth_pct": round(b,2), "momentum_pct": round(m,2),
                    "nh": nh, "nl": nl, "up": u, "down": d}
    cards: List[dict] = []
    for name in CANON_ORDER:
        card = bykey.get(name, {"sector": name.title(), "breadth_pct": 0.0, "momentum_pct": 0.0, "nh":0,"nl":0,"up":0,"down":0})
        card["outlook"] = _label_outlook(card)
        cards.append(card)
    return cards

# ======================= OVERALL SCORE =======================

def lin_points_sym(pct_val: float, weight: int) -> int:
    return int(round(weight * ((float(pct_val) - 50.0) / 50.0)))

def compute_overall10m(ema_sign: int, ema10_dist_pct: float,
                       momentum_pct: float, breadth_pct: float,
                       squeeze_expansion_pct: float, liquidity_pct: float, riskon_pct: float):
    dist_unit = clamp(ema10_dist_pct / 0.60, -1.0, 1.0)
    ema_pts = round(abs(dist_unit) * W_EMA) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)
    m_pts  = lin_points_sym(momentum_pct, W_MOM)
    b_pts  = lin_points_sym(breadth_pct,  W_BR)
    sq_pts = lin_points_sym(squeeze_expansion_pct, W_SQ)   # expansion (wide -> positive)
    lq_pts = lin_points_sym(min(100.0, clamp(liquidity_pct, 0.0, 120.0)), W_LIQ)
    ro_pts = lin_points_sym(riskon_pct,   W_RISK)
    total  = ema_pts + m_pts + b_pts + sq_pts + lq_pts + ro_pts
    score  = int(clamp(50 + total, 0, 100))
    state  = "bull" if (ema_sign > 0 and score >= 60) else ("bear" if (ema_sign < 0 and score < 60) else "neutral")
    comps  = {"ema10": ema_pts, "momentum": m_pts, "breadth": b_pts, "squeeze": sq_pts, "liquidity": lq_pts, "riskOn": ro_pts}
    return state, score, comps

# ============================ ENGINE LIGHTS ============================

def build_engine_lights_signals(curr: dict, prev: Optional[dict], ts_local: str) -> dict:
    m  = curr.get("metrics", {})
    it = curr.get("intraday", {})
    ov = it.get("overall10m", {}) if isinstance(it, dict) else {}

    pm = (prev or {}).get("metrics") or {}
    db = (m.get("breadth_10m_pct") or 0) - (pm.get("breadth_10m_pct") or 0)
    dm = (m.get("momentum_10m_pct") or 0) - (pm.get("momentum_10m_pct") or 0)
    accel = float(db or 0) + float(dm or 0)

    risk_fast   = float(it.get("riskOn10m", {}).get("riskOnPct", 50.0))
    rising_fast = float(it.get("sectorDirection10m", {}).get("risingPct", 0.0))

    ACCEL_INFO = 4.0; RISK_INFO = 58.0; RISK_WARN = 42.0; THRUST_ON = 58.0; THRUST_OFF = 42.0

    sig = {}
    state = str(ov.get("state") or "neutral").lower()
    score = int(ov.get("score") or 0)

    sig["sigOverallBull"] = {"active": state == "bull" and score >= 10, "severity":"info",
                             "reason":f"state={state} score={score}",
                             "lastChanged": ts_local if (state=="bull" and score>=10) else None}
    sig["sigOverallBear"] = {"active": state == "bear" and score <= -10, "severity":"warn",
                             "reason":f"state={state} score={score}",
                             "lastChanged": ts_local if (state=="bear" and score<=-10) else None}

    ema_cross = str(m.get("ema_cross") or "none")
    just = bool(ov.get("just_crossed"))
    sig["sigEMA10BullCross"] = {"active": just and ema_cross=="bull", "severity":"info",
                                "reason":f"ema_cross={ema_cross}", "lastChanged": ts_local if (just and ema_cross=='bull') else None}
    sig["sigEMA10BearCross"] = {"active": just and ema_cross=="bear", "severity":"warn",
                                "reason":f"ema_cross={ema_cross}", "lastChanged": ts_local if (just and ema_cross=='bear') else None}

    sig["sigAccelUp"]   = {"active": accel >= 4.0,  "severity":"info",  "reason":f"Δb+Δm={accel:.1f}",
                           "lastChanged": ts_local if accel >= 4.0 else None}
    sig["sigAccelDown"] = {"active": accel <= -4.0, "severity":"warn",  "reason":f"Δb+Δm={accel:.1f}",
                           "lastChanged": ts_local if accel <= -4.0 else None}

    sig["sigRiskOn"]  = {"active": risk_fast >= 58.0, "severity":"info",
                         "reason":f"riskOn={risk_fast:.1f}", "lastChanged": ts_local if risk_fast >= 58.0 else None}
    sig["sigRiskOff"] = {"active": risk_fast <= 42.0, "severity":"warn",
                         "reason":f"riskOn={risk_fast:.1f}", "lastChanged": ts_local if risk_fast <= 42.0 else None}

    sig["sigSectorThrust"] = {"active": rising_fast >= 58.0, "severity":"info",
                              "reason":f"rising%={rising_fast:.1f}", "lastChanged": ts_local if rising_fast >= 58.0 else None}
    sig["sigSectorWeak"]   = {"active": rising_fast <= 42.0, "severity":"warn",
                              "reason":f"rising%={rising_fast:.1f}", "lastChanged": ts_local if rising_fast <= 42.0 else None}
    return sig

# ============================ CORE BUILDER ============================

def build_intraday(source: Optional[dict] = None, hourly_url: str = HOURLY_URL_DEFAULT, prev_out: Optional[dict]=None) -> dict:
    # 1) sectorCards (native, or groups→cards, or hourly fallback), + outlook labels
    cards: List[dict] = []
    if isinstance(source, dict):
        cards = (source.get("sectorCards") or source.get("outlook", {}).get("sectors") or [])
    if not cards and isinstance(source, dict) and "groups" in source:
        try:
            cards = groups_to_cards(source.get("groups") or {})
        except Exception:
            cards = []
    cards = _apply_outlooks(cards)
    fresh = bool(cards)
    if not cards:
        try:
            hourly = fetch_json(hourly_url)
            fallback = hourly.get("sectorCards") or hourly.get("sectors") or []
            cards = _apply_outlooks(fallback)
            fresh = False
        except Exception:
            cards = []
            fresh = False

    b_slow, m_slow, rising_pct, risk_on_pct = summarize_counts(cards)

    # 2) Fetch Polygon 10m for SPY + ETF fast comps
    key = os.getenv("POLYGON_API_KEY") or os.getenv("POLYGON_API") or os.getenv("POLYGON")
    bars_by_sym: Dict[str, List[dict]] = {}
    if key:
        bars_by_sym["SPY"] = fetch_polygon_10m(key, "SPY")
        for s in SECTOR_ETFS:
            bars_by_sym[s] = fetch_polygon_10m(key, s)

    spy_bars = bars_by_sym.get("SPY", [])

    # 3) SPY: PSI, EMA posture, vol/liquidity
    squeeze_tight_psi = None
    squeeze_exp_pct   = None
    liquidity_pct     = None
    volatility_pct    = None
    ema_cross = "none"; just_crossed = False; ema_sign = 0; ema10_dist = 0.0
    psi_1h = None

    if len(spy_bars) >= 2:
        H = [b["high"] for b in spy_bars]
        L = [b["low"]  for b in spy_bars]
        C = [b["close"] for b in spy_bars]
        V = [b["volume"] for b in spy_bars]

        squeeze_tight_psi = lux_psi_from_closes(C, conv=LUX_CONV, length=LUX_LEN)  # 0..100, high=tight
        squeeze_exp_pct   = clamp(100.0 - squeeze_tight_psi, 0.0, 100.0)

        v3 = ema_last(V, 3); v12 = ema_last(V, 12)
        liquidity_pct = 0.0 if not v12 or v12 <= 0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)

        if len(C) >= 2:
            trs = tr_series(H, L, C); atr = ema_last(trs, 3) if trs else None
            volatility_pct = 0.0 if not atr or C[-1] <= 0 else max(0.0, 100.0 * atr / C[-1])
        else:
            tr = max(H[-1]-L[-1], abs(H[-1]-C[-1]), abs(L[-1]-C[-1]))
            volatility_pct = 0.0 if C[-1] <= 0 else max(0.0, 100.0 * tr / C[-1])

        e10 = ema_series(C, 10); e20 = ema_series(C, 20)
        e10p, e20p = e10[-2], e20[-2]
        e10n, e20n = e10[-1], e20[-1]
        if e10p <= e20p and e10n > e20n:
            ema_cross, just_crossed = "bull", True
        elif e10p >= e20p and e10n < e20n:
            ema_cross, just_crossed = "bear", True
        ema_sign = 1 if e10n > e20n else (-1 if e10n < e20n else 0)
        ema10_dist = 0.0 if e10n == 0 else 100.0 * (C[-1] - e10n) / e10n

        # 1h PSI
        bars_1h = resample_10m_to_1h(spy_bars)
        C1h = [b["close"] for b in bars_1h]
        psi_1h = lux_psi_from_closes(C1h, conv=LUX_CONV, length=LUX_LEN) if len(C1h) >= (LUX_LEN+2) else 50.0

    # 4) Fast breadth/momentum and smoothing
    align_raw = bar_raw = None
    momentum_10m = None
    if key:
        align_raw, bar_raw = fast_components_etfs({s: bars_by_sym.get(s, []) for s in SECTOR_ETFS})
        m10, _, _ = fast_momentum_sector({s: bars_by_sym.get(s, []) for s in SECTOR_ETFS})
        momentum_10m = m10

    prev_metrics = (prev_out or {}).get("metrics") or {}
    align_fast = ema_blend(prev_metrics.get("breadth_align_pct_fast"), align_raw, L=2) if align_raw is not None else prev_metrics.get("breadth_align_pct_fast")
    bar_fast   = ema_blend(prev_metrics.get("breadth_bar_pct_fast"),   bar_raw,   L=2) if bar_raw   is not None else prev_metrics.get("breadth_bar_pct_fast")

    a_val = align_fast if isinstance(align_fast, (int,float)) else align_raw
    b_val = bar_fast   if isinstance(bar_fast,   (int,float)) else bar_raw
    if a_val is None and b_val is None:
        breadth_10m = b_slow
    else:
        a_v = 0.0 if a_val is None else float(a_val)
        b_v = 0.0 if b_val is None else float(b_val)
        breadth_10m = round(clamp(0.60 * a_v + 0.40 * b_v, 0.0, 100.0), 2)

    # 5) Momentum composite (EMA posture + SMI10m + SMI1h)
    momentum_combo = None
    if len(spy_bars) >= 2:
        C = [b["close"] for b in spy_bars]
        ema_score = spy_ema_posture_score(C, max_gap_pct=0.50, cross_age_10m=0, max_bonus_pts=6.0, fade_bars=6)
        H = [b["high"] for b in spy_bars]; L = [b["low"] for b in spy_bars]
        k10, d10 = smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)
        k1h, d1h = smi_1h_live_from_10m(spy_bars)
        s10 = None if (k10 is None or d10 is None) else clamp(50.0 + 0.5*(k10 - d10), 0.0, 100.0)
        s1h = None if (k1h is None or d1h is None) else clamp(50.0 + 0.5*(k1h - d1h), 0.0, 100.0)
        if s10 is None and s1h is None:
            momentum_combo = ema_score
        else:
            wE, w10, w1h = 0.60, 0.15, 0.25
            momentum_combo = (wE * ema_score
                              + w10 * (s10 if s10 is not None else ema_score)
                              + w1h * (s1h if s1h is not None else ema_score))
    if momentum_combo is None:
        momentum_combo = m_slow
    momentum_combo = round(clamp(momentum_combo, 0.0, 100.0), 2)
    if momentum_10m is None:
        momentum_10m = m_slow

    if squeeze_tight_psi is None:
        squeeze_tight_psi = 50.0
    if squeeze_exp_pct is None:
        squeeze_exp_pct = 50.0
    if liquidity_pct   is None:
        liquidity_pct   = 50.0
    if volatility_pct  is None:
        volatility_pct  = 0.0

    # 6) Overall score (uses EXPANSION % for the squeeze contribution)
    state, score, comps = compute_overall10m(
        ema_sign=ema_sign,
        ema10_dist_pct=ema10_dist,
        momentum_pct=momentum_combo,
        breadth_pct=breadth_10m,
        squeeze_expansion_pct=squeeze_exp_pct,
        liquidity_pct=liquidity_pct,
        riskon_pct=risk_on_pct,
    )

    # 7) Metrics (publish PSI + expansion/compression with correct mapping)
    metrics = {
        # fast / blended breadth & momentum
        "breadth_10m_pct": round(float(breadth_10m), 2),
        "breadth_align_pct": round(float(align_raw), 2) if isinstance(align_raw,(int,float)) else None,
        "breadth_align_pct_fast": round(float(align_fast), 2) if isinstance(align_fast,(int,float)) else None,
        "breadth_bar_pct": round(float(bar_raw), 2) if isinstance(bar_raw,(int,float)) else None,
        "breadth_bar_pct_fast": round(float(bar_fast), 2) if isinstance(bar_fast,(int,float)) else None,

        "momentum_combo_pct": round(float(momentum_combo), 2),
        "momentum_10m_pct": round(float(momentum_10m), 2),

        # slow snapshot (from cards)
        "breadth_slow_pct": round(float(b_slow), 2),
        "momentum_slow_pct": round(float(m_slow), 2),

        # EMA posture
        "ema_cross": ("bull" if just_crossed and ema_sign>0 else "bear" if just_crossed and ema_sign<0 else "none"),
        "ema10_dist_pct": round(float(ema10_dist), 2),
        "ema_sign": int(ema_sign),

        # Lux PSI + Expansion/Compression (FIXED MAPPING)
        "squeeze_psi_10m_pct": round(float(squeeze_tight_psi), 2),          # explicit Lux PSI (10m)
        "squeeze_pct":          round(float(squeeze_tight_psi), 2),          # TILE → PSI (tightness 0..100)
        "squeeze_expansion_pct": round(float(100.0 - squeeze_tight_psi), 2), # 100 - PSI (wide bands)
        "squeeze_compression_pct": round(float(squeeze_tight_psi), 2),       # alias to PSI

        # Liquidity / Volatility
        "liquidity_psi": round(float(liquidity_pct), 2),
        "liquidity_pct": round(float(liquidity_pct), 2),
        "volatility_pct": round(float(volatility_pct), 3),
        "volatility_scaled": 0.0 if volatility_pct is None else round(float(volatility_pct) * 6.25, 2),
    }

    # 8) Intraday block
    intraday = (source or {}).get("intraday", {}) or {}
    intraday.setdefault("sectorDirection10m", {})
    intraday["sectorDirection10m"]["risingPct"] = float(rising_pct)
    intraday.setdefault("riskOn10m", {})
    intraday["riskOn10m"]["riskOnPct"] = float(risk_on_pct)

    intraday["overall10m"] = {
        "state": state,
        "score": score,
        "components": comps,
        "just_crossed": bool(metrics["squeeze_psi_10m_pct"] is not None and metrics["ema_cross"] in ("bull","bear")),
    }

    # Lux PSI (1h) for right-side legend / downstream use
    intraday["squeeze1h_pct"] = None if psi_1h is None else round(float(psi_1h), 2)
    intraday["squeeze_meta"]  = {"conv": LUX_CONV, "length": LUX_LEN, "source": "LuxAlgo PSI"}

    return {
        "version": VERSION_TAG,
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": now_utc_iso(),
        "timestamp": now_utc_iso(),
        "metrics": metrics,
        "intraday": intraday,
        "sectorCards": cards,
        "meta": {"cards_fresh": bool(fresh)}
    }

# ============================ CLI ============================

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="")               # optional input (e.g., data/outlook_source.json)
    ap.add_argument("--out",    required=True)            # e.g., data/outlook_intraday.json
    ap.add_argument("--hourly_url", default=HOURLY_URL_DEFAULT)
    args = ap.parse_args()

    # Read previous output to compute deltas (acceleration) and maintain fast smoothing
    prev_out = jread(args.out)

    source = None
    if args.source and os.path.exists(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                source = json.load(f)
        except Exception:
            source = None

    out = build_intraday(source=source, hourly_url=args.hourly_url, prev_out=prev_out)

    # Build Engine Lights
    ts_local = out.get("updated_at") or datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    try:
        sig = build_engine_lights_signals(curr=out, prev=prev_out, ts_local=ts_local)
        out["engineLights"] = {"updatedAt": ts_local, "mode": "intraday", "live": True, "signals": sig}
    except Exception as e:
        print("[warn] engineLights build failed:", e, file=sys.stderr)

    # Persist
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    ov = out["intraday"]["overall10m"]
    print("[ok] wrote", args.out,
          "| version=", out.get("version"),
          "| overall10m.state=", ov["state"], "score=", ov["score"],
          "| breadth_10m_pct=", out["metrics"]["breadth_10m_pct"],
          "| momentum_combo_pct=", out["metrics"]["momentum_pct"] if "momentum_pct" in out["metrics"] else out["metrics"]["momentum_combo_pct"],
          "| squeeze_psi_10m_pct=", out["metrics"]["squeeze_psi_10m_pct"],
          "| squeeze_expansion_pct=", out["metrics"]["squeeze_expansion_pct"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(1)
