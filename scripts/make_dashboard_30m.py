#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_30m.py (R1 — True 30m Bridge)

Intent (locked by user):
- 30m is a TRUE bridge timeframe (between 10m entry and 1h regime).
- Primary structure is Close vs EMA10/EMA20 (intuitive).
- Secondary is EMA8 vs EMA18 (fast feel).
- Lux PSI is tightness (display), expansion is a soft score component.
- Breadth uses sector ETFs on 30m bars (EMA10>EMA20 + last bar up).

Output:
- data/outlook_30m.json (published to data-live-30m)
- Backend serves via /live/30m once mapped.
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

POLY_30M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/30/minute/{start}/{end}"
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

# Structure saturation
FULL_EMA_DIST = 0.60

# SMI (TradingView-like)
SMI_K_LEN = 12
SMI_D_LEN = 5
SMI_EMA_LEN = 5
SMI_BONUS_SCORE_MAX = 3.0

# Score weights (sum = 1.00)
# Structure-first: EMA10/20 posture dominates
W_STRUCT  = 0.50
W_MOM     = 0.25
W_BREADTH = 0.15
W_SQ_EXP  = 0.10

# Inside structure: EMA10 posture + EMA10>EMA20 stack + slope
W_POSTURE = 0.60
W_STACK   = 0.25
W_SLOPE   = 0.15

# Momentum combo: Primary structure + SMI + EMA8/18 (secondary)
W_PRIMARY = 0.70
W_SMI     = 0.20
W_SECOND  = 0.10

# Lux PSI
LUX_CONV = 50
LUX_LEN  = 20

# Window controls
PSI_WIN_30M = int(os.environ.get("PSI_WIN_30M", "26"))    # ~13 hours of 30m bars
FETCH_DAYS_30M = int(os.environ.get("FETCH_DAYS_30M", "30"))  # modest history


def now_utc_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/30m/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_30m(sym: str, key: str, lookback_days: int) -> List[dict]:
    end = datetime.now(UTC).date()
    start = end - timedelta(days=lookback_days)
    url = POLY_30M_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url, timeout=25)
    except Exception:
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
                "close": float(r.get("c", 0)),
                "volume": float(r.get("v", 0)),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["time"])
    # Drop in-flight 30m bar
    if out:
        now = int(time.time())
        last = out[-1]["time"]
        if (last // (30*60)) == (now // (30*60)):
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

def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if not closes or len(closes) < max(5, length + 2):
        return None
    mx = mn = None
    diffs: List[float] = []
    eps = 1e-12
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src)/conv, src)
        mn = src if mn is None else min(mn + (src - mn)/conv, src)
        span = max(mx - mn, eps)
        diffs.append(math.log(span))
    win = diffs[-length:]
    if len(win) < length:
        return None
    xs = list(range(length))
    xbar = sum(xs)/length
    ybar = sum(win)/length
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs, win))
    denx = sum((x-xbar)**2 for x in xs)
    deny = sum((y-ybar)**2 for y in win)
    den = math.sqrt(denx*deny) if denx > 0 and deny > 0 else 0.0
    r = (num/den) if den != 0 else 0.0
    psi = -50.0*r + 50.0
    return float(clamp(psi, 0.0, 100.0))

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

def posture_from_dist(dist_pct: float, full_dist: float) -> float:
    unit = clamp(dist_pct / max(full_dist, 1e-9), -1.0, 1.0)
    return clamp(50.0 + 50.0*unit, 0.0, 100.0)

def slope_score(e10_series: List[float]) -> float:
    # Small, stable slope score: compare last EMA10 to EMA10 from 3 bars ago
    if not e10_series or len(e10_series) < 4:
        return 50.0
    d = e10_series[-1] - e10_series[-4]
    return 60.0 if d > 0 else (40.0 if d < 0 else 50.0)

def compute_breadth_sector_etfs_30m(key: str) -> Tuple[float, float, List[dict]]:
    # align_pct: % ETFs where EMA10 > EMA20 (30m)
    # barup_pct: % ETFs where last bar close > open (30m)
    aligned = barup = total = 0
    cards = []
    for sym, sector in SECTOR_ETFS.items():
        bars = fetch_polygon_30m(sym, key, lookback_days=7)
        if len(bars) < 25:
            continue
        C = [b["close"] for b in bars]
        O = [b["open"] for b in bars]
        e10 = ema_series(C, 10)
        e20 = ema_series(C, 20)
        a = bool(e10[-1] > e20[-1])
        u = bool(C[-1] > O[-1])
        total += 1
        aligned += 1 if a else 0
        barup += 1 if u else 0
        cards.append({
            "sector": sector,
            "symbol": sym,
            "aligned": a,
            "barup": u,
        })
    if total <= 0:
        return 50.0, 50.0, cards
    align_pct = pct(aligned, total)
    barup_pct = pct(barup, total)
    return round(align_pct, 2), round(barup_pct, 2), cards

def riskon_from_alignment(cards: List[dict]) -> float:
    if not cards:
        return 50.0
    by_sector = {c["sector"]: c for c in cards}
    score = den = 0
    for s in OFFENSIVE:
        c = by_sector.get(s)
        if c is None: continue
        den += 1
        score += 1 if c.get("aligned") else 0
    for s in DEFENSIVE:
        c = by_sector.get(s)
        if c is None: continue
        den += 1
        score += 1 if not c.get("aligned") else 0
    return round(pct(score, den or 1), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="data/outlook_30m.json")
    args = ap.parse_args()

    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
    if not key:
        print("[fatal] missing POLYGON_API_KEY", file=sys.stderr)
        sys.exit(2)

    spy = fetch_polygon_30m("SPY", key, lookback_days=FETCH_DAYS_30M)
    if len(spy) < 60:
        print("[fatal] insufficient SPY 30m bars", file=sys.stderr)
        sys.exit(2)

    O = [b["open"] for b in spy]
    H = [b["high"] for b in spy]
    L = [b["low"] for b in spy]
    C = [b["close"] for b in spy]
    V = [b["volume"] for b in spy]

    # === PRIMARY structure ===
    e10_series = ema_series(C, 10)
    e20_series = ema_series(C, 20)
    e8_series  = ema_series(C, 8)
    e18_series = ema_series(C, 18)

    e10 = e10_series[-1]
    e20 = e20_series[-1]
    close = C[-1]

    ema10_dist_pct = 0.0 if e10 == 0 else 100.0 * (close - e10) / e10
    ema10_posture = posture_from_dist(ema10_dist_pct, FULL_EMA_DIST)

    stack_ok = 100.0 if e10 > e20 else 0.0
    slope = slope_score(e10_series)

    structure_score = (
        W_POSTURE * ema10_posture +
        W_STACK   * stack_ok +
        W_SLOPE   * slope
    )
    structure_score = float(clamp(structure_score, 0.0, 100.0))

    # EMA sign for state gate (structure)
    ema_sign = 1 if (close > e10 and e10 > e20) else (-1 if close < e10 else 0)

    # === SECONDARY fast feel (EMA8 vs EMA18) ===
    ema818_gap_pct = 0.0 if e18_series[-1] == 0 else 100.0 * (e8_series[-1] - e18_series[-1]) / e18_series[-1]
    secondary_posture = posture_from_dist(ema818_gap_pct, FULL_EMA_DIST)

    # === SMI ===
    smi_series, sig_series = tv_smi_and_signal(H, L, C, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
    smi_val = float(smi_series[-1]) if smi_series else 0.0
    sig_val = float(sig_series[-1]) if sig_series else 0.0
    smi_pct = smi_to_pct(smi_val)

    smi_bonus = 0.0
    if smi_series and sig_series:
        if smi_val > sig_val:
            smi_bonus = +SMI_BONUS_SCORE_MAX
        elif smi_val < sig_val:
            smi_bonus = -SMI_BONUS_SCORE_MAX

    momentum_combo = clamp(
        W_PRIMARY * structure_score + W_SMI * smi_pct + W_SECOND * secondary_posture,
        0.0, 100.0
    )

    # === Lux PSI (tightness display, expansion score) ===
    Cw = C[-PSI_WIN_30M:] if len(C) > PSI_WIN_30M else C
    psi = lux_psi_from_closes(Cw, conv=LUX_CONV, length=LUX_LEN)
    squeeze_psi = float(psi) if isinstance(psi, (int, float)) else 50.0
    squeeze_psi = float(clamp(squeeze_psi, 0.0, 100.0))
    squeeze_exp = float(clamp(100.0 - squeeze_psi, 0.0, 100.0))

    # === Breadth from sector ETFs on 30m ===
    align_pct, barup_pct, etf_cards = compute_breadth_sector_etfs_30m(key)
    breadth_pct = float(clamp(0.60*align_pct + 0.40*barup_pct, 0.0, 100.0))
    risk_on = float(riskon_from_alignment(etf_cards))

    # === Final 30m score (structure-first) ===
    score_raw = (
        W_STRUCT  * structure_score +
        W_MOM     * momentum_combo +
        W_BREADTH * breadth_pct +
        W_SQ_EXP  * squeeze_exp +
        smi_bonus
    )
    score = float(clamp(score_raw, 0.0, 100.0))

    state = "bull" if (ema_sign > 0 and score >= 60.0) else ("bear" if (ema_sign < 0 and score < 60.0) else "neutral")

    updated = now_utc_iso()

    out = {
        "version": "r30m-v1-truebridge",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated,
        "metrics": {
            "overall_30m_score": round(score, 2),
            "overall_30m_state": state,

            "ema_sign_30m": int(ema_sign),
            "ema10_dist_30m_pct": round(float(ema10_dist_pct), 4),
            "ema10_posture_30m_pct": round(float(ema10_posture), 2),
            "ema10_gt_ema20": bool(e10 > e20),
            "ema10_slope_score_30m": round(float(slope), 2),

            "ema818_gap_pct": round(float(ema818_gap_pct), 4),
            "ema8_ema18_posture_30m_pct": round(float(secondary_posture), 2),

            "smi_30m": round(float(smi_val), 4),
            "smi_signal_30m": round(float(sig_val), 4),
            "smi_30m_pct": round(float(smi_pct), 2),

            "momentum_combo_30m_pct": round(float(momentum_combo), 2),

            "squeeze_psi_30m_pct": round(float(squeeze_psi), 2),
            "squeeze_expansion_30m_pct": round(float(squeeze_exp), 2),

            "breadth_align_pct": float(align_pct),
            "breadth_barup_pct": float(barup_pct),
            "breadth_30m_pct": round(float(breadth_pct), 2),
            "riskOn_30m_pct": round(float(risk_on), 2),

            "psi_window_30m_bars": int(PSI_WIN_30M),
            "fetch_days_30m": int(FETCH_DAYS_30M),
        },
        "thirtyMin": {
            "overall30m": {
                "state": state,
                "score": round(float(score), 2),
                "components": {
                    "structure": round(float(W_STRUCT * structure_score), 2),
                    "momentum": round(float(W_MOM * momentum_combo), 2),
                    "breadth": round(float(W_BREADTH * breadth_pct), 2),
                    "squeeze": round(float(W_SQ_EXP * squeeze_exp), 2),
                    "smiBonus": round(float(smi_bonus), 2),
                },
                "lastChanged": updated,
            }
        },
        "sectorEtfCards": etf_cards,  # debug-friendly
        "meta": {
            "after_hours": False,
        }
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[30m] score={score:.2f} state={state} ema10Post={ema10_posture:.2f} stack={e10>e20} slope={slope:.1f} breadth={breadth_pct:.1f} psi={squeeze_psi:.1f}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[30m-error]", e, file=sys.stderr)
        sys.exit(2)
