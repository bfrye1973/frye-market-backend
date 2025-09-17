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
import os, sys, json, time, math, argparse, datetime, pathlib, requests

BASE = "https://api.polygon.io"

def env(k, d=None): return os.environ.get(k, d)

def poly_json(path, params):
    api = env("POLYGON_API_KEY")
    if not api: raise SystemExit("POLYGON_API_KEY not set")
    p = dict(params or {})
    p["apiKey"] = api
    for i in range(6):
        try:
            r = requests.get(f"{BASE}{path}", params=p, timeout=20)
            if r.status_code in (429,500,502,503,504):
                time.sleep(min(8, 0.5*(2**i))); continue
            r.raise_for_status()
            return r.json()
        except Exception:
            time.sleep(min(8, 0.5*(2**i)))
    raise SystemExit("Polygon request failed repeatedly")

def tf_map(tf):
    # polygon granularity map
    tf = tf.lower()
    if tf in ("10m","10min","10"): return ("10","minute")
    if tf in ("1h","60m"): return ("1","hour")
    if tf in ("1d","d","day"): return ("1","day")
    raise SystemExit(f"Unsupported timeframe: {tf}")

def now_iso():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat()+"Z"

def main():
    syms = [s.strip().upper() for s in env("ARCHIVE_SYMBOLS","SPY").split(",") if s.strip()]
    tfs  = [t.strip().lower() for t in env("ARCHIVE_TIMEFRAMES","1h,1d").split(",") if t.strip()]
    bars = int(env("LOOKBACK_BARS","500"))
    outdir = pathlib.Path("data/archive/ohlc")

    ts = now_iso()
    for sym in syms:
        for tf in tfs:
            mult, unit = tf_map(tf)
            js = poly_json(f"/v2/aggs/ticker/{sym}/range/{mult}/{unit}/now/prev", {"limit": bars})
            results = js.get("results", [])
            payload = {"symbol": sym, "timeframe": tf, "ts": ts,
                       "bars": [{"time": int(b.get("t",0)/1000),
                                 "open": b.get("o"), "high": b.get("h"),
                                 "low": b.get("l"), "close": b.get("c"),
                                 "volume": b.get("v")} for b in results]}
            path = outdir / sym / tf / f"ohlc_{ts}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, separators=(",",":"))
    print(f"Archived OHLC @ {ts} for {syms} {tfs}")

if __name__ == "__main__":
    main()
