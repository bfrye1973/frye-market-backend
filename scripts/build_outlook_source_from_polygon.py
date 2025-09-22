#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R4)

Generates data/outlook_source.json from Polygon.

Modes
- daily     : EOD-style counts from completed daily bars
- intraday  : 10NH / 10NL / 3U / 3D from today's high/low/last vs prior 10-day watermarks

Inputs
- CSVs under data/sectors/{Sector}.csv  (header must be 'Symbol')

Outputs (schema)
{
  "timestamp": "...Z",
  "mode": "intraday" | "daily",
  "groups": {
    "<Sector>": { "nh":int, "nl":int, "u":int, "d":int, "vol_state":"Mixed", "breadth_state":"Neutral", "history":{"nh":[]} }
  },
  "global": {
    "squeeze_pressure_pct": int(0..100),     # legacy PSI (intraday feel) — used by fuel gauge
    "squeeze_state": "none"|"on"|"firingUp"|"firingDown",
    "daily_squeeze_pct": float(0..100),      # Lux-like BB/KC daily squeeze (% compression)
    "volatility_pct": int(0..100),
    "liquidity_pct": int(0..120)
  }
}
"""
from __future__ import annotations
import argparse, csv, json, math, os, time, random, statistics
import urllib.parse, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from math import log
from typing import Any, Dict, List, Tuple

# ---- Config / env
POLY_KEY   = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
POLY_BASE  = "https://api.polygon.io"

SECTORS_DIR= os.path.join("data", "sectors")
OUT_PATH   = os.path.join("data", "outlook_source.json")
HIST_PATH  = os.path.join("data", "history.json")

# -------------------------- HTTP / Polygon helpers --------------------------

def http_get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ferrari-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url: str,
              params: Dict[str, Any] | None = None,
              retries: int = 6,
              backoff: float = 0.8) -> Dict[str, Any]:
    """Robust fetch with retries for 429/5xx/network hiccups."""
    if params is None:
        params = {}
    if POLY_KEY:
        params["apiKey"] = POLY_KEY
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url

    attempt = 0
    while True:
        attempt += 1
        try:
            raw = http_get(full, timeout=30)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt <= retries:
                sleep_s = backoff * (2 ** (attempt - 1)) * (1 + random.random() * 0.25)
                time.sleep(sleep_s); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt <= retries:
                sleep_s = backoff * (2 ** (attempt - 1)) * (1 + random.random() * 0.25)
                time.sleep(sleep_s); continue
            raise

def date_str(d): return d.strftime("%Y-%m-%d")

def fetch_range_daily(ticker: str, start: str, end: str) -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end}"
    js = poly_json(url, {"adjusted":"true","sort":"asc","limit":50000})
    if js.get("status") != "OK": return []
    out = []
    for r in js.get("results", []) or []:
        out.append({"t": int(r.get("t", 0)), "o": float(r.get("o", 0)),
                    "h": float(r.get("h", 0)), "l": float(r.get("l", 0)),
                    "c": float(r.get("c", 0)), "v": float(r.get("v", 0))})
    out.sort(key=lambda x: x["t"])
    return out

# -------------------------- Sector CSV helpers --------------------------

def read_symbols(path: str) -> List[str]:
    syms = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s: syms.append(s)
    return syms

def discover_sectors() -> Dict[str, List[str]]:
    if not os.path.isdir(SECTORS_DIR):
        raise SystemExit(f"Missing folder: {SECTORS_DIR}\nCreate CSVs like data/sectors/Tech.csv with header 'Symbol'")
    sectors = {}
    for name in os.listdir(SECTORS_DIR):
        if not name.lower().endswith(".csv"): continue
        sector = os.path.splitext(name)[0]
        symbols = read_symbols(os.path.join(SECTORS_DIR, name))
        if symbols: sectors[sector] = symbols
    if not sectors: raise SystemExit(f"No sector CSVs found in {SECTORS_DIR}")
    return sectors

# -------------------------- Intraday & Daily counts --------------------------

def bars_last_n_days(ticker: str, n_days: int) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(20, n_days + 5))
    return fetch_range_daily(ticker, date_str(start), date_str(end))[-15:]

def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> tuple[bool,bool,bool,bool]:
    if len(bars) < 11: return False, False, False, False
    today   = bars[-1]
    prior10 = bars[-11:-1]
    max_high_10 = max(b["h"] for b in prior10)
    min_low_10  = min(b["l"] for b in prior10)
    is_10NH = today["h"] > max_high_10
    is_10NL = today["l"] < min_low_10
    last3 = bars[-3:]
    is_3U = (len(last3) == 3) and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"])
    is_3D = (len(last3) == 3) and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"])
    return is_10NH, is_10NL, is_3U, is_3D

def precompute_watermarks(symbols: List[str]) -> Dict[str, tuple[float|None,float|None,float|None,float|None]]:
    out = {}
    for i, sym in enumerate(symbols):
        bars = bars_last_n_days(sym, 12)
        if len(bars) >= 3:
            highs = [b["h"] for b in bars]; lows = [b["l"] for b in bars]; closes = [b["c"] for b in bars]
            highs_ex = highs[:-1] if len(highs) > 1 else highs
            lows_ex  = lows[:-1]  if len(lows)  > 1 else lows
            H10 = max(highs_ex[-10:]) if len(highs_ex) >= 10 else (max(highs_ex) if highs_ex else None)
            L10 = min(lows_ex[-10:])  if len(lows_ex)  >= 10 else (min(lows_ex)  if lows_ex  else None)
            c1 = closes[-1]; c2 = closes[-2]
            out[sym] = (H10, L10, c2, c1)
        if (i+1) % 20 == 0: time.sleep(0.15)
    return out

def compute_intraday_flags(h10, l10, c2, c1, day_high, day_low, last_price) -> tuple[int,int,int,int]:
    nh = int(h10 is not None and day_high is not None and day_high > h10)
    nl = int(l10 is not None and day_low  is not None and day_low  < l10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_price is not None and last_price >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_price is not None and last_price <= c1))
    return nh, nl, u3, d3

def build_sector_counts_daily(symbols: List[str]) -> Dict[str, int]:
    counts = {"nh":0,"nl":0,"u":0,"d":0}
    for i, sym in enumerate(symbols):
        try:
            bars = bars_last_n_days(sym, 11)
        except Exception:
            bars = []
        if bars:
            nh,nl,u,d = compute_flags_from_bars(bars)
            counts["nh"] += int(nh); counts["nl"] += int(nl)
            counts["u"]  += int(u);  counts["d"]  += int(d)
        if (i+1) % 10 == 0: time.sleep(0.25)
    return counts

def bulk_snapshots(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(tickers), 50):
        batch = tickers[i:i+50]
        url = f"{POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
        js = poly_json(url, {"tickers": ",".join(batch)})
        for row in js.get("tickers", []) or []:
            sym = row.get("ticker")
            if sym: out[sym] = row
        time.sleep(0.35)
    return out

def build_sector_counts_intraday(symbols: List[str], wm_cache: Dict[str, tuple], snapshots: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    counts = {"nh":0,"nl":0,"u":0,"d":0}
    for sym in symbols:
        H10,L10,c2,c1 = wm_cache.get(sym, (None,None,None,None))
        snap = snapshots.get(sym, {}) or {}
        day  = snap.get("day") or {}
        last_trade = snap.get("lastTrade") or {}
        last_quote = snap.get("lastQuote") or {}
        day_high   = day.get("h"); day_low = day.get("l")
        last_price = last_trade.get("p") or last_quote.get("p")
        nh,nl,u3,d3 = compute_intraday_flags(H10,L10,c2,c1,day_high,day_low,last_price)
        counts["nh"] += nh; counts["nl"] += nl; counts["u"] += u3; counts["d"] += d3
    return counts

# -------------------------- History file --------------------------

def load_history():
    if not os.path.exists(HIST_PATH): return {"days":[]}
    with open(HIST_PATH, "r", encoding="utf-8") as f: return json.load(f)

def save_history(hist):
    os.makedirs(os.path.dirname(HIST_PATH), exist_ok=True)
    with open(HIST_PATH, "w", encoding="utf-8") as f: json.dump(hist, f, ensure_ascii=False, indent=2)

# -------------------------- Squeeze helpers --------------------------

def percent_rank(series, value):
    if not series: return 0.5
    n = len(series)
    lt = sum(1 for x in series if x < value)
    eq = sum(1 for x in series if x == value)
    return (lt + 0.5 * eq) / n

def ema(vals, length):
    if not vals: return []
    k = 2.0 / (length + 1.0)
    out = [vals[0]]
    for v in vals[1:]: out.append(out[-1] + k * (v - out[-1]))
    return out

def true_range(h, l, c_prev):
    return max(h - l, abs(h - c_prev), abs(l - c_prev))

def atr(highs, lows, closes, length=20):
    if len(closes) < 2: return []
    trs = []
    for i in range(1, len(closes)):
        trs.append(true_range(highs[i], lows[i], closes[i-1]))
    return ema(trs, length)

def rolling_stdev(vals, length=20):
    out = []; q = []
    for v in vals:
        q.append(v)
        if len(q) > length: q.pop(0)
        if len(q) >= length: out.append(statistics.pstdev(q))
        else: out.append(None)
    return out

def compute_daily_squeeze_pct_lux(symbol="SPY", lookback_days=250, length=20, bb_mult=2.0, kc_mult=1.5):
    """Lux-like Daily Squeeze % via BB/KC width ratio percent-rank (0..100, higher = tighter)."""
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days*2)  # buffer for weekends
    bars = fetch_range_daily(symbol, date_str(start), date_str(end))

    if len(bars) < length + 2: return 50.0
    closes = [float(b["c"]) for b in bars]
    highs  = [float(b["h"]) for b in bars]
    lows   = [float(b["l"]) for b in bars]
    sd = rolling_stdev(closes, length=length)
    atr_vals = atr(highs, lows, closes, length=length)

    ratios = []
    for i in range(len(closes)):
        if sd[i] is None or i == 0 or i-1 >= len(atr_vals) or atr_vals[i-1] is None:
            ratios.append(None); continue
        bb_width = 2.0 * bb_mult * sd[i]
        kc_width = 2.0 * kc_mult * atr_vals[i-1]
        if kc_width <= 0: ratios.append(None); continue
        ratios.append(bb_width / kc_width)

    series = [r for r in ratios if r is not None]
    if len(series) < length + 2: return 50.0
    window = series[-120:] if len(series) >= 120 else series
    pr = percent_rank(window, window[-1])  # 0..1 (high = wide BB vs KC => low compression)
    return max(0.0, min(100.0, round((1.0 - pr) * 100.0, 2)))

def compute_psi_from_closes(closes, conv=50, length=20):
    """Legacy PSI (log-span vs time, 0..100) used by intraday 'fuel' semantics."""
    if len(closes) < max(5, length + 2): return None
    mx = mn = None; diffs = []
    for src in closes:
        mx = src if mx is None else max(src, mx - (mx - src)/conv)
        mn = src if mn is None else min(src, mn + (src - mn)/conv)
        span = max(mx - mn, 1e-12); diffs.append(log(span))
    n = length; xs = list(range(n))
    if len(diffs) < n: return None
    window = diffs[-n:]; xbar = sum(xs)/n; ybar = sum(window)/n
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs, window))
    den = (sum((x-xbar)**2 for x in xs) * sum((y-ybar)**2 for y in window)) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0*r + 50.0
    return float(max(0.0, min(100.0, psi)))

def compute_squeeze_fields(ticker="SPY", conv=50, length=20):
    """
    Returns BOTH:
      - squeeze_pressure_pct (legacy PSI) for intraday 'fuel'
      - daily_squeeze_pct (Lux-like BB/KC percent-rank) for daily gauge (~34% in your checks)
      - squeeze_state (simple state flag)
    """
    # Legacy PSI
    end = datetime.utcnow().date(); start = end - timedelta(days=90)
    bars = fetch_range_daily(ticker, date_str(start), date_str(end))
    closes = [b["c"] for b in bars]
    psi = compute_psi_from_closes(closes, conv=conv, length=length)
    if psi is None: psi = 50.0

    # Daily BB/KC squeeze %
    daily_pct = compute_daily_squeeze_pct_lux(symbol=ticker, lookback_days=250, length=20, bb_mult=2.0, kc_mult=1.5)

    # State by PSI + direction hint
    last_up = len(closes) >= 2 and (closes[-1] > closes[-2])
    if psi >= 80: state = "firingUp" if last_up else "firingDown"
    elif psi < 50: state = "on"
    else: state = "none"

    return {
        "squeeze_pressure_pct": int(round(float(psi))),  # legacy / intraday
        "squeeze_state": state,
        "daily_squeeze_pct": float(daily_pct if daily_pct is not None else 50.0)
    }

# -------------------------- Volatility / Liquidity --------------------------

def compute_atr14_percent(closes, highs, lows):
    n = len(closes)
    if n < 20: return None
    trs=[]
    for i in range(1,n):
        trs.append(max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])))
    period=14
    if len(trs)<period: return None
    atr = sum(trs[:period])/period
    for x in trs[period:]: atr=(atr*(period-1)+x)/period
    c = closes[-1]
    if c<=0: return None
    return (atr/c)*100.0

def percentile_rank(values, value):
    if not values: return 50
    less = sum(1 for v in values if v <= value)
    return round(100 * less / len(values))

def compute_volatility_pct(ticker="SPY"):
    end = datetime.utcnow().date(); start = end - timedelta(days=140)
    bars = fetch_range_daily(ticker, date_str(start), date_str(end))
    if len(bars) < 30: return 50
    closes=[b["c"] for b in bars]; highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]
    atrp_series=[]
    for i in range(20, len(bars)+1):
        atrp = compute_atr14_percent(closes[:i], highs[:i], lows[:i])
        if atrp is not None: atrp_series.append(atrp)
    if not atrp_series: return 50
    current = atrp_series[-1]
    return int(max(0, min(100, percentile_rank(atrp_series, current))))

def compute_liquidity_pct(ticker="SPY"):
    end = datetime.utcnow().date(); start = end - timedelta(days=60)
    bars = fetch_range_daily(ticker, date_str(start), date_str(end))
    if len(bars) < 20: return 70
    vols = [b["v"] for b in bars]
    avgv5  = sum(vols[-5:])  / 5
    avgv20 = sum(vols[-20:]) / 20
    if avgv20 <= 0: return 70
    ratio = (avgv5/avgv20)*100.0
    return int(round(max(0, min(120, ratio))))

# -------------------------- Main --------------------------

def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json (daily or intraday)")
    ap.add_argument("--mode", choices=["daily","intraday"], default="daily")
    args = ap.parse_args()

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY (or POLYGON_API_KEY) with your Polygon API key")

    sectors = discover_sectors()
    total_symbols = sum(len(v) for v in sectors.values())
    print(f"[discovered] {total_symbols} symbols across {len(sectors)} sectors (mode={args.mode})")

    groups = {}; sizes = {}

    if args.mode == "daily":
        for sector, symbols in sectors.items():
            sizes[sector] = len(symbols)
            print(f"[{sector}] {len(symbols)} tickers — daily…")
            c = build_sector_counts_daily(symbols)
            groups[sector] = {"nh":c["nh"], "nl":c["nl"], "u":c["u"], "d":c["d"],
                              "vol_state":"Mixed","breadth_state":"Neutral","history":{"nh":[]}}
    else:
        all_syms = sorted({s for arr in sectors.values() for s in arr})
        print(f"[intraday] precomputing watermarks for {len(all_syms)} symbols…")
        wm = precompute_watermarks(all_syms)
        print("[intraday] fetching snapshots…")
        snaps = {}
        for i in range(0,len(all_syms),200):
            part = all_syms[i:i+200]; snaps.update(bulk_snapshots(part))
        for sector, symbols in sectors.items():
            sizes[sector] = len(symbols)
            print(f"[{sector}] {len(symbols)} tickers — intraday…")
            c = build_sector_counts_intraday(symbols, wm_cache=wm, snapshots=snaps)
            groups[sector] = {"nh":c["nh"], "nl":c["nl"], "u":c["u"], "d":c["d"],
                              "vol_state":"Mixed","breadth_state":"Neutral","history":{"nh":[]}}

    # Squeeze / Vol / Liq
    squeeze = compute_squeeze_fields("SPY", conv=50, length=20)
    vol_pct = compute_volatility_pct("SPY")
    liq_psi = compute_liquidity_pct("SPY")

    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": args.mode,
        "groups": groups,
        "global": { **squeeze, "volatility_pct": vol_pct, "liquidity_pct": liq_psi }
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f: json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {OUT_PATH}")

    for s,g in groups.items(): print(f"  {s}: nh={g['nh']} nl={g['nl']} u={g['u']} d={g['d']}")
    print("[squeeze] daily_squeeze_pct:", payload["global"]["daily_squeeze_pct"])
    print("[volatility]", payload["global"]["volatility_pct"])
    print("[liquidity]", payload["global"]["liquidity_pct"])

    # History (DVR)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snap  = { s: {"nh": g["nh"], "nl": g["nl"], "u": g["u"], "d": g["d"]} for s,g in groups.items() }
    hist  = load_history()
    if hist["days"] and hist["days"][-1].get("date") == today:
        hist["days"][-1]["groups"] = snap
    else:
        hist["days"].append({"date": today, "groups": snap})
    hist["days"] = hist["days"][-60:]
    save_history(hist)
    print("[OK] appended to data/history.json")

if __name__ == "__main__":
    main()
