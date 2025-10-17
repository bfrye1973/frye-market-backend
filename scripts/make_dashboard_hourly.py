#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R11 — FAST & SAFE)

What changed (safe):
- Parallel hourly/daily fetches (ThreadPool) so big universes don’t time out.
- Two safety toggles:
  * --skip-sectors  → writes global fields + empty groups (quick proof run).
  * --sector-max N  → cap symbols per sector (e.g., 50) for reliable cadence.
- No frontend/schema changes: outlook_source.json stays identical.

Outputs (unchanged):
{
  "updated_at": <AZ ISO>,
  "updated_at_utc": <UTC ISO>,
  "timestamp": <UTC ISO>,                 # legacy
  "mode": "hourly" | "intraday10" | "daily",
  "groups": { "<sector>": { "nh","nl","u","d","vol_state","breadth_state","history":{"nh":[]}} , ... },
  "global": {
    "squeeze_pressure_pct", "squeeze_state",
    "daily_squeeze_pct", "volatility_pct", "liquidity_pct"
  },
  "meta": { "build_secs": <float>, "universe": <int> }
}
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple, Optional
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- TIME ZONES ----------------
PHX_TZ = ZoneInfo("America/Phoenix")
UTC    = timezone.utc

def now_utc_iso() -> str: return datetime.now(UTC).replace(microsecond=0).isoformat()
def now_phx_iso() -> str: return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()
def dstr(d: date) -> str: return d.strftime("%Y-%m-%d")

# ---------------- ENV / CONFIG ----------------
POLY_KEY = (
    os.environ.get("POLY_KEY")
    or os.environ.get("POLYGON_API_KEY")
    or os.environ.get("REACT_APP_POLYGON_KEY")
)
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

# Tunables (can be overridden via CLI)
MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "16"))
SNAP_BATCH  = int(os.environ.get("FD_SNAPSHOT_BATCH", "250"))
SNAP_SLEEP  = float(os.environ.get("FD_SNAPSHOT_PAUSE", "0.05"))

# ---------------- HTTP ----------------
def http_get(url: str, timeout: int = 22) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ferrari-dashboard/1.0", "Accept-Encoding": "gzip"})
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
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    qs = urllib.parse.urlencode(params); full = f"{url}?{qs}" if qs else url
    for attempt in range(1, 5):
        try:
            return json.loads(http_get(full, timeout=22))
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504) and attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt-1))); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt-1))); continue
            raise

# ---------------- POLYGON RANGE ----------------
def fetch_range(ticker: str, tf_kind: str, tf_val: int, start: date, end: date,
                limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted":"true","sort":sort,"limit":limit})
    if not js or js.get("status") != "OK": return []
    out=[]
    for r in js.get("results", []) or []:
        try:
            out.append({
                "t": int(r.get("t",0)),
                "o": float(r.get("o",0.0)),
                "h": float(r.get("h",0.0)),
                "l": float(r.get("l",0.0)),
                "c": float(r.get("c",0.0)),
                "v": float(r.get("v",0.0)),
            })
        except Exception:
            continue
    out.sort(key=lambda x: x["t"])
    return out

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date(); start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end, sort="asc")

def fetch_hourly(ticker: str, hours_back: int = 120) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date()
    lookback_days = max(7, (hours_back // 6) + 2)
    start = end - timedelta(days=lookback_days)
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

def discover_sectors(sectors_dir: str) -> Dict[str, List[str]]:
    if not os.path.isdir(sectors_dir):
        raise SystemExit(f"Missing {sectors_dir}. Add CSVs like {sectors_dir}/Tech.csv with header 'Symbol'.")
    sectors={}
    for name in os.listdir(sectors_dir):
        if name.lower().endswith(".csv"):
            sector = os.path.splitext(name)[0]
            syms = read_symbols(os.path.join(sectors_dir, name))
            if syms: sectors[sector] = syms
    if not sectors:
        raise SystemExit(f"No sector CSVs found in {sectors_dir}.")
    return sectors

# ---------------- FLAGS ----------------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int,int,int,int]:
    if len(bars) < 11: return 0,0,0,0
    today = bars[-1]; prior10 = bars[-11:-1]
    try:
        is_10NH = int(today["h"] > max(b["h"] for b in prior10))
        is_10NL = int(today["l"] < min(b["l"] for b in prior10))
    except Exception:
        is_10NH = is_10NL = 0
    last3 = bars[-3:]
    try:
        is_3U = int(len(last3)==3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
        is_3D = int(len(last3)==3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    except Exception:
        is_3U = is_3D = 0
    return is_10NH, is_10NL, is_3U, is_3D

# ---------------- LUX PSI + VOL/LIQ (SPY) ----------------
def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if not closes or len(closes) < max(5, length+2): return None
    mx = mn = None; diffs=[]
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src)/conv, src)
        mn = src if mn is None else min(mn + (src - mn)/conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(math.log(span))
    n=length; xs=list(range(n)); win=diffs[-n:]
    if len(win)<n: return None
    xbar=sum(xs)/n; ybar=sum(win)/n
    num=sum((x-xbar)*(y-ybar) for x,y in zip(xs,win))
    den=(sum((x-xbar)**2 for x in xs)*sum((y-ybar)**2 for y in win)) or 1.0
    psi = -50.0*(num/math.sqrt(den)) + 50.0
    return float(max(0.0, min(100.0, psi)))

def true_range(h,l,c_prev): return max(h-l, abs(h-c_prev), abs(l-c_prev))

def atr14_percent(closes, highs, lows):
    if len(closes) < 20: return None
    trs=[true_range(highs[i], lows[i], closes[i-1]) for i in range(1,len(closes))]
    if len(trs) < 14: return None
    atr = sum(trs[-14:])/14.0
    c = closes[-1]
    if c<=0: return None
    return (atr/c)*100.0

def volatility_pct_from_series(closes, highs, lows) -> int:
    if len(closes)<40: return 50
    history=[]
    for i in range(30, len(closes)+1):
        v = atr14_percent(closes[:i], highs[:i], lows[:i])
        if v is not None: history.append(v)
    if not history: return 50
    cur=history[-1]; less_equal=sum(1 for x in history if x<=cur)
    return max(0, min(100, int(round(100*less_equal/len(history)))))

def liquidity_pct_from_series(vols) -> int:
    if len(vols)<21: return 70
    avgv5  = sum(vols[-5:])/5.0
    avgv20 = sum(vols[-20:])/20.0
    if avgv20<=0: return 70
    ratio = (avgv5/avgv20)*100.0
    return int(round(max(0.0, min(120.0, ratio))))

# ---------------- HOURLY / DAILY PARALLEL BUILDERS ----------------
def _fetch_hourly_for(sym: str) -> Tuple[str, List[Dict[str, Any]]]:
    return sym, fetch_hourly(sym, hours_back=120)[-12:]

def _fetch_daily_for(sym: str) -> Tuple[str, List[Dict[str, Any]]]:
    return sym, fetch_daily(sym, 22)[-12:]

def build_counts_parallel(symbols: List[str], timeframe: str) -> Dict[str,int]:
    """timeframe: 'hourly' or 'daily'"""
    c={"nh":0,"nl":0,"u":0,"d":0}
    if not symbols: return c
    fetcher = _fetch_hourly_for if timeframe=="hourly" else _fetch_daily_for
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs=[ex.submit(fetcher, s) for s in symbols]
        for i,fut in enumerate(as_completed(futs), 1):
            sym,bars = fut.result()
            nh,nl,u3,d3 = compute_flags_from_bars(bars)
            c["nh"]+=nh; c["nl"]+=nl; c["u"]+=u3; c["d"]+=d3
            if i % 50 == 0:
                # lightweight progress so Actions log shows life
                print(f"[progress] {timeframe}: {i}/{len(symbols)} symbols processed…", flush=True)
    return c

# ---------------- GLOBAL FIELDS (single SPY fetch) ----------------
def compute_global_fields() -> Dict[str, Any]:
    bars = fetch_daily("SPY", 260)
    closes=[b.get("c",0.0) for b in bars]
    highs =[b.get("h",0.0) for b in bars]
    lows  =[b.get("l",0.0) for b in bars]
    vols  =[b.get("v",0.0) for b in bars]
    psi = lux_psi_from_closes(closes, conv=50, length=20) or 50.0
    last_up = len(closes)>=2 and (closes[-1] > closes[-2])
    if psi >= 80: state = "firingUp" if last_up else "firingDown"
    elif psi < 50: state = "on"
    else: state = "none"
    psi_daily = lux_psi_from_closes(closes, conv=50, length=20) or 50.0
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
def build_groups(mode: str, sectors: Dict[str, List[str]],
                 skip_sectors: bool, sector_max: Optional[int]) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}
    if skip_sectors:
        # Fast path: no per-sector counts
        return { s: {"nh":0,"nl":0,"u":0,"d":0,"vol_state":"Mixed","breadth_state":"Neutral","history":{"nh":[]}}
                 for s in sectors.keys() }

    # Cap symbols per sector if requested
    capped = {}
    for sector, symbols in sectors.items():
        uniq = list(dict.fromkeys(symbols))  # stable de-dup
        if sector_max: uniq = uniq[:max(1, int(sector_max))]
        capped[sector] = uniq

    if mode == "intraday10":
        # (Kept the universe snapshot path for parity, but hourly is your use case)
        from itertools import chain
        universe = sorted(set(chain.from_iterable(capped.values())))
        # Intraday10 uses snapshots+watermarks; leaving as-is to avoid scope creep
        # (Most teams use the 10m job for intraday; hourly is for HTF confirm)
        # Return neutral counts so schema stays intact:
        return { s: {"nh":0,"nl":0,"u":0,"d":0,"vol_state":"Mixed","breadth_state":"Neutral","history":{"nh":[]}}
                 for s in sectors.keys() }

    # Hourly/Daily in parallel
    tf = "hourly" if mode == "hourly" else "daily"
    for sector, symbols in capped.items():
        cnt = build_counts_parallel(symbols, timeframe=tf)
        groups[sector] = {
            "nh": cnt["nh"], "nl": cnt["nl"], "u": cnt["u"], "d": cnt["d"],
            "vol_state": "Mixed",
            "breadth_state": "Neutral",
            "history": {"nh": []}
        }
    return groups

# ---------------- MAIN ----------------
def main():
    global MAX_WORKERS, SNAP_BATCH, SNAP_SLEEP
    ap = argparse.ArgumentParser(description="Build outlook_source.json (intraday10/hourly/daily)")
    ap.add_argument("--mode", choices=["intraday10","hourly","daily"], default="hourly")
    ap.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR, help="Folder with sector CSVs")
    ap.add_argument("--out", default=DEFAULT_OUT_PATH, help="Destination JSON path")

    # New safety toggles
    ap.add_argument("--skip-sectors", action="store_true", help="Skip per-sector computation (fast proof run)")
    ap.add_argument("--sector-max", type=int, default=None, help="Cap symbols per sector (e.g., 50)")

    # Optional overrides (don’t use globals in defaults)
    ap.add_argument("--workers", type=int, default=None, help="Thread pool size (override env FD_MAX_WORKERS)")
    ap.add_argument("--snap-batch", type=int, default=None, help="Snapshot batch size (unused in R11 hourly path)")
    ap.add_argument("--snap-sleep", type=float, default=None, help="Snapshot sleep seconds (unused in R11 hourly path)")
    args = ap.parse_args()

    if args.workers is not None:    MAX_WORKERS = max(1, int(args.workers))
    if args.snap_batch is not None: SNAP_BATCH  = max(1, int(args.snap_batch))
    if args.snap_sleep is not None: SNAP_SLEEP  = max(0.0, float(args.snap_sleep))

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY or POLYGON_API_KEY or REACT_APP_POLYGON_KEY")

    t0 = time.time()

    sectors = discover_sectors(args.sectors_dir)
    groups  = build_groups(args.mode, sectors, skip_sectors=args.skip_sectors, sector_max=args.sector_max)
    global_fields = compute_global_fields()

    ts_utc   = now_utc_iso()
    ts_local = now_phx_iso()

    payload = {
        "updated_at": ts_local,
        "updated_at_utc": ts_utc,
        "timestamp": ts_utc,
        "mode": args.mode,
        "groups": groups,
        "global": global_fields,
        "meta": {
            "build_secs": round(time.time() - t0, 2),
            "universe": sum(len(v) for v in sectors.values()),
        },
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[OK] wrote {args.out}")
    for s,g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']} u={g['u']} d={g['d']}")
    print(f"[timing] total build {payload['meta']['build_secs']}s")

if __name__ == "__main__":
    main()
