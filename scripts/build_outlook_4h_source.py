#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_4h_source.py (4H Sector Source Builder)

Builds a 4H sectorCards source file from per-sector CSV universe:
- Reads data/sectors/*.csv (header: Symbol)
- Pulls Polygon 240-minute (4H) bars per symbol
- Drops in-flight 4H bar
- Computes flags per symbol:
    NH: last high > max(high of prior N bars)
    NL: last low  < min(low of prior N bars)
    3U: last 3 closes strictly increasing
    3D: last 3 closes strictly decreasing
- Aggregates per sector:
    nh/nl/up/down counts
    breadth_pct  = nh / (nh+nl) * 100 (or 50)
    momentum_pct = up / (up+down) * 100 (or 50)

Output:
  data/outlook_source_4h.json
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
            print("[4h-src] using key from", name, flush=True)
            return v
    print("[4h-src] WARNING: no Polygon key in POLY_KEY/POLYGON_API_KEY/POLYGON_API", flush=True)
    return None

POLY_KEY  = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source_4h.json")

MAX_WORKERS     = int(os.environ.get("FD_MAX_WORKERS", "6"))
LOOKBACK_BARS   = int(os.environ.get("H4_LOOKBACK_BARS", "20"))  # MUST match 1H bar count
LOOKBACK_DAYS   = int(os.environ.get("H4_LOOKBACK_DAYS", "45"))  # enough to cover 4H bars

def http_get(url: str, timeout: int = 22) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ferrari-dashboard/4h-builder", "Accept-Encoding": "gzip"},
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

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

def fetch_4h_bars(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date()
    start = end - timedelta(days=days)
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/240/minute/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":"asc","limit":50000})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t",0)),  # ms
                "h": float(r.get("h",0.0)),
                "l": float(r.get("l",0.0)),
                "c": float(r.get("c",0.0)),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["t"])

    # drop in-flight 4H bar
    if out:
        last_sec = out[-1]["t"] // 1000
        now = int(time.time())
        if (last_sec // (4*3600)) == (now // (4*3600)):
            out = out[:-1]
    return out

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

def compute_flags_from_4h_bars(bars: List[Dict[str, Any]], lookback: int) -> Tuple[int,int,int,int]:
    """
    NH: last high > max high of prior N bars
    NL: last low  < min low of prior N bars
    3U: last 3 closes strictly increasing
    3D: last 3 closes strictly decreasing
    """
    n = int(max(10, lookback))
    if len(bars) < n + 1:
        return 0,0,0,0

    today = bars[-1]
    prior = bars[-(n+1):-1]
    try:
        is_nh = int(today["h"] > max(b["h"] for b in prior))
        is_nl = int(today["l"] < min(b["l"] for b in prior))
    except Exception:
        is_nh = is_nl = 0

    last3 = bars[-3:]
    try:
        is_3u = int(last3[0]["c"] < last3[1]["c"] < last3[2]["c"])
        is_3d = int(last3[0]["c"] > last3[1]["c"] > last3[2]["c"])
    except Exception:
        is_3u = is_3d = 0

    return is_nh, is_nl, is_3u, is_3d

def process_symbol(sym: str, lookback: int, days: int) -> Tuple[int,int,int,int]:
    try:
        bars = fetch_4h_bars(sym, days)
        if not bars:
            return 0,0,0,0
        # adapt bars into expected dict
        usable = [{"h":b["h"],"l":b["l"],"c":b["c"]} for b in bars]
        return compute_flags_from_4h_bars(usable, lookback)
    except SystemExit:
        raise
    except Exception:
        return 0,0,0,0

def process_sector(sector: str, symbols: List[str], lookback: int, days: int) -> Dict[str, Any]:
    nh = nl = up = dn = 0
    if not symbols:
        return {"sector": sector, "nh":0, "nl":0, "up":0, "down":0}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(process_symbol, s, lookback, days): s for s in symbols}
        for fut in as_completed(futures):
            try:
                a,b,c,d = fut.result()
                nh += a; nl += b; up += c; dn += d
            except Exception:
                continue
    return {"sector": sector, "nh": nh, "nl": nl, "up": up, "down": dn}

def main() -> int:
    ap = argparse.ArgumentParser(description="Build 4H outlook_source_4h.json from Polygon 4H bars (CSV universe).")
    ap.add_argument("--out", required=True, help="Output path (e.g. data/outlook_source_4h.json)")
    ap.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR)
    ap.add_argument("--lookback-bars", type=int, default=LOOKBACK_BARS)
    ap.add_argument("--days", type=int, default=LOOKBACK_DAYS)
    args = ap.parse_args()

    if not POLY_KEY:
        print("[4h-src] ERROR: no Polygon API key set; emitting neutral sectors.", file=sys.stderr, flush=True)
        sectors_map = discover_sectors(args.sectors_dir)
        cards = []
        for name in sorted(sectors_map.keys()):
            cards.append({"sector": name, "breadth_pct": 0.0, "momentum_pct": 0.0, "nh": 0, "nl": 0, "up": 0, "down": 0})
    else:
        sectors_map = discover_sectors(args.sectors_dir)
        print("[4h-src] discovered sectors:", ", ".join(sorted(sectors_map.keys())), flush=True)

        cards: List[Dict[str, Any]] = []
        for sec, syms in sorted(sectors_map.items()):
            print(f"[4h-src] sector {sec}: {len(syms)} symbols", flush=True)
            agg = process_sector(sec, syms, args.lookback_bars, args.days)
            nh = int(agg["nh"]); nl = int(agg["nl"]); up = int(agg["up"]); dn = int(agg["down"])
            breadth_pct = round(100.0 * nh / float(nh+nl), 2) if (nh+nl) > 0 else 50.0
            mom_pct     = round(100.0 * up / float(up+dn), 2) if (up+dn) > 0 else 50.0
            cards.append({"sector": sec, "breadth_pct": breadth_pct, "momentum_pct": mom_pct, "nh": nh, "nl": nl, "up": up, "down": dn})

    out_obj = {
        "mode": "4h",
        "sectorCards": cards,
        "meta": {
            "lookback_bars": int(args.lookback_bars),
            "lookback_days": int(args.days),
            "ts_utc": now_utc_iso(),
            "source": "polygon/4h",
        },
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[4h-src] wrote {args.out} | cards={len(out_obj.get('sectorCards') or [])}", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
