#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_hourly.py (R12.7, Lux PSI + 4h anchor)

Builds hourly payload with:
- breadth_1h_pct from sectorCards
- momentum_combo_1h_pct from EMA posture + SMI(1h) + SMI(4h) anchor
- Lux-style PSI squeeze on SPY 1h (squeeze_psi_1h_pct + squeeze_1h_pct expansion)
- liquidity_1h (EMA(vol3)/EMA(vol12))
- volatility_1h_pct / volatility_1h_scaled (ATR3 %)
- SectorDirection1h.risingPct (breadth>=55 & momentum>=55)
- RiskOn1h.riskOnPct (offensive>=55, defensive<=45)
- overall1h {state, score, components}
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

# ------------------------------ Config ------------------------------

HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"

POLY_1H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/60/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)
POLY_4H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/240/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

# Overall weights
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 15, 10, 10, 5
FULL_EMA_DIST = 0.60

# Momentum combo weights (with 4h anchor)
W_EMA_1H, W_SMI1H, W_SMI4H = 0.60, 0.15, 0.25

# ------------------------------ Utils ------------------------------

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

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/1h/1.1","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_bars(url_tmpl: str, key: str, sym: str, lookback_days: int = 20) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = url_tmpl.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url)
    except Exception:
        return []
    rows = js.get("results") or []
    out: List[dict] = []
    for r in rows:
        try:
            t = int(r.get("t",0)) // 1000
            out.append({
                "time": t,
                "open": float(r.get("o",0)),
                "high": float(r.get("h",0)),
                "low":  float(r.get("l",0)),
                "close":float(r.get("c",0)),
                "volume": float(r.get("v",0)),
            })
        except Exception:
            continue
    if out:
        bucket = 3600
        now = int(time.time())
        cur  = (now // bucket) * bucket
        if out[-1]["time"] == cur:
            out.pop()
    return out

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k*(v - e)
        out.append(e)
    return out

def ema_last(vals: List[float], span: int) -> Optional[float]:
    if not vals:
        return None
    return ema_series(vals, span)[-1]

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1, len(C))]

# ------------------------------ SMI ------------------------------

def smi_kd_series(H: List[float], L: List[float], C: List[float],
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

# --------------------------- Lux PSI ---------------------------

def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if not closes or len(closes) < max(5, length+2):
        return None
    mx = mn = None
    diffs: List[float] = []
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src)/conv, src)
        mn = src if mn is None else min(mn + (src - mn)/conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(math.log(span))
    n = length
    xs = list(range(n))
    win = diffs[-n:]
    if len(win) < n:
        return None
    xbar = sum(xs)/n
    ybar = sum(win)/n
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs,win))
    den = (sum((x-xbar)**2 for x in xs)*sum((y-ybar)**2 for y in win)) or 1.0
    r = num/math.sqrt(den)
    psi = -50.0*r + 50.0
    return float(clamp(psi,0.0,100.0))

# --------------------------- Sector cards helper ---------------------------

def groups_to_sector_cards(groups: Dict[str, dict]) -> List[dict]:
    ORDER = [
        "information technology","materials","health care","communication services",
        "real estate","energy","consumer staples","consumer discretionary",
        "financials","utilities","industrials",
    ]
    alias = {
        "healthcare":"health care","health-care":"health care",
        "info tech":"information technology","technology":"information technology","tech":"information technology",
        "communications":"communication services","comm services":"communication services","telecom":"communication services",
        "staples":"consumer staples","discretionary":"consumer discretionary","finance":"financials",
        "industry":"industrials","reit":"real estate","reits":"real estate",
    }
    def norm(s: str) -> str: return (s or "").strip().lower()
    by: Dict[str, dict] = {}
    for name, g in (groups or {}).items():
        k = alias.get(norm(name), norm(name))
        nh = int((g or {}).get("nh", 0)); nl = int((g or {}).get("nl", 0))
        u  = int((g or {}).get("u", 0));  d  = int((g or {}).get("d", 0))
        b = 0.0 if (nh+nl)==0 else round(100.0*nh/(nh+nl),2)
        u_plus_dn = u+d
        m = 0.0 if u_plus_dn==0 else round(100.0*u/u_plus_dn,2)
        by[k] = {"sector":k.title(),"breadth_pct":b,"momentum_pct":m,"nh":nh,"nl":nl,"up":u,"down":d}
    return [by.get(name,{"sector":name.title(),"breadth_pct":0.0,"momentum_pct":0.0,"nh":0,"nl":0,"up":0,"down":0})
            for name in ORDER]

# ----------------------------- Overall Score -----------------------------

def lin_points(pct_val: float, weight: int) -> int:
    return int(round(weight * ((float(pct_val) - 50.0) / 50.0)))

def compute_overall1h(ema_sign: int, ema10_dist_pct: float,
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

# ----------------------------- Builder -----------------------------

def build_hourly(source_js: Optional[dict], hourly_url: str) -> dict:
    prev_js = {}
    try:
        prev_js = fetch_json(hourly_url) or {}
    except Exception:
        prev_js = {}

    cards: List[dict] = []
    cards_fresh = False
    if isinstance(source_js, dict):
        if isinstance(source_js.get("sectorCards"), list):
            cards = source_js["sectorCards"]; cards_fresh = True
        elif isinstance(source_js.get("sectors"), list):
            cards = source_js["sectors"]; cards_fresh = True
        elif isinstance(source_js.get("groups"), dict):
            cards = groups_to_sector_cards(source_js["groups"]); cards_fresh = True
    if not cards:
        try:
            h = prev_js if prev_js else fetch_json(hourly_url)
            cards = (h.get("sectorCards") or h.get("sectors") or groups_to_sector_cards(h.get("groups") or {}))
            cards_fresh = False
        except Exception:
            cards = []; cards_fresh = False

    # Aggregate NH/NL/UP/DOWN
    NH=NL=UP=DN=0.0
    for c in cards or []:
        NH += float(c.get("nh",0)); NL += float(c.get("nl",0))
        UP += float(c.get("up",0)); DN += float(c.get("down",0))
    breadth_slow  = round(pct(NH, NH+NL), 2) if (NH+NL)>0 else 50.0
    momentum_slow = round(pct(UP, UP+DN), 2) if (UP+DN)>0 else 50.0

    # SectorDir1h: breadth>=55 & momentum>=55
    rising_good = 0
    rising_total = 0
    for c in cards or []:
        bp = c.get("breadth_pct")
        mp = c.get("momentum_pct")
        if isinstance(bp,(int,float)) and isinstance(mp,(int,float)):
            rising_total += 1
            if bp >= 55.0 and mp >= 55.0:
                rising_good += 1
    rising_pct = round(pct(rising_good, rising_total), 2) if rising_total>0 else 50.0

    # RiskOn1h: OFF >=55, DEF <=45
    by = {(c.get("sector") or "").strip().lower(): c for c in cards or []}
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
    risk_on_pct = round(pct(ro_score, ro_den), 2) if ro_den>0 else 50.0

    # SPY 1h + 4h
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    spy_1h: List[dict] = []
    spy_4h: List[dict] = []
    if key:
        spy_1h = fetch_polygon_bars(POLY_1H_URL, key, "SPY", lookback_days=40)
        spy_4h = fetch_polygon_bars(POLY_4H_URL, key, "SPY", lookback_days=60)

    momentum_combo_1h = 50.0
    ema_sign = 0
    ema10_dist_pct = 0.0
    e8=[]; e18=[]
    k1h_series: List[float] = []
    d1h_series: List[float] = []

    if len(spy_1h) >= 3:
        H = [b["high"] for b in spy_1h]
        L = [b["low"]  for b in spy_1h]
        C = [b["close"] for b in spy_1h]
        e8  = ema_series(C, 8)
        e18 = ema_series(C, 18)
        ema10_dist_pct = 0.0 if e8[-1] == 0 else 100.0 * (C[-1] - e8[-1]) / e8[-1]
        ema_sign = 1 if e8[-1] > e18[-1] else (-1 if e8[-1] < e18[-1] else 0)

        def ema_posture_1h(Cvals: List[float]) -> float:
            e8_  = ema_series(Cvals, 8); e18_ = ema_series(Cvals, 18)
            d    = 0.0 if e18_[-1] == 0 else 100.0 * (e8_[-1] - e18_[-1]) / e18_[-1]
            sign = 1.0 if d > 0 else (-1.0 if d < 0 else 0.0)
            mag  = min(1.0, abs(d) / 0.50)
            bonus = 0.0
            if len(e8_) >= 2 and len(e18_) >= 2:
                if e8_[-2] <= e18_[-2] and e8_[-1] > e18_[-1]: bonus = +5.0
                if e8_[-2] >= e18_[-2] and e8_[-1] < e18_[-1]: bonus = -5.0
            return clamp(50.0 + 50.0 * sign * mag + bonus, 0.0, 100.0)

        ema_score = ema_posture_1h(C)

        k1h_series, d1h_series = smi_kd_series(H, L, C, k_len=12, d_len=7, ema_len=5)
        smi1h: Optional[float] = None
        if k1h_series and d1h_series:
            smi1h = clamp(50.0 + 0.5 * (k1h_series[-1] - d1h_series[-1]), 0.0, 100.0)

        smi4h: Optional[float] = None
        if len(spy_4h) >= 10:
            H4 = [b["high"] for b in spy_4h]
            L4 = [b["low"]  for b in spy_4h]
            C4 = [b["close"] for b in spy_4h]
            k4, d4 = smi_kd_series(H4, L4, C4, k_len=12, d_len=7, ema_len=5)
            if k4 and d4:
                smi4h = clamp(50.0 + 0.5 * (k4[-1] - d4[-1]), 0.0, 100.0)

        # Composite with 4h anchor
        if smi1h is None and smi4h is None:
            momentum_combo_1h = ema_score
        else:
            wE, w1, w4 = W_EMA_1H, W_SMI1H, W_SMI4H
            if smi1h is None:
                wE, w1, w4 = 0.70, 0.00, 0.30
            if smi4h is None:
                wE, w1, w4 = 0.70, 0.30, 0.00
            momentum_combo_1h = (
                wE * ema_score +
                w1 * (smi1h if smi1h is not None else ema_score) +
                w4 * (smi4h if smi4h is not None else ema_score)
            )

    momentum_combo_1h = round(clamp(momentum_combo_1h, 0.0, 100.0), 2)
    breadth_1h  = breadth_slow
    momentum_1h_legacy = momentum_slow

    # Lux PSI squeeze 1h
    squeeze_psi_1h = None
    squeeze_1h = 50.0
    if len(spy_1h) >= 25:
        C = [b["close"] for b in spy_1h]
        psi = lux_psi_from_closes(C, conv=50, length=20)
        if isinstance(psi,(int,float)):
            squeeze_psi_1h = psi
            squeeze_1h = clamp(100.0 - psi, 0.0, 100.0)

    # Liquidity / Volatility
    liquidity_1h = 50.0
    volatility_1h = 0.0
    if len(spy_1h) >= 2:
        V = [b["volume"] for b in spy_1h]
        v3  = ema_last(V, 3)
        v12 = ema_last(V, 12)
        liquidity_1h = 0.0 if not v12 or v12<=0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)

        C = [b["close"] for b in spy_1h]
        H = [b["high"]  for b in spy_1h]
        L = [b["low"]   for b in spy_1h]
        trs = tr_series(H, L, C)
        atr = ema_last(trs, 3) if trs else None
        volatility_1h = 0.0 if not atr or C[-1] <= 0 else max(0.0, 100.0 * atr / C[-1])

    # Overall composite
    state, score, comps = compute_overall1h(
        ema_sign=ema_sign,
        ema10_dist_pct=ema10_dist_pct,
        momentum_pct=momentum_combo_1h,
        breadth_pct=breadth_1h,
        squeeze_expansion_pct=squeeze_1h,
        liquidity_pct=liquidity_1h,
        riskon_pct=risk_on_pct,
    )

    # Signals
    updated_utc = now_utc_iso()

    def stamp(prev_sig: Optional[dict], active: bool, reason: str) -> dict:
        last = prev_sig.get("lastChanged") if isinstance(prev_sig,dict) else updated_utc
        prev_active = prev_sig.get("active") if isinstance(prev_sig,dict) else None
        flipped = (prev_active is None) or (bool(prev_active) != bool(active))
        return {
            "active": bool(active),
            "severity": "info" if "above" in reason else "warn",
            "reason": reason if active else "",
            "lastChanged": updated_utc if flipped else (last or updated_utc),
        }

    prev_sig = ((prev_js.get("hourly") or {}).get("signals") or {}) if isinstance(prev_js, dict) else {}
    has_prev_ema = len(e8) >= 2 and len(e18) >= 2
    has_prev_smi = len(k1h_series) >= 2 and len(d1h_series) >= 2
    ema_bull = ema_bear = smi_bull = smi_bear = False

    if has_prev_ema:
        ema_bull = (e8[-2] <= e18[-2]) and (e8[-1] >  e18[-1])
        ema_bear = (e8[-2] >= e18[-2]) and (e8[-1] <  e18[-1])
    if has_prev_smi:
        smi_bull = (k1h_series[-2] <= d1h_series[-2]) and (k1h_series[-1] >  d1h_series[-1])
        smi_bear = (k1h_series[-2] >= d1h_series[-2]) and (k1h_series[-1] <  d1h_series[-1])

    signals_1h = {
        "sigEMA1hBullCross": stamp(prev_sig.get("sigEMA1hBullCross"), ema_bull, "EMA10 crossed above EMA20 (1h)"),
        "sigEMA1hBearCross": stamp(prev_sig.get("sigEMA1hBearCross"), ema_bear, "EMA10 crossed below EMA20 (1h)"),
        "sigSMI1hBullCross": stamp(prev_sig.get("sigSMI1hBullCross"), smi_bull, "SMI %K crossed above %D (1h)"),
        "sigSMI1hBearCross": stamp(prev_sig.get("sigSMI1hBearCross"), smi_bear, "SMI %K crossed below %D (1h)"),
    }

    metrics = {
        "breadth_1h_pct": breadth_1h,
        "breadth_align_1h_pct": None,
        "breadth_align_1h_pct_fast": None,
        "breadth_bar_1h_pct": None,
        "breadth_bar_1h_pct_fast": None,
        "momentum_1h_pct": momentum_1h_legacy,
        "momentum_combo_1h_pct": momentum_combo_1h,
        "squeeze_1h_pct": squeeze_1h,
        "squeeze_psi_1h_pct": squeeze_psi_1h,
        "liquidity_1h": liquidity_1h,
        "volatility_1h_pct": round(volatility_1h, 3),
        "volatility_1h_scaled": round(volatility_1h * 6.25, 2),
        "breadth_slow_pct": breadth_slow,
        "momentum_slow_pct": momentum_slow,
    }

    hourly = {
        "sectorDirection1h": {"risingPct": rising_pct},
        "riskOn1h": {"riskOnPct": risk_on_pct},
        "overall1h": {"state": state, "score": score, "components": comps},
        "signals": signals_1h,
    }

    out = {
        "version": "r1h-v1-fast",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated_utc,
        "metrics": metrics,
        "hourly": hourly,
        "sectorCards": cards,
        "meta": {"cards_fresh": bool(cards_fresh), "after_hours": False},
    }

    print(
        f"[1h] breadth={breadth_1h:.2f} mom_combo={momentum_combo_1h:.2f} "
        f"squeezeExp={squeeze_1h:.2f} psi_1h={squeeze_psi_1h} "
        f"liq={liquidity_1h:.2f} volScaled={metrics['volatility_1h_scaled']:.2f} "
        f"riskOn={risk_on_pct:.2f} risingPct={rising_pct:.2f} "
        f"overall={state}/{score}",
        flush=True
    )
    return out

# ------------------------------ CLI ------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="optional source json (sectorCards or groups)", default="")
    ap.add_argument("--out", required=True, help="Output file path (e.g., data/outlook_hourly.json)")
    ap.add_argument("--hourly_url", default=HOURLY_URL_DEFAULT)
    args = ap.parse_args()

    src = None
    if args.source and os.path.exists(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                src = json.load(f)
        except Exception:
            src = None

    out = build_hourly(source_js=src, hourly_url=args.hourly_url)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    ov = out.get("hourly", {}).get("overall1h", {})
    print("[ok] wrote", args.out, "| overall1h.state=", ov.get("state"), "score=", ov.get("score"))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(2)
