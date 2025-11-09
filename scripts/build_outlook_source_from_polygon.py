#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (R11.1 — safe network+auth hardened)

What changed (safely, behind flags + auth fixes):
- Polygon authentication now prefers "Authorization: Bearer <POLYGON_API_KEY>" header,
  and transparently retries once with `?apiKey=` for legacy endpoints to avoid 401/403s.
- 10m "Scalper" mode (OPTIONAL): compute NH/NL/U/D from recent **10m intraday bars** instead of 10-day watermarks.
  Enable with FD_SCALPER_ENABLE=true
  • NH = C[-1] > max(H[-L:-1])  (L=FD_SCALPER_LOOKBACK, default 5)
  • NL = C[-1] < min(L[-L:-1])
  • U  = C[-3] < C[-2] < C[-1]
  • D  = C[-3] > C[-2] > C[-1]

- Hourly intraday lookback (DEFAULT): compute 1-hour counts from recent completed hourly bars
  using the same fast logic (L=FD_HOURLY_LOOKBACK, default 6).
  If today has fewer than `L` completed hours, fall back to the last `L` completed hours overall
  (fixes early-session all-zero hourly cards). Disable with FD_HOURLY_INTRADAY=false.

Everything else remains as in your R11 logic. If you don't set any flags, behavior is unchanged.
"""

from __future__ import annotations
import argparse
import csv
import json
import os
import time
import math
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple, Optional
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- TIME ZONES ----------------
PHX_TZ = ZoneInfo("America/Phoenix")
UTC    = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

# ---------------- ENV / CONFIG ----------------
POLY_KEY = (
    os.environ.get("POLY_KEY")
    or os.environ.get("POLYGON_API_KEY")
    or os.environ.get("REACT_APP_POLYGON_KEY")
)
POLY_BASE = "https://api.polygon.io"

DEFAULT_SECTORS_DIR = os.path.join("data", "sectors")
DEFAULT_OUT_PATH    = os.path.join("data", "outlook_source.json")

MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "16"))
SNAP_BATCH  = int(os.environ.get("FD_SNAPSHOT_BATCH", "250"))
SNAP_SLEEP  = float(os.environ.get("FD_SNAPSHOT_PAUSE", "0.05"))

INTRA_MINUTE_LOOKBACK_MIN = int(os.environ.get("FD_MINUTE_LOOKBACK", "180"))  # last 3h

# ==== NEW (Scalper/1h intraday) ====
FD_SCALPER_ENABLE     = os.environ.get("FD_SCALPER_ENABLE", "false").lower() in ("1","true","yes","on")
FD_SCALPER_LOOKBACK   = max(2, int(os.environ.get("FD_SCALPER_LOOKBACK", "5")))
FD_HOURLY_INTRADAY    = os.environ.get("FD_HOURLY_INTRADAY", "true").lower() in ("1","true","yes","on")
FD_HOURLY_LOOKBACK    = max(2, int(os.environ.get("FD_HOURLY_LOOKBACK", "6")))
# ===================================

# ---------------- HTTP (Header-first auth + fallback retry) ----------------
def http_get(url: str, timeout: int = 22, headers: Optional[Dict[str, str]] = None) -> str:
    req = urllib.request.Request(url)
    req.add_header("User-Agent", "ferrari-dashboard/1.0")
    req.add_header("Accept-Encoding", "gzip")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
        try:
            import gzip
            if resp.getheader("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
        except Exception:
            pass
        return data.decode("utf-8")

def poly_json(path_or_url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Robust Polygon GET:
    - Try Authorization: Bearer first (works for v3/v2).
    - If 401, retry once with `?apiKey=` (legacy).
    - Backoff/retry for 429 and 5xx. Raises on final failure.
    """
    if params is None:
        params = {}
    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY or POLYGON_API_KEY or REACT_APP_POLYGON_KEY")

    base_url = path_or_url if path_or_url.startswith("http") else f"{POLY_BASE}{path_or_url}"
    qs = urllib.parse.urlencode(params) if params else ""

    url_no_key = f"{base_url}?{qs}" if qs else base_url
    hdrs = {"Authorization": f"Bearer {POLY_KEY}"}

    for attempt in range(1, 5):
        try:
            raw = http_get(url_no_key, timeout=22, headers=hdrs)
            return json.loads(raw)

        except urllib.error.HTTPError as e:
            if e.code == 401:
                params2 = dict(params or {})
                params2["apiKey"] = POLY_KEY
                qs2 = urllib.parse.urlencode(params2)
                url_key = f"{base_url}?{qs2}" if qs2 else base_url
                raw = http_get(url_key, timeout=22, headers=None)
                return json.loads(raw)

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
def fetch_range(ticker: str, tf_kind: str, tf_val: int, start: date, end: date, limit: int = 50000, sort: str = "asc") -> List[Dict[str, Any]]:
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/{tf_val}/{tf_kind}/{dstr(start)}/{dstr(end)}"
    js = poly_json(url, {"adjusted": "true", "sort": sort, "limit": limit})
    if not js or js.get("status") != "OK":
        return []
    out: List[Dict[str, Any]] = []
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

def fetch_daily(ticker: str, days: int) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date()
    start = end - timedelta(days=days)
    return fetch_range(ticker, "day", 1, start, end, sort="asc")

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict: Any]:
    end = datetime.now(UTC).date()
    lookback_days = max(7, (hours_back // 6) + 2)
    start = end - timedelta(days=lookback_days)
    return fetch_range(ticker, "hour", 1, start, end, sort="asc")

def fetch_minutes_today(ticker: str, lookback_min: int = INTRA_MINUTE_LOOKBACK_MIN) -> List[Dict[str, Any]]:
    now_utc = datetime.now(UTC)
    start_utc = now_utc - timedelta(minutes=lookback_min)
    start = start_utc.date()
    end   = now_utc.date()
    bars = fetch_range(ticker, "minute", 1, start, end, sort="asc")
    if not bars: 
        return []
    cutoff_ms = int(start_utc.timestamp() * 1000)
    return [b for b in bars if (b.get("t") or 0) >= cutoff_ms]

# ==== NEW helpers for intraday/h1 completed buckets ====
def _today_only(bars: List[Dict[str,Any]], bucket_seconds: int) -> List[Dict[str,Any]]:
    if not bars: return []
    def tsec(b): return int(b["t"]/1000.0) if b["t"] > 10**12 else int(b["t"])
    today = datetime.now(UTC).date()
    today_bars = [b for b in bars if datetime.fromtimestamp(tsec(b), UTC).date()==today]
    if not today_bars: return []
    now = int(time.time()); curr = (now // bucket_seconds) * bucket_seconds
    last = tsec(today_bars[-1])
    if (last // bucket_seconds) * bucket_seconds == curr:
        today_bars = today_bars[:-1]
    return today_bars

def _recent_completed(bars: List[Dict[str,Any]], bucket_seconds: int, need: int) -> List[Dict[str,Any]]:
    if not bars: return []
    def tsec(b): return int(b["t"]/1000.0) if b["t"] > 10**12 else int(b["t"])
    out = list(bars)
    now = int(time.time()); curr=(now // bucket_seconds)*bucket_seconds
    if out:
        last = tsec(out[-1])
        if (last // bucket_seconds) * bucket_seconds == curr:
            out = out[:-1]
    if not out: return []
    today = datetime.now(UTC).date()
    todays = [b for b in out if datetime.fromtimestamp(tsec(b), UTC).date()==today]
    if len(todays) >= need:
        return todays[-need:]
    return out[-need:]

def _fast_flags_from_bars(bars: List[Dict[str,Any]], lookback: int) -> Tuple[int,int,int,int]:
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

# ---------------- GROUPS CSV ----------------
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

# ---------------- PER-SECTOR COMPUTATIONS (unchanged + intraday) ----------------
def compute_flags_from_bars(bars: List[Dict[str, Any]]) -> Tuple[int, int, int, int]:
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

def compute_intraday_from_snap(H10, L10, c2, c1, day_high, day_low, last_px) -> Tuple[int, int, int, int]:
    nh = int(H10 is not None and day_high is not None and day_high > H10)
    nl = int(L10 is not None and day_low  is not None and day_low  < L10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_px is not None and last_px >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_px is not None and last_px <= c1))
    return nh, nl, u3, d3

def fetch_daily_wrapper(sym: str) -> Tuple[str, List[Dict[str,Any]]]:
    return fetch_daily(sym, 22)[-12:], sym

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
            need_minute = False

            if day_high is None or day_low is None or last_px is None:
                need_minute = True

            if need_minute:
                mins = fetch_minutes_today(sym)
                if mins:
                    if day_high is None:
                        day_high = max(m["h"] for m in mins)
                    if day_low is None:
                        day_low  = min(m["l"] for m in mins)
                    last_px = mins[-1]["c"]

            nh, nl, u3, d3 = compute_intraday_from_snap(H10, L10, c2, c1, day_high, day_low, last_px)
            c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        results[sector] = c
    return results

# ==== NEW: fast 10m scalper counts (optional) ====
def build_counts_intraday10_scalper(sector_map: Dict[str, List[str]], lookback_bars: int) -> Dict[str, Dict[str,int]]:
    results: Dict[str, Dict[str, int]] = {}
    end = datetime.now(UTC).date()
    start = end - timedelta(days=2)
    for sector, symbols in sector_map.items():
        c = {"nh":0,"nl":0,"u":0,"d":0}
        uniq = sorted(set(symbols))
        for i, sym in enumerate(uniq):
            bars = fetch_range(sym, "minute", 10, start, end, sort="asc")
            bars_today = _today_only(bars, bucket_seconds=600)
            nh, nl, u3, d3 = _fast_flags_from_bars(bars_today, lookback_bars)
            c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
            if (i+1) % 25 == 0:
                time.sleep(0.02)
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

def build_counts_hourly_intraday(symbols: List[str], lookback_bars: int) -> Dict[str,int]:
    c = {"nh":0,"nl":0,"u":0,"d":0}
    end = datetime.now(UTC).date()
    start = end - timedelta(days=7)
    for i, sym in enumerate(symbols):
        all_bars = fetch_range(sym, "hour", 1, start, end, sort="asc")
        recent = _recent_completed(all_bars, bucket_seconds=3600, need=lookback_bars)
        nh, nl, u3, d3 = _fast_flags_from_bars(recent, lookback_bars)
        c["nh"] += nh; c["nl"] += nl; c["u"] += u3; c["d"] += d3
        if (i+1) % 25 == 0:
            time.sleep(0.02)
    return c

# ---------------- LUX/Vol/Global (unchanged) ----------------
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
    psi = -50.0 * r + 50
    return float(max(0.0, min(100.0, psi)))

def true_range(h: float, l: float, c_prev: float) -> float:
    return max(h - l, abs(h - c_prev), abs(l - c_prev))

def atr14_percent(closes: List[float], highs: List[float], lows: List[float]) -> Optional[float]:
    if len(closes) < 20:
        return None
    trs = [true_range(highs[i], lows[i], closes[i-1]) for i in range(1, len(closes))]
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
        sub_c = closes[:i]; sub_h = highs[:i]; sub_l = lows[:i]
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

# ---------------- ORCHESTRATOR ----------------
def build_groups(mode: str, sectors: Dict[str, List[str]]) -> Dict[str, Dict[str, Any]]:
    groups: Dict[str, Dict[str, Any]] = {}

    if mode == "intraday10":
        if FD_SCALPER_ENABLE:
            for sector, symbols in sectors.items():
                uniq = sorted(set(symbols))
                groups[sector] = build_counts_intraday10_scalper({sector: uniq}, FD_SCALPER_LOOKBACK)[sector]
            return groups
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

    for sector, symbols in sectors.items():
        uniq = list(sorted(set(symbols)))
        if mode == "daily":
            cnt = build_counts_daily(uniq)
        elif mode == "hourly":
            if FD_HOURLY_INTRADAY:
                cnt = build_counts_hourly_intraday(uniq, FD_HOURLY_LOOKBACK)
            else:
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
    global MAX_WORKERS, SNAP_BATCH, SNAP_SLEEP
    ap = argparse.ArgumentParser(description="Build outlook_source.json (intraday10/hourly/daily)")
    ap.add_argument("--mode", choices=["intraday10", "hourly", "daily"], default="daily")
    ap.add_argument("--sectors-dir", default=DEFAULT_SECTORS_DIR)
    ap.add_argument("--out", default=DEFAULT_OUT_PATH)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--snap-batch", type=int, default=None)
    ap.add_argument("--snap-sleep", type=float, default=None)
    args = ap.parse_args()

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
        "updated_at": ts_local,
        "updated_at_utc": ts_utc,
        "timestamp": ts_utc,
        "mode": args.mode,
        "groups": groups,
        "global": global_fields,
        "meta": {
            "build_secs": round(time.time() - t0, 2),
            "universe": sum(len(v) for v in sectors.values()),
            "minute_fallback": True,
            "scalper": bool(FD_SCALPER_ENABLE) if args.mode=="intraday10" else False,
            "scalper_lookback": FD_SCALPER_LOOKBACK if args.mode=="intraday10" else None,
            "hourly_intraday": bool(FD_HOURLY_INTRADAY) if args.mode=="hourly" else False,
            "hourly_lookback": FD_HOURLY_LOOKBACK if args.mode=="hourly" else None,
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
