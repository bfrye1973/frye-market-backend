#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_daily.py (EOD Sector Source — DAILY)

Purpose:
  Build a DAILY sectorCards source file for EOD so make_eod.py receives
  correct daily participation data (not intraday scalper semantics).

LOCKED DEFINITIONS (per Index teammate):
- Use DAILY bars (Polygon range/1/day).
- NH/NL uses close vs highest/lowest CLOSE over last L days:
    NH: C[-1] > max(C[-L:-1])
    NL: C[-1] < min(C[-L:-1])
- Momentum uses 3-day close sequences:
    UP:   C[-3] < C[-2] < C[-1]
    DOWN: C[-3] > C[-2] > C[-1]
- Output schema must match frontend contract:
    { sector, breadth_pct, momentum_pct, nh, nl, up, down }
- Output includes mode stamp:
    "mode": "daily"

CLI:
  python -u scripts/build_outlook_source_daily.py --sectors-dir data/sectors --days 90 --out data/outlook_source_daily.json

Env:
  POLY_KEY or POLYGON_API_KEY or POLYGON_API
  FD_MAX_WORKERS (default 8)
  FD_DAILY_LOOKBACK (default 10)  # L for NH/NL close-based lookback
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
from zoneinfo import ZoneInfo
from typing import Any, Dict, List, Optional, Tuple

from sector_volume import UP, DOWN, UNCHANGED, aggregate_sector_volume

UTC = timezone.utc
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source_daily.json")

MAX_WORKERS      = int(os.environ.get("FD_MAX_WORKERS", "8"))
DAILY_LOOKBACK_L = max(2, int(os.environ.get("FD_DAILY_LOOKBACK", "10")))  # L days for NH/NL window


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


def http_get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ferrari-dashboard/daily-builder", "Accept-Encoding": "gzip"},
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
            raw = http_get(full, timeout=25)
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


def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def expected_completed_equity_date() -> date:
    """Latest fully completed U.S. equity session date."""
    now_et = datetime.now(ZoneInfo("America/New_York"))
    today = now_et.date()
    wd = today.weekday()  # Mon=0

    if wd < 5 and (now_et.hour > 16 or (now_et.hour == 16 and now_et.minute >= 0)):
        return today

    candidate = today - timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate -= timedelta(days=1)
    return candidate


def trim_to_completed_session(bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cutoff = expected_completed_equity_date()
    out = []
    for b in bars:
        try:
            d = datetime.fromtimestamp(int(b["t"]) / 1000.0, UTC).date()
        except Exception:
            continue
        if d <= cutoff:
            out.append(b)
    return out


def fetch_1d_bars(ticker: str, days: int) -> List[Dict[str, Any]]:
    """
    Fetch 1-day bars for last `days` calendar days.
    """
    end = datetime.now(UTC).date()
    start = end - timedelta(days=days)
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted": "true", "sort": "asc", "limit": 50000})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t", 0)),  # ms
                "o": float(r.get("o", 0.0)),
                "h": float(r.get("h", 0.0)),
                "l": float(r.get("l", 0.0)),
                "c": float(r.get("c", 0.0)),
                "v": r.get("v"),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["t"])
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


def compute_daily_flags(bars: List[Dict[str, Any]], L: int) -> Tuple[int, int, int, int]:
    """
    Production EOD definitions. Do not change here.
    """
    L = max(2, int(L))
    if not bars or len(bars) < max(L, 3):
        return 0, 0, 0, 0

    C = [float(b["c"]) for b in bars]

    recent_hi = max(C[-L:-1]) if L > 1 else C[-1]
    recent_lo = min(C[-L:-1]) if L > 1 else C[-1]

    nh = int(C[-1] > recent_hi)
    nl = int(C[-1] < recent_lo)

    up = int(C[-3] < C[-2] < C[-1])
    dn = int(C[-3] > C[-2] > C[-1])

    return nh, nl, up, dn


def compute_reconstructed_eod_flags_at(bars: List[Dict[str, Any]], idx: int) -> Tuple[int, int, int, int]:
    if idx < 21 or idx >= len(bars):
        return 0, 0, 0, 0

    nh = nl = 0
    for event_idx in range(idx - 1, idx + 1):
        if event_idx < 10:
            continue
        prior = bars[event_idx - 10:event_idx]
        cur = bars[event_idx]
        if cur["h"] > max(x["h"] for x in prior):
            nh = 1
        if cur["l"] < min(x["l"] for x in prior):
            nl = 1

    move = float(bars[idx]["c"]) - float(bars[idx - 4]["c"])
    sample = bars[idx - 19:idx + 1]
    adr20 = sum(float(x["h"]) - float(x["l"]) for x in sample) / len(sample)
    up = int(adr20 > 0 and move >= 3.0 * adr20)
    dn = int(adr20 > 0 and move <= -3.0 * adr20)
    return nh, nl, up, dn


def compute_reconstructed_eod_flags(bars: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
    """
    Engine25 reconstructed EOD v1 shadow definitions.
    Frozen formula; this wrapper evaluates the latest completed session.
    """
    bars = trim_to_completed_session(bars)
    if len(bars) < 22:
        return 0, 0, 0, 0
    return compute_reconstructed_eod_flags_at(bars, len(bars) - 1)


def process_symbol_daily(sym: str, days: int, L: int):
    try:
        bars = fetch_1d_bars(sym, days=days)
        if not bars:
            return 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, None
        nh, nl, up, dn = compute_daily_flags(bars, L)
        completed = trim_to_completed_session(bars)
        if len(completed) >= 22:
            sh_nh, sh_nl, sh_up, sh_dn = compute_reconstructed_eod_flags_at(completed, len(completed) - 1)
            pr_nh, pr_nl, pr_up, pr_dn = compute_reconstructed_eod_flags_at(completed, len(completed) - 2)
        else:
            sh_nh = sh_nl = sh_up = sh_dn = 0
            pr_nh = pr_nl = pr_up = pr_dn = 0
        last_volume = completed[-1].get("v") if completed else bars[-1].get("v")
        return nh, nl, up, dn, sh_nh, sh_nl, sh_up, sh_dn, pr_nh, pr_nl, pr_up, pr_dn, last_volume
    except SystemExit:
        raise
    except Exception:
        return 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, None


def process_sector_daily(sector: str, symbols: List[str], days: int, L: int) -> Dict[str, Any]:
    nh = nl = up = dn = 0
    sh_nh = sh_nl = sh_up = sh_dn = 0
    volume_observations = []
    shadow_observations = []
    if not symbols:
        return {"sector": sector, "nh": 0, "nl": 0, "up": 0, "down": 0, **{"totalVolume":0.0,"advancingVolume":0.0,"decliningVolume":0.0,"unchangedVolume":0.0,"advancingVolumePct":None,"decliningVolumePct":None,"stocksScanned":0,"stocksWithVolume":0}}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(process_symbol_daily, s, days, L): s for s in symbols}
        for fut in as_completed(futs):
            try:
                a, b, c, d, sa, sb, sc, sd, pa, pb, pc, pd, volume = fut.result()
                nh += a; nl += b; up += c; dn += d
                sh_nh += sa; sh_nl += sb; sh_up += sc; sh_dn += sd
                shadow_observations.append({
                    "symbol": futs[fut],
                    "nh": sa, "nl": sb, "up": sc, "down": sd,
                    "prior_nh": pa, "prior_nl": pb, "prior_up": pc, "prior_down": pd,
                })
                classification = UP if c else (DOWN if d else UNCHANGED)
                volume_observations.append({"classification": classification, "volume": volume})
            except Exception:
                continue

    return {
        "sector": sector,
        "nh": nh, "nl": nl, "up": up, "down": dn,
        "shadow_nh": sh_nh, "shadow_nl": sh_nl,
        "shadow_up": sh_up, "shadow_down": sh_dn,
        "shadowObservations": shadow_observations,
        **aggregate_sector_volume(volume_observations),
    }


def compute_sector_cards_daily(sectors_dir: str, days: int, L: int) -> List[Dict[str, Any]]:
    sectors_map = discover_sectors(sectors_dir)
    print("[daily] discovered sectors:", ", ".join(sorted(sectors_map.keys())), flush=True)

    cards: List[Dict[str, Any]] = []
    shadow_cards: List[Dict[str, Any]] = []
    shadow_symbol_rows: List[Dict[str, Any]] = []
    for sector_name, syms in sorted(sectors_map.items()):
        print(f"[daily] sector {sector_name}: {len(syms)} symbols", flush=True)
        agg = process_sector_daily(sector_name, syms, days=days, L=L)

        nh = int(agg["nh"]); nl = int(agg["nl"])
        up = int(agg["up"]); dn = int(agg["down"])

        denom_b = nh + nl
        denom_m = up + dn

        breadth_pct = round(100.0 * nh / float(denom_b), 2) if denom_b > 0 else 50.0
        momentum_pct = round(100.0 * up / float(denom_m), 2) if denom_m > 0 else 50.0

        cards.append({
            "sector": sector_name,
            "breadth_pct": breadth_pct,
            "momentum_pct": momentum_pct,
            "nh": nh,
            "nl": nl,
            "up": up,
            "down": dn,
            **{k: agg[k] for k in ("totalVolume","advancingVolume","decliningVolume","unchangedVolume","advancingVolumePct","decliningVolumePct","stocksScanned","stocksWithVolume")},
        })

        shadow_symbol_rows.extend(agg.get("shadowObservations") or [])
        sh_nh = int(agg["shadow_nh"]); sh_nl = int(agg["shadow_nl"])
        sh_up = int(agg["shadow_up"]); sh_dn = int(agg["shadow_down"])
        sh_bden = sh_nh + sh_nl
        sh_mden = sh_up + sh_dn
        shadow_cards.append({
            "sector": sector_name,
            "breadth_pct": round(100.0 * sh_nh / sh_bden, 2) if sh_bden > 0 else 50.0,
            "momentum_pct": round(100.0 * sh_up / sh_mden, 2) if sh_mden > 0 else 50.0,
            "nh": sh_nh,
            "nl": sh_nl,
            "up": sh_up,
            "down": sh_dn,
        })
    return cards, shadow_cards, shadow_symbol_rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Build DAILY outlook_source JSON for EOD sectorCards.")
    ap.add_argument("--out", required=True, help="Output path (e.g. data/outlook_source_daily.json)")
    ap.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR)
    ap.add_argument("--days", type=int, default=90, help="Calendar days of daily bars to fetch (default 90)")
    ap.add_argument("--lookback-days", type=int, default=DAILY_LOOKBACK_L, help="L days for NH/NL close window")
    args = ap.parse_args()

    if not POLY_KEY:
        print("[daily] ERROR: no Polygon key set; emitting neutral sectors.", file=sys.stderr, flush=True)
        sectors_map = discover_sectors(args.sectors_dir)
        cards = []
        shadow_cards = []
        shadow_symbol_rows = []
        for name in sorted(sectors_map.keys()):
            neutral = {
                "sector": name,
                "breadth_pct": 50.0,
                "momentum_pct": 50.0,
                "nh": 0, "nl": 0, "up": 0, "down": 0
            }
            cards.append(dict(neutral))
            shadow_cards.append(dict(neutral))
    else:
        cards, shadow_cards, shadow_symbol_rows = compute_sector_cards_daily(args.sectors_dir, days=args.days, L=args.lookback_days)

    if 'shadow_cards' not in locals():
        shadow_cards = []
    if 'shadow_symbol_rows' not in locals():
        shadow_symbol_rows = []

    out_obj: Dict[str, Any] = {
        "mode": "daily",
        "sectorCards": cards,
        "shadowSectorCards": shadow_cards,
        "shadowSymbolRows": shadow_symbol_rows,
        "meta": {
            "shadowFormula": "engine25.reconstructedEod.v1",
            "shadowCompletedSessionDate": expected_completed_equity_date().isoformat(),
            "lookback_days": int(args.lookback_days),
            "ts_utc": now_utc_iso(),
            "source": "polygon/1d",
        },
    }

    out_path = args.out
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[daily] wrote outlook source to {out_path}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
