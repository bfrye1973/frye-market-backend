#!/usr/bin/env python3
"""
Archive OHLC snapshots for replay.

ENV:
  POLYGON_API_KEY   : required
  ARCHIVE_SYMBOLS   : e.g. "SPY,QQQ" (default: SPY)
  ARCHIVE_TIMEFRAMES: e.g. "10m,1h,1d" (default: 1h,1d)
  LOOKBACK_BARS     : e.g. "500" (default: 500)

OUTPUT:
  data/archive/ohlc/<SYMBOL>/<TF>/ohlc_<ISO_TS>.json
"""

import os, json, time, datetime as dt
from pathlib import Path
import requests

BASE = "https://api.polygon.io"

def env(k, d=None): return os.environ.get(k, d)

def poly_json(path, params):
    """Call Polygon and print HTTP errors for visibility."""
    api = env("POLYGON_API_KEY")
    if not api:
        raise SystemExit("POLYGON_API_KEY not set")

    p = dict(params or {})
    p["apiKey"] = api

    for i in range(6):
        try:
            r = requests.get(f"{BASE}{path}", params=p, timeout=20)
            if not r.ok:
                print(f"Polygon {r.status_code}: {r.text[:180]}")
                if r.status_code in (429,500,502,503,504):
                    time.sleep(min(8, 0.5 * (2**i)))
                    continue
                r.raise_for_status()
            return r.json()
        except Exception as e:
            print(f"Polygon call failed attempt {i+1}: {e}")
            time.sleep(min(8, 0.5 * (2**i)))
    raise SystemExit("Polygon request failed repeatedly")

def tf_map(tf):
    tf = tf.lower()
    if tf in ("10m","10min","10"): return ("10","minute","10m")
    if tf in ("1h","60m"):         return ("1","hour","1h")
    if tf in ("1d","d","day"):     return ("1","day","1d")
    raise SystemExit(f"Unsupported timeframe: {tf}")

def now_iso():
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def main():
    syms = [s.strip().upper() for s in env("ARCHIVE_SYMBOLS","SPY").split(",") if s.strip()]
    tfs  = [t.strip().lower() for t in env("ARCHIVE_TIMEFRAMES","1h,1d").split(",") if t.strip()]
    bars = int(env("LOOKBACK_BARS","500"))
    root = Path("data/archive/ohlc")

    ts = now_iso()
    today = dt.date.today()
    start = today - dt.timedelta(days=90)  # wide window; we'll just take last N bars

    for sym in syms:
        for tf in tfs:
            mult, unit, tf_dir = tf_map(tf)
            path = f"/v2/aggs/ticker/{sym}/range/{mult}/{unit}/{start}/{today}"
            js = poly_json(path, {"limit": bars, "sort": "desc"})  # most recent first
            results = js.get("results", [])
            results = results[:bars][::-1]  # keep last N, oldest→newest

            payload = {
                "symbol": sym,
                "timeframe": tf,
                "ts": ts,
                "bars": [
                    {
                        "time": int(b.get("t",0)/1000),
                        "open": b.get("o"),
                        "high": b.get("h"),
                        "low":  b.get("l"),
                        "close": b.get("c"),
                        "volume": b.get("v")
                    } for b in results
                ]
            }

            out = root / sym / tf_dir / f"ohlc_{ts}.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            with out.open("w", encoding="utf-8") as f:
                json.dump(payload, f, separators=(",",":"))

            print(f"Saved {sym} {tf} → {len(payload['bars'])} bars @ {out}")

    print(f"Archived OHLC @ {ts} for {syms} {tfs}")

if __name__ == "__main__":
    main()
