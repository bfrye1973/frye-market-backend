#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (10m Scalper)

Purpose:
  Build a 10-minute / intraday sector "source" file that make_dashboard.py
  can consume to produce outlook_intraday.json, using *true intraday* logic.

What this script does:
  - Reads sector CSVs from data/sectors/*.csv
    (each CSV has header 'Symbol' and a list of tickers)
  - For each symbol:
      * Fetches recent 10-minute bars from Polygon (range/10/minute)
      * Keeps today's completed bars only (drops in-flight bar)
      * Computes from the last L completed 10m bars (default L=3):
          - NH: C[-1] > max(H[-L:-1])  (new 10m high vs recent window)
          - NL: C[-1] < min(L[-L:-1])  (new 10m low vs recent window)
          - 3U: C[-3] < C[-2] < C[-1]  (3-bar up sequence)
          - 3D: C[-3] > C[-2] > C[-1]  (3-bar down sequence)
  - Aggregates per sector:
      - nh = sum(NH)
      - nl = sum(NL)
      - up = sum(3U)
      - down = sum(3D)
  - Computes:
      - breadth_pct  = nh / (nh + nl) * 100  (or 50 if denom=0)
      - momentum_pct = up / (up + down) * 100 (or 50 if denom=0)
  - Writes a JSON file with:
      {
        "mode": "intraday",
        "sectorCards": [
          {
            "sector": "Information Technology",
            "breadth_pct": ...,
            "momentum_pct": ...,
            "nh": ...,
            "nl": ...,
            "up": ...,
            "down": ...
          },
          ...
        ],
        "meta": {
          "lookback_bars": L,
          "ts_utc": "....",
          "source": "polygon/10m"
        }
      }

CLI:
  python -u scripts/build_outlook_source_from_polygon.py --out data/outlook_source.json

Environment:
  - POLY_KEY or POLYGON_API_KEY or POLYGON_API
  - FD_MAX_WORKERS         (optional, default 8)
  - FD_SCALPER_LOOKBACK    (optional, default 3; must be >=2)
  - FD_INTRADAY_DAYS       (optional, default 2; days of 10m bars to fetch)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import math
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

# ------------------------ ENV & CONSTANTS ------------------------

UTC = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "POLYGON_API"):
        v = os.environ.get(name)
        if v:
            print("[poly] using key from", name, flush=True)
            return v
    print("[poly] WARNING: no Polygon key in POLY_KEY/POLYGON_API_KEY/POLYGON_API", flush=True)
    return None

POLY_KEY  = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

MAX_WORKERS         = int(os.environ.get("FD_MAX_WORKERS", "8"))
SCALPER_LOOKBACK    = max(2, int(os.environ.get("FD_SCALPER_LOOKBACK", "3")))  # L bars
INTRADAY_DAYS       = int(os.environ.get("FD_INTRADAY_DAYS", "2"))             # how many days of 10m bars to fetch

# ------------------------ HTTP HELPERS ---------------------------

def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ferrari-dashboard/10m-builder", "Accept-Encoding": "gzip"},
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
    qs   = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    for attempt in range(1, 5):
        try:
            raw = http_get(full, timeout=22)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code == 401:
                raise SystemExit("Polygon returned 401 Unauthorized — check key/plan/rate limits.")
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            raise

# ------------------------ POLYGON QUERIES ------------------------

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

def fetch_10m_bars(ticker: str, days: int) -> List[Dict[str, Any]]:
    """
    Fetch 10-minute bars for the last `days` calendar days.
    We will filter to *today's* completed bars downstream.
    """
    end = datetime.now(UTC).date()
    start = end - timedelta(days=days)
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/10/minute/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":"asc","limit":50000})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t", 0)),  # epoch ms
                "o": float(r.get("o", 0.0)),
                "h": float(r.get("h", 0.0)),
                "l": float(r.get("l", 0.0)),
                "c": float(r.get("c", 0.0)),
                "v": float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["t"])
    return out

def todays_completed_10m(bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    From a list of 10m bars, return today's completed 10m bars:
      - filter to today's date in UTC
      - drop the in-flight bar if its bucket matches the current bucket
    """
    if not bars:
        return []
    today = datetime.now(UTC).date()
    def to_sec(b): return int(b["t"]/1000.0)
    todays = [b for b in bars if datetime.fromtimestamp(to_sec(b), UTC).date() == today]
    if not todays:
        return []
    # Drop in-flight bar
    now = int(time.time())
    BUCKET = 600
    cur_bucket = (now // BUCKET) * BUCKET
    last_sec = to_sec(todays[-1])
    if (last_sec // BUCKET) * BUCKET == cur_bucket:
        todays = todays[:-1]
    return todays

# ------------------------ SECTOR CSV HELPERS ---------------------

def read_symbols(path: str) -> List[str]:
    syms: List[str] = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s:
                syms.append(s)
    return syms

def discover_sectors(sectors_dir: str) -> Dict[str, List[str]]:
    if not os.path.isdir(sectors_dir):
        raise SystemExit(f"Missing {sectors_dir}. Add CSVs like {sectors_dir}/Tech.csv (header 'Symbol').")
    sectors: Dict[str, List[str]] = {}
    for name in os.listdir(sectors_dir):
        if not name.lower().endswith(".csv"):
            continue
        sector = os.path.splitext(name)[0]
        syms = read_symbols(os.path.join(sectors_dir, name))
        if syms:
            sectors[sector] = syms
    if not sectors:
        raise SystemExit(f"No sector CSVs found in {sectors_dir}.")
    return sectors

# ------------------------ FLAG COMPUTATION (10m) -----------------

def compute_intraday_flags_10m(bars: List[Dict[str, Any]], lookback: int) -> Tuple[int,int,int,int]:
    """
    From today's completed 10m bars, compute:
      - NH: C[-1] > max(H[-L:-1])
      - NL: C[-1] < min(L[-L:-1])
      - U3: C[-3] < C[-2] < C[-1]
      - D3: C[-3] > C[-2] > C[-1]
    """
    L = max(lookback, 2)
    if len(bars) < max(L, 3):
        return 0,0,0,0
    H = [float(b["h"]) for b in bars]
    Ls= [float(b["l"]) for b in bars]
    C = [float(b["c"]) for b in bars]
    # NH / NL
    recent_hi = max(H[-L:-1]) if L>1 else H[-1]
    recent_lo = min(Ls[-L:-1]) if L>1 else Ls[-1]
    nh = int(C[-1] > recent_hi)
    nl = int(C[-1] < recent_lo)
    # 3-bar streak
    u3 = int(C[-3] < C[-2] < C[-1])
    d3 = int(C[-3] > C[-2] > C[-1])
    return nh, nl, u3, d3

# ------------------------ SECTOR AGG PIPELINE --------------------

def process_symbol_10m(ticker: str, lookback_bars: int, days: int) -> Tuple[int,int,int,int]:
    """
    Fetch recent 10m bars for a symbol and compute intraday flags.
    """
    try:
        bars = fetch_10m_bars(ticker, days)
        today_bars = todays_completed_10m(bars)
        if not today_bars:
            return 0,0,0,0
        return compute_intraday_flags_10m(today_bars, lookback_bars)
    except SystemExit:
        raise
    except Exception:
        return 0,0,0,0

def process_sector(sector: str, symbols: List[str], lookback_bars: int, days: int) -> Dict[str, Any]:
    """
    Compute aggregate NH/NL/U/D counts for a sector from intraday 10m bars.
    """
    nh = nl = u = d = 0
    if not symbols:
        return {"sector": sector, "nh":0, "nl":0, "u":0, "d":0}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_symbol_10m, sym, lookback_bars, days): sym for sym in symbols}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                f_nh, f_nl, f_u, f_d = fut.result()
                nh += f_nh; nl += f_nl; u += f_u; d += f_d
            except Exception:
                continue
    return {"sector": sector, "nh": nh, "nl": nl, "u": u, "d": d}

def compute_sector_cards(sectors_dir: str, lookback_bars: int, days: int) -> List[Dict[str, Any]]:
    sectors_map = discover_sectors(sectors_dir)
    print("[10m] discovered sectors:", ", ".join(sorted(sectors_map.keys())), flush=True)

    cards: List[Dict[str, Any]] = []
    for sector_name, syms in sorted(sectors_map.items()):
        print(f"[10m] sector {sector_name}: {len(syms)} symbols", flush=True)
        agg = process_sector(sector_name, syms, lookback_bars, days)
        nh = agg["nh"]; nl = agg["nl"]; up = agg["u"]; down = agg["d"]
        denom_b = nh + nl
        denom_m = up + down

        breadth_pct  = round(100.0 * nh / float(denom_b), 2) if denom_b>0 else 50.0
        momentum_pct = round(100.0 * up / float(denom_m), 2) if denom_m>0 else 50.0

        cards.append({
            "sector": sector_name,
            "breadth_pct": breadth_pct,
            "momentum_pct": momentum_pct,
            "nh": int(nh),
            "nl": int(nl),
            "up": int(up),
            "down": int(down),
        })
    return cards

# ------------------------ MAIN ----------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="Build intraday outlook_source.json (10m scalper) from Polygon sectors.")
    ap.add_argument("--out", required=True, help="Output path (e.g. data/outlook_source.json)")
    ap.add_argument(
        "--sectors-dir",
        default=DEFAULT_SECTORS_DIR,
        help="Directory containing sector CSVs (default: data/sectors)",
    )
    ap.add_argument(
        "--lookback-bars",
        type=int,
        default=SCALPER_LOOKBACK,
        help="10m scalper lookback bars L (default from FD_SCALPER_LOOKBACK or 3)",
    )
    ap.add_argument(
        "--days",
        type=int,
        default=INTRADAY_DAYS,
        help="Number of calendar days of 10m bars to fetch (default from FD_INTRADAY_DAYS or 2)",
    )
    args = ap.parse_args()

    if not POLY_KEY:
        print("[10m] ERROR: no Polygon API key set; emitting neutral sectors.", file=sys.stderr, flush=True)
        sectors_map = discover_sectors(args.sectors_dir)
        cards = []
        for name in sorted(sectors_map.keys()):
            cards.append({
                "sector": name,
                "breadth_pct": 0.0,
                "momentum_pct": 0.0,
                "nh": 0,
                "nl": 0,
                "up": 0,
                "down": 0,
            })
    else:
        cards = compute_sector_cards(args.sectors_dir, args.lookback_bars, args.days)

    out_obj: Dict[str, Any] = {
        "mode": "intraday",
        "sectorCards": cards,
        "meta": {
            "lookback_bars": args.lookback_bars,
            "ts_utc": now_utc_iso(),
            "source": "polygon/10m",
        },
    }

    out_path = args.out
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[10m] wrote outlook source to {out_path}", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
