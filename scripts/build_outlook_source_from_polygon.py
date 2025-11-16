#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py

Purpose:
  Build a 10-minute / intraday sector "source" file that make_dashboard.py
  can consume to produce outlook_intraday.json.

What this script does:
  - Reads sector CSVs from data/sectors/*.csv
    (each CSV has header 'Symbol' and a list of tickers)
  - For each symbol:
      * Fetches recent daily bars from Polygon
      * Computes:
          - 10-day high (10NH)
          - 10-day low  (10NL)
          - 3-bar up sequence (3U)
          - 3-bar down sequence (3D)
  - Aggregates per sector:
      - nh = sum(10NH)
      - nl = sum(10NL)
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
          "lookback_days": ...,
          "source": "polygon/daily"
        }
      }

CLI:
  python -u scripts/build_outlook_source_from_polygon.py --out data/outlook_source.json

Environment:
  - POLY_KEY or POLYGON_API_KEY or POLYGON_API
    (first non-empty will be used as the Polygon API key)
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
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

POLY_KEY = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "8"))
LOOKBACK_DAYS = int(os.environ.get("FD_LOOKBACK_DAYS", "20"))  # days of daily bars

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
      # Bubble useful 401 immediately with clear message.
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

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
  """
  Fetch 'days' daily bars (adjusted=true, ascending).
  """
  end = datetime.now(UTC).date()
  start = end - timedelta(days=days + 5)  # pad a bit
  url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{dstr(start)}/{dstr(end)}"
  js = poly_json(url, {"adjusted": "true", "sort": "asc", "limit": 5000})
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
  return out

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

# ------------------------ FLAG COMPUTATION -----------------------

def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
  """
  Given a sequence of daily bars (ascending), compute:

    - is_10NH: today's high > max high of prior 10 bars
    - is_10NL: today's low  < min low of prior 10 bars
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

# ------------------------ SECTOR AGG PIPELINE --------------------

def process_symbol(ticker: str, days: int) -> Tuple[int, int, int, int]:
  """
  Fetch daily bars and compute flags for a single symbol.
  Returns (10NH, 10NL, 3U, 3D).
  """
  try:
    bars = fetch_daily(ticker, days)
    if not bars:
      return 0, 0, 0, 0
    return compute_flags_from_bars(bars)
  except SystemExit:
    raise
  except Exception:
    return 0, 0, 0, 0

def process_sector(sector: str, symbols: List[str], days: int) -> Dict[str, Any]:
  """
  Compute aggregate counts for a sector.
  """
  nh = nl = u = d = 0
  if not symbols:
    return {"sector": sector, "nh":0, "nl":0, "u":0, "d":0}

  with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
    futures = {ex.submit(process_symbol, sym, days): sym for sym in symbols}
    for fut in as_completed(futures):
      sym = futures[fut]
      try:
        f_nh, f_nl, f_u, f_d = fut.result()
        nh += f_nh
        nl += f_nl
        u  += f_u
        d  += f_d
      except Exception:
        # treat error as zero contribution
        continue

  return {"sector": sector, "nh": nh, "nl": nl, "u": u, "d": d}

def compute_sector_cards(sectors_dir: str, days: int) -> List[Dict[str, Any]]:
  sectors_map = discover_sectors(sectors_dir)
  print("[10m] discovered sectors:", ", ".join(sorted(sectors_map.keys())), flush=True)

  cards: List[Dict[str, Any]] = []

  for sector_name, syms in sorted(sectors_map.items()):
    print(f"[10m] sector {sector_name}: {len(syms)} symbols", flush=True)
    agg = process_sector(sector_name, syms, days)
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
  ap = argparse.ArgumentParser(description="Build intraday outlook_source.json from Polygon sectors.")
  ap.add_argument("--out", required=True, help="Output path (e.g. data/outlook_source.json)")
  ap.add_argument(
    "--sectors-dir",
    default=DEFAULT_SECTORS_DIR,
    help="Directory containing sector CSVs (default: data/sectors)",
  )
  ap.add_argument(
    "--days",
    type=int,
    default=LOOKBACK_DAYS,
    help="Daily lookback window for NH/NL/3U/3D flags (default from FD_LOOKBACK_DAYS or 20)",
  )
  args = ap.parse_args()

  if not POLY_KEY:
    print("[10m] ERROR: no Polygon API key set; cannot compute real sector breadth.", file=sys.stderr, flush=True)
    # Emit neutral sectors so pipeline does not crash
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
    cards = compute_sector_cards(args.sectors_dir, args.days)

  out_obj: Dict[str, Any] = {
    "mode": "intraday",
    "sectorCards": cards,
    "meta": {
      "lookback_days": args.days,
      "ts_utc": now_utc_iso(),
      "source": "polygon/daily",
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
