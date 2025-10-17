#!/usr/bin/env python3
"""
repair_intraday_metrics_10m.py  —  Safe repair pass for /live/intraday metrics.

Purpose
- Some runs write neutral 50.0 for squeeze/liquidity/volatility due to warmup/NaN guards.
- This post-process fixes ONLY those set to exactly 50.0 by recomputing them from
  current SPY 10-minute bars via Polygon. If values are already != 50.0, we leave them.

Inputs / Outputs
- --in  data/outlook_intraday.json
- --out data/outlook_intraday.json  (same file OK)

Env
- POLYGON_API_KEY must be set (same as other jobs).

Formulas (10m)
- volatility_pct  = 100 * EMA(TR, span=3) / close
- liquidity_pct   = 100 * EMA(vol,3) / EMA(vol,12)   (clipped 0..200)
- squeeze_pct     = 100 * (BBwidth / KCwidth) over last ~6 bars (clipped 0..100)
"""

import argparse, json, math, os, sys, time
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode

API = "https://api.polygon.io"
UTC = timezone.utc

def http_json(path, params):
    qs = urlencode(params)
    url = f"{API}{path}?{qs}"
    req = Request(url, headers={"User-Agent":"frye-dashboard/repair/1.0"})
    with urlopen(req, timeout=20) as r:
        import json as _json
        return _json.loads(r.read().decode("utf-8"))

def fetch_spy_10m_bars(days=2, limit=50000, key=None):
    if not key:
        raise SystemExit("POLYGON_API_KEY not set")
    end = datetime.now(UTC).date()
    start = end - timedelta(days=max(2, days))
    path = f"/v2/aggs/ticker/SPY/range/10/minute/{start}/{end}"
    js = http_json(path, {"adjusted":"true","sort":"asc","limit":limit,"apiKey":key})
    results = js.get("results") or []
    bars = []
    for r in results:
        try:
            t = int(r["t"]) // 1000
            bars.append({
                "t": t,
                "o": float(r["o"]),
                "h": float(r["h"]),
                "l": float(r["l"]),
                "c": float(r["c"]),
                "v": float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    return bars

def ema_last(values, span):
    if not values: return None
    k = 2.0/(span+1.0)
    out = None
    for x in values:
        out = x if out is None else out + k*(x - out)
    return out

def clamp(x, lo, hi):
    return max(lo, min(hi, x))

def compute_from_bars(bars):
    if len(bars) < 15:
        return None, None, None

    # take recent window (last ~18 bars)
    win = bars[-18:]
    H = [b["h"] for b in win]
    L = [b["l"] for b in win]
    C = [b["c"] for b in win]
    V = [b["v"] for b in win]

    # volatility: %ATR (EMA of TR span=3) / last close
    trs = []
    for i in range(1, len(C)):
        h, l, cp = H[i], L[i], C[i-1]
        trs.append(max(h-l, abs(h-cp), abs(l-cp)))
    atr_fast = ema_last(trs, span=3) if trs else None
    vol_pct = 100.0 * atr_fast / C[-1] if (atr_fast and C[-1] > 0) else None
    if vol_pct is not None: vol_pct = float(max(0.0, vol_pct))

    # liquidity: 100 * EMA(vol,3) / EMA(vol,12), clipped 0..200
    v3  = ema_last(V, span=3)
    v12 = ema_last(V, span=12)
    liq_pct = None
    if v12 and v12 > 0:
        liq_pct = float(clamp(100.0 * (v3 / v12), 0.0, 200.0))

    # squeeze: BB/KC width ratio over last ~6 bars
    n = 6
    if len(C) >= n and len(H) >= n and len(L) >= n:
        cn = C[-n:]
        hn = H[-n:]
        ln = L[-n:]
        mean = sum(cn)/n
        sd   = (sum((x-mean)**2 for x in cn)/n) ** 0.5
        bb_w = (mean + 2*sd) - (mean - 2*sd)
        # TR approx for kc
        trs6 = []
        prevs = cn[:-1] + [cn[-1]]
        for h,l,p in zip(hn, ln, prevs):
            trs6.append(max(h-l, abs(h-p), abs(l-p)))
        kc_w = 2.0 * (sum(trs6)/len(trs6)) if trs6 else 0.0
        sq = 100.0 * (bb_w / kc_w) if kc_w > 0 else None
        if sq is not None: sq = float(clamp(sq, 0.0, 100.0))
    else:
        sq = None

    return sq, liq_pct, vol_pct

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY")
    if not key:
        print("WARN: no POLYGON_API_KEY — skipping repair", file=sys.stderr)
        sys.exit(0)

    data = load_json(args.src)
    metrics = data.get("metrics") or {}

    need_sq  = float(metrics.get("squeeze_pct", 50.0))   == 50.0
    need_liq = float(metrics.get("liquidity_pct", 50.0)) == 50.0
    need_vol = float(metrics.get("volatility_pct", 50.0))== 50.0

    if not (need_sq or need_liq or need_vol):
        print("[repair] nothing to fix — metrics already set")
        sys.exit(0)

    bars = fetch_spy_10m_bars(days=2, key=key)
    sq, liq, vol = compute_from_bars(bars)

    changed = False
    if need_sq and sq is not None:
        metrics["squeeze_pct"] = sq
        metrics["squeeze_intraday_pct"] = sq
        changed = True
    if need_liq and liq is not None:
        metrics["liquidity_pct"] = liq
        metrics["liquidity_psi"] = liq
        changed = True
    if need_vol and vol is not None:
        metrics["volatility_pct"] = vol
        changed = True

    data["metrics"] = metrics
    if changed:
        # optional stamp
        meta = data.get("meta") or {}
        meta["repaired_at_utc"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        data["meta"] = meta
        save_json(args.dst, data)
        print("[repair] updated metrics:",
              "squeeze=", metrics.get("squeeze_pct"),
              "liquidity=", metrics.get("liquidity_pct"),
              "volatility=", metrics.get("volatility_pct"))
    else:
        print("[repair] unable to improve metrics; leaving as-is")

if __name__ == "__main__":
    main()
