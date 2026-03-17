#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_hourly_source.py (v3, true hourly engine)

Goal:
  Provide a real hourly sector "source" file for the hourly workflow:
    data/outlook_source.json

Strategy:
  - Read sector CSVs from data/sectors/*.csv (header: Symbol)
  - For each symbol:
      * Fetch recent 1-hour bars from Polygon (60-minute aggs)
      * Compute:
          - 10-bar high (10NH)
          - 10-bar low  (10NL)
          - 3-bar up sequence (3U)
          - 3-bar down sequence (3D)
  - Aggregate per sector:
      - nh = sum(10NH)
      - nl = sum(10NL)
      - up = sum(3U)
      - down = sum(3D)
  - Compute:
      - breadth_pct  = nh / (nh + nl) * 100  (or 50 if denom=0)
      - momentum_pct = up / (up + down) * 100 (or 50 if denom=0)
  - Emit:
      {
        "mode": "hourly",
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
          "lookback_hours": ...,
          "source": "polygon/hourly"
        }
      }

This is analogous to the 10m daily-based engine but uses 1-hour bars
for a truer hourly picture.

CLI:
  python -u scripts/build_outlook_hourly_source.py --out data/outlook_source.json

Env:
  - POLY_KEY or POLYGON_API_KEY or POLYGON_API
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

UTC = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "POLYGON_API"):
        v = os.environ.get(name)
        if v:
            print("[hourly-src] using key from", name, flush=True)
            return v
    print("[hourly-src] WARNING: no Polygon key in POLY_KEY/POLYGON_API_KEY/POLYGON_API", flush=True)
    return None

POLY_KEY = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

MAX_WORKERS    = int(os.environ.get("FD_MAX_WORKERS", "6"))
LOOKBACK_HOURS = int(os.environ.get("HOUR_LOOKBACK_HOURS", "72"))  # 3 days of 1h bars

# ------------------------ HTTP ------------------------

def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ferrari-dashboard/hourly-builder", "Accept-Encoding": "gzip"},
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
                raise SystemExit("Polygon 401 Unauthorized — check key/plan.")
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

def fetch_hourly_bars(ticker: str, hours: int) -> List[Dict[str, Any]]:
    """
    Fetch ~hours of 60-minute bars for ticker.
    We'll convert to a "bars" list compatible with compute_flags_from_bars.
    """
    end_date = datetime.now(UTC).date()
    # approximate days: hours/6 + cushion
    days = max(2, hours // 6 + 2)
    start_date = end_date - timedelta(days=days)
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/hour/{dstr(start_date)}/{dstr(end_date)}"
    js = poly_json(url, {"adjusted": "true", "sort": "asc", "limit": 50000})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t", 0)),
                "o": float(r.get("o", 0.0)),
                "h": float(r.get("h", 0.0)),
                "l": float(r.get("l", 0.0)),
                "c": float(r.get("c", 0.0)),
                "v": float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["t"])
    # drop in-flight hour
    if out:
        last = out[-1]["t"] // 1000
        now = int(time.time())
        # if last bar is current in-flight hour, drop it
        if (last // 3600) == (now // 3600):
            out = out[:-1]
    return out

# ------------------------ SECTOR CSV HELPERS ------------------------

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

# ------------------------ FLAG COMPUTATION ------------------------

def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
    """
    Given a sequence of bars (ascending), compute:

      - is_10NH: last high > max high of prior 10 bars
      - is_10NL: last low  < min low of prior 10 bars
      - is_3U:   last 3 closes strictly increasing
      - is_3D:   last 3 closes strictly decreasing
    """
    if len(bars) < 11:
        return 0, 0, 0, 0
    today   = bars[-1]
    prior10 = bars[-11:-1]
    if not prior10:
        return 0, 0, 0, 0
    try:
        is_10NH = int(today["h"] > max(b["h"] for b in prior10))
        is_10NL = int(today["l"] < min(b["l"] for b in prior10))
    except Exception:
        is_10NH = is_10NL = 0
    last3 = bars[-3:]
    try:
        is_3U = int(len(last3) == 3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
        is_3D = int(len(last3) == 3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    except Exception:
        is_3U = is_3D = 0
    return is_10NH, is_10NL, is_3U, is_3D

# ------------------------ SECTOR AGG PIPELINE ------------------------

def process_symbol(ticker: str, hours: int) -> Tuple[int, int, int, int]:
    try:
        bars = fetch_hourly_bars(ticker, hours)
        if not bars:
            return 0, 0, 0, 0
        return compute_flags_from_bars(
            [{"h": b["h"], "l": b["l"], "c": b["c"]} for b in bars]
        )
    except SystemExit:
        raise
    except Exception:
        return 0, 0, 0, 0

def process_sector(sector: str, symbols: List[str], hours: int) -> Dict[str, Any]:
    nh = nl = u = d = 0
    if not symbols:
        return {"sector": sector, "nh":0, "nl":0, "u":0, "d":0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_symbol, sym, hours): sym for sym in symbols}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                f_nh, f_nl, f_u, f_d = fut.result()
                nh += f_nh
                nl += f_nl
                u  += f_u
                d  += f_d
            except Exception:
                continue

    return {"sector": sector, "nh": nh, "nl": nl, "u": u, "d": d}

def compute_sector_cards(sectors_dir: str, hours: int) -> List[Dict[str, Any]]:
    sectors_map = discover_sectors(sectors_dir)
    print("[hourly-src] discovered sectors:", ", ".join(sorted(sectors_map.keys())), flush=True)

    cards: List[Dict[str, Any]] = []

    for sector_name, syms in sorted(sectors_map.items()):
        print(f"[hourly-src] sector {sector_name}: {len(syms)} symbols", flush=True)
        agg = process_sector(sector_name, syms, hours)
        nh = agg["nh"]
        nl = agg["nl"]
        up = agg["u"]
        down = agg["d"]

        denom_b = nh + nl
        denom_m = up + down

        if denom_b > 0:
            breadth_pct = round(100.0 * nh / float(denom_b), 2)
        else:
            breadth_pct = 50.0

        if denom_m > 0:
            momentum_pct = round(100.0 * up / float(denom_m), 2)
        else:
            momentum_pct = 50.0

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
    ap = argparse.ArgumentParser(description="Build hourly outlook_source.json from Polygon hourly sector data.")
    ap.add_argument("--out", required=True, help="Output path (e.g. data/outlook_source.json)")
    ap.add_argument(
        "--sectors-dir",
        default=DEFAULT_SECTORS_DIR,
        help="Directory containing sector CSVs (default: data/sectors)",
    )
    ap.add_argument(
        "--hours",
        type=int,
        default=LOOKBACK_HOURS,
        help="1-hour lookback window for NH/NL/3U/3D flags (default from HOUR_LOOKBACK_HOURS or 72)",
    )
    args = ap.parse_args()

    if not POLY_KEY:
        print("[hourly-src] ERROR: no Polygon API key set; cannot compute real hourly sector breadth.", file=sys.stderr, flush=True)
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
        cards = compute_sector_cards(args.sectors_dir, args.hours)

    out_obj: Dict[str, Any] = {
        "mode": "hourly",
        "sectorCards": cards,
        "meta": {
            "lookback_hours": args.hours,
            "ts_utc": now_utc_iso(),
            "source": "polygon/hourly",
        },
    }

    out_path = args.out
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[hourly-src] wrote hourly source to {out_path}", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
