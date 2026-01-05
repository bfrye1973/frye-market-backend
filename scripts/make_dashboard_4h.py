#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_4h.py (R13.0 — EMA posture kept, not double-counted)

Key fix:
- Momentum combo no longer over-weights EMA posture (which is already counted in EMA points).
- New momentum combo weights:
    EMA posture 50%
    SMI(4h)      50%

Everything else unchanged.
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

UTC = timezone.utc

POLY_4H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/240/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 15, 10, 10, 5
FULL_EMA_DIST = 0.60
SMI_BONUS_MAX = 5

SMI_K_LEN   = 12
SMI_D_LEN   = 5
SMI_EMA_LEN = 5

# ✅ FIXED momentum combo weights (balanced)
W_EMA_POSTURE = 0.50
W_SMI_4H      = 0.50

def now_utc_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

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
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/4h/1.1","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_4h(sym: str, key: str, lookback_days: int = 120) -> List[dict]:
    end = datetime.now(UTC).date()
    start = end - timedelta(days=lookback_days)
    url = POLY_4H_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url, timeout=25)
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
    out.sort(key=lambda x: x["time"])
    if out:
        now = int(time.time())
        last = out[-1]["time"]
        if (last // (4*3600)) == (now // (4*3600)):
            out = out[:-1]
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

def tv_smi_and_signal(H: List[float], L: List[float], C: List[float],
                      lengthK: int, lengthD: int, lengthEMA: int) -> Tuple[List[float], List[float]]:
    n = len(C)
    if n < max(lengthK, lengthD, lengthEMA) + 5:
        return [], []
    HH: List[float] = []
    LL: List[float] = []
    for i in range(n):
        i0 = max(0, i - (lengthK - 1))
        HH.append(max(H[i0:i+1]))
        LL.append(min(L[i0:i+1]))
    rangeHL = [HH[i] - LL[i] for i in range(n)]
    rel = [C[i] - (HH[i] + LL[i]) / 2.0 for i in range(n)]

    def ema_ema(vals: List[float], length: int) -> List[float]:
        e1 = ema_series(vals, length)
        e2 = ema_series(e1, length)
        return e2

    nume = ema_ema(rel, lengthD)
    deno = ema_ema(rangeHL, lengthD)

    smi: List[float] = []
    for i in range(n):
        d = deno[i]
        smi.append(0.0 if d == 0 else 200.0 * (nume[i] / d))

    sig = ema_series(smi, lengthEMA)
    return smi, sig

def smi_to_pct(smi_val: float) -> float:
    return clamp(50.0 + 0.5*float(smi_val), 0.0, 100.0)

def lin_points(pct_val: float, weight: int) -> int:
    return int(round(weight * ((float(pct_val) - 50.0) / 50.0)))

def compute_overall4h(ema_sign: int, ema_dist_pct: float,
                      momentum_pct: float, breadth_pct: float,
                      squeeze_expansion_pct: float, liquidity_pct: float,
                      riskon_pct: float, smi_bonus_pts: int) -> Tuple[str, int, dict]:
    dist_unit = clamp(ema_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = int(round(abs(dist_unit) * W_EMA)) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)
    m_pts  = lin_points(momentum_pct, W_MOM)
    b_pts  = lin_points(breadth_pct,  W_BR)
    sq_pts = lin_points(squeeze_expansion_pct, W_SQ)
    lq_pts = lin_points(min(100.0, clamp(liquidity_pct, 0.0, 120.0)), W_LIQ)
    ro_pts = lin_points(riskon_pct, W_RISK)
    score  = int(clamp(50 + ema_pts + m_pts + b_pts + sq_pts + lq_pts + ro_pts + int(smi_bonus_pts), 0, 100))
    state  = "bull" if (ema_sign > 0 and score >= 60) else ("bear" if (ema_sign < 0 and score < 60) else "neutral")
    comps  = {"ema10": ema_pts, "momentum": m_pts, "breadth": b_pts, "squeeze": sq_pts, "liquidity": lq_pts, "riskOn": ro_pts, "smiBonus": int(smi_bonus_pts)}
    return state, score, comps

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="data/outlook_source_4h.json")
    ap.add_argument("--out", required=True, help="data/outlook_4h.json")
    args = ap.parse_args()

    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
    if not key:
        print("[fatal] missing POLYGON_API_KEY", file=sys.stderr)
        sys.exit(2)

    try:
        src = json.load(open(args.source, "r", encoding="utf-8"))
    except Exception as e:
        print("[fatal] cannot read source:", e, file=sys.stderr)
        sys.exit(2)

    cards = src.get("sectorCards") or []

    NH=NL=UP=DN=0.0
    for c in cards:
        NH += float(c.get("nh",0)); NL += float(c.get("nl",0))
        UP += float(c.get("up",0)); DN += float(c.get("down",0))
    breadth_4h = round(pct(NH, NH+NL), 2) if (NH+NL)>0 else 50.0
    momentum_4h_legacy = round(pct(UP, UP+DN), 2) if (UP+DN)>0 else 50.0

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
    risk_on_4h = round(pct(ro_score, ro_den), 2) if ro_den>0 else 50.0

    spy_4h = fetch_polygon_4h("SPY", key, lookback_days=120)
    if len(spy_4h) < 25:
        print("[fatal] insufficient SPY 4H bars", file=sys.stderr)
        sys.exit(2)

    H = [b["high"] for b in spy_4h]
    L = [b["low"]  for b in spy_4h]
    C = [b["close"] for b in spy_4h]
    V = [b["volume"] for b in spy_4h]

    e10 = ema_series(C, 10)[-1]
    ema_dist_pct = 0.0 if e10 == 0 else 100.0 * (C[-1] - e10) / e10
    ema_sign = 1 if ema_dist_pct > 0 else (-1 if ema_dist_pct < 0 else 0)

    unit = clamp(ema_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema10_posture = clamp(50.0 + 50.0 * unit, 0.0, 100.0)

    smi_series, sig_series = tv_smi_and_signal(H, L, C, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
    smi_val = float(smi_series[-1]) if smi_series else 0.0
    sig_val = float(sig_series[-1]) if sig_series else 0.0
    smi_pct = smi_to_pct(smi_val)

    # ✅ FIXED MOMENTUM COMBO (balanced)
    momentum_combo_4h = round(clamp(W_EMA_POSTURE*ema10_posture + W_SMI_4H*smi_pct, 0.0, 100.0), 2)

    smi_bonus = 0
    if smi_series and sig_series:
        if smi_val > sig_val:
            smi_bonus = +SMI_BONUS_MAX
        elif smi_val < sig_val:
            smi_bonus = -SMI_BONUS_MAX

    psi = lux_psi_from_closes(C, conv=50, length=20)
    squeeze_psi_4h = float(psi) if isinstance(psi,(int,float)) else 50.0
    squeeze_exp_4h = clamp(100.0 - squeeze_psi_4h, 0.0, 100.0)

    v3  = ema_last(V, 3)
    v12 = ema_last(V, 12)
    liquidity_4h = 0.0 if not v12 or v12<=0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)

    trs = tr_series(H, L, C)
    atr3 = ema_last(trs, 3) if trs else None
    vol_pct = 0.0 if not atr3 or C[-1] <= 0 else max(0.0, 100.0 * atr3 / C[-1])
    vol_scaled = round(vol_pct * 6.25, 2)

    rising_good = 0
    rising_total = 0
    for c in cards:
        bp = c.get("breadth_pct")
        mp = c.get("momentum_pct")
        if isinstance(bp,(int,float)) and isinstance(mp,(int,float)):
            rising_total += 1
            if bp >= 55.0 and mp >= 55.0:
                rising_good += 1
    sector_dir_4h = round(pct(rising_good, rising_total), 2) if rising_total>0 else 50.0

    state, score, comps = compute_overall4h(
        ema_sign=ema_sign,
        ema_dist_pct=ema_dist_pct,
        momentum_pct=momentum_combo_4h,
        breadth_pct=breadth_4h,
        squeeze_expansion_pct=squeeze_exp_4h,
        liquidity_pct=liquidity_4h,
        riskon_pct=risk_on_4h,
        smi_bonus_pts=smi_bonus,
    )

    updated_utc = now_utc_iso()

    metrics = {
        "trend_strength_4h_pct": float(score),
        "breadth_4h_pct": float(breadth_4h),
        "momentum_4h_pct": float(momentum_4h_legacy),
        "momentum_combo_4h_pct": float(momentum_combo_4h),

        "ema_sign_4h": int(ema_sign),
        "ema_dist_4h_pct": round(float(ema_dist_pct), 4),
        "ema10_posture_4h_pct": round(float(ema10_posture), 2),

        "smi_4h": round(float(smi_val), 4),
        "smi_signal_4h": round(float(sig_val), 4),
        "smi_4h_pct": round(float(smi_pct), 2),
        "smi_bonus_pts": int(smi_bonus),

        "squeeze_psi_4h": round(float(squeeze_psi_4h), 2),
        "squeeze_4h_pct": round(float(squeeze_exp_4h), 2),

        "liquidity_4h": round(float(liquidity_4h), 2),
        "volatility_4h_pct": round(float(vol_pct), 3),
        "volatility_4h_scaled": float(vol_scaled),

        "sector_dir_4h_pct": float(sector_dir_4h),
        "riskOn_4h_pct": float(risk_on_4h),
    }

    fourHour = {
        "sectorDirection4h": {"risingPct": float(sector_dir_4h)},
        "riskOn4h": {"riskOnPct": float(risk_on_4h)},
        "overall4h": {"state": state, "score": int(score), "components": comps, "lastChanged": updated_utc},
        "signals": {
            "sigSMI4hBullCross": {"active": False, "reason": "", "lastChanged": updated_utc},
            "sigSMI4hBearCross": {"active": False, "reason": "", "lastChanged": updated_utc},
        }
    }

    out = {
        "version": "r4h-v2-balanced-momentum",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated_utc,
        "metrics": metrics,
        "fourHour": fourHour,
        "sectorCards": cards,
        "meta": {"cards_fresh": True, "after_hours": False},
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"[4h] breadth={breadth_4h:.2f} mom_combo={momentum_combo_4h:.2f} "
        f"ema10dist={ema_dist_pct:.3f}% ema_post={ema10_posture:.2f} smiBonus={smi_bonus:+d} "
        f"squeezePsi={squeeze_psi_4h:.2f} squeezeExp={squeeze_exp_4h:.2f} "
        f"liq={liquidity_4h:.2f} volScaled={vol_scaled:.2f} "
        f"riskOn={risk_on_4h:.2f} sectorDir={sector_dir_4h:.2f} overall={state}/{score}",
        flush=True
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[4h-error]", e, file=sys.stderr)
        sys.exit(2)
