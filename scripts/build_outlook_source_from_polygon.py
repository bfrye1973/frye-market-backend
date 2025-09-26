#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R9 — FAST & CLEAN)

Cadences
- intraday10 : 10-minute workflow (snapshots vs prior 10-day watermarks)
- hourly     : last completed 1-hour bars
- daily      : completed daily bars (EOD)

Global (unchanged schema so FE keeps working)
- squeeze_pressure_pct : int 0..100   (intraday PSI "fuel" from daily closes)
- squeeze_state        : str           ("none"|"on"|"firingUp"|"firingDown")
- daily_squeeze_pct    : float 0..100  (Lux PSI on DAILY SPY, conv=50 len=20, 2 decimals)
- volatility_pct       : int 0..100    (ATR% percentile on DAILY SPY)
- liquidity_pct        : int 0..120    (SPY 5/20d volume ratio %)

Per-sector counts (each cadence)
- nh, nl     : 10-day new highs / new lows
- u,  d      : 3-day up / 3-day down streaks

NOTE: intraday10 is optimized to fetch the *universe once*:
  1) parallel daily bars (to compute 10-day watermarks & last two closes)
  2) batched snapshot calls (250 tickers per request)
Then sum per sector. No per-sector refetches.
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

PHX_TZ = ZoneInfo("America/Phoenix")

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()

# ---------------- ENV / CONFIG ----------------
POLY_KEY  = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
POLY_BASE = "https://api.polygon.io"

SECTORS_DIR = os.path.join("data", "sectors")
OUT_PATH    = os.path.join("data", "outlook_source.json")

# reasonable defaults for speed
MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "16"))
SNAP_BATCH  = int(os.environ.get("FD_SNAPSHOT_BATCH", "250"))  # Polygon supports 250 tickers per call

# ---------------- HTTP (tight retry) ----------------
def http_get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ferrari-dashboard/1.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        try:
            import gzip, io
            if resp.getheader("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
        except Exception:
            pass
        return data.decode("utf-8")

def poly_json(url: str, params: Dict[str, Any] | None = None) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    qs   = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    for attempt in range(1, 4):
        try:
            raw = http_get(full, timeout=25)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(0.4); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 3:
                time.sleep(0.4); continue
            raise

# ---------------- DATE / FETCH ----------------
def dstr(d: date) -> str: return d.strftime("%Y-%m-%d")

def fetch_range(ticker: str, tf_kind: str, tf_val: int,
                start: date, end: date, limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":sort,"limit":limit})
    if js.get("status") != "OK": return []
    out=[]
    for r in js.get("results", []) or []:
        out.append({"t": int(r.get("t",0)),
                    "o": float(r.get("o",0)), "h": float(r.get("h",0)),
                    "l": float(r.get("l",0)), "c": float(r.get("c",0)),
                    "v": float(r.get("v",0))})
    out.sort(key=lambda x: x["t"])
    return out

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end, sort="asc")

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict[str, Any]]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(7, hours_back // 6 + 2))
    return fetch_range(ticker, "hour", 1, start, end, sort="asc")

# ---------------- SECTORS CSV ----------------
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
        raise SystemExit(f"Missing {SECTORS_DIR}. Add CSVs like data/sectors/Tech.csv (header 'Symbol').")
    sectors={}
    for name in os.listdir(SECTORS_DIR):
        if not name.lower().endswith(".csv"): continue
        sector = os.path.splitext(name)[0]
        syms = read_symbols(os.path.join(SECTORS_DIR, name))
        if syms: sectors[sector] = syms
    if not sectors: raise SystemExit("No sector CSVs found.")
    return sectors

# ---------------- FLAGS ----------------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
    if len(bars) < 11:
        return 0, 0, 0, 0
    today   = bars[-1]
    prior10 = bars[-11:-1]
    is_10NH = int(today["h"] > max(b["h"] for b in prior10))
    is_10NL = int(today["l"] < min(b["l"] for b in prior10))
    last3 = bars[-3:]
    is_3U = int(len(last3) == 3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
    is_3D = int(len(last3) == 3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    return is_10NH, is_10NL, is_3U, is_3D

def compute_intraday_from_snap(H10,L10,c2,c1,day_high,day_low,last_px) -> Tuple[int,int,int,int]:
    nh = int(H10 is not None and day_high is not None and day_high > H10)
    nl = int(L10 is not None and day_low  is not None and day_low  < L10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_px is not None and last_px >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_px is not None and last_px <= c1))
    return nh, nl, u3, d3

# ---------------- LUX PSI (SQUEEZE) ----------------
def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> float | None:
    if not closes or len(closes) < max(5, length+2): return None
    mx = mn = None; diffs=[]
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src)/conv, src)
        mn = src if mn is None else min(mn + (src - mn)/conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(math.log(span))
    n = length; xs=list(range(n)); win=diffs[-n:]
    if len(win) < n: return None
    xbar = sum(xs)/n; ybar = sum(win)/n
    num = sum((x-xbar)*(y-ybar) for x,y in zip(xs, win))
    den = (sum((x-xbar)**2 for x in xs) * sum((y-ybar)**2 for y in win)) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0*r + 50.0
    return float(max(0.0, min(100.0, psi)))

# ---------------- VOL / LIQ from a single SPY fetch ----------------
def true_range(h,l,c_prev): return max(h-l, abs(h-c_prev), abs(l-c_prev))

def atr14_percent(closes, highs, lows):
    if len(closes) < 20: return None
    trs=[true_range(highs[i], lows[i], closes[i-1]) for i in range(1, len(closes))]
    period=14
    if len(trs) < period: return None
    atr = sum(trs[-period:]) / period
    c   = closes[-1]
    if c <= 0: return None
    return (atr / c) * 100.0

def volatility_pct_from_series(closes, highs, lows) -> int:
    if len(closes) < 40: return 50
    history=[]
    for i in range(30, len(closes)+1):
        sub_c = closes[:i]; sub_h = highs[:i]; sub_l = lows[:i]
        v = atr14_percent(sub_c, sub_h, sub_l)
        if v is not None: history.append(v)
    if not history: return 50
    cur = history[-1]
    less_equal = sum(1 for x in history if x <= cur)
    return max(0, min(100, int(round(100*less_equal/len(history)))))

def liquidity_pct_from_series(vols) -> int:
    if len(vols) < 21: return 70
    avgv5  = sum(vols[-5:])  / 5.0
    avgv20 = sum(vols[-20:]) / 20.0
    if avgv20 <= 0: return 70
    ratio = (avgv5/avgv20)*100.0
    return int(round(max(0, min(120, ratio))))

# ---------------- PER-SECTOR BUILDERS ----------------
def fetch_daily_12(sym: str) -> Tuple[str, List[Dict[str, Any]]]:
    # fetch enough for 10d watermarks & last two closes
    bars = fetch_daily(sym, 22)[-12:]
    return sym, bars

def watermarks_last_10d_concurrent(symbols: List[str]) -> Dict[str, Tuple[float|None,float|None,float|None,float|None]]:
    """
    Precompute prior 10-day H/L (excluding today) + last two closes for the entire universe.
    Returns sym -> (H10, L10, c2, c1).
    """
    out: Dict[str, Tuple[float|None,float|None,float|None,float|None]] = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = [ex.submit(fetch_daily_12, s) for s in symbols]
        for fut in as_completed(futs):
            sym, bars = fut.result()
            if len(bars) >= 3:
                highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]; closes=[b["c"] for b in bars]
                highs_ex = highs[:-1] if len(highs)>1 else highs
                lows_ex  = lows[:-1]  if len(lows) >1 else lows
                H10 = max(highs_ex[-10:]) if len(highs_ex)>=10 else (max(highs_ex) if highs_ex else None)
                L10 = min(lows_ex[-10:])  if len(lows_ex) >=10 else (min(lows_ex)  if lows_ex  else None)
                out[sym] = (H10, L10, closes[-2], closes[-1])
    return out

def batch_snapshots(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    snaps: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(symbols), SNAP_BATCH):
        batch = symbols[i:i+SNAP_BATCH]
        js = poly_json(f"{POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers",
                       {"tickers": ",".join(batch)})
        for row in js.get("tickers", []) or []:
            t = row.get("ticker")
            if t: snaps[t] = row
        time.sleep(0.05)  # light throttle
    return snaps

def build_counts_intraday10_from_universe(
    sector_map: Dict[str, List[str]],
    wm: Dict[str, Tuple[float|None,float|None,float|None,float|None]],
    snaps: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str,int]]:
    results: Dict[str, Dict[str,int]] = {}
    for sector, symbols in sector_map.items():
        c={"nh":0,"nl":0,"u":0,"d":0}
        for sym in symbols:
            H10,L10,c2,c1 = wm.get(sym, (None,None,None,None))
            s = snaps.get(sym, {}) or {}
            day  = s.get("day") or {}
            last_trade = s.get("lastTrade") or {}
            last_quote = s.get("lastQuote") or {}
            day_high   = day.get("h"); day_low = day.get("l")
            last_px    = last_trade.get("p") or last_quote.get("p")
            nh,nl,u3,d3 = compute_intraday_from_snap(H10,L10,c2,c1,day_high,day_low,last_px)
            c["nh"]+=nh; c["nl"]+=nl; c["u"]+=u3; c["d"]+=d3
        results[sector] = c
    return results

def build_counts_daily(symbols: List[str]) -> Dict[str,int]:
    c={"nh":0,"nl":0,"u":0,"d":0}
    for i,sym in enumerate(symbols):
        bars = fetch_daily(sym, 22)[-12:]
        nh,nl,u3,d3 = compute_flags_from_bars(bars)
        c["nh"]+=nh; c["nl"]+=nl; c["u"]+=u3; c["d"]+=d3
        if (i+1)%25==0: time.sleep(0.03)
    return c

def build_counts_hourly(symbols: List[str]) -> Dict[str,int]:
    c={"nh":0,"nl":0,"u":0,"d":0}
    for i,sym in enumerate(symbols):
        bars_h = fetch_hourly(sym, hours_back=120)[-12:]
        nh,nl,u3,d3 = compute_flags_from_bars(bars_h)
        c["nh"]+=nh; c["nl"]+=nl; c["u"]+=u3; c["d"]+=d3
        if (i+1)%25==0: time.sleep(0.03)
    return c

# ---------------- GLOBAL FIELDS (single SPY fetch) ----------------
def compute_global_fields() -> Dict[str, Any]:
    bars = fetch_daily("SPY", 260)   # single call reused for all globals
    if len(bars) < 40:
        closes = [b["c"] for b in bars]
        highs  = [b["h"] for b in bars]
        lows   = [b["l"] for b in bars]
        vols   = [b["v"] for b in bars]
    else:
        closes = [b["c"] for b in bars]
        highs  = [b["h"] for b in bars]
        lows   = [b["l"] for b in bars]
        vols   = [b["v"] for b in bars]

    psi = lux_psi_from_closes(closes, conv=50, length=20)
    if psi is None: psi = 50.0

    last_up = len(closes) >= 2 and (closes[-1] > closes[-2])
    if psi >= 80: state = "firingUp" if last_up else "firingDown"
    elif psi < 50: state = "on"
    else: state = "none"

    psi_daily = lux_psi_from_closes(closes, conv=50, length=20)
    if psi_daily is None: psi_daily = 50.0

    vol_pct = volatility_pct_from_series(closes, highs, lows)
    liq_pct = liquidity_pct_from_series(vols)

    return {
        "squeeze_pressure_pct": int(round(float(psi))),
        "squeeze_state": state,
        "daily_squeeze_pct": float(round(psi_daily, 2)),
        "volatility_pct": int(vol_pct),
        "liquidity_pct": int(liq_pct),
    }

# ---------------- GROUPS ORCHESTRATOR ----------------
def build_groups(mode: str, sectors: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}

    if mode == "intraday10":
        # Universe pass (one-time)
        universe = sorted(set(sym for lst in sectors.values() for sym in lst))
        wm = watermarks_last_10d_concurrent(universe)
        snaps = batch_snapshots(universe)

        counts_by_sector = build_counts_intraday10_from_universe(sectors, wm, snaps)
        for sector, cnt in counts_by_sector.items():
            groups[sector] = {
                "nh": cnt["nh"], "nl": cnt["nl"], "u": cnt["u"], "d": cnt["d"],
                "vol_state": "Mixed", "breadth_state": "Neutral", "history": {"nh": []}
            }
        return groups

    # hourly / daily fallbacks (sector-by-sector)
    for sector, symbols in sectors.items():
        uniq = list(sorted(set(symbols)))
        if mode == "daily":
            cnt = build_counts_daily(uniq)
        elif mode == "hourly":
            cnt = build_counts_hourly(uniq)
        else:
            raise SystemExit(f"Unsupported mode: {mode}")
        groups[sector] = {
            "nh": cnt["nh"], "nl": cnt["nl"], "u": cnt["u"], "d": cnt["d"],
            "vol_state": "Mixed", "breadth_state": "Neutral", "history": {"nh": []}
        }
    return groups

# ---------------- MAIN ----------------
def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json (intraday10/hourly/daily)")
    ap.add_argument("--mode", choices=["intraday10","hourly","daily"], default="daily")
    args = ap.parse_args()

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY (or POLYGON_API_KEY)")

    t0 = time.time()

    sectors = discover_sectors()
    groups  = build_groups(args.mode, sectors)
    global_fields = compute_global_fields()

    ts_utc   = now_utc_iso()
    ts_local = now_phx_iso()

    payload = {
        "updated_at": ts_local,       # AZ time for UI
        "updated_at_utc": ts_utc,     # UTC for logs/replay
        "timestamp": ts_utc,          # legacy
        "mode": args.mode,
        "groups": groups,
        "global": global_fields,
        "meta": {
            "build_secs": round(time.time() - t0, 2),
            "universe": sum(len(v) for v in sectors.values())
        }
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {OUT_PATH}")
    for s,g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']} u={g['u']} d={g['d']}")
    print(f"[timing] total build {payload['meta']['build_secs']}s")

if __name__ == "__main__":
    main()
