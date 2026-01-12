#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_4h.py (R13.3 — SHORT-MEMORY LUX PSI, 10m-Behavior)

LOCKED INTENT (per old teammate):
- 10m Lux PSI is canonical behavior.
- 4h Lux PSI must behave like 10m (short-memory "current squeeze"), not long-history memory.
- Dashboard squeeze represents PSI tightness (higher = tighter), NOT expansion.
- 4h squeeze is a soft component (context), not dominant.

This script:
- Reads sectorCards from a source json (data/outlook_source_4h.json)
- Fetches SPY 4h bars from Polygon (modest lookback; NOT long)
- Computes:
  * EMA10 posture from dist (0..100)
  * SMI 12/5/5 + signal, normalized 0..100
  * Momentum combo (50/50 EMA posture + SMI)
  * Lux PSI tightness using SHORT window closes (PSI_WIN_4H bars)
  * Expansion = 100 - PSI (stored)
  * Liquidity (EMA vol3/vol12)
  * Volatility (ATR% scaled)
  * Risk-on from sectorCards
  * overall4h score via weighted average

Outputs:
- data/outlook_4h.json (expected by /live/4h proxy)
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
from typing import List, Optional, Tuple

UTC = timezone.utc

POLY_4H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/240/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

OFFENSIVE = {"information technology", "consumer discretionary", "communication services", "industrials"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

FULL_EMA_DIST = 0.60

SMI_K_LEN = 12
SMI_D_LEN = 5
SMI_EMA_LEN = 5

SMI_BONUS_MAX = 5
SMI_BONUS_SCORE_MAX = 3.0

# momentum combo (balanced)
W_EMA_POSTURE = 0.50
W_SMI_4H = 0.50

# weighted-average score weights (sum=1.00)
W_EMA_SCORE = 0.35
W_MOM_SCORE = 0.25
W_BREADTH = 0.15
W_SQUEEZE = 0.10     # score uses EXPANSION as a soft factor
W_LIQ = 0.07
W_VOL = 0.05
W_RISKON = 0.03

# ---- SHORT-MEMORY PSI WINDOW (LOCKED INTENT) ----
# default ~3 trading weeks worth of 4h bars (roughly 2 bars/day => ~30 bars/3w, but we use 60 for safety)
PSI_WIN_4H = int(os.environ.get("PSI_WIN_4H", "60"))

# modest fetch, not long (keep your request)
FETCH_DAYS_4H = int(os.environ.get("FETCH_DAYS_4H", "120"))


def now_utc_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo


def pct(a: float, b: float) -> float:
    try:
        return 0.0 if b <= 0 else 100.0 * float(a) / float(b)
    except Exception:
        return 0.0


def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "make-dashboard/4h/1.4", "Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_polygon_4h(sym: str, key: str, lookback_days: int) -> List[dict]:
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
            t = int(r.get("t", 0)) // 1000
            out.append(
                {
                    "time": t,
                    "open": float(r.get("o", 0)),
                    "high": float(r.get("h", 0)),
                    "low": float(r.get("l", 0)),
                    "close": float(r.get("c", 0)),
                    "volume": float(r.get("v", 0)),
                }
            )
        except Exception:
            continue

    out.sort(key=lambda x: x["time"])

    # drop in-flight 4h bar
    if out:
        now = int(time.time())
        last = out[-1]["time"]
        if (last // (4 * 3600)) == (now // (4 * 3600)):
            out = out[:-1]
    return out


def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out


def ema_last(vals: List[float], span: int) -> Optional[float]:
    if not vals:
        return None
    return ema_series(vals, span)[-1]


def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]


def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    """
    LuxAlgo PSI (canonical):
      max := nz(max(src, max - (max-src)/conv), src)
      min := nz(min(src, min + (src-min)/conv), src)
      diff = log(max-min)
      psi  = -50*corr(diff, bar_index, length) + 50
    """
    if not closes or len(closes) < max(5, length + 2):
        return None

    mx = None
    mn = None
    diffs: List[float] = []
    eps = 1e-12

    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src) / conv, src)
        mn = src if mn is None else min(mn + (src - mn) / conv, src)
        span = max(mx - mn, eps)
        diffs.append(math.log(span))

    win = diffs[-length:]
    if len(win) < length:
        return None

    xs = list(range(length))
    xbar = sum(xs) / length
    ybar = sum(win) / length

    num = sum((x - xbar) * (y - ybar) for x, y in zip(xs, win))
    denx = sum((x - xbar) ** 2 for x in xs)
    deny = sum((y - ybar) ** 2 for y in win)
    den = math.sqrt(denx * deny) if denx > 0 and deny > 0 else 0.0

    r = (num / den) if den != 0 else 0.0
    psi = -50.0 * r + 50.0
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
        HH.append(max(H[i0:i + 1]))
        LL.append(min(L[i0:i + 1]))

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
    return clamp(50.0 + 0.5 * float(smi_val), 0.0, 100.0)


def posture_from_dist(dist_pct: float, full_dist: float) -> float:
    unit = clamp(dist_pct / max(full_dist, 1e-9), -1.0, 1.0)
    return clamp(50.0 + 50.0 * unit, 0.0, 100.0)


def score_vol(vol_scaled: float) -> float:
    return clamp(100.0 - clamp(vol_scaled, 0.0, 100.0), 0.0, 100.0)


def score_liq(liq: float) -> float:
    liq_c = clamp(liq, 0.0, 120.0)
    return (liq_c / 120.0) * 100.0


def compute_overall_weighted(
    ema_posture: float,
    momentum_combo: float,
    breadth_pct: float,
    squeeze_exp: float,
    liquidity_val: float,
    vol_scaled: float,
    risk_on: float,
    smi_bonus_pts: int,
    ema_sign: int,
) -> Tuple[str, float, dict]:
    liq_norm = score_liq(liquidity_val)
    vol_sc = score_vol(vol_scaled)

    bonus = 0.0
    if smi_bonus_pts > 0:
        bonus = +SMI_BONUS_SCORE_MAX
    elif smi_bonus_pts < 0:
        bonus = -SMI_BONUS_SCORE_MAX

    score_raw = (
        W_EMA_SCORE * ema_posture
        + W_MOM_SCORE * momentum_combo
        + W_BREADTH * clamp(breadth_pct, 0.0, 100.0)
        + W_SQUEEZE * clamp(squeeze_exp, 0.0, 100.0)
        + W_LIQ * liq_norm
        + W_VOL * vol_sc
        + W_RISKON * clamp(risk_on, 0.0, 100.0)
        + bonus
    )
    score = clamp(score_raw, 0.0, 100.0)
    state = "bull" if (ema_sign > 0 and score >= 60.0) else ("bear" if (ema_sign < 0 and score < 60.0) else "neutral")

    comps = {
        "ema10": round(W_EMA_SCORE * ema_posture, 2),
        "momentum": round(W_MOM_SCORE * momentum_combo, 2),
        "breadth": round(W_BREADTH * breadth_pct, 2),
        "squeeze": round(W_SQUEEZE * squeeze_exp, 2),
        "liquidity": round(W_LIQ * liq_norm, 2),
        "volatility": round(W_VOL * vol_sc, 2),
        "riskOn": round(W_RISKON * risk_on, 2),
        "smiBonus": round(bonus, 2),
    }
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
        with open(args.source, "r", encoding="utf-8") as f:
            src = json.load(f)
    except Exception as e:
        print("[fatal] cannot read source:", e, file=sys.stderr)
        sys.exit(2)

    cards = src.get("sectorCards") or []

    # breadth + momentum from cards
    NH = NL = UP = DN = 0.0
    for c in cards:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0))

    breadth_4h = round(pct(NH, NH + NL), 2) if (NH + NL) > 0 else 50.0
    momentum_4h_legacy = round(pct(UP, UP + DN), 2) if (UP + DN) > 0 else 50.0

    # risk-on from cards
    by = {(c.get("sector") or "").strip().lower(): c for c in cards}
    ro_score = ro_den = 0
    for s in OFFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            ro_den += 1
            if float(bp) >= 55.0:
                ro_score += 1
    for s in DEFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            ro_den += 1
            if float(bp) <= 45.0:
                ro_score += 1
    risk_on_4h = round(pct(ro_score, ro_den), 2) if ro_den > 0 else 50.0

    # SPY 4h bars (modest history, per intent)
    spy_4h = fetch_polygon_4h("SPY", key, lookback_days=FETCH_DAYS_4H)
    if len(spy_4h) < 25:
        print("[fatal] insufficient SPY 4H bars", file=sys.stderr)
        sys.exit(2)

    H = [b["high"] for b in spy_4h]
    L = [b["low"] for b in spy_4h]
    C = [b["close"] for b in spy_4h]
    V = [b["volume"] for b in spy_4h]

    # EMA10 posture
    e10 = ema_series(C, 10)[-1]
    ema_dist_pct = 0.0 if e10 == 0 else 100.0 * (C[-1] - e10) / e10
    ema_sign = 1 if ema_dist_pct > 0 else (-1 if ema_dist_pct < 0 else 0)
    ema10_posture = posture_from_dist(ema_dist_pct, FULL_EMA_DIST)

    # SMI 12/5/5
    smi_series, sig_series = tv_smi_and_signal(H, L, C, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
    smi_val = float(smi_series[-1]) if smi_series else 0.0
    sig_val = float(sig_series[-1]) if sig_series else 0.0
    smi_pct = smi_to_pct(smi_val)

    momentum_combo_4h = round(clamp(W_EMA_POSTURE * ema10_posture + W_SMI_4H * smi_pct, 0.0, 100.0), 2)

    smi_bonus = 0
    if smi_series and sig_series:
        if smi_val > sig_val:
            smi_bonus = +SMI_BONUS_MAX
        elif smi_val < sig_val:
            smi_bonus = -SMI_BONUS_MAX

    # ---- Lux PSI (SHORT-MEMORY WINDOWED) ----
    Cw = C[-PSI_WIN_4H:] if len(C) > PSI_WIN_4H else C
    psi = lux_psi_from_closes(Cw, conv=50, length=20)
    squeeze_psi_4h = float(psi) if isinstance(psi, (int, float)) else 50.0
    squeeze_exp_4h = clamp(100.0 - squeeze_psi_4h, 0.0, 100.0)

    # Liquidity + Volatility
    v3 = ema_last(V, 3)
    v12 = ema_last(V, 12)
    liquidity_4h = 0.0 if not v12 or v12 <= 0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)

    trs = tr_series(H, L, C)
    atr3 = ema_last(trs, 3) if trs else None
    vol_pct = 0.0 if not atr3 or C[-1] <= 0 else max(0.0, 100.0 * atr3 / C[-1])
    vol_scaled = round(vol_pct * 6.25, 2)

    # Sector direction
    rising_good = 0
    rising_total = 0
    for c in cards:
        bp = c.get("breadth_pct")
        mp = c.get("momentum_pct")
        if isinstance(bp, (int, float)) and isinstance(mp, (int, float)):
            rising_total += 1
            if float(bp) >= 55.0 and float(mp) >= 55.0:
                rising_good += 1
    sector_dir_4h = round(pct(rising_good, rising_total), 2) if rising_total > 0 else 50.0

    # Overall score
    state, score, comps = compute_overall_weighted(
        ema_posture=float(ema10_posture),
        momentum_combo=float(momentum_combo_4h),
        breadth_pct=float(breadth_4h),
        squeeze_exp=float(squeeze_exp_4h),
        liquidity_val=float(liquidity_4h),
        vol_scaled=float(vol_scaled),
        risk_on=float(risk_on_4h),
        smi_bonus_pts=int(smi_bonus),
        ema_sign=int(ema_sign),
    )

    updated_utc = now_utc_iso()

    metrics = {
        "trend_strength_4h_pct": round(float(score), 2),
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

        # SQUEEZE (tightness is what we display)
        "squeeze_psi_4h_pct": round(float(squeeze_psi_4h), 2),
        "squeeze_expansion_pct": round(float(squeeze_exp_4h), 2),
        "squeeze_pct": round(float(squeeze_psi_4h), 2),

        # legacy keys (kept)
        "squeeze_psi_4h": round(float(squeeze_psi_4h), 2),
        "squeeze_4h_pct": round(float(squeeze_exp_4h), 2),

        "liquidity_4h": round(float(liquidity_4h), 2),
        "volatility_4h_pct": round(float(vol_pct), 3),
        "volatility_4h_scaled": float(vol_scaled),

        "sector_dir_4h_pct": float(sector_dir_4h),
        "riskOn_4h_pct": float(risk_on_4h),

        # debug
        "psi_window_4h_bars": int(PSI_WIN_4H),
        "fetch_days_4h": int(FETCH_DAYS_4H),
    }

    fourHour = {
        "sectorDirection4h": {"risingPct": float(sector_dir_4h)},
        "riskOn4h": {"riskOnPct": float(risk_on_4h)},
        "overall4h": {"state": state, "score": round(float(score), 2), "components": comps, "lastChanged": updated_utc},
        "signals": {
            "sigSMI4hBullCross": {"active": False, "reason": "", "lastChanged": updated_utc},
            "sigSMI4hBearCross": {"active": False, "reason": "", "lastChanged": updated_utc},
        },
    }

    out = {
        "version": "r4h-v4-weightedavg-shortpsi",
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
        f"[4h] score={score:.2f} state={state} emaPost={ema10_posture:.2f} mom={momentum_combo_4h:.2f} "
        f"breadth={breadth_4h:.2f} psi={squeeze_psi_4h:.2f} exp={squeeze_exp_4h:.2f} "
        f"liq={liquidity_4h:.2f} volScaled={vol_scaled:.2f} riskOn={risk_on_4h:.2f} "
        f"smiBonus={smi_bonus:+d} psiWin={PSI_WIN_4H}",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[4h-error]", e, file=sys.stderr)
        sys.exit(2)
