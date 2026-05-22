#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

"""
Ferrari Dashboard — make_dashboard_4h.py
R20.0 — 1H-BUILT 4H STRUCTURE SOURCE + ACTIVE SQUEEZE

LOCKED INTENT:
- Use 1H-built 4H candles as the active 4H structure source when at least 60 bars exist.
- Active structure source drives EMA10/20/50, SMI, volatility, liquidity, score, state, and EMA booleans.
- Native Polygon 240m remains debug/reference fallback only.
- Preserve raw Lux PSI, but use an active/blended dashboard squeeze value when expansion is confirmed.
- Keep existing output schema intact and add debug fields for source/squeeze validation.
"""

import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional, Tuple

UTC = timezone.utc

POLY_4H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/240/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

POLY_1H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/60/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

B2_STREAM_AGG_BASE = "https://frye-market-backend-2.onrender.com/stream/agg-snapshot"
B2_TF = os.environ.get("B2_TF_4H_SOURCE", "10m")
B2_LIMIT = int(os.environ.get("B2_LIMIT_4H_SOURCE", "1200"))

OFFENSIVE = {"information technology", "consumer discretionary", "communication services", "industrials"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

FULL_EMA_DIST = 0.90

SMI_K_LEN = 12
SMI_D_LEN = 5
SMI_EMA_LEN = 5

SMI_BONUS_MAX = 5
SMI_BONUS_SCORE_MAX = 3.0

W_EMA_POSTURE = 0.40
W_SMI_4H = 0.60

W_EMA_SCORE = 0.28
W_MOM_SCORE = 0.27
W_BREADTH = 0.15
W_SQUEEZE = 0.10
W_LIQ = 0.10
W_VOL = 0.05
W_RISKON = 0.05

PSI_WIN_4H = int(os.environ.get("PSI_WIN_4H", "STATEFUL")) if os.environ.get("PSI_WIN_4H", "").isdigit() else 0
FETCH_DAYS_4H = int(os.environ.get("FETCH_DAYS_4H", "720"))
STRUCTURE_MIN_1H_BUILT_BARS = int(os.environ.get("STRUCTURE_MIN_1H_BUILT_BARS", "60"))


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


def avg_last(vals: List[float], n: int) -> Optional[float]:
    if not vals:
        return None
    chunk = vals[-int(n):]
    if not chunk:
        return None
    return float(sum(chunk) / len(chunk))


def fetch_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "make-dashboard/4h/r20", "Cache-Control": "no-store"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fetch_polygon_range(sym: str, key: str, lookback_days: int, url_template: str, timeout: int = 25) -> List[dict]:
    end = datetime.now(UTC).date()
    start = end - timedelta(days=lookback_days)
    url = url_template.format(sym=sym, start=start, end=end, key=key)

    try:
        js = fetch_json(url, timeout=timeout)
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
    return out


def fetch_polygon_4h(sym: str, key: str, lookback_days: int, keep_live: bool = False) -> List[dict]:
    out = _fetch_polygon_range(sym, key, lookback_days, POLY_4H_URL)

    if out and not keep_live:
        now_ts = int(time.time())
        last = int(out[-1]["time"])
        if (last // (4 * 3600)) == (now_ts // (4 * 3600)):
            out = out[:-1]

    return out


def fetch_polygon_1h(sym: str, key: str, lookback_days: int) -> List[dict]:
    return _fetch_polygon_range(sym, key, lookback_days, POLY_1H_URL)


def fetch_polygon_10m(sym: str, key: str, lookback_days: int) -> List[dict]:
    return _fetch_polygon_range(sym, key, lookback_days, POLY_10M_URL)


def _coerce_ts_to_sec(t: Any) -> int:
    try:
        ti = int(float(t))
    except Exception:
        return 0
    if ti > 2_000_000_000_000:
        return ti // 1000
    return ti


def _extract_bar_list(js: Any) -> List[Any]:
    if isinstance(js, list):
        return js
    if isinstance(js, dict):
        for k in ("bars", "data", "candles", "results", "items"):
            v = js.get(k)
            if isinstance(v, list):
                return v
    return []


def _normalize_bar(b: Any) -> Optional[dict]:
    if isinstance(b, dict):
        t = b.get("time", b.get("t"))
        o = b.get("open", b.get("o"))
        h = b.get("high", b.get("h"))
        l = b.get("low", b.get("l"))
        c = b.get("close", b.get("c"))
        v = b.get("volume", b.get("v", 0.0))
        if t is None or o is None or h is None or l is None or c is None:
            return None
        ts = _coerce_ts_to_sec(t)
        if ts <= 0:
            return None
        return {
            "time": int(ts),
            "open": float(o),
            "high": float(h),
            "low": float(l),
            "close": float(c),
            "volume": float(v or 0.0),
        }

    if isinstance(b, (list, tuple)) and len(b) >= 5:
        ts = _coerce_ts_to_sec(b[0])
        if ts <= 0:
            return None
        return {
            "time": int(ts),
            "open": float(b[1]),
            "high": float(b[2]),
            "low": float(b[3]),
            "close": float(b[4]),
            "volume": float(b[5] if len(b) > 5 else 0.0),
        }

    return None


def fetch_backend2_10m(sym: str, tf: str = "10m", limit: int = 1200, lookback_days: int = 120) -> List[dict]:
    qs = urllib.parse.urlencode({"symbol": sym, "tf": tf, "limit": str(limit)})
    url = f"{B2_STREAM_AGG_BASE}?{qs}"

    try:
        js = fetch_json(url, timeout=25)
    except Exception:
        return []

    raw = _extract_bar_list(js)
    out: List[dict] = []

    for b in raw:
        nb = _normalize_bar(b)
        if nb:
            out.append(nb)

    out.sort(key=lambda x: x["time"])

    if out and lookback_days > 0:
        cutoff = int((datetime.now(UTC) - timedelta(days=int(lookback_days))).timestamp())
        out = [b for b in out if b["time"] >= cutoff]

    return out


def build_4h_from_1h(bars1h: List[dict]) -> List[dict]:
    """
    Build synthetic 4H candles from Polygon 1H candles.
    Current grouping is UTC buckets: 00:00/04:00/08:00/12:00/16:00/20:00 UTC.
    """
    if not bars1h:
        return []

    buckets: dict[int, List[dict]] = {}

    for b in bars1h:
        k = int(b["time"]) // (4 * 3600)
        buckets.setdefault(k, []).append(b)

    out: List[dict] = []

    for k in sorted(buckets.keys()):
        grp = buckets[k]
        grp.sort(key=lambda x: x["time"])
        out.append(
            {
                "time": int(grp[0]["time"]),
                "open": float(grp[0]["open"]),
                "high": float(max(x["high"] for x in grp)),
                "low": float(min(x["low"] for x in grp)),
                "close": float(grp[-1]["close"]),
                "volume": float(sum(x.get("volume", 0.0) for x in grp)),
                "sourceBars": int(len(grp)),
            }
        )

    return out


def build_4h_from_10m(bars10: List[dict], keep_live: bool = False) -> List[dict]:
    if not bars10:
        return []

    buckets: dict[int, List[dict]] = {}

    for b in bars10:
        k = int(b["time"]) // (4 * 3600)
        buckets.setdefault(k, []).append(b)

    out: List[dict] = []

    for k in sorted(buckets.keys()):
        grp = buckets[k]
        grp.sort(key=lambda x: x["time"])
        out.append(
            {
                "time": int(grp[0]["time"]),
                "open": float(grp[0]["open"]),
                "high": float(max(x["high"] for x in grp)),
                "low": float(min(x["low"] for x in grp)),
                "close": float(grp[-1]["close"]),
                "volume": float(sum(x.get("volume", 0.0) for x in grp)),
                "sourceBars": int(len(grp)),
            }
        )

    if out and not keep_live:
        now_ts = int(time.time())
        last = int(out[-1]["time"])
        if (last // (4 * 3600)) == (now_ts // (4 * 3600)):
            out = out[:-1]

    return out


def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None

    for v in vals:
        e = float(v) if e is None else e + k * (float(v) - e)
        out.append(e)

    return out


def ema_last(vals: List[float], span: int) -> Optional[float]:
    if not vals:
        return None
    return ema_series(vals, span)[-1]


def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]


def lux_psi_stateful(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if not closes or len(closes) < max(5, length + 2):
        return None

    mx = 0.0
    mn = 0.0
    diffs: List[float] = []
    eps = 1e-12

    for src in map(float, closes):
        mx = max(src, mx - (mx - src) / conv)
        mn = min(src, mn + (src - mn) / conv)
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


def tv_smi_and_signal(
    H: List[float],
    L: List[float],
    C: List[float],
    lengthK: int,
    lengthD: int,
    lengthEMA: int,
) -> Tuple[List[float], List[float]]:
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


def apply_structure_soft_cap(
    score: float,
    above10: bool,
    above20: bool,
    above50: bool,
    above200: bool,
) -> float:
    if above10 and above20 and above50:
        return min(score, 80.0)
    if (not above10) and above20 and above50:
        return min(score, 64.0)
    if above10 and above20 and (not above50):
        return min(score, 58.0)
    if above10 and (not above20):
        return min(score, 52.0)
    if (not above10) and (not above20) and above50:
        return min(score, 50.0)
    if (not above10) and (not above20) and (not above50):
        return min(score, 42.0)
    return min(score, 100.0)


def apply_structure_hard_band(score: float, above10: bool, above20: bool, above50: bool) -> Tuple[float, str]:
    if above10 and above20 and above50:
        return clamp(score, 65.0, 80.0), "ABOVE_10_20_50"
    if (not above10) and above20 and above50:
        return clamp(score, 52.0, 64.0), "BELOW_10_ABOVE_20_50"
    if (not above10) and (not above20) and above50:
        return clamp(score, 45.0, 50.0), "BELOW_10_20_ABOVE_50"
    if (not above10) and (not above20) and (not above50):
        return clamp(score, 30.0, 42.0), "BELOW_10_20_50"
    if above10 and above20 and (not above50):
        return clamp(score, 50.0, 58.0), "ABOVE_10_20_BELOW_50"
    if above10 and (not above20):
        return clamp(score, 45.0, 52.0), "ABOVE_10_BELOW_20"
    return clamp(score, 0.0, 100.0), "MIXED"


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
    above10: bool,
    above20: bool,
    above50: bool,
    above200: bool,
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
    score = apply_structure_soft_cap(score, above10, above20, above50, above200)

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


def _psi_from_bars(bars: List[dict]) -> Optional[float]:
    if len(bars) < 25:
        return None
    closes = [float(b["close"]) for b in bars]
    return lux_psi_stateful(closes, conv=50, length=20)


def build_active_squeeze_4h(
    raw_psi: float,
    O: List[float],
    H: List[float],
    L: List[float],
    C: List[float],
    e10: float,
    e20: float,
    e50: float,
    smi_val: float,
    sig_val: float,
) -> Tuple[float, str, dict]:
    raw = clamp(raw_psi, 0.0, 100.0)

    if len(C) < 25:
        return raw, "RAW_ONLY_INSUFFICIENT_BARS", {"rawPsi": round(raw, 2)}

    price = float(C[-1])
    rng = [max(float(H[i]) - float(L[i]), 0.0) for i in range(len(C))]
    trs = tr_series(H, L, C)

    range3 = avg_last(rng, 3) or 0.0
    range20 = avg_last(rng, 20) or 0.0
    atr3 = avg_last(trs, 3) or 0.0
    atr20 = avg_last(trs, 20) or 0.0

    range_ratio = range3 / range20 if range20 > 0 else 1.0
    atr_ratio = atr3 / atr20 if atr20 > 0 else 1.0

    last_range = max(float(H[-1]) - float(L[-1]), 1e-9)
    close_location = (float(C[-1]) - float(L[-1])) / last_range

    ema_sep_10_20_pct = abs(float(e10) - float(e20)) / price * 100.0 if price > 0 else 0.0
    ema_sep_20_50_pct = abs(float(e20) - float(e50)) / price * 100.0 if price > 0 else 0.0

    bull_stack = price > e10 and e10 >= e20 and e20 >= e50
    bear_stack = price < e10 and e10 <= e20 and e20 <= e50
    close_strong = close_location >= 0.62
    close_weak = close_location <= 0.38
    smi_bull = smi_val >= sig_val or smi_val > 0
    smi_bear = smi_val <= sig_val or smi_val < 0

    expansion_points = 0
    reasons: List[str] = []

    if bull_stack or bear_stack:
        expansion_points += 2
        reasons.append("EMA_STACK_EXPANSION")
    if range_ratio >= 1.15:
        expansion_points += 1
        reasons.append("RANGE_EXPANDING")
    if atr_ratio >= 1.10:
        expansion_points += 1
        reasons.append("ATR_EXPANDING")
    if ema_sep_10_20_pct >= 0.12 or ema_sep_20_50_pct >= 0.20:
        expansion_points += 1
        reasons.append("EMA_SEPARATION_EXPANDING")
    if (bull_stack and close_strong) or (bear_stack and close_weak):
        expansion_points += 1
        reasons.append("STRONG_CLOSE_LOCATION")
    if (bull_stack and smi_bull) or (bear_stack and smi_bear):
        expansion_points += 1
        reasons.append("SMI_CONFIRMS_EXPANSION")

    if expansion_points >= 6:
        state = "VIOLENT_EXPANSION"
        active = min(raw, 65.0)
    elif expansion_points >= 4:
        state = "CONFIRMED_EXPANSION"
        active = min(raw, 88.0)
    elif expansion_points >= 3:
        state = "EARLY_RELEASE"
        active = min(raw, 92.0)
    else:
        state = "RAW_PSI_COMPRESSION_MEMORY"
        active = raw

    debug = {
        "rawPsi": round(raw, 2),
        "activePsi": round(float(active), 2),
        "expansionPoints": int(expansion_points),
        "reasons": reasons,
        "rangeRatio3v20": round(float(range_ratio), 3),
        "atrRatio3v20": round(float(atr_ratio), 3),
        "closeLocation": round(float(close_location), 3),
        "emaSep10_20Pct": round(float(ema_sep_10_20_pct), 4),
        "emaSep20_50Pct": round(float(ema_sep_20_50_pct), 4),
        "bullStack": bool(bull_stack),
        "bearStack": bool(bear_stack),
    }

    return float(clamp(active, 0.0, 100.0)), state, debug


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="data/outlook_source_4h.json")
    ap.add_argument("--out", required=True, help="data/outlook_4h.json")
    args = ap.parse_args()

    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""

    try:
        with open(args.source, "r", encoding="utf-8") as f:
            src = json.load(f)
    except Exception as e:
        print("[fatal] cannot read source:", e, file=sys.stderr)
        sys.exit(2)

    cards = src.get("sectorCards") or []

    NH = NL = UP = DN = 0.0
    for c in cards:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0))

    breadth_4h = round(pct(NH, NH + NL), 2) if (NH + NL) > 0 else 50.0
    momentum_4h_legacy = round(pct(UP, UP + DN), 2) if (UP + DN) > 0 else 50.0

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

    # --- Native/reference 4H source ---
    spy_4h_native = fetch_polygon_4h("SPY", key, lookback_days=FETCH_DAYS_4H, keep_live=True)
    native_source_used = "polygon_240m"

    if len(spy_4h_native) < 25:
        print("[warn] insufficient Polygon 240m bars; falling back to Backend-2 10m aggregation", flush=True)
        spy_10m = fetch_backend2_10m("SPY", tf=B2_TF, limit=B2_LIMIT, lookback_days=FETCH_DAYS_4H)
        spy_4h_native = build_4h_from_10m(spy_10m, keep_live=True)
        native_source_used = "backend2_10m_grouped_4h"

    if len(spy_4h_native) < 25:
        print("[warn] insufficient Backend-2 10m bars; falling back to Polygon 10m aggregation", flush=True)
        poly_10m = fetch_polygon_10m("SPY", key, lookback_days=FETCH_DAYS_4H)
        spy_4h_native = build_4h_from_10m(poly_10m, keep_live=True)
        native_source_used = "polygon_10m_grouped_4h"

    if len(spy_4h_native) < 25:
        print("[fatal] insufficient SPY 4H bars even after all fallbacks", file=sys.stderr)
        sys.exit(2)

    # --- Debug / alternate 4H sources ---
    spy_10m_test = fetch_polygon_10m("SPY", key, lookback_days=FETCH_DAYS_4H)
    spy_4h_from_10m = build_4h_from_10m(spy_10m_test, keep_live=True)

    spy_1h_test = fetch_polygon_1h("SPY", key, lookback_days=FETCH_DAYS_4H)
    spy_4h_from_1h = build_4h_from_1h(spy_1h_test)

     # --- Active 4H structure source ---
    # Backend-2 1H is the confirmed live SPY source near real chart price.
    # Polygon 60m/240m remains debug/reference only because it produced stale/bad SPY pricing.
    backend2_1h_bars = fetch_backend2_10m("SPY", tf="1h", limit=B2_LIMIT, lookback_days=FETCH_DAYS_4H)
    backend2_1h_4h = build_4h_from_1h(backend2_1h_bars)

    if len(backend2_1h_4h) >= STRUCTURE_MIN_1H_BUILT_BARS:
        spy_4h_structure = backend2_1h_4h
        structure_source_4h = "backend2_1h_grouped_4h_structure"
    elif len(spy_4h_from_1h) >= STRUCTURE_MIN_1H_BUILT_BARS:
        spy_4h_structure = spy_4h_from_1h
        structure_source_4h = "polygon_60m_grouped_4h_structure_fallback"
    else:
        spy_4h_structure = spy_4h_native
        structure_source_4h = native_source_used

    source_used = structure_source_4h

    O = [float(b["open"]) for b in spy_4h_structure]
    H = [float(b["high"]) for b in spy_4h_structure]
    L = [float(b["low"]) for b in spy_4h_structure]
    C = [float(b["close"]) for b in spy_4h_structure]
    V = [float(b["volume"]) for b in spy_4h_structure]

    if len(C) < 25:
        print("[fatal] insufficient active SPY 4H structure bars", file=sys.stderr)
        sys.exit(2)

    e10 = ema_series(C, 10)[-1]
    e20 = ema_series(C, 20)[-1]
    e50 = ema_series(C, 50)[-1]
    e200 = ema_series(C, 200)[-1] if len(C) >= 200 else None

    price = float(C[-1])
    above10 = price > e10
    above20 = price > e20
    above50 = price > e50
    above200 = (price > e200) if e200 is not None else False

    close_dist_pct = 0.0 if e10 == 0 else 100.0 * (price - e10) / e10
    body_mid = (float(O[-1]) + price) / 2.0
    body_mid_dist_pct = 0.0 if e10 == 0 else 100.0 * (body_mid - e10) / e10
    body_top = max(float(O[-1]), price)
    body_top_dist_pct = 0.0 if e10 == 0 else 100.0 * (body_top - e10) / e10

    RECLAIM_TOL_PCT = float(os.environ.get("EMA10_RECLAIM_TOL_PCT", "0.30"))
    wick_reclaimed = float(H[-1]) > float(e10)

    ema_dist_pct = body_mid_dist_pct
    if wick_reclaimed and close_dist_pct >= -RECLAIM_TOL_PCT:
        ema_dist_pct = max(body_mid_dist_pct, -0.10)

    if above10 and above20:
        ema_sign = 1
    elif (not above10) and (not above20):
        ema_sign = -1
    else:
        ema_sign = 0

    ema10_posture = posture_from_dist(ema_dist_pct, FULL_EMA_DIST)

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

    # --- PSI calculations, kept separate ---
    psi_native = _psi_from_bars(spy_4h_native)
    squeeze_psi_4h_native = float(clamp(psi_native, 0.0, 100.0)) if isinstance(psi_native, (int, float)) else 50.0

    psi_10m = _psi_from_bars(spy_4h_from_10m)
    squeeze_psi_4h_from_10m = float(clamp(psi_10m, 0.0, 100.0)) if isinstance(psi_10m, (int, float)) else None

    psi_1h = _psi_from_bars(spy_4h_from_1h)
    squeeze_psi_4h_from_1h = float(clamp(psi_1h, 0.0, 100.0)) if isinstance(psi_1h, (int, float)) else None

     # Raw production PSI should match Backend-2 when Backend-2 is the active structure source.
    psi_backend2 = _psi_from_bars(backend2_1h_4h)
    squeeze_psi_4h_backend2 = float(clamp(psi_backend2, 0.0, 100.0)) if isinstance(psi_backend2, (int, float)) else None

    if squeeze_psi_4h_backend2 is not None and structure_source_4h == "backend2_1h_grouped_4h_structure":
        squeeze_psi_4h_raw = squeeze_psi_4h_backend2
        squeeze_source_4h = "backend2_1h_grouped_4h"
    elif squeeze_psi_4h_from_1h is not None:
        squeeze_psi_4h_raw = squeeze_psi_4h_from_1h
        squeeze_source_4h = "polygon_60m_grouped_4h"
    else:
        squeeze_psi_4h_raw = squeeze_psi_4h_native
        squeeze_source_4h = native_source_used

    # Active dashboard squeeze: raw Lux PSI plus fast expansion override.
    squeeze_psi_4h, squeeze_expansion_state_4h, squeeze_expansion_debug_4h = build_active_squeeze_4h(
        raw_psi=squeeze_psi_4h_raw,
        O=O,
        H=H,
        L=L,
        C=C,
        e10=float(e10),
        e20=float(e20),
        e50=float(e50),
        smi_val=float(smi_val),
        sig_val=float(sig_val),
    )

    squeeze_psi_4h = float(clamp(squeeze_psi_4h, 0.0, 100.0))
    squeeze_exp_4h = clamp(100.0 - squeeze_psi_4h, 0.0, 100.0)

    v3 = ema_last(V, 3)
    v12 = ema_last(V, 12)
    liquidity_4h = 0.0 if not v12 or v12 <= 0 else clamp(100.0 * (v3 / v12), 0.0, 200.0)

    trs = tr_series(H, L, C)
    atr3 = ema_last(trs, 3) if trs else None
    vol_pct = 0.0 if not atr3 or C[-1] <= 0 else max(0.0, 100.0 * atr3 / C[-1])
    vol_scaled = round(vol_pct * 6.25, 2)

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
        above10=bool(above10),
        above20=bool(above20),
        above50=bool(above50),
        above200=bool(above200),
    )

    # --- 4H bridge valuation adjustment ---
    timing_penalty = 0.0
    timing_reasons: List[str] = []

    ema10_distance_abs = abs(float(close_dist_pct))

    if ema10_distance_abs <= 0.30:
        timing_penalty += 3.0
        timing_reasons.append("NEAR_4H_EMA10_DECISION_ZONE")

    if close_dist_pct < 0:
        if above20 and above50:
            timing_penalty += 3.0
            timing_reasons.append("BELOW_4H_EMA10_BUT_ABOVE_20_50")
        else:
            timing_penalty += 6.0
            timing_reasons.append("PRICE_BELOW_4H_EMA10")

    if smi_series and sig_series and smi_val < sig_val:
        if above20 and above50:
            timing_penalty += 3.0
            timing_reasons.append("SMI_4H_COOLING_BRIDGE_STILL_ALIVE")
        else:
            timing_penalty += 6.0
            timing_reasons.append("SMI_4H_MOMENTUM_COOLING")

    if above20 and above50:
        timing_penalty = min(timing_penalty, 7.0)
    else:
        timing_penalty = min(timing_penalty, 14.0)

    score = clamp(float(score) - timing_penalty, 0.0, 100.0)

    # --- Hard structural bridge band ---
    score, bridge_structure_band_4h = apply_structure_hard_band(
        score=float(score),
        above10=bool(above10),
        above20=bool(above20),
        above50=bool(above50),
    )
    timing_reasons.append(f"BRIDGE_BAND_{bridge_structure_band_4h}")

    if score >= 65.0 and above10 and above20 and above50:
        state = "bull"
    elif score <= 42.0 and (not above10) and (not above20) and (not above50):
        state = "bear"
    else:
        state = "neutral"

    comps["timingPenalty"] = round(-timing_penalty, 2)
    comps["timingReasons"] = timing_reasons
    comps["bridgeStructureBand"] = bridge_structure_band_4h

    updated_utc = now_utc_iso()

    metrics = {
        "trend_strength_4h_pct": round(float(score), 2),
        "breadth_4h_pct": float(breadth_4h),
        "momentum_4h_pct": float(momentum_4h_legacy),
        "momentum_combo_4h_pct": float(momentum_combo_4h),

        "ema_sign_4h": int(ema_sign),
        "ema_dist_4h_pct": round(float(ema_dist_pct), 4),
        "ema10_posture_4h_pct": round(float(ema10_posture), 2),

        "ema_close_dist_4h_pct": round(float(close_dist_pct), 4),
        "ema_body_mid_dist_4h_pct": round(float(body_mid_dist_pct), 4),
        "ema_body_top_dist_4h_pct": round(float(body_top_dist_pct), 4),
        "ema_wick_reclaimed_4h": bool(wick_reclaimed),
        "ema_reclaim_tol_pct": float(RECLAIM_TOL_PCT),

        "ema10_4h": round(float(e10), 4),
        "ema20_4h": round(float(e20), 4),
        "ema50_4h": round(float(e50), 4),
        "ema200_4h": round(float(e200), 4) if e200 is not None else None,
        "price_above_ema10_4h": bool(above10),
        "price_above_ema20_4h": bool(above20),
        "price_above_ema50_4h": bool(above50),
        "price_above_ema200_4h": bool(above200) if e200 is not None else None,

        # Added aliases for easier debugging / Engine 25 reads.
        "trend_price_4h": round(float(price), 4),
        "above10_4h": bool(above10),
        "above20_4h": bool(above20),
        "above50_4h": bool(above50),

        "smi_4h": round(float(smi_val), 4),
        "smi_signal_4h": round(float(sig_val), 4),
        "smi_4h_pct": round(float(smi_pct), 2),
        "smi_bonus_pts": int(smi_bonus),

        # Main/public squeeze fields use the active dashboard squeeze.
        "squeeze_psi_4h_pct": round(float(squeeze_psi_4h), 2),
        "squeeze_expansion_pct": round(float(squeeze_exp_4h), 2),
        "squeeze_pct": round(float(squeeze_psi_4h), 2),
        "squeeze_psi_4h": round(float(squeeze_psi_4h), 2),
        "squeeze_4h_pct": round(float(squeeze_exp_4h), 2),
        "squeeze_source_4h": squeeze_source_4h,
        "squeeze_psi_4h_pct_raw": round(float(squeeze_psi_4h_raw), 2),
        "squeeze_expansion_state_4h": squeeze_expansion_state_4h,
        "squeeze_expansion_debug_4h": squeeze_expansion_debug_4h,

        # Debug/reference fields keep every source separated.
        "squeeze_psi_4h_pct_native": round(float(squeeze_psi_4h_native), 2),
        "squeeze_psi_4h_pct_session": round(float(squeeze_psi_4h_from_10m), 2) if squeeze_psi_4h_from_10m is not None else None,
        "squeeze_psi_4h_pct_from_1h": round(float(squeeze_psi_4h_from_1h), 2) if squeeze_psi_4h_from_1h is not None else None,

        "session_4h_bars": int(len(spy_4h_from_10m)),
        "from_1h_4h_bars": int(len(spy_4h_from_1h)),
        "polygon_1h_bars": int(len(spy_1h_test)),
        "source_used_4h_from_1h": "polygon_60m_grouped_4h",
        "backend2_1h_bars": int(len(backend2_1h_bars)),
        "backend2_1h_4h_bars": int(len(backend2_1h_4h)),
        "squeeze_psi_4h_pct_backend2": round(float(squeeze_psi_4h_backend2), 2) if squeeze_psi_4h_backend2 is not None else None,

        "liquidity_4h": round(float(liquidity_4h), 2),
        "volatility_4h_pct": round(float(vol_pct), 3),
        "volatility_4h_scaled": float(vol_scaled),

        "sector_dir_4h_pct": float(sector_dir_4h),
        "riskOn_4h_pct": float(risk_on_4h),

        "psi_window_4h_bars": int(PSI_WIN_4H),
        "lux_psi_mode_4h": "stateful_raw_plus_active_expansion_blend",
        "fetch_days_4h": int(FETCH_DAYS_4H),
        "source_used_4h": source_used,
        "native_source_used_4h": native_source_used,
        "structure_source_4h": structure_source_4h,
        "uses_live_4h_bar": True,
        "bridge_structure_band_4h": bridge_structure_band_4h,
        "completed_4h_bars": int(len(spy_4h_structure)),
    }

    fourHour = {
        "sectorDirection4h": {"risingPct": float(sector_dir_4h)},
        "riskOn4h": {"riskOnPct": float(risk_on_4h)},
        "overall4h": {
            "state": state,
            "score": round(float(score), 2),
            "components": comps,
            "lastChanged": updated_utc,
        },
        "signals": {
            "sigSMI4hBullCross": {"active": False, "reason": "", "lastChanged": updated_utc},
            "sigSMI4hBearCross": {"active": False, "reason": "", "lastChanged": updated_utc},
        },
    }

    out = {
        "version": "r4h-v21-backend2-1h-structure-active-squeeze",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": updated_utc,
        "metrics": metrics,
        "fourHour": fourHour,
        "sectorCards": cards,
        "engineLights": {
            "4h": {
                "score": round(float(score), 2),
                "state": state,
                "lastChanged": updated_utc,
            }
        },
        "meta": {
            "cards_fresh": True,
            "after_hours": False,
            "psi_mode_4h": "stateful_lux_raw_plus_active_expansion_blend",
            "fetch_days_4h": int(FETCH_DAYS_4H),
            "completed_4h_bars": int(len(spy_4h_structure)),
            "structure_source_4h": structure_source_4h,
            "squeeze_source_4h": squeeze_source_4h,
            "uses_live_4h_bar": True,
        },
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(
        f"[4h] score={score:.2f} state={state} source={source_used} bars={len(spy_4h_structure)} "
        f"psiMain={squeeze_psi_4h:.2f} psiRaw={squeeze_psi_4h_raw:.2f} psiNative={squeeze_psi_4h_native:.2f} "
        f"psi1h={squeeze_psi_4h_from_1h if squeeze_psi_4h_from_1h is not None else 'NA'} "
        f"squeezeState={squeeze_expansion_state_4h} "
        f"emaPost={ema10_posture:.2f} mom={momentum_combo_4h:.2f} "
        f"breadth={breadth_4h:.2f} exp={squeeze_exp_4h:.2f} "
        f"liq={liquidity_4h:.2f} volScaled={vol_scaled:.2f} riskOn={risk_on_4h:.2f} "
        f"smiBonus={smi_bonus:+d} structureSource={structure_source_4h} squeezeSource={squeeze_source_4h}",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[4h-error]", e, file=sys.stderr)
        sys.exit(2)

