#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — compute_trend10m.py (R12.7 with 55/45 thresholds)

Goal
----
Post-process data/outlook_intraday.json (10m snapshot) and:

  - Compute fast 10m metrics for Market Meter:
      * breadth_10m_pct
      * momentum_10m_pct / momentum_combo_10m_pct
      * squeeze_psi_10m_pct / squeeze_expansion_pct / squeeze_pct
      * liquidity_psi
      * volatility_pct
      * breadth_align_fast_pct
      * ema_sign / ema_gap_pct
      * riskOn_10m_pct

  - Compute 10m intraday blocks:
      * sectorDirection10m.risingPct (breadth≥55 & momentum≥55)
      * riskOn10m.riskOnPct        (offensive≥55, defensive≤45)
      * overall10m { state, score, components }
      * engineLights["10m"] mirroring overall10m (+ lastChanged)

Inputs
------
- data/outlook_intraday.json, with at minimum:
    metrics: {}
    sectorCards: [ {sector,breadth_pct,momentum_pct,nh,nl,up,down}, ... ]
- Polygon API key via:
    POLY_KEY or POLYGON_API_KEY or POLYGON_API

Outputs
-------
- Writes updated metrics + intraday + engineLights["10m"] back to
  data/outlook_intraday.json in-place.

This script is idempotent and safe to run multiple times.
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

UTC = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

# ------------------------ Polygon helpers ------------------------

def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "POLYGON_API"):
        v = os.environ.get(name)
        if v:
            print("[10m-trend] using key from", name, flush=True)
            return v
    print("[10m-trend] WARNING: no Polygon key in POLY_KEY/POLYGON_API_KEY/POLYGON_API", flush=True)
    return None

POLY_KEY = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ferrari-dashboard/10m-trend", "Accept-Encoding": "gzip"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        try:
            import gzip
            if resp.getheader("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
        except Exception:
            pass
        return data.decode("utf-8")

def poly_json(url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if params is None:
        params = {}
    if POLY_KEY:
        params["apiKey"] = POLY_KEY
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    for attempt in range(1, 5):
        try:
            raw = http_get(full, timeout=22)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print("[10m-trend] Polygon 401 -- check key/plan.", file=sys.stderr)
                break
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            break
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            break
    return {}

# ------------------------ math helpers ------------------------

def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def pct(num: float, den: float) -> float:
    try:
        if den <= 0:
            return 0.0
        return 100.0 * float(num) / float(den)
    except Exception:
        return 0.0

def to_num(x, default=0.0) -> float:
    try:
        v = float(x)
        if math.isnan(v):
            return default
        return v
    except Exception:
        return default

def ema_series(values: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
    for v in values:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out

def ema_last(values: List[float], span: int) -> Optional[float]:
    s = ema_series(values, span)
    return s[-1] if s else None

# ------------------------ 10m bars ------------------------

def last_closed_10m(bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not bars:
        return []
    BUCKET = 600  # 10 min
    out = list(bars)
    now = int(time.time())
    curr_bucket = (now // BUCKET) * BUCKET
    last = int(out[-1].get("time") or out[-1].get("t") or 0)
    # assume last["time"] is seconds; if ms, convert
    if last > 2_000_000_000:
        last //= 1000
    if (last // BUCKET) * BUCKET == curr_bucket:
        out = out[:-1]
    return out

def fetch_10m_bars(symbol: str, minutes_back: int = 600) -> List[Dict[str, Any]]:
    """
    Fetch ~minutes_back of 10m bars for symbol.
    """
    end_date = datetime.now(UTC).date()
    # approx days = minutes_back/60/6 + pad
    days = max(1, minutes_back // (60 * 6) + 2)
    start_date = end_date - timedelta(days=days)
    url = f"{POLY_BASE}/v2/aggs/ticker/{symbol}/range/10/minute/{start_date:%Y-%m-%d}/{end_date:%Y-%m-%d}"
    js = poly_json(url, {"adjusted": "true", "sort": "asc", "limit": 50000})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "time": int(r.get("t", 0)) // 1000,
                "open": float(r.get("o", 0.0)),
                "high": float(r.get("h", 0.0)),
                "low":  float(r.get("l", 0.0)),
                "close":float(r.get("c", 0.0)),
                "volume":float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    out.sort(key=lambda b: b["time"])
    return last_closed_10m(out)

# ------------------------ SMI helpers ------------------------

def smi_kd_series(H: List[float], L: List[float], C: List[float],
                  k_len: int = 12, d_len: int = 7, ema_len: int = 5) -> Tuple[List[float], List[float]]:
    n = len(C)
    if n < max(k_len, d_len) + 6:
        return [], []
    HH: List[float] = []
    LL: List[float] = []
    for i in range(n):
        i0 = max(0, i - (k_len - 1))
        HH.append(max(H[i0:i+1]))
        LL.append(min(L[i0:i+1]))
    mid = [(HH[i] + LL[i]) / 2.0 for i in range(n)]
    rng = [(HH[i] - LL[i]) for i in range(n)]
    m = [C[i] - mid[i] for i in range(n)]

    def ema_vals(vals: List[float], span: int) -> List[float]:
        k = 2.0 / (span + 1.0)
        e: Optional[float] = None
        out: List[float] = []
        for v in vals:
            e = v if e is None else e + k * (v - e)
            out.append(e)
        return out

    m1 = ema_vals(m, k_len)
    m2 = ema_vals(m1, ema_len)
    r1 = ema_vals(rng, k_len)
    r2 = ema_vals(r1, ema_len)

    K: List[float] = []
    for i in range(n):
        denom = (r2[i] or 0.0) / 2.0
        v = 0.0 if denom == 0 else 100.0 * (m2[i] / denom)
        if not (v == v):  # NaN check
            v = 0.0
        K.append(max(-100.0, min(100.0, v)))

    D: List[float] = []
    k = 2.0 / (d_len + 1.0)
    e: Optional[float] = None
    for v in K:
        e = v if e is None else e + k * (v - e)
        D.append(e)
    return K, D

# ------------------------ Lux PSI helper ------------------------

def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    """
    Approx Lux PSI implementation (like daily, reused for 10m):
      - compute rolling max/min envelope
      - log(span) series
      - correlation slope inverted to 0..100
    """
    if not closes or len(closes) < max(5, length + 2):
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
    num = sum((x - xbar)*(y - ybar) for x, y in zip(xs, win))
    den = (sum((x - xbar)**2 for x in xs) * sum((y - ybar)**2 for y in win)) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0 * r + 50.0
    return float(clamp(psi, 0.0, 100.0))

# ------------------------ Sector-based metrics ------------------------

OFFENSIVE = {"information technology","communication services","consumer discretionary"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

def compute_risk_on_10m(sector_cards: List[Dict[str, Any]]) -> float:
    """
    Risk-on %: offensive≥55, defensive≤45 (55/45 thresholds)
    """
    if not sector_cards:
        return 50.0
    by = { (c.get("sector") or "").strip().lower(): c for c in sector_cards }
    score = 0
    den = 0
    for s in OFFENSIVE:
        c = by.get(s, {})
        v = c.get("breadth_pct")
        if isinstance(v, (int, float)):
            den += 1
            if v >= 55.0:
                score += 1
    for s in DEFENSIVE:
        c = by.get(s, {})
        v = c.get("breadth_pct")
        if isinstance(v, (int, float)):
            den += 1
            if v <= 45.0:
                score += 1
    return round(pct(score, den) if den > 0 else 50.0, 2)

def compute_sector_direction_10m(sector_cards: List[Dict[str, Any]], align_fast_pct: Optional[float]) -> float:
    """
    Sector Dir = % sectors where breadth≥55 AND momentum≥55 (55/45 stronger threshold).
    Fallback to align_fast_pct or 50 if no cards.
    """
    if sector_cards:
        good = 0
        total = 0
        for c in sector_cards:
            b = to_num(c.get("breadth_pct"), 50.0)
            m = to_num(c.get("momentum_pct"), 50.0)
            total += 1
            if b >= 55.0 and m >= 55.0:
                good += 1
        if total > 0:
            return round(pct(good, total), 2)
    if align_fast_pct is not None and align_fast_pct == align_fast_pct:  # not NaN
        return float(align_fast_pct)
    return 50.0

# ------------------------ Overall composite ------------------------

def compute_overall_10m(ema_sign: int, ema_gap_pct: float,
                        momentum_10m: float, breadth_10m: float,
                        expansion_10m: float, liquidity_psi: float,
                        risk_on_pct: float) -> Tuple[str, int, Dict[str, int]]:
    """
    Overall 10m composite:
      score = 0.40 * ema_posture
            + 0.25 * momentum
            + 0.10 * breadth
            + 0.10 * expansion
            + 0.10 * liq_pct
            + 0.05 * riskOn
    """
    ema_posture = clamp(50.0 + 50.0 * clamp(ema_gap_pct / 0.60, -1.0, 1.0), 0.0, 100.0)
    liq_pct     = clamp(min(liquidity_psi, 120.0)/120.0 * 100.0, 0.0, 100.0)
    momentum    = clamp(momentum_10m, 0.0, 100.0)
    breadth     = clamp(breadth_10m,  0.0, 100.0)
    expansion   = clamp(expansion_10m,0.0, 100.0)
    riskon      = clamp(risk_on_pct,  0.0, 100.0)

    score_f = (
        0.40 * ema_posture +
        0.25 * momentum +
        0.10 * breadth +
        0.10 * expansion +
        0.10 * liq_pct +
        0.05 * riskon
    )
    score = int(round(clamp(score_f, 0.0, 100.0)))

    if score >= 60 and ema_sign > 0:
        state = "bull"
    elif score <= 40 and ema_sign < 0:
        state = "bear"
    else:
        state = "neutral"

    ema_component = int(round(40.0 * clamp(abs(ema_gap_pct)/0.60, 0, 1) * (1 if ema_sign>0 else -1 if ema_sign<0 else 0)))
    components = {
        "ema10":     ema_component,
        "momentum":  int(round(25.0 * (momentum - 50.0) / 50.0)),
        "breadth":   int(round(10.0 * (breadth  - 50.0) / 50.0)),
        "squeeze":   int(round(10.0 * (expansion- 50.0) / 50.0)),
        "liquidity": int(round(10.0 * (liq_pct - 50.0) / 50.0)),
        "riskOn":    int(round( 5.0 * (riskon  - 50.0) / 50.0)),
    }

    return state, score, components

# ------------------------ MAIN ----------------------------------

INTRADAY_PATH = os.path.join("data", "outlook_intraday.json")

def main() -> int:
    if not os.path.exists(INTRADAY_PATH):
        print("[10m-trend] no outlook_intraday.json; skipping", file=sys.stderr)
        return 0

    with open(INTRADAY_PATH, "r", encoding="utf-8") as f:
        j = json.load(f)

    metrics: Dict[str, Any] = j.get("metrics") or {}
    intraday: Dict[str, Any] = j.get("intraday") or {}
    cards: List[Dict[str, Any]] = j.get("sectorCards") or []

    # --- 0) If no Polygon key, leave existing values alone ---
    if not POLY_KEY:
        print("[10m-trend] no Polygon key; leaving metrics as-is.", file=sys.stderr)
        return 0

    # --- 1) Fast breadth via sector ETFs (align + bar-up) ---
    ETF_SYMBOLS = [
        "XLK","XLY","XLC","XLP","XLU","XLV","XLRE","XLE","XLF","XLB","XLI"
    ]
    etf_bars: Dict[str, List[Dict[str, Any]]] = {}
    for sym in ETF_SYMBOLS:
        bars = fetch_10m_bars(sym, minutes_back=600)
        if len(bars) >= 2:
            etf_bars[sym] = bars

    aligned = barup = total = 0
    for sym, bars in etf_bars.items():
        C = [b["close"] for b in bars]
        O = [b["open"]  for b in bars]
        e10 = ema_series(C, 10)
        e20 = ema_series(C, 20)
        if not e10 or not e20:
            continue
        total += 1
        if e10[-1] > e20[-1]:
            aligned += 1
        if C[-1] > O[-1]:
            barup += 1

    align_pct = pct(aligned, total)
    barup_pct = pct(barup, total)
    breadth_10m_pct = clamp(0.60 * align_pct + 0.40 * barup_pct, 0.0, 100.0)
    metrics["breadth_10m_pct"]        = round(breadth_10m_pct, 2)
    metrics["breadth_align_fast_pct"] = round(align_pct, 2)

    # --- 2) Momentum (10m) from SPY 10m ---
    spy_bars = fetch_10m_bars("SPY", minutes_back=600)
    spy_bars = last_closed_10m(spy_bars)
    if len(spy_bars) < 6:
        ema_gap_pct = 0.0
        ema_sign = 0
        momentum_combo = 50.0
    else:
        C = [b["close"] for b in spy_bars]
        H = [b["high"]  for b in spy_bars]
        L = [b["low"]   for b in spy_bars]

        e8  = ema_series(C, 8)
        e18 = ema_series(C,18)
        if not e8 or not e18:
            ema_gap_pct = 0.0
            ema_sign = 0
            momentum_combo = 50.0
        else:
            gap = (e8[-1] - e18[-1]) / (e18[-1] if e18[-1] != 0 else 1.0)
            ema_gap_pct = 100.0 * gap
            ema_sign = 1 if e8[-1] > e18[-1] else (-1 if e8[-1] < e18[-1] else 0)
            ema_posture = clamp(50.0 + 50.0 * clamp(ema_gap_pct / 0.60, -1.0, 1.0), 0.0, 100.0)

            K, D = smi_kd_series(H, L, C, k_len=12, d_len=7, ema_len=5)
            if K and D:
                smi_diff = K[-1] - D[-1]
                smi_mapped = clamp(50.0 + 0.5 * smi_diff, 0.0, 100.0)
            else:
                smi_mapped = 50.0

            momentum_combo = clamp(0.70 * ema_posture + 0.30 * smi_mapped, 0.0, 100.0)

    metrics["momentum_10m_pct"]       = round(momentum_combo, 2)
    metrics["momentum_combo_10m_pct"] = round(momentum_combo, 2)
    metrics["ema_sign"]               = int(ema_sign)
    metrics["ema_gap_pct"]            = round(ema_gap_pct, 3)

    # --- 3) Squeeze (10m) via Lux PSI on SPY 10m closes ---
    C_spy = [b["close"] for b in spy_bars]
    psi = lux_psi_from_closes(C_spy, conv=50, length=20)
    if psi is None:
        psi = 50.0
    expansion = 100.0 - psi
    expansion = clamp(expansion, 0.0, 100.0)
    metrics["squeeze_psi_10m_pct"]   = round(psi, 2)
    metrics["squeeze_expansion_pct"] = round(expansion, 2)
    metrics["squeeze_pct"]           = round(expansion, 2)

    # --- 4) Liquidity (10m) ---
    V_spy = [b["volume"] for b in spy_bars]
    v3  = ema_last(V_spy, 3) or 0.0
    v12 = ema_last(V_spy,12) or 1.0
    liq_psi = clamp(100.0 * (v3 / v12), 0.0, 200.0)
    metrics["liquidity_psi"] = round(liq_psi, 2)

    # --- 5) Volatility (10m) ---
    if len(spy_bars) >= 2:
        C = [b["close"] for b in spy_bars]
        H = [b["high"]  for b in spy_bars]
        L = [b["low"]   for b in spy_bars]
        TR = [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1,len(C))]
        atr3 = ema_last(TR, 3) or 0.0
        vol_pct = 100.0 * (atr3 / (C[-1] if C[-1] else 1.0))
        vol_pct = max(0.0, vol_pct)
    else:
        vol_pct = 0.0
    metrics["volatility_pct"] = round(vol_pct, 3)

    # --- 6) RiskOn + Sector Direction from sectorCards (55/45 thresholds) ---
    risk_on_10m = compute_risk_on_10m(cards)
    metrics["riskOn_10m_pct"] = risk_on_10m

    align_fast = metrics.get("breadth_align_fast_pct")
    if align_fast is not None:
        align_fast = float(align_fast)
    else:
        align_fast = None

    rising_pct = compute_sector_direction_10m(cards, align_fast)

    sectorDir10 = intraday.get("sectorDirection10m") or {}
    sectorDir10["risingPct"] = rising_pct
    intraday["sectorDirection10m"] = sectorDir10

    riskOn10 = intraday.get("riskOn10m") or {}
    riskOn10["riskOnPct"] = risk_on_10m
    intraday["riskOn10m"] = riskOn10

    # --- 7) Overall 10m composite + engineLights["10m"] ---
    state, score, comps = compute_overall_10m(
        ema_sign=ema_sign,
        ema_gap_pct=ema_gap_pct,
        momentum_10m=momentum_combo,
        breadth_10m=breadth_10m_pct,
        expansion_10m=expansion,
        liquidity_psi=liq_psi,
        risk_on_pct=risk_on_10m,
    )

    overall10_prev = intraday.get("overall10m") or {}
    prev_state = overall10_prev.get("state")
    prev_changed = overall10_prev.get("lastChanged")

    if prev_state == state and prev_changed:
        last_changed = prev_changed
    else:
        last_changed = now_utc_iso()

    overall10 = {
        "state": state,
        "score": score,
        "components": comps,
        "lastChanged": last_changed,
    }
    intraday["overall10m"] = overall10

    eng = j.get("engineLights") or {}
    prev10 = eng.get("10m") or {}
    prev10_state = prev10.get("state")
    prev10_changed = prev10.get("lastChanged")

    if prev10_state == state and prev10_changed:
        eng_last_changed = prev10_changed
    else:
        eng_last_changed = last_changed

    eng["10m"] = {
        "state": state,
        "score": score,
        "components": comps,
        "lastChanged": eng_last_changed,
    }

    j["metrics"]     = metrics
    j["intraday"]    = intraday
    j["engineLights"]= eng

    with open(INTRADAY_PATH, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[10m-trend] state={state} score={score} breadth={breadth_10m_pct:.2f} "
          f"momentum={momentum_combo:.2f} squeezeExp={expansion:.2f} liq={liq_psi:.2f} "
          f"riskOn={risk_on_10m:.2f} risingPct={rising_pct:.2f}", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
