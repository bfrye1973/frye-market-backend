#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R6 — 10m / 1h / EOD, Lux PSI daily)

Generates data/outlook_source.json from Polygon for three cadences:

- intraday10 : 10-minute workflow (today's NH/NL/3U/3D from snapshots vs prior 10-day watermarks)
- hourly     : 1-hour workflow    (last completed 1-hour bars)
- daily      : EOD workflow       (completed daily bars)

Global fields:
  squeeze_pressure_pct : int  (intraday 'fuel' PSI — kept as you had it)
  squeeze_state        : str  ('none' | 'on' | 'firingUp' | 'firingDown')
  daily_squeeze_pct    : float (Lux PSI on DAILY SPY closes, conv=50 length=20)
  volatility_pct       : int  (ATR% percentile on DAILY SPY)
  liquidity_pct        : int  (vol ratio percentile on DAILY SPY)

Output:
  data/outlook_source.json
"""

from __future__ import annotations
import argparse, csv, json, math, os, random, statistics, time
import urllib.parse, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone, date
from math import log
from typing import Any, Dict, List, Tuple

# ---------- ENV / CONFIG ----------
POLY_KEY  = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
POLY_BASE = "https://api.polygon.io"

SECTORS_DIR = os.path.join("data", "sectors")
OUT_PATH    = os.path.join("data", "outlook_source.json")

# ----- HTTP / Polygon helpers -----
def http_get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ferrari-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url: str,
              params: Dict[str, Any] | None = None,
              retries: int = 6,
              backoff: float = 0.8) -> Dict[str, Any]:
    """Retry for 429/5xx with exponential backoff + jitter."""
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
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

def dstr(d: date) -> str: return d.strftime("%Y-%m-%d")

def fetch_range(ticker: str, tf_kind: str, tf_val: int,
                start: date, end: date, limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    """
    tf_kind: 'day' or 'hour'
    tf_val : 1 for day, 1 for hour (we keep generic)
    Returns ascending list of bars with keys o,h,l,c,v,t
    """
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":sort,"limit":limit})
    if js.get("status") != "OK": return []
    out = []
    for r in js.get("results", []) or []:
        out.append({
            "t": int(r.get("t", 0)),
            "o": float(r.get("o", 0)),
            "h": float(r.get("h", 0)),
            "l": float(r.get("l", 0)),
            "c": float(r.get("c", 0)),
            "v": float(r.get("v", 0))
        })
    out.sort(key=lambda x: x["t"])
    return out

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end, sort="asc")

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict[str, Any]]:
    # use a date window wide enough to include ~hours_back business hours
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(7, hours_back // 6 + 2))  # loose buffer
    return fetch_range(ticker, "hour", 1, start, end, sort="asc")

# ---------- Sector CSV ----------
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

# ---------- Flag math ----------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> tuple[int,int,int,int]:
    """
    NH/NL vs prior 10 bars; 3U/3D on last 3 closes.
    Works for both DAILY and HOURLY series.
    """
    if len(bars) < 11: return 0,0,0,0
    today   = bars[-1]
    prior10 = bars[-11:-1]
    max_high_10 = max(b["h"] for b in prior10)
    min_low_10  = min(b["l"] for b in prior10)
    is_10NH = int(today["h"] > max_high_10)
    is_10NL = int(today["l"] < min_low_10)
    last3 = bars[-3:]
    is_3U = int(len(last3) == 3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
    is_3D = int(len(last3) == 3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    return is_10NH, is_10NL, is_3U, is_3D

def watermarks_last_10d(symbols: List[str]) -> Dict[str, tuple[float|None,float|None,float|None,float|None]]:
    """
    For intraday10 mode, precompute 10-day H/L watermarks and last two closes.
    Returns map: sym -> (H10, L10, c2, c1)   (excluding today's bar in H/L)
    """
    out = {}
    for i, sym in enumerate(symbols):
        bars = fetch_daily(sym, 20)[-12:]  # enough to form prior-10 excluding today
        if len(bars) >= 3:
            highs = [b["h"] for b in bars]
            lows  = [b["l"] for b in bars]
            closes= [b["c"] for b in bars]
            highs_ex = highs[:-1] if len(highs) > 1 else highs  # exclude today
            lows_ex  = lows[:-1]  if len(lows)  > 1 else lows
            H10 = max(highs_ex[-10:]) if len(highs_ex) >= 10 else (max(highs_ex) if highs_ex else None)
            L10 = min(lows_ex[-10:])  if len(lows_ex)  >= 10 else (min(lows_ex)  if lows_ex  else None)
            out[sym] = (H10, L10, closes[-2], closes[-1])
        if (i+1) % 20 == 0: time.sleep(0.12)
    return out

def compute_intraday_from_snap(H10, L10, c2, c1, day_high, day_low, last_price) -> tuple[int,int,int,int]:
    nh = int(H10 is not None and day_high is not None and day_high > H10)
    nl = int(L10 is not None and day_low  is not None and day_low  < L10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_price is not None and last_price >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_price is not None and last_price <= c1))
    return nh, nl, u3, d3

# ---------- Lux Squeeze (PSI) ----------
def compute_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> float | None:
    """
    Lux Squeeze PSI (correlation of log(span) vs time). Returns 0..100 (higher = tighter).
    """
    if len(closes) < max(5, length + 2): return None
    mx = mn = None
    diffs: List[float] = []
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src)/conv, src)
        mn = src if mn is None else min(mn + (src - mn)/conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(log(span))
    n = length
    xs = list(range(n))
    window = diffs[-n:]
    if len(window) < n: return None
    xbar = sum(xs)/n; ybar = sum(window)/n
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs, window))
    den = (sum((x-xbar)**2 for x in xs) * sum((y-ybar)**2 for y in window)) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0*r + 50.0
    return float(max(0.0, min(100.0, psi)))

# ---- Volatility / Liquidity (daily SPY) ----
def true_range(h, l, c_prev): return max(h - l, abs(h - c_prev), abs(l - c_prev))

def ema(vals, length):
    if not vals: return []
    k = 2.0 / (length + 1.0)
    out = [vals[0]]
    for v in vals[1:]: out.append(out[-1] + k * (v - out[-1]))
    return out

def atr_ema(highs, lows, closes, length=20):
    if len(closes) < 2: return []
    trs=[]
    for i in range(1,len(closes)):
        trs.append(true_range(highs[i], lows[i], closes[i-1]))
    return ema(trs, length)

def compute_atr14_percent_series(closes, highs, lows):
    if len(closes) < 20: return []
    trs=[]
    for i in range(1, len(closes)):
        trs.append(true_range(highs[i], lows[i], closes[i-1]))
    period=14
    if len(trs) < period: return []
    out=[]
    atr = sum(trs[:period])/period
    out.append(atr)
    for x in trs[period:]:
        atr = (atr*(period-1) + x)/period
        out.append(atr)
    series=[]
    for i, a in enumerate(out, start=period):
        c = closes[i] if i < len(closes) else closes[-1]
        series.append((a / max(c,1e-9)) * 100.0)
    return series

def percentile_rank(values: List[float], value: float) -> int:
    if not values: return 50
    less = sum(1 for v in values if v <= value)
    return int(round(100 * less / len(values)))

def compute_volatility_pct_SPY() -> int:
    bars = fetch_daily("SPY", 160)
    if len(bars) < 40: return 50
    closes=[b["c"] for b in bars]; highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]
    atrp_series = compute_atr14_percent_series(closes, highs, lows)
    if not atrp_series: return 50
    return int(max(0, min(100, percentile_rank(atrp_series, atrp_series[-1]))))

def compute_liquidity_pct_SPY() -> int:
    bars = fetch_daily("SPY", 70)
    if len(bars) < 21: return 70
    vols = [b["v"] for b in bars]
    avgv5  = sum(vols[-5:])  / 5.0
    avgv20 = sum(vols[-20:]) / 20.0
    if avgv20 <= 0: return 70
    ratio = (avgv5 / avgv20) * 100.0
    return int(round(max(0, min(120, ratio))))

# ---------- Counts builders ----------
def build_counts_daily(symbols: List[str]) -> Dict[str, int]:
    c = {"nh":0,"nl":0,"u":0,"d":0}
    for i, sym in enumerate(symbols):
        bars = fetch_daily(sym, 20)[-12:]
        nh,nl,u3,d3 = compute_flags_from_bars(bars)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        if (i+1) % 10 == 0: time.sleep(0.15)
    return c

def build_counts_hourly(symbols: List[str]) -> Dict[str, int]:
    """
    Uses last completed 1-hour bars. We compute flags on the hourly series.
    """
    c = {"nh":0,"nl":0,"u":0,"d":0}
    for i, sym in enumerate(symbols):
        bars = fetch_hourly(sym, hours_back=80)[-12:]
        nh,nl,u3,d3 = compute_flags_from_bars(bars)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        if (i+1) % 10 == 0: time.sleep(0.10)
    return c

def build_counts_intraday10(symbols: List[str]) -> Dict[str, int]:
    """
    Intraday10: compare today's snapshot H/L/last vs prior 10-day watermarks.
    """
    c = {"nh":0,"nl":0,"u":0,"d":0}
    wm = watermarks_last_10d(symbols)
    # bulk snapshots
    out_snaps: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(symbols), 50):
        batch = symbols[i:i+50]
        url = f"{POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
        js = poly_json(url, {"tickers": ",".join(batch)})
        for row in js.get("tickers", []) or []:
            sym = row.get("ticker")
            if sym: out_snaps[sym] = row
        time.sleep(0.30)
    for sym in symbols:
        H10,L10,c2,c1 = wm.get(sym, (None,None,None,None))
        s = out_snaps.get(sym, {}) or {}
        day  = s.get("day") or {}
        last_trade = s.get("lastTrade") or {}
        last_quote = s.get("lastQuote") or {}
        day_high   = day.get("h"); day_low = day.get("l")
        last_price = last_trade.get("p") or last_quote.get("p")
        nh,nl,u3,d3 = compute_intraday_from_snap(H10,L10,c2,c1,day_high,day_low,last_price)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
    return c

# ---------- Sector orchestrator ----------
def build_groups(mode: str, sectors: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}
    for sector, symbols in sectors.items():
        syms = list(sorted(set(symbols)))
        if mode == "daily":
            cnt = build_counts_daily(syms)
        elif mode == "hourly":
            cnt = build_counts_hourly(syms)
        else:  # intraday10
            cnt = build_counts_intraday10(syms)
        groups[sector] = {
            "nh": cnt["nh"], "nl": cnt["nl"], "u": cnt["u"], "d": cnt["d"],
            "vol_state": "Mixed", "breadth_state": "Neutral", "history": {"nh": []}
        }
    return groups

# ---------- Global gauges (squeeze/vol/liquidity) ----------
def compute_global_fields() -> Dict[str, Any]:
    # fuel (unchanged behavior you asked to keep) — PSI on recent daily closes
    bars = fetch_daily("SPY", 120)
    closes = [b["c"] for b in bars]
    psi = compute_psi_from_closes(closes, conv=50, length=20)
    if psi is None: psi = 50.0

    last_up = len(closes) >= 2 and (closes[-1] > closes[-2])
    if psi >= 80: state = "firingUp" if last_up else "firingDown"
    elif psi < 50: state = "on"
    else: state = "none"

    # daily squeeze = Lux PSI on daily closes (explicit; same params)
    bars_d = fetch_daily("SPY", 260)
    closes_d = [b["c"] for b in bars_d]
    psi_daily = compute_psi_from_closes(closes_d, conv=50, length=20)
    if psi_daily is None: psi_daily = 50.0

    vol_pct = compute_volatility_pct_SPY()
    liq_pct = compute_liquidity_pct_SPY()

    return {
        "squeeze_pressure_pct": int(round(float(psi))),
        "squeeze_state": state,
        "daily_squeeze_pct": float(round(psi_daily, 2)),
        "volatility_pct": int(vol_pct),
        "liquidity_pct": int(liq_pct)
    }

# ---------- Main ----------
def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json for intraday10/hourly/daily")
    ap.add_argument("--mode", choices=["intraday10","hourly","daily"], default="daily")
    args = ap.parse_args()

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY (or POLYGON_API_KEY) with your Polygon API key")

    sectors = discover_sectors()
    print(f"[sectors] {len(sectors)} groups")

    groups = build_groups(args.mode, sectors)
    global_fields = compute_global_fields()

    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": args.mode,
        "groups": groups,
        "global": global_fields
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {OUT_PATH}")
    print(f"[global] fuel(psi)={payload['global']['squeeze_pressure_pct']}  daily(psi)={payload['global']['daily_squeeze_pct']}")
    for s,g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']} u={g['u']} d={g['d']}")

if __name__ == "__main__":
    main()
