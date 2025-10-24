#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard.py (Intraday 10m, R12 v3: groups→sectorCards bridge + Outlook labels + Lux Squeeze)

Builds /live/intraday with v1 fields.

Changes vs R12 v2:
- If the source contains `groups` (sector -> {nh,nl,u,d}) but no `sectorCards`, we synthesize them.
- Adds `outlook` label to each sector card:
    Bullish : breadth_pct >= 55 AND momentum_pct >= 55
    Bearish : breadth_pct <= 45 AND momentum_pct <= 45
    Neutral : otherwise
- Canonical ordering + aliasing kept.
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

# 11 sector ETFs for Breadth universe
SECTOR_ETFS = ["XLK","XLY","XLC","XLP","XLU","XLV","XLRE","XLE","XLF","XLB","XLI"]

# Canonical order + alias map for sector card names
CANON_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]
ALIASES = {
    "healthcare":"health care","health-care":"health care",
    "info tech":"information technology","technology":"information technology","tech":"information technology",
    "communications":"communication services","comm services":"communication services","telecom":"communication services",
    "staples":"consumer staples","discretionary":"consumer discretionary",
    "finance":"financials","industry":"industrials","reit":"real estate","reits":"real estate",
}

# Squeeze lookback (10-minute bars)
SQUEEZE_LOOKBACK_10M = 6  # last ~1 hour (6 × 10m bars)

# Overall weights
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60  # % distance to reach full ±40pts

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
    # Drop in-flight 10m bar
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

# ------------------------- Slow (daily/right) -------------------------
def summarize_counts(cards: List[dict]) -> Tuple[float,float,float,float]:
    NH = NL = UP = DN = 0.0
    for c in cards or []:
        NH += float(c.get("nh",0))
        NL += float(c.get("nl",0))
        UP += float(c.get("up",0))
        DN += float(c.get("down",0))
    breadth_slow  = round(pct(NH, NH+NL), 2)
    momentum_slow = round(pct(UP, UP+DN), 2)
    # rising%
    good = total = 0
    for c in cards or []:
        bp = c.get("breadth_pct")
        if isinstance(bp,(int,float)):
            total += 1
            if bp > 50.0: good += 1
    rising = round(pct(good, total), 2)
    # risk-on
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

# ------------------------- SPY intraday gauges -------------------------
def squeeze_raw_bbkc(H: List[float], L: List[float], C: List[float], lookback: int) -> Optional[float]:
    """BB/KC ratio ×100 on last lookback bars. HIGH = TIGHT compression."""
    if min(len(H),len(L),len(C)) < lookback: return None
    n = lookback
    cn, hn, ln = C[-n:], H[-n:], L[-n:]
    mean = sum(cn)/n
    sd = (sum((x-mean)**2 for x in cn)/n) ** 0.5
    bb_w = (mean+2*sd) - (mean-2*sd)
    prevs = cn[:-1] + [cn[-1]]
    trs = [max(h-l, abs(h-p), abs(l-p)) for h,l,p in zip(hn,ln,prevs)]
    kc_w = 2.0 * (sum(trs)/len(trs)) if trs else 0.0
    if kc_w <= 0.0: return None
    return clamp(100.0 * (bb_w / kc_w), 0.0, 100.0)

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

# ------------------------- SMI (EMA %K=12, %D=7, EMA=5) -------------------------
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
    """Rolling 60-minute SMI using last 6×10m bars (RTH+AH)."""
    if len(bars10m) < 6:
        return None, None
    win = bars10m[-6:]
    H = [b["high"] for b in win]
    L = [b["low"]  for b in win]
    C = [b["close"] for b in win]
    return smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)

# ------------------------- SPY EMA posture (gap + fresh-cross) -------------------------
def spy_ema_posture_score(C: List[float], max_gap_pct: float = 0.50,
                          cross_age_10m: int = 0, max_bonus_pts: float = 6.0, fade_bars: int = 6) -> float:
    e10 = ema_series(C, 10); e20 = ema_series(C, 20)
    e10_prev, e20_prev = e10[-2], e20[-2]
    e10_now,  e20_now  = e10[-1], e20[-1]
    diff_pct = 0.0 if e20_now == 0 else 100.0 * (e10_now - e20_now) / e20_now
    sign = 1.0 if diff_pct > 0 else (-1.0 if diff_pct < 0 else 0.0)
    mag  = min(1.0, abs(diff_pct) / max_gap_pct)  # 0..1
    posture = 50.0 + 50.0 * sign * mag            # 0..100

    bonus = 0.0
    age = min(max(cross_age_10m, 0), fade_bars)
    if e10_prev <= e20_prev and e10_now > e20_now:
        bonus = max_bonus_pts * (1.0 - age / fade_bars)
    elif e10_prev >= e20_prev and e10_now < e20_now:
        bonus = -max_bonus_pts * (1.0 - age / fade_bars)

    return float(clamp(posture + bonus, 0.0, 100.0))

# ------------------------- FAST Breadth components + sector momentum -------------------------
def fast_components_etfs(bars_by_sym: Dict[str, List[dict]]) -> Tuple[
    Optional[float],  # alignment_raw_pct (EMA10>EMA20)
    Optional[float],  # bar_raw_pct       (close>open)
]:
    syms = [s for s in SECTOR_ETFS if s in bars_by_sym and len(bars_by_sym[s])>=2]
    if not syms: return None, None
    total = len(syms)
    aligned_up = 0
    bar_rising = 0
    for s in syms:
        bars = bars_by_sym[s]
        C = [b["close"] for b in bars]
        O = [b["open"]  for b in bars]
        e10 = ema_series(C, 10); e20 = ema_series(C, 20)
        if e10[-1] > e20[-1]:
            aligned_up += 1
        if C[-1] > O[-1]:
            bar_rising += 1
    alignment_raw = round(100.0 * aligned_up / total, 2)
    bar_raw       = round(100.0 * bar_rising / total, 2)
    return alignment_raw, bar_raw

def fast_momentum_sector(bars_by_sym: Dict[str, List[dict]]) -> Tuple[
    Optional[float], Optional[float], Optional[float]
]:
    syms = [s for s in SECTOR_ETFS if s in bars_by_sym and len(bars_by_sym[s])>=2]
    if not syms: return None, None, None
    total = len(syms)
    ema10_gt_ema20 = 0
    cross_up = cross_down = 0
    for s in syms:
        bars = bars_by_sym[s]
        C = [b["close"] for b in bars]
        e10 = ema_series(C,10); e20 = ema_series(C,20)
        e10_now, e20_now = e10[-1], e20[-1]
        e10_prev, e20_prev = e10[-2], e20[-2]
        if e10_now > e20_now: ema10_gt_ema20 += 1
        if e10_prev <= e20_prev and e10_now > e20_now: cross_up += 1
        if e10_prev >= e20_prev and e10_now < e20_now: cross_down += 1
    base_mom = 100.0 * ema10_gt_ema20 / total
    up_pct   = 100.0 * cross_up / total
    dn_pct   = 100.0 * cross_down / total
    momentum_10m = round(clamp(base_mom + 0.5*up_pct - 0.5*dn_pct, 0.0, 100.0), 2)
    return momentum_10m, round(up_pct,2), round(dn_pct,2)

# ------------------------- groups → sectorCards + outlook -------------------------
def norm(s: str) -> str:
    return (s or "").strip().lower()

def canon_name(name: str) -> str:
    n = norm(name)
    return ALIASES.get(n, n)

def _label_outlook(card: dict) -> str:
    b = float(card.get("breadth_pct", 0) or 0.0)
    m = float(card.get("momentum_pct", 0) or 0.0)
    if b >= 55.0 and m >= 55.0:
        return "Bullish"
    if b <= 45.0 and m <= 45.0:
        return "Bearish"
    return "Neutral"

def _apply_outlooks(cards: List[dict]) -> List[dict]:
    out = []
    for c in cards or []:
        c2 = dict(c)
        c2["outlook"] = _label_outlook(c2)
        out.append(c2)
    return out

def groups_to_cards(groups: Dict[str, Dict[str, int]]) -> List[dict]:
    """Convert groups[sector] = {nh,nl,u,d} → sectorCards with pcts + counts, in canonical order."""
    bykey: Dict[str, dict] = {}
    for raw_name, g in (groups or {}).items():
        k = canon_name(raw_name)
        nh, nl, u, d = int(g.get("nh",0)), int(g.get("nl",0)), int(g.get("u",0)), int(g.get("d",0))
        b = pct(nh, nh+nl); m = pct(u, u+d)
        bykey[k] = {
            "sector": k.title(),
            "breadth_pct": round(b, 2),
            "momentum_pct": round(m, 2),
            "nh": nh, "nl": nl, "up": u, "down": d,
        }
    cards: List[dict] = []
    for name in CANON_ORDER:
        cards.append(bykey.get(name, {
            "sector": name.title(),
            "breadth_pct": 0.0, "momentum_pct": 0.0,
            "nh": 0, "nl": 0, "up": 0, "down": 0
        }))
    return cards

# ------------------------- Core builder -------------------------
def build_intraday(source_js: Optional[dict] = None,
                   hourly_url: str = HOURLY_URL_DEFAULT,
                   prev_out: Optional[dict] = None) -> dict:
    # 1) sectorCards (source or hourly fallback) → slow counts (daily/right)
    sector_cards: List[dict] = []

    # A) try native sectorCards first
    if isinstance(source_js, dict):
        sector_cards = (source_js.get("sectorCards")
                        or source_js.get("outlook", {}).get("sectorCards")
                        or [])
    # B) if missing, but groups present, synthesize sectorCards
    if (not sector_cards) and isinstance(source_js, dict) and "groups" in source_js:
        try:
            sector_cards = groups_to_cards(source_js.get("groups") or {})
        except Exception:
            sector_cards = []

    # C) apply outlook labels
    sector_cards = _apply_outlooks(sector_cards)

    cards_fresh = True if sector_cards else False

    # D) final fallback: hourly live file (keeps UI populated if intraday source absent)
    if not sector_cards:
        try:
            hourly = fetch_json(hourly_url)
            tmp_cards = hourly.get("sectorCards") or hourly.get("sectors") or []
            sector_cards = _apply_outlooks(tmp_cards)
            cards_fresh = False
        except Exception:
            sector_cards = []
            cards_fresh = False

    # --- compute slow/right stats from cards ---
    breadth_slow, momentum_slow, rising_pct, risk_on_pct = summarize_counts(sector_cards)

    # 2) Polygon bars (RTH+AH)
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    bars_by_sym: Dict[str, List[dict]] = {}
    if key:
        bars_by_sym["SPY"] = fetch_polygon_10m(key, "SPY")
        for s in SECTOR_ETFS:
            bars_by_sym[s] = fetch_polygon_10m(key, s)

    # 3) SPY intraday gauges + EMA posture
    squeeze_exp_pct  = None   # TILE + Overall (0=tight, 100=expanded)
    liquidity_pct = None
    volatility_pct = None
    ema_cross="none"; just_crossed=False; ema_sign=0; ema10_dist_pct=0.0

    spy_bars = bars_by_sym.get("SPY", [])
    if len(spy_bars) >= 2:
        H = [b["high"] for b in spy_bars]
        L = [b["low"]  for b in spy_bars]
        C = [b["close"] for b in spy_bars]
        V = [b["volume"] for b in spy_bars]

        # Lux-style Expansion: sq_raw = BB/KC*100 (HIGH=TIGHT) → Expansion = 100 - sq_raw
        sq_raw = squeeze_raw_bbkc(H, L, C, lookback=SQUEEZE_LOOKBACK_10M)
        if sq_raw is not None:
            squeeze_exp_pct  = clamp(100.0 - sq_raw, 0.0, 100.0)

        # Liquidity/Volatility
        liq = liquidity_pct_spy(V)
        vol = volatility_pct_spy(H, L, C)
        liquidity_pct  = 50.0 if liq is None else liq
        volatility_pct = 0.0  if vol is None else vol

        # EMA posture + cross
        e10 = ema_series(C,10); e20 = ema_series(C,20)
        e10_prev, e20_prev = e10[-2], e20[-2]
        e10_now,  e20_now  = e10[-1], e20[-1]
        close_now = C[-1]
        if e10_prev <= e20_prev and e10_now > e20_now: ema_cross, just_crossed = "bull", True
        elif e10_prev >= e20_prev and e10_now < e20_now: ema_cross, just_crossed = "bear", True
        ema_sign = 1 if e10_now > e20_now else (-1 if e10_now < 0 else 0)
        ema10_dist_pct = 0.0 if e10_now == 0 else 100.0 * (close_now - e10_now) / e10_now

    # 4) FAST Breadth components + sector momentum
    alignment_raw = bar_raw = None
    breadth_10m = None
    momentum_10m = None
    if key:
        alignment_raw, bar_raw = fast_components_etfs({s: bars_by_sym.get(s, []) for s in SECTOR_ETFS})
        m10, _, _ = fast_momentum_sector({s: bars_by_sym.get(s, []) for s in SECTOR_ETFS})
        momentum_10m = m10

    # Persisted smoothing for breadth components (L=2) via prev_out
    prev_metrics = (prev_out or {}).get("metrics") or {}
    align_fast = ema_blend(prev_metrics.get("breadth_align_pct_fast"), alignment_raw, L=2) \
                 if alignment_raw is not None else prev_metrics.get("breadth_align_pct_fast")
    bar_fast   = ema_blend(prev_metrics.get("breadth_bar_pct_fast"),   bar_raw,       L=2) \
                 if bar_raw is not None else prev_metrics.get("breadth_bar_pct_fast")

    a_val = align_fast if isinstance(align_fast,(int,float)) else alignment_raw
    b_val = bar_fast   if isinstance(bar_fast,(int,float))   else bar_raw
    if a_val is None and b_val is None:
        breadth_10m = breadth_slow  # last resort
    else:
        a_v = 0.0 if a_val is None else float(a_val)
        b_v = 0.0 if b_val is None else float(b_val)
        breadth_10m = round(clamp(0.60 * a_v + 0.40 * b_v, 0.0, 100.0), 2)

    # 5) SPY Momentum blend (EMA posture + SMI10m + SMI1h live)
    ema_score = 50.0
    smi10_k = smi10_d = smi1h_k = smi1h_d = None
    smi10_score = smi1h_score = None
    if len(spy_bars) >= 2:
        C = [b["close"] for b in spy_bars]
        ema_score = spy_ema_posture_score(C, max_gap_pct=0.50, cross_age_10m=0,
                                          max_bonus_pts=6.0, fade_bars=6)
        H = [b["high"] for b in spy_bars]; L = [b["low"] for b in spy_bars]
        smi10_k, smi10_d = smi_kd(H, L, C, k_len=12, d_len=7, ema_len=5)
        if smi10_k is not None and smi10_d is not None:
            smi10_score = clamp(50.0 + 0.5 * (smi10_k - smi10_d), 0.0, 100.0)
        smi1h_k, smi1h_d = smi_1h_live_from_10m(spy_bars)
        if smi1h_k is not None and smi1h_d is not None:
            smi1h_score = clamp(50.0 + 0.5 * (smi1h_k - smi1h_d), 0.0, 100.0)

    if smi10_score is None and smi1h_score is None:
        momentum_combo = ema_score
    else:
        w_ema, w_smi10, w_smi1h = 0.60, 0.15, 0.25
        momentum_combo = (w_ema * ema_score
                          + w_smi10 * (smi10_score if smi10_score is not None else ema_score)
                          + w_smi1h * (smi1h_score if smi1h_score is not None else ema_score))
    momentum_combo = round(clamp(momentum_combo, 0.0, 100.0), 2)

    if momentum_10m is None: momentum_10m = momentum_slow
    if squeeze_exp_pct is None: squeeze_exp_pct = 50.0
    if liquidity_pct   is None: liquidity_pct   = 50.0
    if volatility_pct  is None: volatility_pct  = 0.0

    # 6) Overall
    state, score, components = compute_overall10m(
        ema_sign=ema_sign,
        ema10_dist_pct=ema10_dist_pct,
        momentum_pct=momentum_combo,
        breadth_pct=breadth_10m,
        squeeze_expansion_pct=squeeze_exp_pct,
        liquidity_pct=liquidity_pct,
        riskon_pct=risk_on_pct,
    )

    # 7) Pack metrics
    metrics = {
        "breadth_10m_pct": breadth_10m,
        "breadth_align_pct": round(alignment_raw, 2) if isinstance(alignment_raw,(int,float)) else None,
        "breadth_align_pct_fast": round(align_fast, 2) if isinstance(align_fast,(int,float)) else None,
        "breadth_bar_pct": round(bar_raw, 2) if isinstance(bar_raw,(int,float)) else None,
        "breadth_bar_pct_fast": round(bar_fast, 2) if isinstance(bar_fast,(int,float)) else None,

        "momentum_combo_pct": momentum_combo,
        "momentum_10m_pct": momentum_10m,

        "breadth_slow_pct": breadth_slow,
        "momentum_slow_pct": momentum_slow,

        "ema_cross": ("bull" if just_crossed and ema_sign>0 else "bear" if just_crossed and ema_sign<0 else "none"),
        "ema10_dist_pct": round(ema10_dist_pct, 2),
        "ema_sign": int(ema_sign),

        "squeeze_pct": round(squeeze_exp_pct, 2),
        "squeeze_compression_pct": round(100.0 - squeeze_exp_pct, 2) if squeeze_exp_pct is not None else None,
        "liquidity_psi": round(liquidity_pct, 2),
        "liquidity_pct": round(liquidity_pct, 2),
        "volatility_pct": round(volatility_pct, 3),
        "volatility_scaled": 0.0 if volatility_pct is None else round(volatility_pct * 6.25, 2),
    }

    # 8) Intraday block
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
        "meta": {
            "cards_fresh": bool(cards_fresh),
            "smi1h_fresh": bool("SPY" in bars_by_sym and len(bars_by_sym.get("SPY",[]))>=6),
            "after_hours": False
        }
    }
    etf_ready = sum(1 for s in SECTOR_ETFS if bars_by_sym.get(s))
    print(f"[breadth] ETFs ready={etf_ready}/11 | A_raw={alignment_raw} | B_raw={bar_raw} | final={breadth_10m}")
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

    prev_out = jread(args.out)  # for smoothing persistence

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
          "| breadth_10m_pct=", out["metrics"]["breadth_10m_pct"],
          "| momentum_combo_pct=", out["metrics"]["momentum_combo_pct"],
          "| squeeze_pct(Expansion)=", out["metrics"]["squeeze_pct"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
