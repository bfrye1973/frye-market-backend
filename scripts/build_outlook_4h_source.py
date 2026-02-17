#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_4h_source.py (Baseline + Incremental Cache)

Goal:
  1) Baseline run: scan ALL symbols (CSV universe), compute flags, build sectorCards.
  2) Incremental run: only recompute symbols whose latest COMPLETED 4H bar changed.
     - Cheap check: fetch last 2 4H bars (desc, limit=2) for each symbol
     - If last_bar_time unchanged vs cache -> skip
     - If changed -> fetch full lookback (H4_LOOKBACK_DAYS) and recompute flags
  3) Always re-aggregate sectorCards from cache so totals reflect all symbols.

Flags per symbol:
  NH: last high > max high of prior N bars
  NL: last low  < min low  of prior N bars
  3U: last 3 closes strictly increasing
  3D: last 3 closes strictly decreasing

Outputs:
  - data/outlook_source_4h.json  (sectorCards for 4H breadth)
  - data/4h_cache.json           (persistent per-symbol state)

Key settings:
  - --lookback-bars MUST match the 1H bar-count window (do NOT change for 4H)
  - --lookback-days = 14 (your choice, good cushion)

Usage:
  Baseline:
    python -u scripts/build_outlook_4h_source.py --mode baseline --sectors-dir data/sectors \
      --lookback-bars 20 --lookback-days 14 --cache data/4h_cache.json --out data/outlook_source_4h.json

  Incremental:
    python -u scripts/build_outlook_4h_source.py --mode incremental --sectors-dir data/sectors \
      --lookback-bars 20 --lookback-days 14 --cache data/4h_cache.json --out data/outlook_source_4h.json

Env:
  POLY_KEY or POLYGON_API_KEY or POLYGON_API
  FD_MAX_WORKERS (recommended 10–20)
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
POLY_BASE = "https://api.polygon.io"

SECTOR_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

ALIASES = {
    "healthcare":"health care","health-care":"health care",
    "info tech":"information technology","technology":"information technology","tech":"information technology",
    "communications":"communication services","comm services":"communication services","telecom":"communication services","comm":"communication services",
    "staples":"consumer staples","discretionary":"consumer discretionary",
    "finance":"financials","industry":"industrials","reit":"real estate","reits":"real estate",
}

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "POLYGON_API"):
        v = os.environ.get(name)
        if v:
            print("[4h-src] using key from", name, flush=True)
            return v
    print("[4h-src] WARNING: no Polygon key in POLY_KEY/POLYGON_API_KEY/POLYGON_API", flush=True)
    return None

POLY_KEY = choose_poly_key()
MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "12"))

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
    qs = urllib.parse.urlencode(params)
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

def canon_sector_name(name: str) -> str:
    k = (name or "").strip().lower()
    return ALIASES.get(k, k)

def fetch_4h_bars(ticker: str, start: date, end: date, sort: str = "asc", limit: int = 50000) -> List[Dict[str, Any]]:
    """
    Fetch Polygon 240-minute bars for [start, end], return list sorted by time.
    """
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/240/minute/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":sort,"limit":limit})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t",0)) // 1000,  # sec
                "o": float(r.get("o",0.0)),
                "h": float(r.get("h",0.0)),
                "l": float(r.get("l",0.0)),
                "c": float(r.get("c",0.0)),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["t"])
    # drop in-flight 4H bar
    if out:
        now = int(time.time())
        last = out[-1]["t"]
        if (last // (4*3600)) == (now // (4*3600)):
            out = out[:-1]
    return out

def latest_completed_bar_time_fast(ticker: str, quick_days: int = 7) -> Optional[int]:
    """
    Cheap check: fetch last 2 4H bars (desc) and return latest completed bar time (sec).
    """
    end = datetime.now(UTC).date()
    start = end - timedelta(days=max(3, quick_days))
    bars_desc = fetch_4h_bars(ticker, start, end, sort="desc", limit=2)
    if not bars_desc:
        return None
    # fetch_4h_bars sorts ascending at end; if sort=desc we still sort ascending, so take last
    return int(bars_desc[-1]["t"])

def compute_flags_from_bars(bars: List[Dict[str, Any]], lookback_bars: int) -> Tuple[int,int,int,int,int]:
    """
    Returns:
      (last_bar_time, NH, NL, U3, D3)
    NH/NL compares last bar to prior lookback_bars bars.
    """
    n = int(max(2, lookback_bars))
    if len(bars) < max(n+1, 3):
        return 0, 0, 0, 0, 0

    last = bars[-1]
    last_t = int(last["t"])

    prior = bars[-(n+1):-1]
    nh = nl = 0
    try:
        nh = int(last["h"] > max(b["h"] for b in prior))
        nl = int(last["l"] < min(b["l"] for b in prior))
    except Exception:
        nh = nl = 0

    last3 = bars[-3:]
    u3 = d3 = 0
    try:
        u3 = int(last3[0]["c"] < last3[1]["c"] < last3[2]["c"])
        d3 = int(last3[0]["c"] > last3[1]["c"] > last3[2]["c"])
    except Exception:
        u3 = d3 = 0

    return last_t, nh, nl, u3, d3

def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_json(path: str, obj: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

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

def ensure_cache_shape(cache: dict) -> dict:
    cache = cache if isinstance(cache, dict) else {}
    cache.setdefault("meta", {})
    cache.setdefault("symbols", {})
    if not isinstance(cache["symbols"], dict):
        cache["symbols"] = {}
    return cache

def process_symbol_baseline(sym: str, lookback_bars: int, lookback_days: int) -> Tuple[str, Optional[dict]]:
    """
    Full recompute for one symbol using lookback_days.
    """
    try:
        end = datetime.now(UTC).date()
        start = end - timedelta(days=lookback_days)
        bars = fetch_4h_bars(sym, start, end, sort="asc", limit=50000)
        if not bars:
            return sym, None
        last_t, nh, nl, u3, d3 = compute_flags_from_bars(bars, lookback_bars)
        return sym, {"last_bar_time": last_t, "nh": nh, "nl": nl, "u3": u3, "d3": d3}
    except Exception:
        return sym, None

def process_symbol_incremental(sym: str, cache_entry: Optional[dict], lookback_bars: int, lookback_days: int) -> Tuple[str, Optional[dict], bool]:
    """
    Incremental:
      - Cheap check latest completed bar time
      - If unchanged, return None update (keep cache)
      - If changed/missing, full recompute and return updated entry
    Returns: (sym, new_entry_or_none, did_update)
    """
    try:
        cached_t = None
        if isinstance(cache_entry, dict):
            cached_t = cache_entry.get("last_bar_time")

        latest_t = latest_completed_bar_time_fast(sym, quick_days=min(lookback_days, 14))
        if latest_t is None:
            return sym, None, False

        if isinstance(cached_t, (int, float)) and int(cached_t) == int(latest_t):
            return sym, None, False

        # changed -> full recompute
        end = datetime.now(UTC).date()
        start = end - timedelta(days=lookback_days)
        bars = fetch_4h_bars(sym, start, end, sort="asc", limit=50000)
        if not bars:
            return sym, None, False

        last_t, nh, nl, u3, d3 = compute_flags_from_bars(bars, lookback_bars)
        return sym, {"last_bar_time": last_t, "nh": nh, "nl": nl, "u3": u3, "d3": d3}, True
    except Exception:
        return sym, None, False

def aggregate_sector_cards_from_cache(sectors_map: Dict[str, List[str]], cache_symbols: Dict[str, dict]) -> List[dict]:
    """
    Rebuild sectorCards from cached per-symbol flags.
    """
    cards: List[dict] = []
    # normalize sector name ordering
    # we keep the CSV filenames but order by canonical names if possible
    for sector_file, syms in sorted(sectors_map.items()):
        nh = nl = up = dn = 0
        for s in syms:
            e = cache_symbols.get(s)
            if not isinstance(e, dict):
                continue
            nh += int(e.get("nh", 0))
            nl += int(e.get("nl", 0))
            up += int(e.get("u3", 0))
            dn += int(e.get("d3", 0))
        breadth_pct = round(pct(nh, nh+nl), 2) if (nh+nl) > 0 else 50.0
        mom_pct     = round(pct(up, up+dn), 2) if (up+dn) > 0 else 50.0
        cards.append({
            "sector": sector_file,
            "breadth_pct": breadth_pct,
            "momentum_pct": mom_pct,
            "nh": int(nh),
            "nl": int(nl),
            "up": int(up),
            "down": int(dn),
        })
    return cards

def main() -> int:
    ap = argparse.ArgumentParser(description="Build 4H sectorCards source with baseline + incremental cache.")
    ap.add_argument("--mode", required=True, choices=["baseline","incremental"])
    ap.add_argument("--sectors-dir", required=True)
    ap.add_argument("--lookback-bars", type=int, required=True)
    ap.add_argument("--lookback-days", type=int, required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not POLY_KEY:
        print("[4h-src] ERROR: no Polygon key available.", file=sys.stderr)
        return 2

    sectors_map = discover_sectors(args.sectors_dir)
    cache = ensure_cache_shape(load_json(args.cache))
    sym_cache: Dict[str, dict] = cache.get("symbols") or {}

    # build flat list of symbols and keep mapping sector->symbols
    all_syms: List[str] = []
    for _, syms in sectors_map.items():
        all_syms.extend(syms)
    # dedupe
    all_syms = sorted(list({s for s in all_syms if s}))

    started = now_utc_iso()
    print(f"[4h-src] mode={args.mode} symbols={len(all_syms)} lookbackBars={args.lookback_bars} lookbackDays={args.lookback_days} workers={MAX_WORKERS}", flush=True)

    updated = 0
    checked = 0

    if args.mode == "baseline":
        # full recompute for every symbol
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futures = {ex.submit(process_symbol_baseline, s, args.lookback_bars, args.lookback_days): s for s in all_syms}
            for fut in as_completed(futures):
                sym = futures[fut]
                checked += 1
                try:
                    _, entry = fut.result()
                except Exception:
                    entry = None
                if isinstance(entry, dict):
                    sym_cache[sym] = entry
                    updated += 1

    else:
        # incremental: cheap check + full recompute only if needed
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futures = {
                ex.submit(process_symbol_incremental, s, sym_cache.get(s), args.lookback_bars, args.lookback_days): s
                for s in all_syms
            }
            for fut in as_completed(futures):
                sym = futures[fut]
                checked += 1
                try:
                    _, new_entry, did_update = fut.result()
                except Exception:
                    new_entry, did_update = None, False
                if did_update and isinstance(new_entry, dict):
                    sym_cache[sym] = new_entry
                    updated += 1

        # ensure symbols newly added to CSVs are computed if missing
        missing = [s for s in all_syms if s not in sym_cache]
        if missing:
            print(f"[4h-src] incremental: missing_in_cache={len(missing)} -> full compute", flush=True)
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
                futures = {ex.submit(process_symbol_baseline, s, args.lookback_bars, args.lookback_days): s for s in missing}
                for fut in as_completed(futures):
                    sym = futures[fut]
                    try:
                        _, entry = fut.result()
                    except Exception:
                        entry = None
                    if isinstance(entry, dict):
                        sym_cache[sym] = entry
                        updated += 1

    cache["symbols"] = sym_cache
    cache["meta"] = {
        "mode": args.mode,
        "lookback_bars": int(args.lookback_bars),
        "lookback_days": int(args.lookback_days),
        "last_run_utc": now_utc_iso(),
        "started_utc": started,
        "checked": int(checked),
        "updated": int(updated),
    }

    # Build sectorCards from cache (full universe)
    cards = aggregate_sector_cards_from_cache(sectors_map, sym_cache)

    out_obj = {
        "mode": "4h",
        "sectorCards": cards,
        "meta": {
            "ts_utc": now_utc_iso(),
            "source": "polygon/4h",
            "lookback_bars": int(args.lookback_bars),
            "lookback_days": int(args.lookback_days),
            "cache_mode": args.mode,
            "cache_checked": int(checked),
            "cache_updated": int(updated),
        }
    }

    save_json(args.cache, cache)
    save_json(args.out, out_obj)

    print(f"[4h-src] wrote cache={args.cache} | wrote source={args.out} | cards={len(cards)} | checked={checked} updated={updated}", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
