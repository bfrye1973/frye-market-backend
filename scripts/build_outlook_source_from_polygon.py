#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R8 — FAST & CLEAN)

Cadences
- intraday10 : 10-minute workflow (snapshots vs prior 10-day watermarks)
- hourly     : last completed 1-hour bars
- daily      : completed daily bars (EOD)

Global (unchanged schema so FE keeps working)
- squeeze_pressure_pct : int 0..100   (intraday PSI "fuel" from daily closes; unchanged)
- squeeze_state        : str           ("none"|"on"|"firingUp"|"firingDown")
- daily_squeeze_pct    : float 0..100  (Lux PSI on DAILY SPY, conv=50 len=20, 2 decimals)
- volatility_pct       : int 0..100    (ATR% percentile on DAILY SPY)
- liquidity_pct        : int 0..120    (SPY 5/20d volume ratio %)

Per-sector counts (each cadence)
- nh, nl     : 10-day new highs / new lows
- u,  d      : 3-day up / 3-day down streaks
- vol_state, breadth_state, history scaffolding (unchanged)

NOTE: No ADR momentum in intraday10 to keep runtime <~15–20 min.
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple

# ---------------- ENV / CONFIG ----------------
POLY_KEY  = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
POLY_BASE = "https://api.polygon.io"

SECTORS_DIR = os.path.join("data", "sectors")
OUT_PATH    = os.path.join("data", "outlook_source.json")

# ---------------- HTTP (tight retry) ----------------
def http_get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ferrari-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    qs   = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    for attempt in range(1, 4):  # max 3 tries
        try:
            raw = http_get(full, timeout=25)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(0.5); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 3:
                time.sleep(0.5); continue
            raise

# ---------------- DATE / FETCH ----------------
def dstr(d: date) -> str: return d.strftime("%Y-%m-%d")

def fetch_range(ticker: str, tf_kind: str, tf_val: int,
                start: date, end: date, limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":sort,"limit":limit})
    if js.get("status") != "OK": return []
    out=[]
    for r in js.get("results", []) or []:
        out.append({"t": int(r.get("t",0)),
                    "o": float(r.get("o",0)), "h": float(r.get("h",0)),
                    "l": float(r.get("l",0)), "c": float(r.get("c",0)),
                    "v": float(r.get("v",0))})
    out.sort(key=lambda x: x["t"])
    return out

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end, sort="asc")

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(7, hours_back // 6 + 2))  # buffer
    return fetch_range(ticker, "hour", 1, start, end, sort="asc")

# ---------------- SECTORS CSV ----------------
def read_symbols(path: str) -> List[str]:
    syms=[]
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s: syms.append(s)
    return syms

def discover_sectors() -> Dict[str, List[str]]:
    if not os.path.isdir(SECTORS_DIR):
        raise SystemExit(f"Missing {SECTORS_DIR}. Add CSVs like data/sectors/Tech.csv (header 'Symbol').")
    sectors={}
    for name in os.listdir(SECTORS_DIR):
        if not name.lower().endswith(".csv"): continue
        sector = os.path.splitext(name)[0]
        syms = read_symbols(os.path.join(SECTORS_DIR, name))
        if syms: sectors[sector] = syms
    if not sectors: raise SystemExit("No sector CSVs found.")
    return sectors

# ---------------- FLAGS ----------------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int,int,int,int]:
    """
    NH/NL vs prior 10 bars; 3U/3D = last 3 closes trending.
    Works for DAILY and HOURLY series.
    """
    if len(bars) < 11: return 0,0,0,0
    today   = bars[-1]
    prior10 = bars[-11:-1]
    is_10NH = int(today["h"] > max(b["h"] for b in prior10))
    is_10NL = int(today "l" < min(b["l"] for b in prior10))
    last3 = bars[-3:]
    is_3U = int(len(last3)==3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
    is_3D = int(len(last3)==3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    return is_10NH, is_10NL, is_3U, is_3D
