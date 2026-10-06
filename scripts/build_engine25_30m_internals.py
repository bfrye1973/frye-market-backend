#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Engine 25 full-market 30m internals scanner.

Purpose:
- Mirror the proven Engine25 10m stock-universe scanner on true completed 30m bars.
- Preserve Engine25 ownership of breadth, sector participation, NH/NL, directional
  volume, and coverage.
- Keep this separate from the existing SPY/sector-ETF 30m technical bridge.

Important:
- Uses the same sector CSV universe as the 10m scanner.
- Uses the same NH/NL and 3-bar up/down classification logic as 10m.
- Uses only completed 30m Polygon aggregate bars.
- sourceTimestamp is the completed 30m boundary, not archive/write time.
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
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sector_volume import UP, DOWN, UNCHANGED, aggregate_sector_volume

UTC = timezone.utc
BAR_MINUTES = 30
BAR_SECONDS = BAR_MINUTES * 60
DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
MAX_WORKERS = int(os.environ.get("FD_30M_MAX_WORKERS", os.environ.get("FD_MAX_WORKERS", "10")))
LOOKBACK_BARS = max(2, int(os.environ.get("FD_30M_LOOKBACK", "3")))
LOOKBACK_DAYS = int(os.environ.get("FD_30M_DAYS", "5"))
POLY_BASE = "https://api.polygon.io"

ORDER = [
    "Information Technology",
    "Materials",
    "Health Care",
    "Communication Services",
    "Real Estate",
    "Energy",
    "Consumer Staples",
    "Consumer Discretionary",
    "Financials",
    "Utilities",
    "Industrials",
]

ALIASES = {
    "tech": "Information Technology",
    "technology": "Information Technology",
    "info tech": "Information Technology",
    "healthcare": "Health Care",
    "health-care": "Health Care",
    "health care": "Health Care",
    "communications": "Communication Services",
    "comm services": "Communication Services",
    "staples": "Consumer Staples",
    "discretionary": "Consumer Discretionary",
    "finance": "Financials",
    "industry": "Industrials",
    "reit": "Real Estate",
    "reits": "Real Estate",
}


def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "POLYGON_API"):
        value = os.environ.get(name)
        if value:
            print("[30m-internals] using key from", name, flush=True)
            return value
    return None


POLY_KEY = choose_poly_key()


def now_utc() -> datetime:
    return datetime.now(UTC)


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def completed_boundary_utc(now: Optional[datetime] = None) -> datetime:
    now = (now or now_utc()).astimezone(UTC)
    epoch = int(now.timestamp())
    boundary = (epoch // BAR_SECONDS) * BAR_SECONDS
    return datetime.fromtimestamp(boundary, UTC)


def dstr(value: date) -> str:
    return value.strftime("%Y-%m-%d")


def http_get(url: str, timeout: int = 22) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "frye-dashboard/engine25-30m-internals",
            "Accept-Encoding": "gzip",
            "Cache-Control": "no-store",
        },
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
    params = dict(params or {})
    if POLY_KEY:
        params["apiKey"] = POLY_KEY
    query = urllib.parse.urlencode(params)
    full = f"{url}?{query}" if query else url
    for attempt in range(1, 5):
        try:
            return json.loads(http_get(full))
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise SystemExit("Polygon returned 401 Unauthorized")
            if exc.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            raise


def fetch_30m_bars(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = now_utc().date()
    start = end - timedelta(days=days)
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/30/minute/{dstr(start)}/{dstr(end)}"
    payload = poly_json(url, {"adjusted": "true", "sort": "asc", "limit": 50000})
    if not payload or payload.get("status") != "OK":
        return []

    bars = []
    for row in payload.get("results") or []:
        try:
            bars.append({
                "t": int(row.get("t", 0)),
                "o": float(row.get("o", 0.0)),
                "h": float(row.get("h", 0.0)),
                "l": float(row.get("l", 0.0)),
                "c": float(row.get("c", 0.0)),
                "v": row.get("v"),
            })
        except Exception:
            continue
    bars.sort(key=lambda row: row["t"])
    return bars


def todays_completed_30m(bars: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not bars:
        return []
    today = now_utc().date()
    current_bucket = int(now_utc().timestamp()) // BAR_SECONDS

    out = []
    for bar in bars:
        start_sec = int(bar["t"] / 1000)
        if datetime.fromtimestamp(start_sec, UTC).date() != today:
            continue
        # Polygon aggregate timestamp is the bar start. A bar is completed only
        # when its bucket is strictly before the current bucket.
        if start_sec // BAR_SECONDS >= current_bucket:
            continue
        out.append(bar)
    return out


def read_symbols(path: str) -> List[str]:
    symbols = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            symbol = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if symbol:
                symbols.append(symbol)
    return symbols


def canonical_sector(name: str) -> str:
    raw = str(name or "").strip()
    return ALIASES.get(raw.lower(), raw)


def discover_sectors(sectors_dir: str) -> Dict[str, List[str]]:
    if not os.path.isdir(sectors_dir):
        raise SystemExit(f"Missing sector directory: {sectors_dir}")

    sectors: Dict[str, List[str]] = {}
    for filename in os.listdir(sectors_dir):
        if not filename.lower().endswith(".csv"):
            continue
        sector = canonical_sector(os.path.splitext(filename)[0])
        symbols = read_symbols(os.path.join(sectors_dir, filename))
        if symbols:
            sectors.setdefault(sector, []).extend(symbols)

    if not sectors:
        raise SystemExit(f"No sector CSVs found in {sectors_dir}")
    return sectors


def compute_flags(bars: List[Dict[str, Any]], lookback: int) -> Tuple[int, int, int, int]:
    lookback = max(lookback, 2)
    if len(bars) < max(lookback, 3):
        return 0, 0, 0, 0

    highs = [float(row["h"]) for row in bars]
    lows = [float(row["l"]) for row in bars]
    closes = [float(row["c"]) for row in bars]

    recent_high = max(highs[-lookback:-1])
    recent_low = min(lows[-lookback:-1])

    nh = int(closes[-1] > recent_high)
    nl = int(closes[-1] < recent_low)
    up = int(closes[-3] < closes[-2] < closes[-1])
    down = int(closes[-3] > closes[-2] > closes[-1])
    return nh, nl, up, down


def process_symbol(ticker: str, lookback: int, days: int):
    try:
        bars = todays_completed_30m(fetch_30m_bars(ticker, days))
        if not bars:
            return 0, 0, 0, 0, None, None
        nh, nl, up, down = compute_flags(bars, lookback)
        last = bars[-1]
        return nh, nl, up, down, last.get("v"), int(last["t"] / 1000)
    except SystemExit:
        raise
    except Exception:
        return 0, 0, 0, 0, None, None


def process_sector(sector: str, symbols: List[str], lookback: int, days: int) -> Dict[str, Any]:
    nh = nl = up = down = 0
    volume_observations = []
    last_bar_starts = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_symbol, symbol, lookback, days): symbol
            for symbol in symbols
        }
        for future in as_completed(futures):
            try:
                f_nh, f_nl, f_up, f_down, volume, bar_start = future.result()
                nh += f_nh
                nl += f_nl
                up += f_up
                down += f_down
                classification = UP if f_up else (DOWN if f_down else UNCHANGED)
                volume_observations.append({
                    "classification": classification,
                    "volume": volume,
                })
                if bar_start is not None:
                    last_bar_starts.append(bar_start)
            except Exception:
                continue

    volume = aggregate_sector_volume(volume_observations)
    latest_bar_start = max(last_bar_starts) if last_bar_starts else None

    return {
        "sector": sector,
        "nh": nh,
        "nl": nl,
        "up": up,
        "down": down,
        "latestBarStartEpochSec": latest_bar_start,
        **volume,
    }


def classify_state(breadth: float, momentum: float) -> str:
    if breadth >= 55 and momentum >= 55:
        return "STRONG"
    if breadth <= 45 and momentum <= 45:
        return "WEAK"
    return "NEUTRAL"


def build_payload(sectors_dir: str, lookback: int, days: int) -> Dict[str, Any]:
    sectors = discover_sectors(sectors_dir)
    print("[30m-internals] sectors:", ", ".join(sorted(sectors)), flush=True)

    raw_cards = {}
    for sector in ORDER:
        symbols = sectors.get(sector, [])
        print(f"[30m-internals] {sector}: {len(symbols)} symbols", flush=True)
        raw_cards[sector] = process_sector(sector, symbols, lookback, days)

    cards = []
    latest_starts = []
    for sector in ORDER:
        agg = raw_cards[sector]
        nh, nl = int(agg["nh"]), int(agg["nl"])
        up, down = int(agg["up"]), int(agg["down"])
        breadth = round(100.0 * nh / (nh + nl), 2) if nh + nl else 50.0
        momentum = round(100.0 * up / (up + down), 2) if up + down else 50.0
        state = classify_state(breadth, momentum)
        if agg.get("latestBarStartEpochSec") is not None:
            latest_starts.append(int(agg["latestBarStartEpochSec"]))

        cards.append({
            "sector": sector,
            "state": state,
            "breadth_pct": breadth,
            "momentum_pct": momentum,
            "nh": nh,
            "nl": nl,
            "up": up,
            "down": down,
            **{key: agg[key] for key in (
                "totalVolume",
                "advancingVolume",
                "decliningVolume",
                "unchangedVolume",
                "advancingVolumePct",
                "decliningVolumePct",
                "stocksScanned",
                "stocksWithVolume",
            )},
        })

    # Canonical market identity is the end of the latest completed 30m bar.
    if latest_starts:
        source_boundary = datetime.fromtimestamp(max(latest_starts) + BAR_SECONDS, UTC)
    else:
        source_boundary = completed_boundary_utc()

    generated = now_utc()

    advancing = sum(int(card["up"]) for card in cards)
    declining = sum(int(card["down"]) for card in cards)
    breadth_den = advancing + declining

    new_highs = sum(int(card["nh"]) for card in cards)
    new_lows = sum(int(card["nl"]) for card in cards)

    advancing_volume = sum(float(card.get("advancingVolume") or 0) for card in cards)
    declining_volume = sum(float(card.get("decliningVolume") or 0) for card in cards)
    unchanged_volume = sum(float(card.get("unchangedVolume") or 0) for card in cards)
    directional_volume = advancing_volume + declining_volume

    stocks_scanned = sum(int(card.get("stocksScanned") or 0) for card in cards)
    stocks_with_volume = sum(int(card.get("stocksWithVolume") or 0) for card in cards)

    strong = sum(1 for card in cards if card["state"] == "STRONG")
    neutral = sum(1 for card in cards if card["state"] == "NEUTRAL")
    weak = sum(1 for card in cards if card["state"] == "WEAK")

    complete = len(cards) == 11 and all(card.get("stocksScanned", 0) > 0 for card in cards)

    return {
        "schema": "engine25.marketInternals30m@1",
        "timeframe": "30m",
        "sourceTimestamp": iso_z(source_boundary),
        "generatedAt": iso_z(generated),
        "updated_at_utc": iso_z(generated),
        "freshnessState": "FRESH_AT_SOURCE" if complete else "INCOMPLETE_AT_SOURCE",
        "completeCanonicalSet": complete,
        "stocksScanned": stocks_scanned,
        "stocksWithVolume": stocks_with_volume,
        "coveragePct": (
            stocks_with_volume / stocks_scanned * 100 if stocks_scanned else None
        ),
        "advancingStocks": advancing,
        "decliningStocks": declining,
        "advancingBreadthPct": (
            advancing / breadth_den * 100 if breadth_den else None
        ),
        "decliningBreadthPct": (
            declining / breadth_den * 100 if breadth_den else None
        ),
        "strongSectorCount": strong,
        "neutralSectorCount": neutral,
        "weakSectorCount": weak,
        "newHighs": new_highs,
        "newLows": new_lows,
        "netNewHighsLows": new_highs - new_lows,
        "advancingVolume": advancing_volume,
        "decliningVolume": declining_volume,
        "unchangedVolume": unchanged_volume,
        "advancingVolumeShare": (
            advancing_volume / directional_volume * 100 if directional_volume else None
        ),
        "decliningVolumeShare": (
            declining_volume / directional_volume * 100 if directional_volume else None
        ),
        "volumeImbalance": (
            (advancing_volume - declining_volume) / directional_volume * 100
            if directional_volume
            else None
        ),
        "sectorCards": cards,
        "meta": {
            "barMinutes": BAR_MINUTES,
            "lookbackBars": lookback,
            "source": "polygon/30m",
            "universe": "engine25-sector-csvs",
            "calculationParity": "engine25-10m-stock-scanner",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR)
    parser.add_argument("--lookback-bars", type=int, default=LOOKBACK_BARS)
    parser.add_argument("--days", type=int, default=LOOKBACK_DAYS)
    args = parser.parse_args()

    if not POLY_KEY:
        raise SystemExit("Missing Polygon API key; refusing to publish fabricated 30m internals")

    payload = build_payload(args.sectors_dir, args.lookback_bars, args.days)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")

    print(json.dumps({
        "sourceTimestamp": payload["sourceTimestamp"],
        "stocksScanned": payload["stocksScanned"],
        "stocksWithVolume": payload["stocksWithVolume"],
        "advancingStocks": payload["advancingStocks"],
        "decliningStocks": payload["decliningStocks"],
        "newHighs": payload["newHighs"],
        "newLows": payload["newLows"],
        "sectors": [
            payload["strongSectorCount"],
            payload["neutralSectorCount"],
            payload["weakSectorCount"],
        ],
        "coveragePct": payload["coveragePct"],
    }, indent=2), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
