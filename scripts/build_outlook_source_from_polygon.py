#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R7)

Cadences
- intraday10 : 10m workflow (snapshots vs prior 10-day watermarks)
- hourly     : last completed 1-hour bars
- daily      : completed daily bars (EOD)

Global
- squeeze_pressure_pct : int (intraday 'fuel' PSI — unchanged)
- squeeze_state        : str ('none'|'on'|'firingUp'|'firingDown')
- daily_squeeze_pct    : float (Lux PSI on DAILY SPY closes, conv=50 len=20)
- volatility_pct       : int  (ATR% percentile on DAILY SPY)
- liquidity_pct        : int  (volume ratio percentile on DAILY SPY)
- adr_momentum_pct     : float (ADR Up / (ADR Up + ADR Down) * 100 across universe)

Per-sector counts now include:
- nh, nl, u, d (unchanged)
- adrUp, adrDown   <-- NEW (ADR momentum, 3-day lookback by default)

Output: data/outlook_source.json
"""
from __future__ import annotations
import argparse, csv, json, math, os, random, statistics, time, urllib.parse, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone, date
from math import log
from typing import Any, Dict, List, Tuple

# ---------------- ENV / CONFIG ----------------
POLY_KEY  = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
POLY_BASE = "https://api.polygon.io"

SECTORS_DIR = os.path.join("data", "sectors")
OUT_PATH    = os.path.join("data", "outlook_source.json")

ADR_LOOKBACK_DAYS = 80     # enough to compute ATR% + 3-day momentum
ADR_PERIOD        = 14     # ATR period for ADR%
ADR_MOMENTUM_LAG  = 3      # compare today vs N bars ago for Up/Down

# ---------------- HTTP ----------------
def http_get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ferrari-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url: str, params: Dict[str, Any] | None = None, retries: int = 6, backoff: float = 0.8) -> Dict[str, Any]:
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
            if e.code in (429,500,502,503,504) and attempt <= retries:
                sleep = backoff * (2 ** (attempt-1)) * (1 + random.random()*0.25)
                time.sleep(sleep); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt <= retries:
                sleep = backoff * (2 ** (attempt-1)) * (1 + random.random()*0.25)
                time.sleep(sleep); continue
            raise

def dstr(d: date) -> str: return d.strftime("%Y-%m-%d")

def fetch_range(ticker: str, tf_kind: str, tf_val: int, start: date, end: date, limit: int = 50000) -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":"asc","limit":limit})
    if js.get("status") != "OK": return []
    out=[]
    for r in js.get("results", []) or []:
        out.append({"t": int(r.get("t",0)),"o": float(r.get("o",0)),"h": float(r.get("h",0)),
                    "l": float(r.get("l",0)),"c": float(r.get("c",0)),"v": float(r.get("v",0))})
    out.sort(key=lambda x: x["t"])
    return out

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end)

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(7, hours_back // 6 + 2))
    return fetch_range(ticker, "hour", 1, start, end)

# ---------------- Sectors CSV ----------------
def read_symbols(path: str) -> List[str]:
    syms=[]
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s: syms.append(s)
    return syms

def discover_sectors() -> Dict[str, List[str]]:
    if not os.path.isdir(SECTORS_DIR):
        raise SystemExit(f"Missing {SECTORS_DIR}. Put CSVs like data/sectors/Tech.csv with header 'Symbol'.")
    sectors={}
    for name in os.listdir(SECTORS_DIR):
        if not name.lower().endswith(".csv"): continue
        sector = os.path.splitext(name)[0]
        symbols = read_symbols(os.path.join(SECTORS_DIR, name))
        if symbols: sectors[sector]=symbols
    if not sectors: raise SystemExit("No sector CSVs found.")
    return sectors

# ---------------- Flags ----------------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> tuple[int,int,int,int]:
    if len(bars) < 11: return 0,0,0,0
    today = bars[-1]; prior10 = bars[-11:-1]
    is_10NH = int(today["h"] > max(b["h"] for b in prior10))
    is_10NL = int(today["l"] < min(b["l"] for b in prior10))
    last3 = bars[-3:]
    is_3U = int(len(last3)==3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
    is_3D = int(len(last3)==3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    return is_10NH, is_10NL, is_3U, is_3D

def watermarks_last_10d(symbols: List[str]) -> Dict[str, tuple[float|None,float|None,float|None,float|None]]:
    out={}
    for i,sym in enumerate(symbols):
        bars = fetch_daily(sym, 22)[-12:]
        if len(bars) >= 3:
            highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]; closes=[b["c"] for b in bars]
            highs_ex = highs[:-1] if len(highs)>1 else highs
            lows_ex  = lows[:-1]  if len(lows)>1 else lows
            H10 = max(highs_ex[-10:]) if len(highs_ex)>=10 else (max(highs_ex) if highs_ex else None)
            L10 = min(lows_ex[-10:])  if len(lows_ex) >=10 else (min(lows_ex)  if lows_ex  else None)
            out[sym] = (H10, L10, closes[-2], closes[-1])
        if (i+1)%20==0: time.sleep(0.12)
    return out

def compute_intraday_from_snap(H10,L10,c2,c1,day_high,day_low,last_price)->tuple[int,int,int,int]:
    nh = int(H10 is not None and day_high is not None and day_high > H10)
    nl = int(L10 is not None and day_low  is not None and day_low  < L10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_price is not None and last_price >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_price is not None and last_price <= c1))
    return nh,nl,u3,d3

# ---------------- Lux PSI (Squeeze) ----------------
def compute_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> float | None:
    if len(closes) < max(5, length+2): return None
    mx = mn = None; diffs=[]
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx-src)/conv, src)
        mn = src if mn is None else min(mn + (src-mn)/conv, src)
        span = max(mx-mn, 1e-12)
        diffs.append(log(span))
    n=length; xs=list(range(n)); win=diffs[-n:]
    if len(win)<n: return None
    xbar = sum(xs)/n; ybar = sum(win)/n
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs,win))
    den = (sum((x-xbar)**2 for x in xs) * sum((y-ybar)**2 for y in win)) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0*r + 50.0
    return float(max(0.0, min(100.0, psi)))

# ---------------- ADR % + Momentum ----------------
def true_range(h,l,c_prev): return max(h-l, abs(h-c_prev), abs(l-c_prev))

def adr_percent_series(bars: List[Dict[str,Any]], period: int = ADR_PERIOD) -> List[float]:
    """ATR(period) / Close * 100 over time (EMA ATR)."""
    if len(bars) < period+1: return []
    closes=[b["c"] for b in bars]; highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]
    trs=[]
    for i in range(1, len(bars)):
        trs.append(true_range(highs[i], lows[i], closes[i-1]))
    # EMA(ATR)
    k = 2.0/(period+1.0)
    atr = sum(trs[:period])/period
    out=[(atr/max(closes[period],1e-9))*100.0]
    for j,x in enumerate(trs[period:], start=period+1):
        atr = (atr*(1.0-k)) + k*x
        c   = closes[j] if j < len(closes) else closes[-1]
        out.append((atr/max(c,1e-9))*100.0)
    return out  # aligned starting at index (period)

def adr_momentum_up_down(bars: List[Dict[str,Any]], lag: int = ADR_MOMENTUM_LAG) -> tuple[int,int]:
    """Return (adrUp, adrDown) comparing latest ADR% vs ADR% lag bars ago."""
    series = adr_percent_series(bars, ADR_PERIOD)
    if len(series) < lag+1: return 0,0
    cur = series[-1]; prev = series[-1-lag]
    if cur > prev: return 1,0
    if cur < prev: return 0,1
    return 0,0

# ---------------- Per-sector builders ----------------
def build_counts_daily(symbols: List[str]) -> Dict[str,int]:
    c={"nh":0,"nl":0,"u":0,"d":0,"adrUp":0,"adrDown":0}
    for i,sym in enumerate(symbols):
        bars = fetch_daily(sym, max(ADR_LOOKBACK_DAYS, 22))[-max(22, ADR_LOOKBACK_DAYS):]
        nh,nl,u3,d3 = compute_flags_from_bars(bars[-12:])
        au,ad = adr_momentum_up_down(bars, ADR_MOMENTUM_LAG)
        c["nh"]+=nh; c["nl"]+=nl; c["u"]+=u3; c["d"]+=d3; c["adrUp"]+=au; c["adrDown"]+=ad
        if (i+1)%10==0: time.sleep(0.12)
    return c

def build_counts_hourly(symbols: List[str]) -> Dict[str,int]:
    c={"nh":0,"nl":0,"u":0,"d":0,"adrUp":0,"adrDown":0}
    for i,sym in enumerate(symbols):
        bars_h = fetch_hourly(sym, hours_back=120)[-36:]  # ~1–2 days
        nh,nl,u3,d3 = compute_flags_from_bars(bars_h[-12:])
        # ADR momentum for hourly cadence: still compute from daily bars (stable)
        bars_d = fetch_daily(sym, ADR_LOOKBACK_DAYS)[-ADR_LOOKBACK_DAYS:]
        au,ad = adr_momentum_up_down(bars_d, ADR_MOMENTUM_LAG)
        c["nh"]+=nh; c["nl"]+=nl; c["u"]+=u3; c["d"]+=d3; c["adrUp"]+=au; c["adrDown"]+=ad
        if (i+1)%10==0: time.sleep(0.10)
    return c

def build_counts_intraday10(symbols: List[str]) -> Dict[str,int]:
    """
    Intraday10: compare today's snapshot H/L/last vs prior 10-day watermarks.
    FAST PATH: no per-symbol daily ADR fetch (keeps 10m runtime <~15m).
    """
    # Keep adrUp/adrDown keys for schema stability, but we do NOT compute them here.
    c = {"nh": 0, "nl": 0, "u": 0, "d": 0, "adrUp": 0, "adrDown": 0}

    wm = watermarks_last_10d(symbols)

    # Bulk snapshots (larger batches + mild throttle are okay here)
    snaps: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(symbols), 100):  # bigger batch → fewer API calls
        batch = symbols[i:i+100]
        js = poly_json(f"{POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers",
                       {"tickers": ",".join(batch)})
        for row in js.get("tickers", []) or []:
            t = row.get("ticker")
            if t:
                snaps[t] = row
        time.sleep(0.15)

    for sym in symbols:
        H10, L10, c2, c1 = wm.get(sym, (None, None, None, None))
        s = snaps.get(sym, {}) or {}
        day = s.get("day") or {}
        last_trade = s.get("lastTrade") or {}
        last_quote = s.get("lastQuote") or {}
        day_high = day.get("h")
        day_low  = day.get("l")
        last_px  = last_trade.get("p") or last_quote.get("p")

        nh, nl, u3, d3 = compute_intraday_from_snap(H10, L10, c2, c1, day_high, day_low, last_px)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3

    return c


# ---------------- Global gauges ----------------
def compute_global_fields(universe_symbols: List[str]) -> Dict[str, Any]:
    # fuel (unchanged) — PSI on recent daily closes of SPY
    bars = fetch_daily("SPY", 120)
    closes = [b["c"] for b in bars]
    psi = compute_psi_from_closes(closes, conv=50, length=20) or 50.0
    last_up = len(closes)>=2 and (closes[-1] > closes[-2])
    if psi >= 80: state = "firingUp" if last_up else "firingDown"
    elif psi < 50: state = "on"
    else: state = "none"

    # daily squeeze PSI on daily closes of SPY
    bars_d = fetch_daily("SPY", 260)
    closes_d = [b["c"] for b in bars_d]
    psi_daily = compute_psi_from_closes(closes_d, conv=50, length=20) or 50.0

    # volatility/liquidity (SPY daily)
    vol_pct = compute_volatility_pct_SPY()
    liq_pct = compute_liquidity_pct_SPY()

    # ADR momentum (global) — tally up across universe with daily bars
    adr_up = adr_down = 0
    for i,sym in enumerate(universe_symbols):
        bars_sym = fetch_daily(sym, ADR_LOOKBACK_DAYS)[-ADR_LOOKBACK_DAYS:]
        up,down = adr_momentum_up_down(bars_sym, ADR_MOMENTUM_LAG)
        adr_up += up; adr_down += down
        if (i+1)%25==0: time.sleep(0.05)
    denom = adr_up + adr_down
    adr_momo = (adr_up/denom)*100.0 if denom>0 else 50.0

    return {
        "squeeze_pressure_pct": int(round(float(psi))),
        "squeeze_state": state,
        "daily_squeeze_pct": float(round(psi_daily, 2)),
        "volatility_pct": int(vol_pct),
        "liquidity_pct": int(liq_pct),
        "adr_momentum_pct": round(float(adr_momo), 2)
    }

def compute_volatility_pct_SPY() -> int:
    bars = fetch_daily("SPY", 160)
    if len(bars) < 40: return 50
    closes=[b["c"] for b in bars]; highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]
    # simple ATR14% percentile
    # reuse adr_percent_series to avoid duplicate math
    series = adr_percent_series(bars, ADR_PERIOD)
    if not series: return 50
    cur = series[-1]
    less = sum(1 for v in series if v <= cur)
    return max(0, min(100, int(round(100*less/len(series)))))

def compute_liquidity_pct_SPY() -> int:
    bars = fetch_daily("SPY", 70)
    if len(bars) < 21: return 70
    vols=[b["v"] for b in bars]
    avgv5  = sum(vols[-5:]) / 5.0
    avgv20 = sum(vols[-20:]) / 20.0
    if avgv20 <= 0: return 70
    ratio = (avgv5/avgv20)*100.0
    return int(round(max(0, min(120, ratio))))

# ---------------- Orchestrator ----------------
def build_groups(mode: str, sectors: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    groups={}
    for sector, symbols in sectors.items():
        uniq = list(sorted(set(symbols)))
        if mode == "daily":
            cnt = build_counts_daily(uniq)
        elif mode == "hourly":
            cnt = build_counts_hourly(uniq)
        else:
            cnt = build_counts_intraday10(uniq)
        groups[sector] = {
            "nh": cnt["nh"], "nl": cnt["nl"], "u": cnt["u"], "d": cnt["d"],
            "adrUp": cnt["adrUp"], "adrDown": cnt["adrDown"],
            "vol_state": "Mixed", "breadth_state": "Neutral", "history": {"nh": []}
        }
    return groups

def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json (intraday10/hourly/daily)")
    ap.add_argument("--mode", choices=["intraday10","hourly","daily"], default="daily")
    args = ap.parse_args()

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY (or POLYGON_API_KEY)")

    sectors = discover_sectors()
    groups = build_groups(args.mode, sectors)

    # full universe for global ADR momentum
    universe = []
    for syms in sectors.values(): universe.extend(syms)
    universe = list(sorted(set(universe)))

    global_fields = compute_global_fields(universe)

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
    print(f"[global] fuel={payload['global']['squeeze_pressure_pct']}  daily={payload['global']['daily_squeeze_pct']}  adrMomentum={payload['global']['adr_momentum_pct']}")
    for s,g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']} u={g['u']} d={g['d']} adrUp={g['adrUp']} adrDown={g['adrDown']}")

if __name__ == "__main__":
    main()
