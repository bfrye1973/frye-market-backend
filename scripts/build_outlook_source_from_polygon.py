#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py  (R11.1 LIVE intraday)

- Accepts --mode {intraday, hourly, eod, intraday10}  (intraday10 maps to intraday)
- --source OPTIONAL. If omitted in intraday mode, fetches Polygon minute bars for sector ETF proxies
  and builds groups {nh,nl,u,d} plus simple intraday metrics (breadth/momentum).
- --sectors-dir OPTIONAL (only sanity-checks presence; not required for ETF proxy build)
- Stamps updated_at (America/Phoenix) and updated_at_utc (UTC)
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple, Optional
from zoneinfo import ZoneInfo

# ---------------- TIME / ENV ----------------
try:
    PHX_TZ = ZoneInfo("America/Phoenix")
except Exception:
    PHX_TZ = ZoneInfo("UTC")
UTC = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    # human-friendly AZ local (no milliseconds)
    return datetime.now(PHX_TZ).replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "REACT_APP_POLYGON_KEY"):
        v = os.environ.get(name)
        if v:
            print(f"[keys] using {name}", flush=True)
            return v
    return None

POLY_KEY = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

# conservative defaults
INTRA_MINUTE_LOOKBACK_MIN = int(os.environ.get("FD_MINUTE_LOOKBACK", "180"))  # 3h

# ---------------- HTTP ----------------
def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "ferrari-dashboard/1.0", "Accept-Encoding": "gzip"},
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

# ---------------- Polygon agg fetchers ----------------
def fetch_range(ticker: str, tf_kind: str, tf_val: int, start: date, end: date,
                limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted": "true", "sort": sort, "limit": limit})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t", 0)),  # may be ms
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

def fetch_minutes_today(ticker: str, lookback_min: int = INTRA_MINUTE_LOOKBACK_MIN) -> List[Dict[str, Any]]:
    now_utc = datetime.now(UTC)
    start_utc = now_utc - timedelta(minutes=lookback_min)
    start = start_utc.date()
    end   = now_utc.date()
    minutes = fetch_range(ticker, "minute", 1, start, end, sort="asc")
    if not minutes:
        return []
    cutoff_ms = int(start_utc.timestamp() * 1000)
    return [m for m in minutes if m["t"] >= cutoff_ms]

# collapse minute bars -> 10m buckets
def collapse_to_10m(minutes: List[Dict[str,Any]]) -> List[Dict[str,Any]]:
    if not minutes:
        return []
    ten, curr = [], None
    for m in minutes:
        bid = m["t"] // (10 * 60 * 1000)
        if curr is None or curr["id"] != bid:
            if curr: ten.append(curr)
            curr = {"id":bid, "o":m["o"], "h":m["h"], "l":m["l"], "c":m["c"], "v":m["v"]}
        else:
            curr["h"] = max(curr["h"], m["h"])
            curr["l"] = min(curr["l"], m["l"])
            curr["c"] = m["c"]; curr["v"] += m["v"]
    if curr: ten.append(curr)

    # remove in-flight last 10m bucket
    now_sec = int(time.time())
    curr_bucket = (now_sec // 600) * 600
    ten = [b for b in ten if (b["id"] * 600) < curr_bucket]
    return ten

def fast_flags_10m(bars: List[Dict[str,Any]], lookback: int = 5) -> Tuple[int,int,int,int]:
    if len(bars) < max(lookback, 3): return 0,0,0,0
    H = [float(b["h"]) for b in bars]
    L = [float(b["l"]) for b in bars]
    C = [float(b["c"]) for b in bars]
    recent_hi = max(H[-lookback:-1]) if lookback>1 else H[-1]
    recent_lo = min(L[-lookback:-1]) if lookback>1 else L[-1]
    nh = int(C[-1] > recent_hi)
    nl = int(C[-1] < recent_lo)
    u3 = int(C[-3] < C[-2] < C[-1])
    d3 = int(C[-3] > C[-2] > C[-1])
    return nh, nl, u3, d3

# ---------------- Sector cards helpers ----------------
ORDER_TITLES = [
    "Information Technology","Materials","Health Care","Communication Services",
    "Real Estate","Energy","Consumer Staples","Consumer Discretionary",
    "Financials","Utilities","Industrials"
]

def build_live_groups_from_etfs() -> Dict[str, Dict[str,int]]:
    proxies = {
        "Information Technology":"XLK", "Materials":"XLB", "Health Care":"XLV", "Communication Services":"XLC",
        "Real Estate":"XLRE", "Energy":"XLE", "Consumer Staples":"XLP", "Consumer Discretionary":"XLY",
        "Financials":"XLF", "Utilities":"XLU", "Industrials":"XLI",
    }
    groups = {k: {"nh":0,"nl":0,"u":0,"d":0} for k in ORDER_TITLES}
    for sector, ticker in proxies.items():
        try:
            mins = fetch_minutes_today(ticker, INTRA_MINUTE_LOOKBACK_MIN)
            ten  = collapse_to_10m(mins)
            nh, nl, u3, d3 = fast_flags_10m(ten, lookback=5)
            g = groups[sector]
            g["nh"] += nh; g["nl"] += nl; g["u"] += u3; g["d"] += d3
        except Exception as e:
            print(f"[warn] minute fetch/agg failed for {sector}/{ticker}: {e}", flush=True)
    return groups

def sector_cards_from_groups(groups: Dict[str,Any]) -> List[Dict[str,Any]]:
    cards = []
    for name in ORDER_TITLES:
        g = groups.get(name) or {}
        nh, nl = int(g.get("nh",0)), int(g.get("nl",0))
        up, dn = int(g.get("u",0)),  int(g.get("d",0))
        b = 0.0 if nh+nl==0 else round(100.0*nh/(nh+nl), 2)
        m = 0.0 if up+dn==0 else round(100.0*up/(up+dn), 2)
        cards.append({"sector":name,"breadth_pct":b,"momentum_pct":m,"nh":nh,"nl":nl,"up":up,"down":dn})
    return cards

# ---------------- Main ----------------
def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json (live intraday/hourly/eod)")
    ap.add_argument("--mode", choices=["intraday","hourly","eod","intraday10"], required=True)
    ap.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR)
    ap.add_argument("--out", default=DEFAULT_OUT_PATH)
    ap.add_argument("--source", required=False, help="optional pre-aggregated source JSON")
    args = ap.parse_args()

    mode = "intraday" if args.mode == "intraday10" else args.mode

    # Load provided source if any
    src: Dict[str, Any] = {}
    if args.source:
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                src = json.load(f)
        except Exception as e:
            print(f"[warn] failed to read --source: {e}", flush=True)
            src = {}

    if mode == "intraday":
        # Build live source if none provided
        if not src:
            if not POLY_KEY:
                raise SystemExit("Missing Polygon API key (set POLY_KEY / POLYGON_API_KEY in repo Secrets).")
            groups = build_live_groups_from_etfs()
            metrics: Dict[str, Any] = {}

            # simple breadth/momentum from sector flags
            names = list(groups.keys())
            if names:
                breadth_wins  = sum(1 for s in names if groups[s]["nh"] > groups[s]["nl"])
                momentum_wins = sum(1 for s in names if groups[s]["u"]  > groups[s]["d"])
                metrics["breadth_10m_pct"]  = round(100.0 * breadth_wins  / len(names), 2)
                metrics["momentum_10m_pct"] = round(100.0 * momentum_wins / len(names), 2)
            src = {"metrics": metrics, "groups": groups, "sectorCards": sector_cards_from_groups(groups)}
    else:
        if not src:
            src = {"metrics": {}, "groups": {}}

    # stamp
    src["updated_at"]      = now_phx_iso()
    src["updated_at_utc"]  = now_utc_iso()
    src["mode"]            = mode

    # write
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(src, f, ensure_ascii=False, separators=(",",":"))

    print("[ok] wrote", args.out, "mode:", mode)

if __name__ == "__main__":
    main()
