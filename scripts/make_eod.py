#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_eod.py (R12.9 — EMA Structure First + Lux PSI Trade Gate)

Builds /live/eod payload (data/outlook.json) with:

A) STRUCTURE-FIRST EOD STATE (Daily SPY)
- EMA10 / EMA20 / EMA50 posture drives EOD state:
  - Bull:   Close > EMA20 and not meaningfully below EMA10
  - Neutral (pullback): Close > EMA20 but meaningfully below EMA10
  - Bear:   Close < EMA20
  - Regime damage flag: Close < EMA50

B) Lux PSI Squeeze Gate (Safety rail for automation)
- PSI >= 90     => DANGER (RED)   => no entries, exits allowed
- 84..89.99     => CAUTION (YEL)  => entries allowed only for A+ setups
- 25..83.99     => FREE (GREEN)   => normal trading
- 0..24.99      => MINOR (BLUE)   => chop caution

C) EOD SCORE (0..100)
- Score is mostly EMA structure, with breadth confirmation + conditions.
- Guardrails ensure score never contradicts the state.

Inputs:
- SectorCards from --source (kept for UI display + optional risk-on)
- Sector ETF daily bars used to compute daily breadth/participation confirmation (stable vs "intraday" sector cards)
- SPY daily bars for EMAs + Lux PSI + liquidity + volatility
"""

from __future__ import annotations
import argparse, json, os, sys, math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
import urllib.request

UTC = timezone.utc

# 11 sector ETFs
SECTOR_ETFS = ["XLK","XLY","XLC","XLP","XLU","XLV","XLRE","XLE","XLF","XLB","XLI"]

# For risk-on/off using sectorCards (optional)
OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

POLY_KEY  = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
POLY_BASE = "https://api.polygon.io"

# --- EMA distance saturations (daily) ---
# These control how quickly posture reaches 0 or 100.
FULL_DIST_10 = 0.60   # +/-0.60% from EMA10 saturates the EMA10 posture
FULL_DIST_20 = 1.00   # +/-1.00% from EMA20 saturates the EMA20 posture
FULL_DIST_50 = 2.00   # +/-2.00% from EMA50 saturates the EMA50 posture

# EMA10 tolerance used for Bull vs Pullback split
EMA10_PULLBACK_TOL = -0.20  # if d10 < -0.20% while above EMA20 => pullback (yellow)

# --- Score weights (sum to 1.00) ---
W_EMA_STRUCT   = 0.60
W_BREADTH_CONF = 0.25
W_CONDITIONS   = 0.15

def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def now_utc_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"make-eod/1.1","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def poly_daily_bars(ticker: str, days: int = 260) -> List[dict]:
    end = datetime.now(UTC).date()
    start = (end - timedelta(days=days)).strftime("%Y-%m-%d")
    end_s = end.strftime("%Y-%m-%d")
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end_s}?adjusted=true&sort=asc&limit=50000&apiKey={POLY_KEY}"
    try:
        js = fetch_json(url)
        rows = js.get("results") or []
    except Exception:
        rows = []
    out=[]
    for r in rows:
        try:
            out.append({
                "t": int(r["t"])//1000,
                "o": float(r["o"]),
                "h": float(r["h"]),
                "l": float(r["l"]),
                "c": float(r["c"]),
                "v": float(r.get("v",0.0))
            })
        except Exception:
            pass
    return out

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out

def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if len(closes) < length + 2:
        return None
    mx = mn = None
    diffs=[]
    for src in closes:
        mx = src if mx is None else max(mx - (mx - src) / conv, src)
        mn = src if mn is None else min(mn + (src - mn) / conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(math.log(span))
    n = length
    xs = list(range(n))
    win = diffs[-n:]
    xbar = sum(xs)/n
    ybar = sum(win)/n
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs,win))
    den = (sum((x-xbar)**2 for x in xs)*sum((y-ybar)**2 for y in win)) or 1.0
    r = num/(den**0.5)
    psi = -50.0 * r + 50.0
    return float(clamp(psi, 0.0, 100.0))

def volatility_atr14_pct(closes: List[float], highs: List[float], lows: List[float]) -> float:
    if len(closes) < 20:
        return 20.0
    trs=[max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])) for i in range(1,len(closes))]
    if len(trs) < 14:
        return 20.0
    atr = sum(trs[-14:]) / 14.0
    return max(0.0, 100.0 * atr / closes[-1]) if closes[-1] > 0 else 0.0

def liquidity_5_20(vols: List[float]) -> float:
    if len(vols) < 20:
        return 70.0
    v5  = sum(vols[-5:]) / 5.0
    v20 = sum(vols[-20:]) / 20.0
    if v20 <= 0:
        return 0.0
    return clamp(100.0 * (v5 / v20), 0.0, 120.0)

def posture_from_dist(dist_pct: float, full_dist: float) -> float:
    unit = clamp(dist_pct / max(full_dist, 1e-9), -1.0, 1.0)
    return clamp(50.0 + 50.0 * unit, 0.0, 100.0)

def dist_pct(close: float, ema: float) -> float:
    if ema <= 0:
        return 0.0
    return 100.0 * (close - ema) / ema

def squeeze_regime(psi: float) -> Tuple[str, str, bool, str]:
    """
    Returns:
      regime_key, light_color, no_entries, mode_label
    """
    if psi >= 90.0:
        return ("danger", "red", True, "NO ENTRIES (exits allowed)")
    if psi >= 84.0:
        return ("caution", "yellow", False, "A+ ONLY")
    if psi >= 25.0:
        return ("free", "green", False, "NORMAL")
    return ("minor", "blue", False, "CHOP CAUTION")

def squeeze_score_from_regime(regime_key: str) -> float:
    """
    Maps your PSI regimes into a 0..100 'conditions' score input.
    - danger: 0 (wick trap risk)
    - caution: 30 (tight)
    - free: 100 (trend-friendly)
    - minor: 60 (chop/digestion)
    """
    if regime_key == "danger":
        return 0.0
    if regime_key == "caution":
        return 30.0
    if regime_key == "free":
        return 100.0
    return 60.0

def compute_sectorcards_risk_on(cards: List[dict]) -> float:
    """
    Optional: use sectorCards breadth_pct to compute risk-on/off.
    Offensive good if breadth >= 50; Defensive good if breadth <= 50.
    Returns 0..100
    """
    if not cards:
        return 50.0
    by = {(c.get("sector") or "").strip().lower(): c for c in cards}
    score = considered = 0
    for s in OFFENSIVE:
        b = by.get(s, {}).get("breadth_pct")
        if isinstance(b,(int,float)):
            considered += 1
            score += (1 if float(b) > 50.0 else 0)
    for s in DEFENSIVE:
        b = by.get(s, {}).get("breadth_pct")
        if isinstance(b,(int,float)):
            considered += 1
            score += (1 if float(b) < 50.0 else 0)
    return round(pct(score, considered or 1), 2)

def daily_breadth_participation_from_sector_etfs() -> Tuple[float, float]:
    """
    Stable daily breadth confirmation:
    - align_pct: % of sector ETFs with EMA10 > EMA20
    - barup_pct: % of sector ETFs with close > open
    - breadth_daily = 0.60*align + 0.40*barup
    - participation_daily = align (simple + intuitive)
    Returns (breadth_daily, participation_daily) in 0..100
    """
    good = 0
    align = 0
    barup = 0
    for sym in SECTOR_ETFS:
        b = poly_daily_bars(sym, days=120)
        if len(b) < 30:
            continue
        closes = [x["c"] for x in b]
        opens  = [x["o"] for x in b]
        e10 = ema_series(closes, 10)[-1]
        e20 = ema_series(closes, 20)[-1]
        good += 1
        if e10 > e20:
            align += 1
        if closes[-1] > opens[-1]:
            barup += 1
    if good <= 0:
        return (50.0, 50.0)
    align_pct = pct(align, good)
    barup_pct = pct(barup, good)
    breadth_daily = clamp(0.60*align_pct + 0.40*barup_pct, 0.0, 100.0)
    participation = clamp(align_pct, 0.0, 100.0)
    return (round(breadth_daily,2), round(participation,2))

def compute_eod_state(close: float, ema10: float, ema20: float, ema50: float) -> Tuple[str, str]:
    """
    Returns (state, label):
      state: bull / neutral / bear
      label: human hint (bull / pullback / bear / regime_damage)
    """
    d10 = dist_pct(close, ema10)
    above20 = close > ema20
    below20 = close < ema20
    below50 = close < ema50

    if above20:
        if d10 >= EMA10_PULLBACK_TOL:
            return ("bull", "bull")
        return ("neutral", "pullback")
    # below20 => bear
    if below50:
        return ("bear", "regime_damage")
    return ("bear", "bear")

def apply_score_guardrails(state: str, score: float) -> float:
    """
    Enforces:
    - bull: score >= 55
    - neutral: 45..65
    - bear: score <= 45
    """
    if state == "bull":
        return clamp(score, 55.0, 100.0)
    if state == "neutral":
        return clamp(score, 45.0, 65.0)
    return clamp(score, 0.0, 45.0)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not POLY_KEY:
        print("[fatal] Missing POLYGON_API_KEY", file=sys.stderr)
        sys.exit(2)

    try:
        src = json.load(open(args.source,"r",encoding="utf-8"))
    except Exception as e:
        print("[error] cannot read source:", e, file=sys.stderr)
        sys.exit(1)

    cards = src.get("sectorCards") or []

    # --- SPY daily bars (for EMAs + PSI + vol + liq) ---
    bars = poly_daily_bars("SPY", days=320)
    if len(bars) < 60:
        print("[fatal] insufficient SPY daily bars", file=sys.stderr)
        sys.exit(2)

    C = [b["c"] for b in bars]
    H = [b["h"] for b in bars]
    L = [b["l"] for b in bars]
    V = [b["v"] for b in bars]

    close = float(C[-1])

    e10 = ema_series(C, 10)[-1]
    e20 = ema_series(C, 20)[-1]
    e50 = ema_series(C, 50)[-1]

    d10 = dist_pct(close, e10)
    d20 = dist_pct(close, e20)
    d50 = dist_pct(close, e50)

    ema10_post = posture_from_dist(d10, FULL_DIST_10)
    ema20_post = posture_from_dist(d20, FULL_DIST_20)
    ema50_post = posture_from_dist(d50, FULL_DIST_50)

    # EMA structure score (0..100)
    ema_structure = (
        0.50 * ema20_post +
        0.30 * ema10_post +
        0.20 * ema50_post
    )
    ema_structure = float(clamp(ema_structure, 0.0, 100.0))

    # EOD state (structure first)
    state, state_label = compute_eod_state(close, e10, e20, e50)

    # Lux PSI squeeze tightness (0..100)
    psi = lux_psi_from_closes(C, conv=50, length=20)
    psi = float(psi) if isinstance(psi,(int,float)) else 50.0
    psi = float(clamp(psi, 0.0, 100.0))

    regime_key, regime_color, no_entries, mode_label = squeeze_regime(psi)
    squeeze_score = squeeze_score_from_regime(regime_key)

    # Volatility + Liquidity (conditions)
    vol_pct = float(volatility_atr14_pct(C, H, L))
    vol_score = float(clamp(100.0 - clamp(vol_pct, 0.0, 200.0), 0.0, 100.0))

    liq_pct = float(liquidity_5_20(V))  # 0..120
    liq_norm = float(clamp((liq_pct / 120.0) * 100.0, 0.0, 100.0))

    conditions = (
        0.40 * squeeze_score +
        0.30 * liq_norm +
        0.30 * vol_score
    )
    conditions = float(clamp(conditions, 0.0, 100.0))

    # Breadth confirmation (daily, from sector ETFs)
    breadth_daily, participation_daily = daily_breadth_participation_from_sector_etfs()
    breadth_confirm = float(clamp(0.60*breadth_daily + 0.40*participation_daily, 0.0, 100.0))

    # Risk-on (optional, from sectorCards)
    risk_on = compute_sectorcards_risk_on(cards)

    # Final score (pre-guardrail)
    score_raw = (
        W_EMA_STRUCT   * ema_structure +
        W_BREADTH_CONF * breadth_confirm +
        W_CONDITIONS   * conditions
    )
    score = apply_score_guardrails(state, score_raw)

    # Trade gate fields (automation contract)
    allow_exits = True
    allow_entries = (not no_entries)
    entry_mode = mode_label  # "NO ENTRIES (exits allowed)" / "A+ ONLY" / "NORMAL" / "CHOP CAUTION"

    # A+ only logic (your requirement 2B)
    a_plus_only = (regime_key == "caution")

    # “Danger red light” (your requirement: PSI >= 90)
    danger_active = (regime_key == "danger")

    updated_utc = now_utc_iso()

    # Components for UI explanation
    components = {
        "emaStructure": round(ema_structure, 1),
        "breadthConfirm": round(breadth_confirm, 1),
        "conditions": round(conditions, 1),
        "squeezePsi": round(psi, 1),
        "liquidityNorm": round(liq_norm, 1),
        "volScore": round(vol_score, 1),
    }

    daily = {
        "state": state,
        "stateLabel": state_label,
        "score": round(score, 1),

        # Tiles (keep simple keys)
        "ema10": round(float(e10), 4),
        "ema20": round(float(e20), 4),
        "ema50": round(float(e50), 4),
        "d10_pct": round(float(d10), 3),
        "d20_pct": round(float(d20), 3),
        "d50_pct": round(float(d50), 3),

        "breadthDailyPct": breadth_daily,
        "participationDailyPct": participation_daily,

        "squeezePsi": round(psi, 2),
        "squeezeRegime": regime_key,
        "squeezeColor": regime_color,

        "volatilityPct": round(vol_pct, 3),
        "liquidityPct": round(liq_pct, 2),
        "riskOnPct": risk_on,

        # Composite output for Market Meter / automation
        "overallEOD": {
            "state": state,
            "score": round(score, 1),
            "components": components,
            "lastChanged": updated_utc,  # compute_trend_eod will preserve/adjust if needed
        },

        # Trade gate (automation-facing)
        "tradeGate": {
            "allowEntries": bool(allow_entries),
            "allowExits": bool(allow_exits),
            "mode": entry_mode,
            "aPlusOnly": bool(a_plus_only),
            "danger": bool(danger_active),
            "psi": round(psi, 2),
        }
    }

    metrics = {
        # Legacy-ish keys (so nothing downstream breaks)
        "overall_eod_score": round(score, 1),
        "overall_eod_state": state,

        # EMA structure
        "ema10": round(float(e10), 6),
        "ema20": round(float(e20), 6),
        "ema50": round(float(e50), 6),
        "d10_pct": round(float(d10), 4),
        "d20_pct": round(float(d20), 4),
        "d50_pct": round(float(d50), 4),
        "ema10_posture": round(float(ema10_post), 2),
        "ema20_posture": round(float(ema20_post), 2),
        "ema50_posture": round(float(ema50_post), 2),
        "ema_structure": round(float(ema_structure), 2),

        # Breadth confirmation
        "breadth_daily_pct": breadth_daily,
        "participation_daily_pct": participation_daily,
        "breadth_confirm_pct": round(float(breadth_confirm), 2),

        # Lux PSI + regimes
        "daily_squeeze_pct": round(float(psi), 2),  # PSI tightness (Lux)
        "squeeze_regime": regime_key,

        # Conditions
        "volatility_pct": round(float(vol_pct), 3),
        "liquidity_pct": round(float(liq_pct), 2),
        "liq_norm_pct": round(float(liq_norm), 2),
        "vol_score_pct": round(float(vol_score), 2),
        "conditions_pct": round(float(conditions), 2),

        # Risk on
        "risk_on_daily_pct": risk_on,

        # Automation gate mirrors
        "no_entries": bool(no_entries),
        "a_plus_only": bool(a_plus_only),
    }

    engineLights = {
        "eodSqueezeGate": {
            "state": regime_color,          # red/yellow/green/blue
            "active": True,
            "psi": round(psi, 2),
            "regime": regime_key,
            "allowEntries": bool(allow_entries),
            "allowExits": bool(allow_exits),
            "mode": entry_mode,
            "lastChanged": updated_utc,
        }
    }

    out = {
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated_utc,
        "metrics": metrics,
        "daily": daily,
        "sectorCards": cards,
        "engineLights": engineLights,
        "meta": {
            "source": "make_eod.py R12.9",
            "tz": "America/Phoenix",
        }
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"[eod] state={state} label={state_label} score={score:.1f} "
        f"d10={d10:.3f}% d20={d20:.3f}% d50={d50:.3f}% "
        f"psi={psi:.1f} gate={regime_key}/{entry_mode} "
        f"breadth={breadth_daily:.1f} part={participation_daily:.1f} conditions={conditions:.1f}",
        flush=True
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(1)
