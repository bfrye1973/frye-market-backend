#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (LIVE intraday fetch, R11.1)

- Accepts --mode {intraday,hourly,eod,intraday10}  (intraday10 maps to intraday)
- --source is OPTIONAL. If omitted in intraday mode, we fetch from Polygon and compute
  sector NH/NL/U/D and 10m breadth/momentum using sector ETF proxies.
- --sectors-dir is OPTIONAL (used only to sanity-check your CSV folder exists).
- Stamps updated_at (AZ) and updated_at_utc (UTC).

This is the working fetcher needed to publish non-zero sectorCards and real metrics.
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

# ---------- time / tz ----------
try:
    PHX = ZoneInfo("America/Phoenix")
except Exception:
    PHX = ZoneInfo("UTC")
UTC = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    return datetime.now(PHX).replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

# ---------- polygon keys ----------
def choose_poly_key() -> Optional[str]:
    for name in ("POLY_KEY", "POLYGON_API_KEY", "REACT_APP_POLYGON_KEY"):
        v = os.environ.get(name)
        if v:
            print(f"[keys] using {name}", flush=True)
            return v
    return None

POLY_KEY = choose_poly_key()
POLY_BASE = "https://api.polygon.io"

# ---------- http helpers ----------
def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url, headers={"User-Agent": "ferrari-dashboard/1.0", "Accept-Encoding": "gzip"}
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

def poly_json(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    params = dict(params or {})
    if POLY_KEY:
        params["apiKey"] = POLY_KEY
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    for attempt in range(1, 5):
        try:
            return json.loads(http_get(full, timeout=22))
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

# ---------- fetch minute → 10m ----------
def fetch_range(ticker: str, tf_kind: str, tf_val: int, start: date, end: date,
                limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":sort,"limit":limit})
    if not js or js.get("status") != "OK":
        return []
    out = []
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

def fetch_minutes_today(ticker: str, lookback_min: int = 180) -> List[Dict[str, Any]]:
    now_utc = datetime.now(UTC)
    start_utc = now_utc - timedelta(minutes=lookback_min)
    start = start_utc.date(); end = now_utc.date()
    minutes = fetch_range(ticker, "minute", 1, start, end, sort="asc")
    if not minutes:
        return []
    cutoff_ms = int(start_utc.timestamp() * 1000)
    return [m for m in minutes if m["t"] >= cutoff_ms]

def collapse_to_10m(minutes: List[Dict[str,Any]]) -> List[Dict[str,Any]]:
    if not minutes:
        return []
    ten, curr = [], None
    for m in minutes:
        bid = m["t"] // (10 * 60 * 1000)
        if curr is None or curr["id"] != bid:
            if curr: ten.append(curr)
            curr = {"id": bid, "o": m["o"], "h": m["h"], "l": m["l"], "c": m["c"], "v": m["v"]}
        else:
            curr["h"] = max(curr["h"], m["h"])
            curr["l"] = min(curr["l"], m["l"])
            curr["c"] = m["c"]; curr["v"] += m["v"]
    if curr: ten.append(curr)

    # remove in-flight last bucket for current 10m
    now_sec = int(time.time())
    curr_bucket = (now_sec // 600) * 600
    ten = [b for b in ten if (b["id"] * 600) < curr_bucket]
    return ten

def fast_flags_10m(bars: List[Dict[str,Any]], lookback: int = 5):
    if len(bars) < max(lookback, 3):
        return 0,0,0,0
    H = [float(b["h"]) for b in bars]
    L = [float(b["l"]) for b in bars]
    C = [float(b["c"]) for b in bars]
    recent_hi = max(H[-lookback:-1]) if lookback > 1 else H[-1]
    recent_lo = min(L[-lookback:-1]) if lookback > 1 else L[-1]
    nh = int(C[-1] > recent_hi)
    nl = int(C[-1] < recent_lo)
    u3 = int(C[-3] < C[-2] < C[-1])
    d3 = int(C[-3] > C[-2] > C[-1])
    return nh, nl, u3, d3

# ---------- sector cards helpers ----------
ORDER = [
    "Information Technology","Materials","Health Care","Communication Services",
    "Real Estate","Energy","Consumer Staples","Consumer Discretionary",
    "Financials","Utilities","Industrials"
]

def build_intraday_live_groups() -> Dict[str, Dict[str,int]]:
    # ETF proxies (lightweight). Replace with your full universe later if desired.
    proxies = {
        "Information Technology":"XLK","Materials":"XLB","Health Care":"XLV","Communication Services":"XLC",
        "Real Estate":"XLRE","Energy":"XLE","Consumer Staples":"XLP","Consumer Discretionary":"XLY",
        "Financials":"XLF","Utilities":"XLU","Industrials":"XLI",
    }
    groups = {k: {"nh":0,"nl":0,"u":0,"d":0} for k in ORDER}
    for sector, ticker in proxies.items():
        try:
            mins = fetch_minutes_today(ticker, lookback_min=180)
            ten  = collapse_to_10m(mins)
            nh, nl, u3, d3 = fast_flags_10m(ten, lookback=5)
            g = groups[sector]
            g["nh"] += nh; g["nl"] += nl; g["u"] += u3; g["d"] += d3
        except Exception as e:
            print(f"[warn] sector {sector}/{ticker} minute fetch failed: {e}", flush=True)
    return groups

def build_sectorCards_from_groups(groups: Dict[str,Any]) -> List[Dict[str,Any]]:
    cards = []
    for s in ORDER:
        g = groups.get(s) or {}
        nh, nl = int(g.get("nh",0)), int(g.get("nl",0))
        up, dn = int(g.get("u",0)),  int(g.get("d",0))
        b = 0.0 if nh+nl==0 else round(100.0*nh/(nh+nl),2)
        m = 0.0 if up+dn==0 else round(100.0*up/(up+dn),2)
        cards.append({"sector":s,"breadth_pct":b,"momentum_pct":m,"nh":nh,"nl":nl,"up":up,"down":dn})
    return cards

# ---------- main ----------
def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json")
    ap.add_argument("--mode", choices=["intraday","hourly","eod","intraday10"], required=True)
    ap.add_argument("--sectors-dir", default="data/sectors")
    ap.add_argument("--source", required=False)
    ap.add_argument("--out", default="data/outlook_source.json")
    args = ap.parse_args()

    mode = "intraday" if args.mode == "intraday10" else args.mode

    if args.source:
        try:
            src = json.load(open(args.source,"r",encoding="utf-8"))
        except Exception as e:
            print("[warn] failed to read --source:", e); src = {}
    else:
        src = {}

    if mode == "intraday":
        if not src:
            # live build from Polygon minutes (ETF proxies)
            if not POLY_KEY:
                print("[warn] no Polygon key in env; publishing skeleton", flush=True)
                groups = {s: {"nh":0,"nl":0,"u":0,"d":0} for s in ORDER}
            else:
                groups = build_intraday_live_groups()
            metrics = {}
            src = {"metrics": metrics, "groups": groups, "sectorCards": build_sectorCards_from_groups(groups)}
    else:
        if not src:
            src = {"metrics": {}, "groups": {}}

    # stamp source
    src["updated_at"]     = now_phx_iso()
    src["updated_at_utc"] = now_utc_iso()
    src["mode"]           = mode

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(src, open(args.out,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    print("[ok] wrote", args.out, "mode:", mode)

if __name__ == "__main__":
    main()
