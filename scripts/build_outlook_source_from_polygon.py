#!/usr/bin/env python3
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py
R11.1 (safe) — includes hourly/intraday options + full helpers.

- Fully self-contained (defines watermarks_last_10d_concurrent).
- Backward compatible: if you don’t set special env flags, behavior is unchanged.
"""

from __future__ import annotations
import argparse, csv, json, os, time, math, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List, Tuple, Optional
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- TIME / ENV ----------------
# Harden timezone: prefer Phoenix, fall back to UTC if tzdata is missing.
try:
    PHX_TZ = ZoneInfo("America/Phoenix")
except Exception:
    PHX_TZ = ZoneInfo("UTC")
    print("[tz] tzdata missing or zone not found; falling back to UTC", flush=True)

UTC = timezone.utc

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()

def dstr(d: date) -> str:
    return d.strftime("%Y-%m-%d")

def choose_poly_key() -> Optional[str]:
    """Pick first available key and log WHICH variable was used (not the value)."""
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

MAX_WORKERS = int(os.environ.get("FD_MAX_WORKERS", "16"))
SNAP_BATCH  = int(os.environ.get("FD_SNAPSHOT_BATCH", "250"))
SNAP_SLEEP  = float(os.environ.get("FD_SNAPSHOT_PAUSE", "0.05"))

INTRA_MINUTE_LOOKBACK_MIN = int(os.environ.get("FD_MINUTE_LOOKBACK", "180"))  # 3h

# ---- optional fast modes (defaults OFF except hourly intraday) ----
FD_SCALPER_ENABLE   = os.environ.get("FD_SCALPER_ENABLE", "false").lower() in ("1","true","yes","on")
FD_SCALPER_LOOKBACK = max(2, int(os.environ.get("FD_SCALPER_LOOKBACK", "5")))
FD_HOURLY_INTRADAY  = os.environ.get("FD_HOURLY_INTRADAY", "true").lower() in ("1","true","yes","on")
FD_HOURLY_LOOKBACK  = max(2, int(os.environ.get("FD_HOURLY_LOOKBACK", "6")))

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
            # Bubble useful 401 immediately with clear message.
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

# ---------------- POLYGON QUERIES ----------------
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
                "t": int(r.get("t", 0)),  # may be milliseconds
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

def fetch_hourly(ticker: str, hours_back: int = 72) -> List[Dict[str, Any]]:
    end = datetime.now(UTC).date()
    lookback_days = max(7, (hours_back // 6) + 2)
    start = end - timedelta(days=lookback_days)
    return fetch_range(ticker, "hour", 1, start, end, sort="asc")

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

# ---------------- FAST HELPERS (intraday) ----------------
def _today_only(bars: List[Dict[str,Any]], bucket_seconds: int) -> List[Dict[str,Any]]:
    if not bars: return []
    def tsec(b): return int(b["t"]/1000.0) if b["t"] > 10**12 else int(b["t"])
    today = datetime.now(UTC).date()
    bs = [b for b in bars if datetime.fromtimestamp(tsec(b), UTC).date()==today]
    if not bs: return []
    now = int(time.time()); curr=(now // bucket_seconds) * bucket_seconds
    last = tsec(bs[-1])
    if (last // bucket_seconds) * bucket_seconds == curr:
        bs = bs[:-1]
    return bs

def _recent_completed(bars: List[Dict[str,Any]], bucket_seconds: int, need: int) -> List[Dict[str,Any]]:
    if not bars: return []
    def tsec(b): return int(b["t"]/1000.0) if b["t"] > 10**12 else int(b["t"])
    out = list(bars)
    now = int(time.time()); curr=(now // bucket_seconds) * bucket_seconds
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

# ---------------- SECTORS ----------------
def read_symbols(path: str) -> List[str]:
    syms: List[str] = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s: syms.append(s)
    return syms

def discover_sectors(sectors_dir: str) -> Dict[str, List[str]]:
    if not os.path.isdir(sectors_dir):
        raise SystemExit(f"Missing {sectors_dir}. Add CSVs like {sectors_dir}/Tech.csv (header 'Symbol').")
    sectors: Dict[str, List[str]] = {}
    for name in os.listdir(sectors_dir):
        if not name.lower().endswith(".csv"): continue
        sector = os.path.splitext(name)[0]
        syms = read_symbols(os.path.join(sectors_dir, name))
        if syms: sectors[sector] = syms
    if not sectors:
        raise SystemExit(f"No sector CSVs found in {sectors_dir}.")
    return sectors

# ---------------- DAILY/10-DAY FLAGS ----------------
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

def compute_intraday_from_snap(H10, L10, c2, c1, day_high, day_low, last_px) -> Tuple[int,int,int,int]:
    nh = int(H10 is not None and day_high is not None and day_high > H10)
    nl = int(L10 is not None and day_low  is not None and day_low  < L10)
    u3 = int((c1 is not None and c2 is not None and c1 > c2) and (last_px is not None and last_px >= c1))
    d3 = int((c1 is not None and c2 is not None and c1 < c2) and (last_px is not None and last_px <= c1))
    return nh, nl, u3, d3

# ---------------- PSI / VOL / LIQ (unchanged) ----------------
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
