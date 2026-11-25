#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_daily.py
EOD v3 — STRUCTURE-FIRST (20/50/200 backbone) + SHORT LUX PSI + SAFETY GATES

LOCKED INTENT:
- EOD is structure-first and slower than 4H.
- 10 EMA is a minor short-term modifier only.
- 20 / 50 / 200 are the real daily structure backbone.
- Lux PSI is a short-memory current-state detector (NOT long history).
- PSI meaning = tightness (higher = tighter).
- PSI ≥ 90 => NO ENTRIES (exits allowed).
- Internals Weak can block entries even if trend is Bull.
- Output schema remains backward compatible for /live/eod.
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
from typing import List, Optional, Tuple, Dict

UTC = timezone.utc

POLY_BASE = "https://api.polygon.io"
POLY_URL_DAY = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/1/day/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

SECTOR_ETFS = ["XLK", "XLY", "XLC", "XLP", "XLU", "XLV", "XLRE", "XLE", "XLF", "XLB", "XLI"]

OFFENSIVE = {"information technology", "consumer discretionary", "communication services", "industrials"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

# --- EOD structure thresholds ---
EMA10_PULLBACK_TOL = -0.20  # kept for diagnostics / minor modifier use

# --- Score weights (sum=1.00) ---
W_EMA_STRUCT = 0.65
W_BREADTH_CONF = 0.20
W_CONDITIONS = 0.15

# --- Lux PSI params (LuxAlgo defaults) ---
LUX_CONV = 50
LUX_LEN = 20

# --- SHORT MEMORY window (2–3 weeks default) ---
PSI_WIN_D = int(os.environ.get("PSI_WIN_D", "10"))

# --- fetch days ---
# Increased SPY default to stabilize EMA200. Still configurable.
FETCH_DAYS_SPY = int(os.environ.get("FETCH_DAYS_SPY", "420"))
FETCH_DAYS_SECTORS = int(os.environ.get("FETCH_DAYS_SECTORS", "120"))

# --- internals weak thresholds (LOCKED) ---
INTERNALS_RED_COUNT = int(os.environ.get("INTERNALS_RED_COUNT", "7"))
INTERNALS_PARTICIPATION_MIN = float(os.environ.get("INTERNALS_PARTICIPATION_MIN", "55"))
INTERNALS_BREADTH_MIN = float(os.environ.get("INTERNALS_BREADTH_MIN", "50"))


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
    req = urllib.request.Request(url, headers={"User-Agent": "make-eod/3.0", "Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def poly_daily_bars(ticker: str, days: int) -> List[dict]:
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
    if not key:
        raise RuntimeError("Missing POLYGON_API_KEY in env/secrets.")

    end = datetime.now(UTC).date()
    start = (end - timedelta(days=days)).strftime("%Y-%m-%d")
    end_s = end.strftime("%Y-%m-%d")

    url = POLY_URL_DAY.format(sym=ticker, start=start, end=end_s, key=key)
    try:
        js = fetch_json(url, timeout=25)
    except Exception:
        return []

    rows = js.get("results") or []
    out: List[dict] = []
    for r in rows:
        try:
            out.append(
                {
                    "t": int(r.get("t", 0)) // 1000,
                    "o": float(r.get("o", 0)),
                    "h": float(r.get("h", 0)),
                    "l": float(r.get("l", 0)),
                    "c": float(r.get("c", 0)),
                    "v": float(r.get("v", 0.0)),
                }
            )
        except Exception:
            continue
    return out


def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out


def dist_pct(close: float, ema: float) -> float:
    if ema <= 0:
        return 0.0
    return 100.0 * (close - ema) / ema


def posture_from_dist(distp: float, full_dist: float) -> float:
    unit = clamp(distp / max(full_dist, 1e-9), -1.0, 1.0)
    return clamp(50.0 + 50.0 * unit, 0.0, 100.0)


def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    """
    LuxAlgo PSI canonical:
      max := nz(max(src, max - (max-src)/conv), src)
      min := nz(min(src, min + (src-min)/conv), src)
      diff = log(max-min)
      psi  = -50*corr(diff, bar_index, length) + 50
    """
    if not closes or len(closes) < length + 2:
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


def volatility_atr14_pct(C: List[float], H: List[float], L: List[float]) -> float:
    if len(C) < 20:
        return 20.0
    trs = [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]
    if len(trs) < 14:
        return 20.0
    atr = sum(trs[-14:]) / 14.0
    return max(0.0, 100.0 * atr / C[-1]) if C[-1] > 0 else 0.0


def liquidity_5_20(vols: List[float]) -> float:
    if len(vols) < 20:
        return 70.0
    v5 = sum(vols[-5:]) / 5.0
    v20 = sum(vols[-20:]) / 20.0
    if v20 <= 0:
        return 0.0
    return clamp(100.0 * (v5 / v20), 0.0, 120.0)


def squeeze_regime(psi: float) -> Tuple[str, str, bool, str]:
    if psi >= 90.0:
        return ("danger", "red", True, "NO ENTRIES (exits allowed)")
    if psi >= 84.0:
        return ("caution", "yellow", False, "A+ ONLY")
    if psi >= 25.0:
        return ("free", "green", False, "NORMAL")
    return ("minor", "blue", False, "CHOP CAUTION")


def squeeze_score_from_regime(regime_key: str) -> float:
    if regime_key == "danger":
        return 0.0
    if regime_key == "caution":
        return 30.0
    if regime_key == "free":
        return 100.0
    return 60.0


def daily_breadth_participation_from_sector_etfs() -> Tuple[float, float]:
    good = align = barup = 0
    for sym in SECTOR_ETFS:
        b = poly_daily_bars(sym, days=FETCH_DAYS_SECTORS)
        if len(b) < 30:
            continue
        closes = [x["c"] for x in b]
        opens = [x["o"] for x in b]
        e10 = ema_series(closes, 10)[-1]
        e20 = ema_series(closes, 20)[-1]
        good += 1
        if e10 > e20:
            align += 1
        if closes[-1] > opens[-1]:
            barup += 1

        time.sleep(0.10)

    if good <= 0:
        return (50.0, 50.0)

    align_pct = pct(align, good)
    barup_pct = pct(barup, good)
    breadth_daily = clamp(0.60 * align_pct + 0.40 * barup_pct, 0.0, 100.0)
    participation = clamp(align_pct, 0.0, 100.0)

    return (round(breadth_daily, 2), round(participation, 2))


def compute_stack_score(
    close: float,
    ema10: float,
    ema20: float,
    ema50: float,
    ema200: float,
) -> float:
    """
    Stable daily structure ladder.
    Heavier reward for 200 / 50 / 20 than for 10.
    """
    score = 0.0

    if close > ema200:
        score += 35.0
    if close > ema50:
        score += 25.0
    if close > ema20:
        score += 20.0
    if close > ema10:
        score += 10.0

    if ema10 > ema20:
        score += 3.0
    if ema20 > ema50:
        score += 4.0
    if ema50 > ema200:
        score += 3.0

    return clamp(score, 0.0, 100.0)


def compute_eod_state(close: float, ema10: float, ema20: float, ema50: float, ema200: float) -> Tuple[str, str]:
    above10 = close > ema10
    above20 = close > ema20
    above50 = close > ema50
    above200 = close > ema200

    # strongest daily structure
    if above20 and above50 and above200:
        if above10:
            return ("bull", "bull")
        return ("bull", "pullback")

    # below 20 but above 50/200 = normal pullback, not real damage
    if (not above20) and above50 and above200:
        return ("neutral", "pullback")

    # above 20 but below 50 while above 200 = transition / recovery
    if above20 and (not above50) and above200:
        return ("neutral", "transition")

    # below 50 but above 200 = intermediate damage, but macro still intact
    if (not above50) and above200:
        return ("neutral", "intermediate_damage")

    # below 200 = real regime damage
    return ("bear", "regime_damage")


def apply_eod_score_guardrails(
    state: str,
    state_label: str,
    score: float,
    above10: bool,
    above20: bool,
    above50: bool,
    above200: bool,
) -> float:
    """
    Keep EOD slower and structural.
    10 EMA can tweak, but 20/50/200 control the range.
    """
    # hard damage
    if not above200:
        return clamp(score, 0.0, 45.0)

    # above 200 but below 50 = macro intact, intermediate damage
    if above200 and (not above50):
        return clamp(score, 50.0, 60.0)

    # above 50 and above 200, but below 20 = pullback
    if above50 and above200 and (not above20):
        return clamp(score, 54.0, 66.0)

    # above 20 / 50 / 200 but below 10 = healthy pullback
    if above20 and above50 and above200 and (not above10):
        return clamp(score, 60.0, 74.0)

    if state == "bull":
        return clamp(score, 62.0, 100.0)
    if state == "neutral":
        return clamp(score, 50.0, 70.0)
    return clamp(score, 0.0, 48.0)


def sector_is_red(card: dict) -> bool:
    try:
        b = float(card.get("breadth_pct", 50.0))
        m = float(card.get("momentum_pct", 50.0))
    except Exception:
        return False
    return (b <= 45.0) and (m <= 45.0)


def compute_internals_weak(cards: List[dict], participation_daily: float, breadth_daily: float) -> Tuple[bool, int, str]:
    red = sum(1 for c in (cards or []) if sector_is_red(c))

    if red >= INTERNALS_RED_COUNT:
        return True, red, f"INTERNALS WEAK: {red}/11 sectors red"
    if isinstance(participation_daily, (int, float)) and participation_daily < INTERNALS_PARTICIPATION_MIN:
        return True, red, f"INTERNALS WEAK: participation {participation_daily:.1f}%"
    if isinstance(breadth_daily, (int, float)) and breadth_daily < INTERNALS_BREADTH_MIN:
        return True, red, f"INTERNALS WEAK: breadth {breadth_daily:.1f}%"
    return False, red, ""


def compute_sectorcards_risk_on(cards: List[dict]) -> float:
    if not cards:
        return 50.0
    by = {(c.get("sector") or "").strip().lower(): c for c in cards}
    score = considered = 0
    for s in OFFENSIVE:
        b = by.get(s, {}).get("breadth_pct")
        if isinstance(b, (int, float)):
            considered += 1
            score += (1 if float(b) > 50.0 else 0)
    for s in DEFENSIVE:
        b = by.get(s, {}).get("breadth_pct")
        if isinstance(b, (int, float)):
            considered += 1
            score += (1 if float(b) < 50.0 else 0)
    return round(pct(score, considered or 1), 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="data/outlook_source_daily.json (sectorCards)")
    ap.add_argument("--out", required=True, help="data/outlook.json")
    args = ap.parse_args()

    # load sectorCards source
    try:
        with open(args.source, "r", encoding="utf-8") as f:
            src = json.load(f)
    except Exception as e:
        print("[fatal] cannot read source:", e, file=sys.stderr)
        sys.exit(2)

    cards = src.get("sectorCards") or []

    # SPY daily bars
    bars = poly_daily_bars("SPY", days=FETCH_DAYS_SPY)
    if len(bars) < 220:
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
    e200 = ema_series(C, 200)[-1]

    d10 = dist_pct(close, e10)
    d20 = dist_pct(close, e20)
    d50 = dist_pct(close, e50)
    d200 = dist_pct(close, e200)

    above10 = close > e10
    above20 = close > e20
    above50 = close > e50
    above200 = close > e200

    # posture components
    # 10 EMA is intentionally less important here than in 4H
    ema10_post = posture_from_dist(d10, 0.80)
    ema20_post = posture_from_dist(d20, 1.20)
    ema50_post = posture_from_dist(d50, 2.50)
    ema200_post = posture_from_dist(d200, 4.50)

    stack_score = compute_stack_score(close, e10, e20, e50, e200)

    # slower, structure-first blend
    ema_structure = float(
        clamp(
            0.40 * stack_score
            + 0.15 * ema10_post
            + 0.20 * ema20_post
            + 0.15 * ema50_post
            + 0.10 * ema200_post,
            0.0,
            100.0,
        )
    )

    state, state_label = compute_eod_state(close, e10, e20, e50, e200)

    # ---- Lux PSI (SHORT MEMORY) ----
    Cw = C[-PSI_WIN_D:] if len(C) > PSI_WIN_D else C
    psi = lux_psi_from_closes(Cw, conv=LUX_CONV, length=LUX_LEN)
    psi = float(psi) if isinstance(psi, (int, float)) else 50.0
    psi = float(clamp(psi, 0.0, 100.0))

    regime_key, regime_color, no_entries, mode_label = squeeze_regime(psi)
    squeeze_score = squeeze_score_from_regime(regime_key)

    # conditions: vol + liquidity + squeeze regime score
    vol_pct = float(volatility_atr14_pct(C, H, L))
    vol_score = float(clamp(100.0 - clamp(vol_pct, 0.0, 200.0), 0.0, 100.0))

    liq_pct = float(liquidity_5_20(V))
    liq_norm = float(clamp((liq_pct / 120.0) * 100.0, 0.0, 100.0))

    conditions = float(clamp(0.40 * squeeze_score + 0.30 * liq_norm + 0.30 * vol_score, 0.0, 100.0))

    breadth_daily, participation_daily = daily_breadth_participation_from_sector_etfs()
    breadth_confirm = float(clamp(0.60 * breadth_daily + 0.40 * participation_daily, 0.0, 100.0))

    internals_weak, red_count, internals_reason = compute_internals_weak(cards, participation_daily, breadth_daily)
    risk_on = compute_sectorcards_risk_on(cards)

    score_raw = float(W_EMA_STRUCT * ema_structure + W_BREADTH_CONF * breadth_confirm + W_CONDITIONS * conditions)
    score = apply_eod_score_guardrails(
        state=state,
        state_label=state_label,
        score=score_raw,
        above10=bool(above10),
        above20=bool(above20),
        above50=bool(above50),
        above200=bool(above200),
    )

    # EOD stall / transition cap: don't call a stalled daily structure a strong trend
    ema_gap_10_20 = abs((e10 - e20) / e20) * 100 if e20 != 0 else 0.0
    ema_gap_20_50 = abs((e20 - e50) / e50) * 100 if e50 != 0 else 0.0
    dist_from_20 = abs((close - e20) / e20) * 100 if e20 != 0 else 0.0

    if above200 and ema_gap_10_20 < 1.2:
        score = min(score, 55.0)

    # trade gate from PSI regime
    allow_exits = True
    allow_entries = (not no_entries)
    a_plus_only = (regime_key == "caution")
    danger_active = (regime_key == "danger")

    # internals weak override
    if internals_weak:
        allow_entries = False
        a_plus_only = False

    updated_utc = now_utc_iso()

    components = {
        "emaStructure": round(ema_structure, 1),
        "breadthConfirm": round(breadth_confirm, 1),
        "conditions": round(conditions, 1),
        "squeezePsi": round(psi, 1),
        "liquidityNorm": round(liq_norm, 1),
        "volScore": round(vol_score, 1),
        "internalsWeak": bool(internals_weak),
        "redSectors": int(red_count),
        "psiWindowDays": int(PSI_WIN_D),

        # new non-breaking diagnostics
        "stackScore": round(stack_score, 1),
        "ema10Post": round(ema10_post, 1),
        "ema20Post": round(ema20_post, 1),
        "ema50Post": round(ema50_post, 1),
        "ema200Post": round(ema200_post, 1),
    }

    daily = {
        "state": state,
        "stateLabel": state_label,
        "score": round(score, 1),

        "ema10": round(float(e10), 4),
        "ema20": round(float(e20), 4),
        "ema50": round(float(e50), 4),
        "ema200": round(float(e200), 4),

        "d10_pct": round(float(d10), 3),
        "d20_pct": round(float(d20), 3),
        "d50_pct": round(float(d50), 3),
        "d200_pct": round(float(d200), 3),

        "breadthDailyPct": breadth_daily,
        "participationDailyPct": participation_daily,

        "squeezePsi": round(psi, 2),
        "squeezeRegime": regime_key,
        "squeezeColor": regime_color,

        "volatilityPct": round(vol_pct, 3),
        "liquidityPct": round(liq_pct, 2),
        "riskOnPct": risk_on,

        "internalsWeak": bool(internals_weak),
        "internalsWeakReason": internals_reason if internals_weak else "",
        "redSectorsCount": int(red_count),

        "overallEOD": {
            "state": state,
            "score": round(score, 1),
            "components": components,
            "lastChanged": updated_utc,
        },

        "tradeGate": {
            "allowEntries": bool(allow_entries),
            "allowExits": bool(allow_exits),
            "mode": ("INTERNALS WEAK — NO LONG ENTRIES" if internals_weak else mode_label),
            "aPlusOnly": bool(a_plus_only),
            "danger": bool(danger_active),
            "psi": round(psi, 2),
        }
    }

    metrics = {
        "overall_eod_score": round(score, 1),
        "overall_eod_state": state,

        "ema10": round(float(e10), 6),
        "ema20": round(float(e20), 6),
        "ema50": round(float(e50), 6),
        "ema200": round(float(e200), 6),

        "d10_pct": round(float(d10), 4),
        "d20_pct": round(float(d20), 4),
        "d50_pct": round(float(d50), 4),
        "d200_pct": round(float(d200), 4),

        "ema_structure": round(float(ema_structure), 2),
        "stack_score": round(float(stack_score), 2),

        "breadth_daily_pct": breadth_daily,
        "participation_daily_pct": participation_daily,
        "breadth_confirm_pct": round(float(breadth_confirm), 2),

        # squeeze tightness (canonical meaning)
        "daily_squeeze_pct": round(float(psi), 2),
        "squeeze_pct": round(float(psi), 2),
        "squeeze_expansion_pct": round(float(100.0 - psi), 2),
        "squeeze_regime": regime_key,

        "volatility_pct": round(float(vol_pct), 3),
        "liquidity_pct": round(float(liq_pct), 2),
        "liq_norm_pct": round(float(liq_norm), 2),
        "vol_score_pct": round(float(vol_score), 2),
        "conditions_pct": round(float(conditions), 2),

        "risk_on_daily_pct": risk_on,

        "internals_weak": bool(internals_weak),
        "red_sectors_count": int(red_count),

        # debug
        "price_above_ema10": bool(above10),
        "price_above_ema20": bool(above20),
        "price_above_ema50": bool(above50),
        "price_above_ema200": bool(above200),
        "psi_window_days": int(PSI_WIN_D),
        "fetch_days_spy": int(FETCH_DAYS_SPY),
        "fetch_days_sectors": int(FETCH_DAYS_SECTORS),
    }

    engineLights = {
        "eodSqueezeGate": {
            "state": regime_color,
            "active": True,
            "psi": round(psi, 2),
            "regime": regime_key,
            "allowEntries": bool(allow_entries),
            "allowExits": bool(allow_exits),
            "mode": daily["tradeGate"]["mode"],
            "lastChanged": updated_utc,
        },
        "eodInternals": {
            "state": ("red" if internals_weak else "green"),
            "active": bool(internals_weak),
            "redSectors": int(red_count),
            "reason": internals_reason if internals_weak else "",
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
            "source": "make_dashboard_daily.py EOD v3",
            "tz": "America/Phoenix",
        }
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"[eod] state={state} label={state_label} score={score:.1f} raw={score_raw:.1f} "
        f"psi={psi:.2f} regime={regime_key} internalsWeak={internals_weak} redSectors={red_count} "
        f"allowEntries={allow_entries} above10={int(above10)} above20={int(above20)} "
        f"above50={int(above50)} above200={int(above200)} psiWin={PSI_WIN_D}",
        flush=True
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[fatal] eod builder error:", e, file=sys.stderr)
        sys.exit(1)
