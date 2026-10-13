#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — compute_trend10m.py (R12.7 Fast Bee Engine)

Post-processes data/outlook_intraday.json to compute:

- metrics.breadth_10m_pct        (fast ETF breadth)
- metrics.momentum_10m_pct
- metrics.momentum_combo_10m_pct
- metrics.squeeze_psi_10m_pct    (Lux PSI tightness 0..100)
- metrics.squeeze_pct            (expansion 0..100 = 100 - psi)
- metrics.squeeze_expansion_pct  (same as squeeze_pct)
- metrics.liquidity_psi          (vol EMA3/EMA12)
- metrics.volatility_pct         (ATR3 % on 10m)
- metrics.breadth_align_fast_pct (QA)
- metrics.riskOn_10m_pct

- intraday.sectorDirection10m.risingPct  (breadth>=55 & momentum>=55)
- intraday.riskOn10m.riskOnPct           (offense>=55, defense<=45)
- intraday.overall10m.{state,score,components,lastChanged}
- engineLights["10m"] mirror of overall10m
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

INTRADAY_PATH = "data/outlook_intraday.json"
INTRADAY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/intraday"

POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

SECTOR_ETFS = {
    "XLK": "information technology",
    "XLB": "materials",
    "XLV": "health care",
    "XLC": "communication services",
    "XLRE": "real estate",
    "XLE": "energy",
    "XLP": "consumer staples",
    "XLY": "consumer discretionary",
    "XLF": "financials",
    "XLU": "utilities",
    "XLI": "industrials",
}

OFFENSIVE = {"information technology", "consumer discretionary", "communication services", "industrials"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

# Overall weights (same as 1h/EOD)
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 15, 10, 10, 5
FULL_EMA_DIST = 0.60

# ------------------------------ Helpers ------------------------------

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def pct(a: float, b: float) -> float:
    try:
        if b <= 0:
            return 0.0
        return 100.0 * float(a) / float(b)
    except Exception:
        return 0.0

def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_json(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"compute-trend10m/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_bars(sym: str, lookback_days: int = 5) -> List[dict]:
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLY_API")
    if not key:
        print("[10m] WARNING: no Polygon key found in env", file=sys.stderr)
        return []
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_10M_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url, timeout=25)
    except Exception as e:
        print(f"[10m] Polygon fetch error for {sym}: {e}", file=sys.stderr)
        return []
    rows = js.get("results") or []
    out: List[dict] = []
    for r in rows:
        try:
            t = int(r.get("t", 0)) // 1000
            out.append({
                "time": t,
                "open": float(r.get("o", 0)),
                "high": float(r.get("h", 0)),
                "low":  float(r.get("l", 0)),
                "close":float(r.get("c", 0)),
                "volume": float(r.get("v", 0)),
            })
        except Exception:
            continue
    # drop in-flight bar
    if out:
        bucket = 600
        now = int(time.time())
        cur  = (now // bucket) * bucket
        if (out[-1]["time"] // bucket) * bucket == cur:
            out = out[:-1]
    return out

def ema_series(values: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in values:
        e = v if e is None else e + k*(v - e)
        out.append(e)
    return out

def ema_last(values: List[float], span: int) -> Optional[float]:
    if not values:
        return None
    return ema_series(values, span)[-1]

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1, len(C))]

def smi_kd(H: List[float], L: List[float], C: List[float],
           k_len: int = 12, d_len: int = 7, ema_len: int = 5) -> Tuple[List[float], List[float]]:
    n = len(C)
    if n < max(k_len, d_len) + 6:
        return [], []
    HH=[]; LL=[]
    for i in range(n):
        i0 = max(0, i - (k_len - 1))
        HH.append(max(H[i0:i+1])); LL.append(min(L[i0:i+1]))
    mid=[(HH[i]+LL[i])/2.0 for i in range(n)]
    rng=[(HH[i]-LL[i]) for i in range(n)]
    m=[C[i]-mid[i] for i in range(n)]

    def ema_vals(vals, span):
        k = 2.0 / (span + 1.0)
        e=None; out=[]
        for v in vals:
            e = v if e is None else e + k*(v - e)
            out.append(e)
        return out

    m1 = ema_vals(m, k_len)
    m2 = ema_vals(m1, ema_len)
    r1 = ema_vals(rng, k_len)
    r2 = ema_vals(r1, ema_len)

    K=[]
    for i in range(n):
        denom = (r2[i] or 0.0)/2.0
        v = 0.0 if denom==0 else 100.0*(m2[i]/denom)
        if not (v==v): v = 0.0
        K.append(max(-100.0,min(100.0,v)))

    D=[]
    k = 2.0/(d_len+1.0)
    e=None
    for v in K:
        e = v if e is None else e + k*(v - e)
        D.append(e)
    return K, D

# --- NEW: Lux PSI based on high-low range, matching EOD equation ---------

def lux_psi_from_hl(H: List[float], L: List[float], length: int = 20) -> Optional[float]:
    """
    Lux PSI tightness (0..100) based on correlation of log(high-low) vs bar index.
    psi = -50 * corr(log(range), bar_index, length) + 50
    """
    n = len(H)
    if n < length + 2:
        return None

    # last `length` bars
    rng = []
    for h, l in zip(H[-length:], L[-length:]):
        span = max(float(h) - float(l), 1e-12)
        rng.append(math.log(span))

    xs = list(range(length))
    xbar = sum(xs) / length
    ybar = sum(rng) / length

    num = sum((x - xbar) * (y - ybar) for x, y in zip(xs, rng))
    den_x = math.sqrt(sum((x - xbar) ** 2 for x in xs))
    den_y = math.sqrt(sum((y - ybar) ** 2 for y in rng))
    if not den_x or not den_y:
        return None

    corr = num / (den_x * den_y)
    psi = -50.0 * corr + 50.0
    return float(clamp(psi, 0.0, 100.0))

def lin_points(pct_val: float, weight: int) -> int:
    return int(round(weight * ((float(pct_val) - 50.0) / 50.0)))

def compute_overall10m(ema_sign: int, ema10_dist_pct: float,
                       momentum_pct: float, breadth_pct: float,
                       squeeze_expansion_pct: float, liquidity_pct: float,
                       riskon_pct: float) -> Tuple[str, int, dict]:
    dist_unit = clamp(ema10_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = int(round(abs(dist_unit) * W_EMA)) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)
    m_pts  = lin_points(momentum_pct, W_MOM)
    b_pts  = lin_points(breadth_pct,  W_BR)
    sq_pts = lin_points(squeeze_expansion_pct, W_SQ)
    lq_pts = lin_points(min(100.0, clamp(liquidity_pct, 0.0, 120.0)), W_LIQ)
    ro_pts = lin_points(riskon_pct, W_RISK)
    score  = int(clamp(50 + ema_pts + m_pts + b_pts + sq_pts + lq_pts + ro_pts, 0, 100))
    state  = "bull" if (ema_sign > 0 and score >= 60) else ("bear" if (ema_sign < 0 and score < 60) else "neutral")
    comps  = {"ema10": ema_pts, "momentum": m_pts, "breadth": b_pts, "squeeze": sq_pts, "liquidity": lq_pts, "riskOn": ro_pts}
    return state, score, comps

# ------------------------------ Core logic ------------------------------

def compute_10m():
    j = load_json(INTRADAY_PATH)
    if not j:
        print("[10m] intraday JSON missing")
        return

    metrics = j.get("metrics") or {}
    intraday = j.get("intraday") or {}
    cards = j.get("sectorCards") or []
    prev_js = {}
    try:
        prev_js = fetch_json(INTRADAY_URL_DEFAULT) or {}
    except Exception:
        prev_js = {}

    # Aggregate sector NH/NL/UP/DOWN for slow breadth/momentum
    NH = NL = UP = DN = 0.0
    for c in cards:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0))
    breadth_slow = round(pct(NH, NH+NL), 2) if (NH+NL) > 0 else 50.0
    momentum_slow = round(pct(UP, UP+DN), 2) if (UP+DN) > 0 else 50.0

    # Fast breadth via sector ETFs (EMA10>20 + bar up)
    etf_bars: Dict[str, List[dict]] = {}
    for sym in SECTOR_ETFS.keys():
        etf_bars[sym] = fetch_polygon_bars(sym, lookback_days=5)

    aligned = barup = total = 0
    for sym, bars in etf_bars.items():
        if len(bars) < 2:
            continue
        C = [b["close"] for b in bars]
        O = [b["open"]  for b in bars]
        e10 = ema_series(C, 10)
        e20 = ema_series(C, 20)
        total += 1
        if e10[-1] > e20[-1]:
            aligned += 1
        if C[-1] > O[-1]:
            barup += 1

    align_pct = pct(aligned, total)
    barup_pct = pct(barup, total)
    breadth_fast = clamp(0.60*align_pct + 0.40*barup_pct, 0.0, 100.0)
    metrics["breadth_align_fast_pct"] = round(align_pct,2)
    metrics["breadth_10m_pct"] = round(breadth_fast,2)

    # SPY 10m bars
    spy_10m = fetch_polygon_bars("SPY", lookback_days=5)
    ema_sign = 0
    ema_gap_pct = 0.0
    momentum_combo_10m = 50.0
    e8 = e18 = []
    k10 = d10 = []

    if len(spy_10m) >= 6:
        H = [b["high"] for b in spy_10m]
        L = [b["low"]  for b in spy_10m]
        C = [b["close"] for b in spy_10m]

        e8  = ema_series(C, 8)
        e18 = ema_series(C, 18)
        ema_gap_pct = 0.0 if e18[-1] == 0 else 100.0 * (e8[-1] - e18[-1]) / e18[-1]
        ema_sign = 1 if e8[-1] > e18[-1] else (-1 if e8[-1] < e18[-1] else 0)

        # EMA posture
        ema_posture = clamp(50.0 + 50.0 * clamp(ema_gap_pct / FULL_EMA_DIST, -1.0, 1.0), 0.0, 100.0)

        # SMI(10m)
        k10, d10 = smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)
        smi10 = None
        if k10 and d10:
            smi10 = clamp(50.0 + 0.5*(k10[-1] - d10[-1]), 0.0, 100.0)
        if smi10 is None:
            momentum_combo_10m = ema_posture
        else:
            momentum_combo_10m = clamp(0.70*ema_posture + 0.30*smi10, 0.0, 100.0)

    metrics["momentum_10m_pct"]       = round(momentum_combo_10m,2)
    metrics["momentum_combo_10m_pct"] = round(momentum_combo_10m,2)
    metrics["ema_sign"]   = int(ema_sign)
    metrics["ema_gap_pct"]= round(ema_gap_pct,3)

    # Lux PSI Squeeze 10m — MATCH EOD EQUATION
    squeeze_psi_10m = None
    squeeze_exp = 50.0
    if len(spy_10m) >= 25:
        H = [b["high"] for b in spy_10m]
        L = [b["low"]  for b in spy_10m]
        psi = lux_psi_from_hl(H, L, length=20)
        if isinstance(psi, (int, float)):
            squeeze_psi_10m = psi
            squeeze_exp = clamp(100.0 - psi, 0.0, 100.0)

    metrics["squeeze_psi_10m_pct"]   = round(squeeze_psi_10m,2) if isinstance(squeeze_psi_10m,(int,float)) else None
    metrics["squeeze_expansion_pct"] = round(squeeze_exp,2)
    metrics["squeeze_pct"]           = metrics["squeeze_expansion_pct"]

    # Liquidity & Volatility 10m
    liquidity_psi = 50.0
    volatility_pct = 0.0
    if len(spy_10m) >= 2:
        V = [b["volume"] for b in spy_10m]
        v3  = ema_last(V, 3)
        v12 = ema_last(V, 12)
        liquidity_psi = 0.0 if not v12 or v12 <= 0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)
        C = [b["close"] for b in spy_10m]
        H = [b["high"]  for b in spy_10m]
        L = [b["low"]   for b in spy_10m]
        trs = tr_series(H, L, C)
        atr3 = ema_last(trs, 3) if trs else None
        volatility_pct = 0.0 if not atr3 or C[-1] <= 0 else max(0.0, 100.0*atr3/C[-1])

    metrics["liquidity_psi"]  = round(liquidity_psi,2)
    metrics["volatility_pct"] = round(volatility_pct,3)

    # SectorDir10m & RiskOn10m from sectorCards
    rising_good = rising_total = 0
    for c in cards:
        bp = c.get("breadth_pct")
        mp = c.get("momentum_pct")
        if isinstance(bp,(int,float)) and isinstance(mp,(int,float)):
            rising_total += 1
            if bp >= 55.0 and mp >= 55.0:
                rising_good += 1
    rising_pct = round(pct(rising_good, rising_total),2) if rising_total>0 else 50.0

    by = {(c.get("sector") or "").strip().lower(): c for c in cards}
    ro_score = ro_den = 0
    for s in OFFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp,(int,float)):
            ro_den += 1
            if bp >= 55.0:
                ro_score += 1
    for s in DEFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp,(int,float)):
            ro_den += 1
            if bp <= 45.0:
                ro_score += 1
    risk_on_10m = round(pct(ro_score, ro_den),2) if ro_den>0 else 50.0
    metrics["riskOn_10m_pct"] = risk_on_10m

    # Overall10m composite
    state, score, comps = compute_overall10m(
        ema_sign=ema_sign,
        ema10_dist_pct=ema_gap_pct,
        momentum_pct=momentum_combo_10m,
        breadth_pct=breadth_fast,
        squeeze_expansion_pct=squeeze_exp,
        liquidity_pct=liquidity_psi,
        riskon_pct=risk_on_10m,
    )

    intraday.setdefault("sectorDirection10m", {})
    intraday["sectorDirection10m"]["risingPct"] = rising_pct

    intraday.setdefault("riskOn10m", {})
    intraday["riskOn10m"]["riskOnPct"] = risk_on_10m

    intraday.setdefault("overall10m", {})
    prev_overall = intraday["overall10m"]
    last_changed = prev_overall.get("lastChanged") or now_utc_iso()
    if prev_overall.get("state") != state:
        last_changed = now_utc_iso()

    intraday["overall10m"] = {
        "state": state,
        "score": score,
        "components": comps,
        "lastChanged": last_changed,
    }

    j["metrics"] = metrics
    j["intraday"] = intraday

    j.setdefault("engineLights", {})
    j["engineLights"].setdefault("10m", {})
    j["engineLights"]["10m"].update({
        "state": state,
        "score": score,
        "components": comps,
        "lastChanged": last_changed,
    })

    save_json(INTRADAY_PATH, j)
    print(
        f"[10m] breadth_fast={breadth_fast:.2f} momCombo={momentum_combo_10m:.2f} "
        f"squeezeExp={squeeze_exp:.2f} psi={squeeze_psi_10m} "
        f"liqPsi={liquidity_psi:.2f} volPct={volatility_pct:.3f} "
        f"riskOn={risk_on_10m:.2f} risingPct={rising_pct:.2f} overall={state}/{score}",
        flush=True,
    )

# ------------------------------ Main ------------------------------

if __name__ == "__main__":
    try:
        compute_10m()
    except Exception as e:
        print("[10m-error]", e, file=sys.stderr)
        sys.exit(2)
