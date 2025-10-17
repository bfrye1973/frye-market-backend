#!/usr/bin/env python3
"""
repair_intraday_metrics_10m.py — SAFE REPAIR + DISPLAY FIELDS

What it does
- If squeeze_pct / liquidity_pct / volatility_pct == 50.0 (neutral fallback),
  recompute from SPY 10-minute bars via Polygon and patch the JSON.
- Always:
  * clamp squeeze_pct to 0..100 and round(2)
  * add metrics.volatility_scaled = round(volatility_pct * 6.25, 2)
    (daily-normalized display; raw volatility_pct stays for logic)

Requires
- env POLYGON_API_KEY (same key you use on Render)
"""

import argparse, json, os, sys
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.parse import urlencode

API = "https://api.polygon.io"
UTC = timezone.utc


def http_json(path, params):
    url = f"{API}{path}?{urlencode(params)}"
    try:
        req = Request(url, headers={"User-Agent": "frye-dashboard/repair/1.0"})
        with urlopen(req, timeout=20) as r:
            import json as _json
            return _json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print("[repair] Polygon fetch error:", e, file=sys.stderr)
        return {"results": []}


def fetch_spy_10m(days, key):
    from_dt = (datetime.now(UTC).date() - timedelta(days=max(2, days)))
    to_dt = datetime.now(UTC).date()
    js = http_json(
        f"/v2/aggs/ticker/SPY/range/10/minute/{from_dt}/{to_dt}",
        {"adjusted": "true", "sort": "asc", "limit": 50000, "apiKey": key},
    )
    bars = []
    for r in js.get("results") or []:
        try:
            bars.append(
                {
                    "o": float(r["o"]),
                    "h": float(r["h"]),
                    "l": float(r["l"]),
                    "c": float(r["c"]),
                    "v": float(r.get("v", 0.0)),
                }
            )
        except Exception:
            pass
    return bars


def ema_last(values, span):
    if not values:
        return None
    k = 2.0 / (span + 1.0)
    out = None
    for x in values:
        out = x if out is None else out + k * (x - out)
    return out


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def compute_three_from(bars):
    """
    Return (squeeze_pct, liquidity_pct, volatility_pct).
    Works even with few bars; uses last window defensively.
    """
    if not bars:
        return None, None, None

    win = bars[-18:] if len(bars) >= 18 else bars[:]  # up to ~3 hours
    H = [b["h"] for b in win]
    L = [b["l"] for b in win]
    C = [b["c"] for b in win]
    V = [b["v"] for b in win]

    # ---- volatility: 100 * EMA(TR,3) / last close
    vol = None
    if len(C) >= 2:
        TR = []
        for i in range(1, len(C)):
            TR.append(max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])))
        atr_fast = ema_last(TR, 3) if TR else None
        if atr_fast and C[-1] > 0:
            vol = 100.0 * atr_fast / C[-1]
            vol = float(max(0.0, vol))
    elif len(C) == 1:
        # minimal fallback with one bar: TR ≈ H-L; prevClose ≈ open
        tr = max(H[-1] - L[-1], abs(H[-1] - C[-1]), abs(L[-1] - C[-1]))
        vol = 100.0 * tr / C[-1] if C[-1] else 0.0

    # ---- liquidity: 100 * EMA(V,3)/EMA(V,12), clip 0..200
    liq = None
    if V:
        v3 = ema_last(V, 3)
        v12 = ema_last(V, 12)
        if v12 and v12 > 0:
            liq = float(clamp(100.0 * (v3 / v12), 0.0, 200.0))

    # ---- squeeze: BB/KC ratio over last ~6 bars, clip 0..100
    sq = None
    n = 6
    if len(C) >= n:
        cn = C[-n:]
        hn = H[-n:]
        ln = L[-n:]
        mean = sum(cn) / n
        sd = (sum((x - mean) ** 2 for x in cn) / n) ** 0.5
        bb_w = (mean + 2 * sd) - (mean - 2 * sd)
        prevs = cn[:-1] + [cn[-1]]
        trs6 = [max(h - l, abs(h - p), abs(l - p)) for h, l, p in zip(hn, ln, prevs)]
        kc_w = 2.0 * (sum(trs6) / len(trs6)) if trs6 else 0.0
        if kc_w > 0:
            sq = float(clamp(100.0 * (bb_w / kc_w), 0.0, 100.0))

    return sq, liq, vol


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    data = json.load(open(args.src, "r", encoding="utf-8"))
    m = data.get("metrics") or {}

    # Fix only if builder emitted neutral 50.0 fallbacks
    need_sq = float(m.get("squeeze_pct", 50.0)) == 50.0
    need_liq = float(m.get("liquidity_pct", 50.0)) == 50.0
    need_vol = float(m.get("volatility_pct", 50.0)) == 50.0

    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY")
    if (need_sq or need_liq or need_vol) and not key:
        print("[repair] no POLYGON_API_KEY — skipping fallbacks", file=sys.stderr)

    if (need_sq or need_liq or need_vol) and key:
        bars = fetch_spy_10m(2, key)
        sq, liq, vol = compute_three_from(bars)

        changed = False
        if need_sq and sq is not None:
            m["squeeze_pct"] = sq
            m["squeeze_intraday_pct"] = sq
            changed = True
        if need_liq and liq is not None:
            m["liquidity_pct"] = liq
            m["liquidity_psi"] = liq
            changed = True
        if need_vol and vol is not None:
            m["volatility_pct"] = vol
            changed = True

        if changed:
            data["metrics"] = m
            meta = data.get("meta") or {}
            meta["repaired_at_utc"] = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            data["meta"] = meta

    # Always clamp/round squeeze and add scaled volatility for display
    sq = float(m.get("squeeze_pct", 50.0))
    sq = clamp(sq, 0.0, 100.0)
    m["squeeze_pct"] = round(sq, 2)

    vol = float(m.get("volatility_pct", 0.0))
    m["volatility_scaled"] = round(vol * 6.25, 2)  # daily-normalized display

    data["metrics"] = m
    json.dump(data, open(args.dst, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(
        "[repair] squeeze=",
        m.get("squeeze_pct"),
        " liquidity=",
        m.get("liquidity_pct"),
        " vol=",
        m.get("volatility_pct"),
        " vol_scaled=",
        m.get("volatility_scaled"),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)
