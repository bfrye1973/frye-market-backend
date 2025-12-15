#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_hourly.py (R12.8 — EMA10 distance + TV SMI 12/5/5)

Builds hourly payload with:
- breadth_1h_pct from sectorCards (NH/NL aggregate)
- momentum_combo_1h_pct from EMA10-distance posture + SMI(1h) + optional SMI(4h) anchor
- TradingView-style SMI (12,5,5) + signal line (EMA 5)
- Lux-style PSI squeeze on SPY 1h (squeeze_psi_1h_pct + squeeze_1h_pct expansion)
- liquidity_1h (EMA(vol3)/EMA(vol12))
- volatility_1h_pct / volatility_1h_scaled (ATR3 %)
- SectorDirection1h.risingPct (breadth>=55 & momentum>=55)
- RiskOn1h.riskOnPct (offensive>=55, defensive<=45)
- overall1h {state, score, components} with EMA10 distance as primary driver
- SMI bonus/penalty (±5 max) added to overall score
- SMI crossover event signals based on (SMI crosses Signal)
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

# Overall weights (same style as 10m)
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 15, 10, 10, 5

# EMA10 distance saturation: ±0.60% from EMA10 = "full strength"
FULL_EMA_DIST = 0.60

# Momentum combo weights (keep simple + stable)
W_EMA10_POSTURE = 0.75
W_SMI1H_POSTURE = 0.20
W_SMI4H_ANCHOR  = 0.05

# SMI bonus to overall score (your request: "both", but small)
SMI_BONUS_MAX = 5  # ±5 points max

# TradingView SMI params (your request)
SMI_K_LEN   = 12
SMI_D_LEN   = 5
SMI_EMA_LEN = 5

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
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/1h/1.2","Cache-Control":"no-store"})
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
    # drop in-flight hour
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

# --------------------------- TradingView SMI (12,5,5) ---------------------------

def tv_smi_and_signal(H: List[float], L: List[float], C: List[float],
                      lengthK: int, lengthD: int, lengthEMA: int) -> Tuple[List[float], List[float]]:
    """
    Matches the TradingView script you pasted:
    SMI = 200 * ( EMA(EMA(relativeRange, lengthD), lengthD) / EMA(EMA(range, lengthD), lengthD) )
    Signal = EMA(SMI, lengthEMA)
    """
    n = len(C)
    if n < max(lengthK, lengthD, lengthEMA) + 5:
        return [], []

    # highest/lowest rolling
    HH: List[float] = []
    LL: List[float] = []
    for i in range(n):
        i0 = max(0, i - (lengthK - 1))
        HH.append(max(H[i0:i+1]))
        LL.append(min(L[i0:i+1]))

    rangeHL = [HH[i] - LL[i] for i in range(n)]
    rel = [C[i] - (HH[i] + LL[i]) / 2.0 for i in range(n)]

    # double EMA helper
    def ema_ema(vals: List[float], length: int) -> List[float]:
        e1 = ema_series(vals, length)
        e2 = ema_series(e1, length)
        return e2

    num = ema_ema(rel, lengthD)
    den = ema_ema(rangeHL, lengthD)

    smi: List[float] = []
    for i in range(n):
        d = den[i]
        if d == 0:
            smi.append(0.0)
        else:
            smi.append(200.0 * (num[i] / d))

    sig = ema_series(smi, lengthEMA)
    return smi, sig

def smi_to_pct(smi_val: float) -> float:
    # map -100..+100 into 0..100
    return clamp(50.0 + 0.5 * float(smi_val), 0.0, 100.0)

# ----------------------------- Overall Score -----------------------------

def lin_points(pct_val: float, weight: int) -> int:
    return int(round(weight * ((float(pct_val) - 50.0) / 50.0)))

def compute_overall1h(ema_sign: int, ema_dist_pct: float,
                      momentum_pct: float, breadth_pct: float,
                      squeeze_expansion_pct: float, liquidity_pct: float,
                      riskon_pct: float,
                      smi_bonus_pts: int) -> Tuple[str, int, dict]:
    # EMA points from EMA10 distance
    dist_unit = clamp(ema_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = int(round(abs(dist_unit) * W_EMA)) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)

    m_pts  = lin_points(momentum_pct, W_MOM)
    b_pts  = lin_points(breadth_pct,  W_BR)
    sq_pts = lin_points(squeeze_expansion_pct, W_SQ)
    lq_pts = lin_points(min(100.0, clamp(liquidity_pct, 0.0, 120.0)), W_LIQ)
    ro_pts = lin_points(riskon_pct, W_RISK)

    score_raw = 50 + ema_pts + m_pts + b_pts + sq_pts + lq_pts + ro_pts + int(smi_bonus_pts)
    score  = int(clamp(score_raw, 0, 100))

    state  = "bull" if (ema_sign > 0 and score >= 60) else ("bear" if (ema_sign < 0 and score < 60) else "neutral")
    comps  = {
        "ema10": ema_pts,
        "momentum": m_pts,
        "breadth": b_pts,
        "squeeze": sq_pts,
        "liquidity": lq_pts,
        "riskOn": ro_pts,
        "smiBonus": int(smi_bonus_pts),
    }
    return state, score, comps

# ----------------------------- Builder -----------------------------

def build_hourly(source_js: Optional[dict], hourly_url: str) -> dict:
    prev_js = {}
    try:
        prev_js = fetch_json(hourly_url) or {}
    except Exception:
        prev_js = {}

    # sector cards input
    cards: List[dict] = []
    cards_fresh = False
    if isinstance(source_js, dict):
        if isinstance(source_js.get("sectorCards"), list):
            cards = source_js["sectorCards"]; cards_fresh = True
        elif isinstance(source_js.get("sectors"), list):
            cards = source_js["sectors"]; cards_fresh = True
        elif isinstance(source_js.get("groups"), dict):
            # if your source uses groups, expect another converter upstream; keep fallback to previous
            cards = []; cards_fresh = False

    if not cards:
        try:
            h = prev_js if prev_js else fetch_json(hourly_url)
            cards = (h.get("sectorCards") or h.get("sectors") or [])
            cards_fresh = False
        except Exception:
            cards = []; cards_fresh = False

    # Aggregate NH/NL/UP/DOWN (slow breadth/momentum)
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

    # SPY 1h + 4h bars (Polygon)
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
    spy_1h: List[dict] = []
    spy_4h: List[dict] = []
    if key:
        spy_1h = fetch_polygon_bars(POLY_1H_URL, key, "SPY", lookback_days=40)
        spy_4h = fetch_polygon_bars(POLY_4H_URL, key, "SPY", lookback_days=60)

    # ---- EMA10 distance posture (PRIMARY TREND ENGINE) ----
    ema_sign = 0
    ema_dist_pct = 0.0
    ema10_posture = 50.0

    # ---- SMI (TV style 12/5/5) ----
    smi_1h = None
    smi_sig_1h = None
    smi_pct_1h = None

    smi_4h = None
    smi_sig_4h = None
    smi_pct_4h = None

    if len(spy_1h) >= 20:
        H = [b["high"] for b in spy_1h]
        L = [b["low"]  for b in spy_1h]
        C = [b["close"] for b in spy_1h]

        e10 = ema_series(C, 10)
        if e10[-1] and e10[-1] != 0:
            ema_dist_pct = 100.0 * (C[-1] - e10[-1]) / e10[-1]
        ema_sign = 1 if ema_dist_pct > 0 else (-1 if ema_dist_pct < 0 else 0)

        unit = clamp(ema_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
        ema10_posture = clamp(50.0 + 50.0 * unit, 0.0, 100.0)

        smi_series, sig_series = tv_smi_and_signal(H, L, C, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
        if smi_series and sig_series:
            smi_1h = float(smi_series[-1])
            smi_sig_1h = float(sig_series[-1])
            smi_pct_1h = smi_to_pct(smi_1h)

    if len(spy_4h) >= 20:
        H4 = [b["high"] for b in spy_4h]
        L4 = [b["low"]  for b in spy_4h]
        C4 = [b["close"] for b in spy_4h]
        smi4, sig4 = tv_smi_and_signal(H4, L4, C4, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
        if smi4 and sig4:
            smi_4h = float(smi4[-1])
            smi_sig_4h = float(sig4[-1])
            smi_pct_4h = smi_to_pct(smi_4h)

    # Momentum combo pct (0..100) — mainly EMA10 posture, small SMI influence
    momentum_combo_1h = ema10_posture
    if isinstance(smi_pct_1h, (int, float)) or isinstance(smi_pct_4h, (int, float)):
        wE, w1, w4 = W_EMA10_POSTURE, W_SMI1H_POSTURE, W_SMI4H_ANCHOR
        if smi_pct_1h is None:
            wE, w1, w4 = 0.90, 0.00, 0.10
        if smi_pct_4h is None:
            wE, w1, w4 = 0.80, 0.20, 0.00
        momentum_combo_1h = (
            wE * ema10_posture +
            w1 * (float(smi_pct_1h) if smi_pct_1h is not None else ema10_posture) +
            w4 * (float(smi_pct_4h) if smi_pct_4h is not None else ema10_posture)
        )
    momentum_combo_1h = round(clamp(momentum_combo_1h, 0.0, 100.0), 2)

    # SMI bonus/penalty (±5 max) based on SMI vs Signal (1h only)
    smi_bonus_pts = 0
    if isinstance(smi_1h, (int, float)) and isinstance(smi_sig_1h, (int, float)):
        if smi_1h > smi_sig_1h:
            smi_bonus_pts = +SMI_BONUS_MAX
        elif smi_1h < smi_sig_1h:
            smi_bonus_pts = -SMI_BONUS_MAX

    # Lux PSI squeeze 1h (PSI tightness + expansion)
    squeeze_psi_1h = None
    squeeze_exp_1h = 50.0
    if len(spy_1h) >= 25:
        C = [b["close"] for b in spy_1h]
        psi = lux_psi_from_closes(C, conv=50, length=20)
        if isinstance(psi,(int,float)):
            squeeze_psi_1h = float(psi)
            squeeze_exp_1h = clamp(100.0 - float(psi), 0.0, 100.0)

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
    breadth_1h = breadth_slow
    state, score, comps = compute_overall1h(
        ema_sign=ema_sign,
        ema_dist_pct=ema_dist_pct,
        momentum_pct=momentum_combo_1h,
        breadth_pct=breadth_1h,
        squeeze_expansion_pct=squeeze_exp_1h,
        liquidity_pct=liquidity_1h,
        riskon_pct=risk_on_pct,
        smi_bonus_pts=smi_bonus_pts,
    )

    updated_utc = now_utc_iso()

    # ---- Crossover EVENT signals based on SMI crosses Signal (1h) ----
    def stamp(prev_sig: Optional[dict], active: bool, reason: str) -> dict:
        last = prev_sig.get("lastChanged") if isinstance(prev_sig,dict) else updated_utc
        prev_active = prev_sig.get("active") if isinstance(prev_sig,dict) else None
        flipped = (prev_active is None) or (bool(prev_active) != bool(active))
        return {
            "active": bool(active),
            "severity": "info",
            "reason": reason if active else "",
            "lastChanged": updated_utc if flipped else (last or updated_utc),
        }

    prev_sig = ((prev_js.get("hourly") or {}).get("signals") or {}) if isinstance(prev_js, dict) else {}

    smi_bull = smi_bear = False
    if len(spy_1h) >= 25:
        H = [b["high"] for b in spy_1h]
        L = [b["low"]  for b in spy_1h]
        C = [b["close"] for b in spy_1h]
        smi_series, sig_series = tv_smi_and_signal(H, L, C, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
        if len(smi_series) >= 2 and len(sig_series) >= 2:
            smi_bull = (smi_series[-2] <= sig_series[-2]) and (smi_series[-1] > sig_series[-1])
            smi_bear = (smi_series[-2] >= sig_series[-2]) and (smi_series[-1] < sig_series[-1])

    signals_1h = {
        "sigSMI1hBullCross": stamp(prev_sig.get("sigSMI1hBullCross"), smi_bull, "SMI crossed above Signal (1h)"),
        "sigSMI1hBearCross": stamp(prev_sig.get("sigSMI1hBearCross"), smi_bear, "SMI crossed below Signal (1h)"),
    }

    # TrendStrength for the post-processor to color (we set it = overall score)
    trend_strength_1h_pct = float(score)

    metrics = {
        "trend_strength_1h_pct": round(trend_strength_1h_pct, 2),

        "breadth_1h_pct": breadth_1h,
        "momentum_combo_1h_pct": momentum_combo_1h,

        # legacy slow fields
        "breadth_slow_pct": breadth_slow,
        "momentum_slow_pct": momentum_slow,

        # EMA10 distance posture
        "ema_sign": int(ema_sign),
        "ema10_dist_pct": round(float(ema_dist_pct), 4),
        "ema10_posture_1h_pct": round(float(ema10_posture), 2),

        # SMI raw + signal (TV style)
        "smi_1h": float(smi_1h) if isinstance(smi_1h,(int,float)) else None,
        "smi_signal_1h": float(smi_sig_1h) if isinstance(smi_sig_1h,(int,float)) else None,
        "smi_1h_pct": round(float(smi_pct_1h), 2) if isinstance(smi_pct_1h,(int,float)) else None,
        "smi_bonus_pts": int(smi_bonus_pts),

        # squeeze (1h)
        "squeeze_1h_pct": round(float(squeeze_exp_1h), 2),          # expansion 0..100
        "squeeze_psi_1h_pct": round(float(squeeze_psi_1h), 2) if isinstance(squeeze_psi_1h,(int,float)) else None,  # tightness

        # liquidity / volatility
        "liquidity_1h": round(float(liquidity_1h), 2),
        "volatility_1h_pct": round(float(volatility_1h), 3),
        "volatility_1h_scaled": round(float(volatility_1h) * 6.25, 2),
    }

    hourly = {
        "sectorDirection1h": {"risingPct": rising_pct},
        "riskOn1h": {"riskOnPct": risk_on_pct},
        "overall1h": {"state": state, "score": score, "components": comps},
        "signals": signals_1h,
    }

    out = {
        "version": "r1h-v2-ema10dist-tvSMI",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated_utc,
        "metrics": metrics,
        "hourly": hourly,
        "sectorCards": cards,
        "meta": {"cards_fresh": bool(cards_fresh), "after_hours": False},
    }

    print(
        f"[1h] ema10dist={ema_dist_pct:.3f}% ema10Posture={ema10_posture:.2f} "
        f"mom_combo={momentum_combo_1h:.2f} smiBonus={smi_bonus_pts:+d} "
        f"squeezeExp={squeeze_exp_1h:.2f} psi={squeeze_psi_1h} "
        f"liq={liquidity_1h:.2f} volScaled={metrics['volatility_1h_scaled']:.2f} "
        f"riskOn={risk_on_pct:.2f} risingPct={rising_pct:.2f} overall={state}/{score}",
        flush=True
    )
    return out

# ------------------------------ CLI ------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="optional source json (sectorCards)", default="")
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
