#!/usr/bin/env python3
"""
metrics_10.py — 10-minute Market Meter math (pure, importable)

Implements the formulas we locked on:
- Squeeze%  (BB/KC over last ~6 x 10m bars)  ∈ [0..100]
- Liquidity% (100 * EMA(vol,3)/EMA(vol,12))  ∈ [0..200], floor=0
- Volatility% (100 * EMA(TR,3)/Close)        small (0.2–1.2 for SPY 10m)
- Volatility_scaled = Volatility% * 6.25     daily-normalized for display only
- Breadth%  = ΣNH / (ΣNH + ΣNL)              from sectorCards
- Momentum% = ΣUp / (ΣUp + ΣDown)            from sectorCards
- Rising%   = %sectors with breadth_pct > 50
- RiskOn%   = (#offensive>50 + #defensive<50) / total considered * 100

Overall10m score (0–100) with fixed weights:
- EMA 40 / Momentum 25 / Breadth 10 / Squeeze 10 / Liquidity 10 / RiskOn 5
state:
  bull if ema_sign > 0 and score >= 60
  bear if ema_sign < 0 and score < 60
  else neutral
"""

from __future__ import annotations
from typing import Dict, List, Tuple, Optional


# ---------------------- utils ----------------------
def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def ema_last(values: List[float], span: int) -> Optional[float]:
    if not values:
        return None
    k = 2.0 / (span + 1.0)
    out = None
    for x in values:
        out = x if out is None else out + k * (x - out)
    return out

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    trs = []
    for i in range(1, len(C)):
        trs.append(max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])))
    return trs


# ---------------------- intraday (bars → metrics) ----------------------
def squeeze_pct_10m(H: List[float], L: List[float], C: List[float], lookback: int = 6) -> Optional[float]:
    n = lookback
    if min(len(H), len(L), len(C)) < n:
        return None
    cn = C[-n:]; hn = H[-n:]; ln = L[-n:]
    mean = sum(cn) / n
    sd = (sum((x - mean) ** 2 for x in cn) / n) ** 0.5
    bb_w = (mean + 2 * sd) - (mean - 2 * sd)
    prevs = cn[:-1] + [cn[-1]]
    trs6 = [max(h - l, abs(h - p), abs(l - p)) for h, l, p in zip(hn, ln, prevs)]
    kc_w = 2.0 * (sum(trs6) / len(trs6)) if trs6 else 0.0
    if kc_w <= 0:
        return None
    return clamp(100.0 * (bb_w / kc_w), 0.0, 100.0)

def liquidity_pct_10m(V: List[float]) -> Optional[float]:
    if not V:
        return None
    v3 = ema_last(V, 3)
    v12 = ema_last(V, 12)
    if not v12 or v12 <= 0:
        return 0.0
    # floor at 0; cap visual at 200
    return clamp(100.0 * (v3 / v12), 0.0, 200.0)

def volatility_pct_10m(H: List[float], L: List[float], C: List[float]) -> Optional[float]:
    if not C:
        return None
    if len(C) >= 2:
        trs = tr_series(H, L, C)
        atr_fast = ema_last(trs, 3) if trs else None
        if atr_fast and C[-1] > 0:
            return max(0.0, 100.0 * atr_fast / C[-1])
    else:
        # minimal fallback with 1 bar
        tr = max(H[-1] - L[-1], abs(H[-1] - C[-1]), abs(L[-1] - C[-1]))
        return max(0.0, 100.0 * tr / C[-1]) if C[-1] else 0.0
    return None

def volatility_scaled(vol_pct: Optional[float]) -> float:
    """Daily-normalized display value (sqrt(390/10)≈6.25)."""
    if vol_pct is None:
        return 0.0
    return round(vol_pct * 6.25, 2)


# ---------------------- sectorCards (counts → metrics) ----------------------
OFFENSIVE = {"information technology", "consumer discretionary", "communication services"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

def breadth_momentum_rising_riskon_from_cards(sector_cards: List[Dict]) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
    nh = sum(float(c.get("nh", 0)) for c in sector_cards)
    nl = sum(float(c.get("nl", 0)) for c in sector_cards)
    up = sum(float(c.get("up", 0)) for c in sector_cards)
    dn = sum(float(c.get("down", 0)) for c in sector_cards)

    breadth = 100.0 * nh / (nh + nl) if (nh + nl) > 0 else None
    momentum = 100.0 * up / (up + dn) if (up + dn) > 0 else None

    # Rising% = share of sectors with breadth_pct > 50
    good = 0; total = 0
    for c in sector_cards:
        bp = c.get("breadth_pct")
        if isinstance(bp, (int, float)):
            total += 1
            if bp > 50.0:
                good += 1
    rising = 100.0 * good / total if total > 0 else None

    # RiskOn% = offensive>50 + defensive<50 over considered
    by = {(c.get("sector") or "").strip().lower(): c for c in sector_cards}
    score = total2 = 0
    for s in OFFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            total2 += 1
            if bp > 50.0:
                score += 1
    for s in DEFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            total2 += 1
            if bp < 50.0:
                score += 1
    risk_on = 100.0 * score / total2 if total2 > 0 else None

    # round to 2 for presentation
    def r2(x): return None if x is None else round(x, 2)
    return r2(breadth), r2(momentum), r2(rising), r2(risk_on)


# ---------------------- overall10m score ----------------------
def overall10m_score(
    ema_sign: int,
    ema10_dist_pct: float,
    momentum_pct: float,
    breadth_pct: float,
    squeeze_pct: float,
    liquidity_pct: float,
    riskon_pct: float,
) -> Tuple[str, int, Dict[str, int]]:
    """
    Weights: EMA 40 / Momentum 25 / Breadth 10 / Squeeze 10 / Liquidity 10 / RiskOn 5
    EMA scaling: FULL_EMA_DIST = 0.60% distance → full ±40 pts
    """
    FULL_EMA_DIST = 0.60
    # EMA points
    dist_unit = clamp(ema10_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = round(40 * abs(dist_unit)) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)

    def lin_points(percent: float, weight: int) -> int:
        # 50% → 0 ; 100% → +weight ; 0% → -weight
        return int(round(weight * ((float(percent) - 50.0) / 50.0)))

    momentum_pts = lin_points(momentum_pct, 25)
    breadth_pts  = lin_points(breadth_pct, 10)
    squeeze_pts  = lin_points(squeeze_pct, 10)
    liq60 = clamp(liquidity_pct, 0.0, 120.0)
    liq_pts      = lin_points(min(100.0, liq60), 10)
    riskon_pts   = lin_points(riskon_pct, 5)

    total = ema_pts + momentum_pts + breadth_pts + squeeze_pts + liq_pts + riskon_pts
    score = max(0, min(100, 50 + total))  # center at 50, clamp 0..100

    if ema_sign > 0 and score >= 60:
        state = "bull"
    elif ema_sign < 0 and score < 60:
        state = "bear"
    else:
        state = "neutral"

    components = {
        "ema10": ema_pts,
        "momentum": momentum_pts,
        "breadth": breadth_pts,
        "squeeze": squeeze_pts,
        "liquidity": liq_pts,
        "riskOn": riskon_pts,
    }
    return state, score, components
