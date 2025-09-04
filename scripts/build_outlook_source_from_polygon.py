#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R2, intraday support)

Generates data/outlook_source.json from Polygon:

Modes
- daily     : EOD-style counts from completed daily bars
- intraday  : 10NH / 10NL / 3U / 3D from today's high/low/last vs prior 10-day watermarks

Inputs
- CSVs under data/sectors/{Sector}.csv  (header must be 'Symbol')

Outputs (unchanged schema for downstream make_dashboard.py)
{
  "timestamp": "...Z",
  "mode": "intraday" | "daily",
  "groups": {
    "<Sector>": { "nh":int, "nl":int, "u":int, "d":int, "vol_state":"Mixed", "breadth_state":"Neutral", "history":{"nh":[]} },
    ...
  },
  "global": {
    "squeeze_pressure_pct": int(0..100),
    "squeeze_state": "none"|"on"|"firingUp"|"firingDown",
    "volatility_pct": int(0..100),
    "liquidity_pct": int(0..120)
  }
}
"""

from __future__ import annotations
import argparse, csv, json, math, os, time, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from math import log
from typing import Any, Dict, List, Tuple

POLY_KEY   = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
POLY_BASE  = "https://api.polygon.io"

SECTORS_DIR= os.path.join("data", "sectors")
OUT_PATH   = os.path.join("data", "outlook_source.json")
HIST_PATH  = os.path.join("data", "history.json")

# ------------- HTTP helpers -------------
def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "frye-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url: str, params: Dict[str, Any] | None = None, retries: int = 3, backoff: float = 1.0) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    tries = 0
    while True:
        tries += 1
        try:
            return json.loads(http_get(full))
        except urllib.error.HTTPError as e:
            if e.code == 429 and tries <= retries:
                time.sleep(backoff * tries); continue
            raise
        except Exception:
            if tries <= retries:
                time.sleep(backoff * tries); continue
            raise

# ------------- Polygon fetches -------------
def fetch_range_daily(ticker: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start_date}/{end_date}"
    js = poly_json(url, {"adjusted":"true", "sort":"asc", "limit":50000})
    if js.get("status") != "OK": return []
    out = []
    for r in js.get("results", []) or []:
        out.append({"t": int(r.get("t", 0)), "o": float(r.get("o", 0)), "h": float(r.get("h", 0)),
                    "l": float(r.get("l", 0)), "c": float(r.get("c", 0)), "v": float(r.get("v", 0))})
    out.sort(key=lambda x: x["t"])
    return out

def bulk_snapshots(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
    """ /v2/snapshot/locale/us/markets/stocks/tickers?tickers=AAPL,MSFT,... """
    out: Dict[str, Dict[str, Any]] = {}
    for i
