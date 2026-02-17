#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_hourly.py (R13.2 — SHORT-MEMORY LUX PSI, 10m-Behavior)

LOCKED INTENT (per old teammate):
- 10m Lux PSI is canonical behavior.
- 1h Lux PSI must behave like 10m (short-memory "current squeeze"), NOT like TradingView long-history memory.
- Lux PSI is a state detector, not a historical memory.
- Dashboard squeeze represents PSI tightness (higher = tighter), NOT expansion.
- 1h squeeze is a soft component (not a gate).

What this script does (1h):
- Builds hourly payload: data/outlook_hourly.json
- Uses sectorCards (NH/NL and UP/DOWN) from source JSON, or falls back to prior /live/hourly
- Fetches SPY 1h bars from Polygon (modest lookback)
- Computes:
  * EMA10 posture from dist (0..100)
  * SMI 12/5/5 + signal, normalized 0..100
  * Momentum combo (EMA posture + SMI, plus optional 4h anchor)
  * Lux PSI tightness (0..100) using SHORT window input closes
  * Liquidity EMA(vol3/vol12)
  * Volatility ATR% scaled
  * Risk-on from sectorCards
- Computes overall1h.score as weighted average (0..100) with small SMI bonus nudge.

NOTE:
- Lookback for fetching bars does NOT need to be long.
- Short-memory PSI is enforced by WINDOWING the closes fed into lux_psi_from_closes().
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

HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"

POLY_1H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/60/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)
POLY_4H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/240/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

OFFENSIVE = {"information technology", "consumer discretionary", "communication services", "industrials"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

# EMA distance saturation
FULL_EMA_DIST = 0.60

# SMI params (TradingView-equivalent)
SMI_K_LEN = 12
SMI_D_LEN = 5
SMI_EMA_LEN = 5

# Momentum combo weights (balanced, no dominance)
W_EMA10_POSTURE = 0.45
W_SMI1H_POSTURE = 0.45
W_SMI4H_ANCHOR = 0.10

# Weighted-average overall score weights (sum=1.00)
W_EMA_SCORE = 0.35
W_MOM_SCORE = 0.25
W_BREADTH = 0.15
W_SQUEEZE = 0.10     # uses EXPANSION for score (like before), but tile displays tightness
W_LIQ = 0.07
W_VOL = 0.05
W_RISKON = 0.03

# SMI bonus small nudge
SMI_BONUS_MAX = 5
SMI_BONUS_SCORE_MAX = 3.0

# ---- SHORT-MEMORY PSI WINDOW (LOCKED INTENT) ----
# default ~10 trading days of 1h bars (approx 24 bars/day)
PSI_WIN_1H = int(os.environ.get("PSI_WIN_1H", "120"))

# modest fetch lookbacks (NOT long)
FETCH_DAYS_1H = int(os.environ.get("FETCH_DAYS_1H", "40"))
FETCH_DAYS_4H_ANCHOR = int(os.environ.get("FETCH_DAYS_4H_ANCHOR", "80"))


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
    req = urllib.request.Request(url, headers={"User-Agent": "make-dashboard/1h/1.6", "Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_polygon_bars(url_tmpl: str, key: str, sym: str, lookback_days: int) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = url_tmpl.format(sym=sym, start=start, end=end, key=key)

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

    # drop in-flight 1h bucket
    if out:
        bucket = 3600
        now = int(time.time())
        cur = (now // bucket) * bucket
        if out[-1]["time"] == cur:
            out.pop()
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
    """
    TradingView-equivalent SMI:
      Uses double EMA smoothing on rel and rangeHL with lengthD, then signal EMA lengthEMA.
    """
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


def build_hourly(source_js: Optional[dict], hourly_url: str) -> dict:
    # fallback to prior live hourly (signals + sectorCards if missing)
    prev_js = {}
    try:
        prev_js = fetch_json(hourly_url) or {}
    except Exception:
        prev_js = {}

    cards: List[dict] = []
    cards_fresh = False
    if isinstance(source_js, dict):
        if isinstance(source_js.get("sectorCards"), list):
            cards = source_js["sectorCards"]
            cards_fresh = True
        elif isinstance(source_js.get("sectors"), list):
            cards = source_js["sectors"]
            cards_fresh = True

    if not cards:
        try:
            h = prev_js if prev_js else fetch_json(hourly_url)
            cards = (h.get("sectorCards") or h.get("sectors") or [])
            cards_fresh = False
        except Exception:
            cards = []
            cards_fresh = False

    # breadth + momentum from cards (NH/NL & UP/DOWN)
    NH = NL = UP = DN = 0.0
    for c in cards or []:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0))

    breadth_slow = round(pct(NH, NH + NL), 2) if (NH + NL) > 0 else 50.0
    momentum_slow = round(pct(UP, UP + DN), 2) if (UP + DN) > 0 else 50.0

    # sector direction risingPct
    rising_good = 0
    rising_total = 0
    for c in cards or []:
        bp = c.get("breadth_pct")
        mp = c.get("momentum_pct")
        if isinstance(bp, (int, float)) and isinstance(mp, (int, float)):
            rising_total += 1
            if float(bp) >= 55.0 and float(mp) >= 55.0:
                rising_good += 1
    rising_pct = round(pct(rising_good, rising_total), 2) if rising_total > 0 else 50.0

    # risk-on
    by = {(c.get("sector") or "").strip().lower(): c for c in cards or []}
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
    risk_on_pct = round(pct(ro_score, ro_den), 2) if ro_den > 0 else 50.0

    # Polygon bars
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
    spy_1h: List[dict] = []
    spy_4h: List[dict] = []
    if key:
        spy_1h = fetch_polygon_bars(POLY_1H_URL, key, "SPY", lookback_days=FETCH_DAYS_1H)
        spy_4h = fetch_polygon_bars(POLY_4H_URL, key, "SPY", lookback_days=FETCH_DAYS_4H_ANCHOR)

    # Defaults
    ema_sign = 0
    ema_dist_pct = 0.0
    ema10_posture = 50.0

    smi_1h = None
    smi_sig_1h = None
    smi_pct_1h = None
    smi_pct_4h = None

    # EMA10 posture + SMI 1h
    if len(spy_1h) >= 25:
        H = [b["high"] for b in spy_1h]
        L = [b["low"] for b in spy_1h]
        C = [b["close"] for b in spy_1h]

        e10 = ema_series(C, 10)
        if e10[-1] and e10[-1] != 0:
            ema_dist_pct = 100.0 * (C[-1] - e10[-1]) / e10[-1]

        ema_sign = 1 if ema_dist_pct > 0 else (-1 if ema_dist_pct < 0 else 0)
        ema10_posture = posture_from_dist(ema_dist_pct, FULL_EMA_DIST)

        smi_series, sig_series = tv_smi_and_signal(H, L, C, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
        if smi_series and sig_series:
            smi_1h = float(smi_series[-1])
            smi_sig_1h = float(sig_series[-1])
            smi_pct_1h = smi_to_pct(smi_1h)

    # optional 4h anchor SMI (for momentum combo only)
    if len(spy_4h) >= 25:
        H4 = [b["high"] for b in spy_4h]
        L4 = [b["low"] for b in spy_4h]
        C4 = [b["close"] for b in spy_4h]
        smi4, sig4 = tv_smi_and_signal(H4, L4, C4, SMI_K_LEN, SMI_D_LEN, SMI_EMA_LEN)
        if smi4 and sig4:
            smi_pct_4h = smi_to_pct(float(smi4[-1]))

    # momentum combo
    momentum_combo_1h = float(ema10_posture)
    if isinstance(smi_pct_1h, (int, float)) or isinstance(smi_pct_4h, (int, float)):
        wE, w1, w4 = W_EMA10_POSTURE, W_SMI1H_POSTURE, W_SMI4H_ANCHOR
        if smi_pct_1h is None:
            wE, w1, w4 = 0.75, 0.00, 0.25
        if smi_pct_4h is None:
            wE, w1, w4 = 0.55, 0.45, 0.00
        momentum_combo_1h = (
            wE * float(ema10_posture)
            + w1 * float(smi_pct_1h if smi_pct_1h is not None else ema10_posture)
            + w4 * float(smi_pct_4h if smi_pct_4h is not None else ema10_posture)
        )
    momentum_combo_1h = round(clamp(momentum_combo_1h, 0.0, 100.0), 2)

    # SMI bonus points
    smi_bonus_pts = 0
    if isinstance(smi_1h, (int, float)) and isinstance(smi_sig_1h, (int, float)):
        if smi_1h > smi_sig_1h:
            smi_bonus_pts = +SMI_BONUS_MAX
        elif smi_1h < smi_sig_1h:
            smi_bonus_pts = -SMI_BONUS_MAX

    # ---- Lux PSI (SHORT-MEMORY WINDOWED) ----
    squeeze_psi_1h = None
    squeeze_exp_1h = 50.0
    if len(spy_1h) >= 25:
        C = [b["close"] for b in spy_1h]
        Cw = C[-PSI_WIN_1H:] if len(C) > PSI_WIN_1H else C
        psi = lux_psi_from_closes(Cw, conv=50, length=20)
        if isinstance(psi, (int, float)):
            squeeze_psi_1h = float(psi)
            squeeze_exp_1h = clamp(100.0 - float(psi), 0.0, 100.0)

    # Liquidity + Volatility
    liquidity_1h = 50.0
    volatility_1h_pct = 0.0
    volatility_1h_scaled = 0.0

    if len(spy_1h) >= 3:
        V = [b["volume"] for b in spy_1h]
        v3 = ema_last(V, 3)
        v12 = ema_last(V, 12)
        liquidity_1h = 0.0 if not v12 or v12 <= 0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)

        C = [b["close"] for b in spy_1h]
        H = [b["high"] for b in spy_1h]
        L = [b["low"] for b in spy_1h]
        trs = tr_series(H, L, C)
        atr = ema_last(trs, 3) if trs else None
        volatility_1h_pct = 0.0 if not atr or C[-1] <= 0 else max(0.0, 100.0 * atr / C[-1])
        volatility_1h_scaled = round(float(volatility_1h_pct) * 6.25, 2)

    # Overall score (uses expansion as a soft component)
    state, score, comps = compute_overall_weighted(
        ema_posture=float(ema10_posture),
        momentum_combo=float(momentum_combo_1h),
        breadth_pct=float(breadth_slow),
        squeeze_exp=float(squeeze_exp_1h),
        liquidity_val=float(liquidity_1h),
        vol_scaled=float(volatility_1h_scaled),
        risk_on=float(risk_on_pct),
        smi_bonus_pts=int(smi_bonus_pts),
        ema_sign=int(ema_sign),
    )

    updated_utc = now_utc_iso()

    metrics = {
        "trend_strength_1h_pct": round(float(score), 2),

        "breadth_1h_pct": float(breadth_slow),
        "momentum_1h_pct": float(momentum_slow),  # legacy required
        "momentum_combo_1h_pct": float(momentum_combo_1h),

        # SQUEEZE: tightness for display, expansion available for score/debug
        "squeeze_psi_1h_pct": round(float(squeeze_psi_1h), 2) if isinstance(squeeze_psi_1h, (int, float)) else None,
        "squeeze_expansion_pct": round(float(squeeze_exp_1h), 2),
        "squeeze_pct": round(float(squeeze_psi_1h), 2) if isinstance(squeeze_psi_1h, (int, float)) else None,

        # legacy fields (keep for compatibility)
        "squeeze_1h_pct": round(float(squeeze_exp_1h), 2),

        "ema_sign": int(ema_sign),
        "ema10_dist_pct": round(float(ema_dist_pct), 4),
        "ema10_posture_1h_pct": round(float(ema10_posture), 2),

        "smi_1h": float(smi_1h) if isinstance(smi_1h, (int, float)) else None,
        "smi_signal_1h": float(smi_sig_1h) if isinstance(smi_sig_1h, (int, float)) else None,
        "smi_1h_pct": round(float(smi_pct_1h), 2) if isinstance(smi_pct_1h, (int, float)) else None,
        "smi_bonus_pts": int(smi_bonus_pts),

        "liquidity_1h": round(float(liquidity_1h), 2),
        "volatility_1h_pct": round(float(volatility_1h_pct), 3),
        "volatility_1h_scaled": float(volatility_1h_scaled),

        "breadth_slow_pct": float(breadth_slow),
        "momentum_slow_pct": float(momentum_slow),
    }

    hourly = {
        "sectorDirection1h": {"risingPct": float(rising_pct)},
        "riskOn1h": {"riskOnPct": float(risk_on_pct)},
        "overall1h": {"state": state, "score": round(float(score), 2), "components": comps},
        "signals": (prev_js.get("hourly") or {}).get("signals") or {},
    }

    out = {
        "version": "r1h-v6-weightedavg-shortpsi",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated_utc,
        "metrics": metrics,
        "hourly": hourly,
        "sectorCards": cards,
        "meta": {
            "cards_fresh": bool(cards_fresh),
            "after_hours": False,
            "psi_window_1h_bars": int(PSI_WIN_1H),
            "fetch_days_1h": int(FETCH_DAYS_1H),
        },
    }

    print(
        f"[1h] score={score:.2f} state={state} emaPost={ema10_posture:.2f} mom={momentum_combo_1h:.2f} "
        f"breadth={breadth_slow:.2f} psi={float(squeeze_psi_1h or 0.0):.2f} exp={squeeze_exp_1h:.2f} "
        f"liq={liquidity_1h:.2f} volScaled={volatility_1h_scaled:.2f} riskOn={risk_on_pct:.2f} "
        f"smiBonus={smi_bonus_pts:+d} psiWin={PSI_WIN_1H}",
        flush=True,
    )
    return out


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
