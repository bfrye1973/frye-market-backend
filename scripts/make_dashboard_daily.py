#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_daily.py (EOD v1)
- Builds daily feed from Polygon 1D bars for SPY + sector ETFs
- Computes daily Market Meter + Lux-style trend capsule (strategy.trendDaily)
- Writes data/outlook_daily.json
"""

import os
import sys
import json
import math
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import List, Dict

POLY_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/1/day/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

SECTOR_ETFS = ["XLK", "XLY", "XLC", "XLP", "XLU", "XLV", "XLRE", "XLE", "XLF", "XLB", "XLI"]

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x, lo, hi): 
    return max(lo, min(hi, x))

def pct(a, b):
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "make-daily/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_daily(sym: str, key: str, lookback_days: int = 60) -> list:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_URL.replace("{sym}", sym).replace("{start}", str(start)).replace("{end}", str(end)).replace("{key}", key)
    try:
        js = fetch_json(url)
    except Exception as e:
        print(f"[warn] polygon fetch fail for {sym}:", e)
        return []
    rows = js.get("results") or []
    out = []
    for r in rows:
        try:
            out.append({
                "t": int(r["t"]) // 1000,
                "o": float(r["o"]),
                "h": float(r["h"]),
                "l": float(r["l"]),
                "c": float(r["c"]),
                "v": float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    return out[-60:]  # limit last ~3 months

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out = []
    e = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out

def build_daily() -> Dict:
    api_key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    if not api_key:
        raise RuntimeError("POLYGON_API_KEY is missing from repository/environment secrets.")

    # Fetch daily bars for sector ETFs and SPY
    bars = {}
    for sym in SECTOR_ETFS:
        bars[sym] = fetch_polygon_daily(sym, api_key, 60)
        time.sleep(0.2)

    # Breadth/Momentum from sector ETFs (EMA10 > EMA20 and close > open)
    total = sum(1 for s in SECTOR_ETFS if len(bars.get(s, [])) >= 20)
    align = 0
    rising = 0
    for sym in SECTOR_ETFS:
        b = bars.get(sym, [])
        if len(b) < 20:
            continue
        closes = [x["c"] for x in b]
        opens  = [x["o"] for x in b]
        e10 = ema_series(closes, 10)[-1]
        e20 = ema_series(closes, 20)[-1]
        if e10 > e20:
            align += 1
        if closes[-1] > opens[-1]:
            rising += 1

    breadth_daily_pct  = round(0.60 * pct(align, total) + 0.40 * pct(rising, total), 2)
    momentum_daily_pct = breadth_daily_pct  # coarse proxy for now

    # Fetch SPY for EOD trending
    spy = fetch_polygon_daily("SPY", api_key, 180)
    if len(spy) < 20:
        raise RuntimeError("Insufficient SPY daily bars to compute daily metrics")

    H = [x["h"] for x in spy]
    L = [x["l"] for x in spy]
    C = [x["c"] for x in spy]
    V = [x["v"] for x in spy]

    # Squeeze daily (Lux style): BB width vs KC width
    mean = sum(C) / len(C)
    std  = (sum((x - mean) ** 2 for x in C) / len(C)) ** 0.5
    bb_width = (mean + 2 * std) - (mean - 2 * std)
    tr = [max(H[i] - L[i], abs(H[i] - C[i-1]), abs(L[i] - C[i-1])) for i in range(1, len(C))]
    kc_width = 2.0 * (sum(tr[-20:]) / max(1, min(20, len(tr))))
    if kc_width <= 0:
        squeeze_daily_pct = 50.0
    else:
        squeeze_daily_pct = round(clamp((bb_width / kc_width) * 100.0, 0.0, 100.0), 2)
        # convert width to "tightness": higher => tighter
        squeeze_daily_pct = round(100.0 - squeeze_daily_pct, 2)

    # Liquidity daily (PSI): EMA3/EMA12 of volume
    if len(V) >= 12:
        v3  = sum(V[-3:]) / 3
        v12 = sum(V[-12:]) / 12
        liquidity_daily = round(clamp((v3 / v12) * 100.0, 0.0, 200.0), 2)
    else:
        liquidity_daily = 50.0

    # Volatility daily: ATR% (3d)
    if len(C) >= 4:
        tr = [max(H[i] - L[i], abs(H[i] - C[i-1]), abs(L[i] - C[i-1])) for i in range(1, len(C))]
        atr = sum(tr[-3:]) / max(1, min(3, len(tr)))
        volatility_daily_pct = round(clamp(100.0 * atr / C[-1], 0.0, 100.0), 2)
    else:
        volatility_daily_pct = 20.0

    # EMA10/EMA20 posture on SPY daily for "overall"
    e10 = ema_series(C, 10)[-1]
    e20 = ema_series(C, 20)[-1]
    ema_sign = 1 if e10 > e20 else (-1 if e10 < e20 else 0)

    # Overall daily score (simple blend)
    overall_score = clamp(50.0 + 0.35 * (breadth_daily_pct - 50.0) + 0.35 * (momentum_daily_pct - 50.0) + 0.30 * ((100.0 - squeeze_daily_pct) - 50.0), 0, 100)
    daily_state = "bull" if (overall_score >= 60 and ema_sign > 0) else ("bear" if (overall_score <= 40 and ema_sign < 0) else "neutral")

    # Lux-trend daily capsule
    if squeeze_daily_pct >= 80.0:
        trend_state = "purple"
        trend_reason = f"PSI tight {squeeze_daily_pct:.0f}%"
    elif daily_state == "bull":
        trend_state = "green"
        trend_reason = f"Daily Bull {overall_score:.0f}"
    elif daily_state == "bear":
        trend_state = "red"
        trend_reason = f"Daily Bear {overall_score:.0f}"
    else:
        trend_state = "purple"
        trend_reason = f"Neutral {overall_score:.0f}"

    out = {
        "version": "r1-daily",
        "updated_at": now_iso(),
        "metrics": {
            "breadth_daily_pct": breadth_daily_pct,
            "momentum_daily_pct": momentum_daily_pct,
            "squeeze_daily_pct": squeeze_daily_pct,
            "liquidity_daily": liquidity_daily,
            "volatility_daily_pct": volatility_daily_pct,
            "ema_sign": ema_sign,
            "overall_score": overall_score
        },
        "daily": {
            "state": daily_state,
            "score": overall_score
        },
        "strategy": {
            "trendDaily": {
                "state": trend_state,
                "reason": trend_reason,
                "updatedAt": now_iso()
            }
        }
    }

    # ensure data dir exists
    os.makedirs("data", exist_ok=True)
    with open("data/outlook_daily.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("[ok] wrote data/outlook_daily.json")
    print("[daily]", out["strategy"]["trendDaily"])
    return out

if __name__ == "__main__":
    try:
        build_daily()
    except Exception as e:
        print("[fatal] daily builder error:", e)
        sys.exit(1)
