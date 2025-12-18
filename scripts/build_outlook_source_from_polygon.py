#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (10m Scalper) — FIXED

Key fixes:
  - Uses millisecond range for Polygon aggs (prevents date-boundary truncation)
  - Defines "today" using America/New_York session date (works pre/after-market)
  - Correct 10m in-flight bucket detection (10m = 600 seconds)
  - Only drops in-flight bar if enough bars remain to compute signals

Everything else kept aligned with your original intent.
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
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

# ------------------------ ENV & CONSTANTS ------------------------

UTC = timezone.utc

# Market session date
try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:
    ET = UTC  # fallback (should rarely happen)

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

MAX_WORKERS      = int(os.environ.get("FD_MAX_WORKERS", "8"))
SCALPER_LOOKBACK = max(2, int(os.environ.get("FD_SCALPER_LOOKBACK", "3")))  # L bars
INTRADAY_DAYS    = int(os.environ.get("FD_INTRADAY_DAYS", "2"))             # days of 10m bars to fetch

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

# ------------------------ POLYGON QUERIES (FIXED) ------------------------

def fetch_10m_bars(ticker: str, days: int) -> List[Dict[str, Any]]:
    """
    Fetch 10-minute bars using millisecond from/to window (robust).
    """
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - int(days * 24 * 60 * 60 * 1000)

    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/10/minute/{start_ms}/{end_ms}"
    js = poly_json(url, {"adjusted": "true", "sort": "asc", "limit": 50000})

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

def todays_completed_10m(bars: List[Dict[str, Any]], lookback_bars: int) -> List[Dict[str, Any]]:
    """
    Return today's completed 10m bars based on America/New_York session date.
    Drops the in-flight bar only if enough bars remain to compute signals.
    """
    if not bars:
        return []

    # Determine "today" in ET (market session date)
    today_et = datetime.now(ET).date()

    def to_sec(b): 
        return int(b["t"] / 1000.0)

    todays: List[Dict[str, Any]] = []
    for b in bars:
        dt_et = datetime.fromtimestamp(to_sec(b), UTC).astimezone(ET)
        if dt_et.date() == today_et:
            todays.append(b)

    if not todays:
        return []

    # Correct 10-minute bucket logic (600 sec)
    BUCKET = 600
    now_sec = int(time.time())
    cur_bucket = (now_sec // BUCKET) * BUCKET

    last_sec = to_sec(todays[-1])
    last_bucket = (last_sec // BUCKET) * BUCKET

    # Only drop "in-flight" bar if we still have enough bars left to compute flags
    min_needed = max(lookback_bars, 3)  # need at least 3 for 3U/3D
    if last_bucket == cur_bucket and len(todays) > min_needed:
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

    recent_hi = max(H[-L:-1]) if L > 1 else H[-1]
    recent_lo = min(Ls[-L:-1]) if L > 1 else Ls[-1]
    nh = int(C[-1] > recent_hi)
    nl = int(C[-1] < recent_lo)

    u3 = int(C[-3] < C[-2] < C[-1])
    d3 = int(C[-3] > C[-2] > C[-1])

    return nh, nl, u3, d3

# ------------------------ SECTOR AGG PIPELINE --------------------

def process_symbol_10m(ticker: str, lookback_bars: int, days: int) -> Tuple[int,int,int,int]:
    try:
        bars = fetch_10m_bars(ticker, days)
        today_bars = todays_completed_10m(bars, lookback_bars)
        if not today_bars:
            return 0,0,0,0
        return compute_intraday_flags_10m(today_bars, lookback_bars)
    except SystemExit:
        raise
    except Exception:
        return 0,0,0,0

def process_sector(sector: str, symbols: List[str], lookback_bars: int, days: int) -> Dict[str, Any]:
    nh = nl = u = d = 0
    if not symbols:
        return {"sector": sector, "nh":0, "nl":0, "u":0, "d":0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_symbol_10m, sym, lookback_bars, days): sym for sym in symbols}
        for fut in as_completed(futures):
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

        breadth_pct  = round(100.0 * nh / float(denom_b), 2) if denom_b > 0 else 50.0
        momentum_pct = round(100.0 * up / float(denom_m), 2) if denom_m > 0 else 50.0

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
                "breadth_pct": 50.0,
                "momentum_pct": 50.0,
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
            "source": "polygon/10m-msrange-et-today",
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
