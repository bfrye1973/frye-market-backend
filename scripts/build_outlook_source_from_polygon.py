#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R10 — SAFE & CLEAN)

Cadences (unchanged)
- intraday10 : 10-minute workflow (snapshots vs prior 10-day watermarks, summed by sector)
- hourly     : last completed 1-hour bars (per-symbol scan)
- daily      : completed daily bars (EOD, per-symbol scan)

Global schema (unchanged so FE + other scripts keep working)
- squeeze_pressure_pct : int 0..100   (intraday PSI "fuel" proxy from DAILY SPY)
- squeeze_state        : str          ("none"|"on"|"firingUp"|"firingDown")
- daily_squeeze_pct    : float 0..100 (Lux PSI on DAILY SPY, conv=50 len=20, 2 decimals)
- volatility_pct       : int 0..100   (ATR% percentile on DAILY SPY)
- liquidity_pct        : int 0..120   (SPY 5/20d volume ratio %)

Per-sector counts (each cadence)
- nh, nl : 10-day new highs / new lows
- u, d   : 3-day up / 3-day down streaks

Notes:
- intraday10 fetches the *entire universe once* (daily watermarks + batch snapshots) — no per-sector refetches.
- hourly/daily compute per-symbol locally then sum by sector.
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple, Optional
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- TIME ZONES ----------------
PHX_TZ = ZoneInfo("America/Phoenix")  # Keep AZ-pinned timestamps for UI/replay consistency
UTC    = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

# ---------------- ENV / CONFIG (defaults preserved) ----------------
POLY_KEY = (
    os.environ.get("POLY_KEY")
    or os.environ.get("POLYGON_API_KEY")
    or os.environ.get("REACT_APP_POLYGON_KEY")
)
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

# Reasonable defaults; all overridable via CLI/env
MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "16"))
SNAP_BATCH  = int(os.environ.get("FD_SNAPSHOT_BATCH", "250"))  # Polygon max ~250 per call
SNAP_SLEEP  = float(os.environ.get("FD_SNAPSHOT_PAUSE", "0.05"))  # tiny throttle to avoid 429

# ---------------- HTTP (tight retry + gzip) ----------------
def http_get(url: str, timeout: int = 20) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ferrari-dashboard/1.0",
            "Accept-Encoding": "gzip",
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
    if params is None:
        params = {}
    if POLY_KEY:
        params["apiKey"] = POLY_KEY
    qs   = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url

    for attempt in range(1, 5):  # 4 tries total
        try:
            raw = http_get(full, timeout=22)
            return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if attempt < 4:
                time.sleep(0.35 * (1.6 ** (attempt - 1)))
                continue
            raise

# ---------------- POLYGON FETCH HELPERS ----------------
def fetch_range(
    ticker: str,
    tf_kind: str,
    tf_val: int,
    start: date,
    end: date,
    limit: int = 50000,
    sort: str = "asc",
) -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted": "true", "sort": sort, "limit": limit})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
    for r in js.get("results", []) or []:
        try:
            out.append(
                {
                    "t": int(r.get("t", 0)),  # epoch ms
                    "o": float(r.get("o", 0.0)),
                    "h": float(r.get("h", 0.0)),
                    "l": float(r.get("l", 0.0)),
                    "c": float(r.get("c", 0.0)),
                    "v": float(r.get("v", 0.0)),
                }
            )
        except Exception:
            # Skip malformed row defensively
            continue
    out.sort(key=lambda x: x["t"])
    return out

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date()
    start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end, sort="asc")

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date()
    # Ensure we cover requested hours (<= 72 default) with a small cushion
    lookback_days = max(7, (hours_back // 6) + 2)
    start = end - timedelta(days=lookback_days)
    return fetch_range(ticker, "hour", 1, start, end, sort="asc")

# ---------------- SECTORS CSV ----------------
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

# ---------------- FLAG COMPUTATIONS ----------------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
    """
    From a series of bars (daily or hourly), compute sector counters:
    - 10NH: today's high > prior 10 highs (excluding today)
    - 10NL: today's low  < prior 10 lows  (excluding today)
    - 3U:   last 3 closes strictly up
    - 3D:   last 3 closes strictly down
    """
    if len(bars) < 11:
        return 0, 0, 0, 0
    today   = bars[-1]
    prior10 = bars[-11:-1]
    if not prior10:
        return 0, 0, 0, 0

    try:
        is_10NH = int(today["h"] > max(b["h"] for b in prior10))
        is_10NL = int(today["l"] < min(b["l"] for b in prior10))
    except Exception:
        is_10NH = is_10NL = 0

    last3 = bars[-3:]
    try:
        is_3U = int(len(last3) == 3 and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"]))
        is_3D = int(len(last3) == 3 and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"]))
    except Exception:
        is_3U = is_3D = 0

    return is_10NH, is_10NL, is_3U, is_3D

def compute_intraday_from_snap(
    H10: Optional[float], L10: Optional[float],
    c2: Optional[float], c1: Optional[float],
    day_high: Optional[float], day_low: Optional[float],
    last_px: Optional[float]
) -> Tuple[int, int, int, int]:
    nh = int(H10 is not None and day_high is not None and day_high > H10)
    nl = int(L10 is not None and day_low  is not None and day_low  < L10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_px is not None and last_px >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_px is not None and last_px <= c1))
    return nh, nl, u3, d3

# ---------------- LUX PSI (SQUEEZE) ----------------
def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if not closes or len(closes) < max(5, length + 2):
        return None
    mx = mn = None
    diffs: List[float] = []
    for src in map(float, closes):
        mx = src if mx is None else max(mx - (mx - src) / conv, src)
        mn = src if mn is None else min(mn + (src - mn) / conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(math.log(span))
    n = length
    xs = list(range(n))
    win = diffs[-n:]
    if len(win) < n:
        return None
    xbar = sum(xs) / n
    ybar = sum(win) / n
    num = sum((x - xbar) * (y - ybar) for x, y in zip(xs, win))
    den = (sum((x - xbar) ** 2 for x in xs) * sum((y - ybar) ** 2 for y in win)) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0 * r + 50.0
    return float(max(0.0, min(100.0, psi)))

# ---------------- VOL / LIQ from SPY ----------------
def true_range(h: float, l: float, c_prev: float) -> float:
    return max(h - l, abs(h - c_prev), abs(l - c_prev))

def atr14_percent(closes: List[float], highs: List[float], lows: List[float]) -> Optional[float]:
    if len(closes) < 20:
        return None
    trs = [true_range(highs[i], lows[i], closes[i - 1]) for i in range(1, len(closes))]
    period = 14
    if len(trs) < period:
        return None
    atr = sum(trs[-period:]) / period
    c   = closes[-1]
    if c <= 0:
        return None
    return (atr / c) * 100.0

def volatility_pct_from_series(closes: List[float], highs: List[float], lows: List[float]) -> int:
    if len(closes) < 40:
        return 50
    history: List[float] = []
    for i in range(30, len(closes) + 1):
        sub_c = closes[:i]
        sub_h = highs[:i]
        sub_l = lows[:i]
        v = atr14_percent(sub_c, sub_h, sub_l)
        if v is not None:
            history.append(v)
    if not history:
        return 50
    cur = history[-1]
    less_equal = sum(1 for x in history if x <= cur)
    pct = int(round(100 * less_equal / len(history)))
    return max(0, min(100, pct))

def liquidity_pct_from_series(vols: List[float]) -> int:
    if len(vols) < 21:
        return 70
    avgv5  = sum(vols[-5:])  / 5.0
    avgv20 = sum(vols[-20:]) / 20.0
    if avgv20 <= 0:
        return 70
    ratio = (avgv5 / avgv20) * 100.0
    return int(round(max(0.0, min(120.0, ratio))))

# ---------------- PER-SECTOR BUILDERS ----------------
def fetch_daily_12(sym: str) -> Tuple[str, List[Dict[str, Any]]]:
    bars = fetch_daily(sym, 22)[-12:]
    return sym, bars

def watermarks_last_10d_concurrent(symbols: List[str]) -> Dict[str, Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]]:
    """
    Precompute prior 10-day H/L (excluding today) + last two closes for the entire universe.
    Returns: sym -> (H10, L10, c2, c1)
    """
    out: Dict[str, Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]] = {}
    if not symbols:
        return out
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = [ex.submit(fetch_daily_12, s) for s in symbols]
        for fut in as_completed(futs):
            sym, bars = fut.result()
            if len(bars) >= 3:
                highs = [b["h"] for b in bars]
                lows  = [b["l"] for b in bars]
                closes= [b["c"] for b in bars]
                highs_ex = highs[:-1] if len(highs) > 1 else highs
                lows_ex  = lows[:-1]  if len(lows)  > 1 else lows
                H10 = max(highs_ex[-10:]) if len(highs_ex) >= 10 else (max(highs_ex) if highs_ex else None)
                L10 = min(lows_ex[-10:])  if len(lows_ex)  >= 10 else (min(lows_ex)  if lows_ex  else None)
                out[sym] = (H10, L10, closes[-2], closes[-1])
            else:
                out[sym] = (None, None, None, None)
    return out

def batch_snapshots(symbols: List[str]) -> Dict[str, Dict[str, Any]]:
    snaps: Dict[str, Dict[str, Any]] = {}
    if not symbols:
        return snaps
    for i in range(0, len(symbols), SNAP_BATCH):
        batch = symbols[i:i + SNAP_BATCH]
        js = poly_json(
            f"{POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers",
            {"tickers": ",".join(batch)}
        )
        for row in js.get("tickers", []) or []:
            t = row.get("ticker")
            if t:
                snaps[t] = row
        time.sleep(SNAP_SLEEP)  # light throttle
    return snaps

def build_counts_intraday10_from_universe(
    sector_map: Dict[str, List[str]],
    wm: Dict[str, Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]],
    snaps: Dict[str, Dict[str, Any]],
) -> Dict[str, Dict[str, int]]:
    results: Dict[str, Dict[str, int]] = {}
    for sector, symbols in sector_map.items():
        c = {"nh": 0, "nl": 0, "u": 0, "d": 0}
        for sym in symbols:
            H10, L10, c2, c1 = wm.get(sym, (None, None, None, None))
            s = snaps.get(sym, {}) or {}
            day        = s.get("day") or {}
            last_trade = s.get("lastTrade") or {}
            last_quote = s.get("lastQuote") or {}
            day_high   = day.get("h")
            day_low    = day.get("l")
            last_px    = last_trade.get("p") or last_quote.get("p")
            nh, nl, u3, d3 = compute_intraday_from_snap(H10, L10, c2, c1, day_high, day_low, last_px)
            c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        results[sector] = c
    return results

def build_counts_daily(symbols: List[str]) -> Dict[str, int]:
    c = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    for i, sym in enumerate(symbols):
        bars = fetch_daily(sym, 22)[-12:]
        nh, nl, u3, d3 = compute_flags_from_bars(bars)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        if (i + 1) % 25 == 0:
            time.sleep(0.03)
    return c

def build_counts_hourly(symbols: List[str]) -> Dict[str, int]:
    c = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    for i, sym in enumerate(symbols):
        bars_h = fetch_hourly(sym, hours_back=120)[-12:]
        nh, nl, u3, d3 = compute_flags_from_bars(bars_h)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        if (i + 1) % 25 == 0:
            time.sleep(0.03)
    return c

# ---------------- GLOBAL FIELDS (single SPY fetch) ----------------
def compute_global_fields() -> Dict[str, Any]:
    bars = fetch_daily("SPY", 260)
    closes = [b.get("c", 0.0) for b in bars]
    highs  = [b.get("h", 0.0) for b in bars]
    lows   = [b.get("l", 0.0) for b in bars]
    vols   = [b.get("v", 0.0) for b in bars]

    psi = lux_psi_from_closes(closes, conv=50, length=20)
    if psi is None:
        psi = 50.0

    last_up = len(closes) >= 2 and (closes[-1] > closes[-2])
    if psi >= 80:
        state = "firingUp" if last_up else "firingDown"
    elif psi < 50:
        state = "on"
    else:
        state = "none"

    psi_daily = lux_psi_from_closes(closes, conv=50, length=20)
    if psi_daily is None:
        psi_daily = 50.0

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
        wm    = watermarks_last_10d_concurrent(universe)
        snaps = batch_snapshots(universe)
        counts_by_sector = build_counts_intraday10_from_universe(sectors, wm, snaps)
        for sector, cnt in counts_by_sector.items():
            groups[sector] = {
                "nh": cnt["nh"], "nl": cnt["nl"], "u": cnt["u"], "d": cnt["d"],
                "vol_state": "Mixed", "breadth_state": "Neutral", "history": {"nh": []},
            }
        return groups

    # hourly / daily (per-sector scans)
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
            "vol_state": "Mixed", "breadth_state": "Neutral", "history": {"nh": []},
        }
    return groups

# ---------------- MAIN ----------------
def main():
    # Declare globals up-front so we can override them safely based on CLI args
    global MAX_WORKERS, SNAP_BATCH, SNAP_SLEEP

    ap = argparse.ArgumentParser(description="Build outlook_source.json (intraday10/hourly/daily)")
    ap.add_argument("--mode", choices=["intraday10", "hourly", "daily"], default="daily")
    ap.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR,
                    help="Folder with sector CSVs (default: data/sectors)")
    ap.add_argument("--out", default=DEFAULT_OUT_PATH,
                    help="Destination JSON (default: data/outlook_source.json)")

    # IMPORTANT: accept None and apply overrides AFTER parsing (avoids 'used prior to global declaration')
    ap.add_argument("--workers", type=int, default=None,
                    help="Thread pool size (override env FD_MAX_WORKERS)")
    ap.add_argument("--snap-batch", type=int, default=None,
                    help="Snapshot batch size (override env FD_SNAPSHOT_BATCH)")
    ap.add_argument("--snap-sleep", type=float, default=None,
                    help="Snapshot sleep seconds (override env FD_SNAPSHOT_PAUSE)")

    args = ap.parse_args()

    # Optional overrides (keep existing env/defaults if not provided)
    if args.workers is not None:
        MAX_WORKERS = max(1, int(args.workers))
    if args.snap_batch is not None:
        SNAP_BATCH = max(1, int(args.snap_batch))
    if args.snap_sleep is not None:
        SNAP_SLEEP = max(0.0, float(args.snap_sleep))

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY or POLYGON_API_KEY or REACT_APP_POLYGON_KEY")

    t0 = time.time()

    sectors = discover_sectors(args.sectors_dir)
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
            "universe": sum(len(v) for v in sectors.values()),
        },
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[OK] wrote {args.out}")
    for s, g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']} u={g['u']} d={g['d']}")
    print(f"[timing] total build {payload['meta']['build_secs']}s")

if __name__ == "__main__":
    main()
