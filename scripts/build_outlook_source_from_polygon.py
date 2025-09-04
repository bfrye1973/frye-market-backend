#!/usr/bin/env python3
"""
Builds data/outlook_source.json from Polygon REST and appends today's snapshot to data/history.json.

Adds --mode intraday:
- Uses daily bars to compute 10-day watermarks (exclude today)
- Uses Polygon bulk snapshots for today-so-far (day high/low, last price)
- Computes per-sector NH / NL / 3U / 3D intraday

Keeps existing behavior for --mode daily.

Inputs:
- CSVs under data/sectors/{Sector}.csv (header must be 'Symbol')

Outputs (unchanged schema):
- data/outlook_source.json:
  {
    "groups": { "<Sector>": { nh, nl, u, d, ... }, ... },
    "global": { squeeze_pressure_pct, squeeze_state, volatility_pct, liquidity_pct }
  }
- Appends compact snapshot to data/history.json (last 60 days)
"""

import csv, json, os, time, math, argparse
from math import log
from datetime import datetime, timedelta, timezone
import urllib.request, urllib.error, urllib.parse

POLY_KEY   = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
SECTORS_DIR= os.path.join("data", "sectors")
OUT_PATH   = os.path.join("data", "outlook_source.json")
HIST_PATH  = os.path.join("data", "history.json")
POLY_BASE  = "https://api.polygon.io"

# ---------------- HTTP / Polygon helpers ----------------
def http_get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "frye-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url, params=None, retries=3, backoff=1.0):
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}" if qs else url
    tries = 0
    while True:
        tries += 1
        try:
            txt = http_get(full)
            return json.loads(txt)
        except urllib.error.HTTPError as e:
            if e.code == 429 and tries <= retries:
                time.sleep(backoff * tries)
                continue
            raise
        except Exception:
            if tries <= retries:
                time.sleep(backoff * tries)
                continue
            raise

def fetch_range_daily(ticker, start_date, end_date):
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start_date}/{end_date}"
    js = poly_json(url, {"adjusted":"true","sort":"asc","limit":50000})
    if js.get("status") != "OK": return []
    out = []
    for r in js.get("results", []) or []:
        out.append({
            "t": int(r.get("t", 0)),
            "o": float(r.get("o", 0)),
            "h": float(r.get("h", 0)),
            "l": float(r.get("l", 0)),
            "c": float(r.get("c", 0)),
            "v": float(r.get("v", 0)),
        })
    out.sort(key=lambda x: x["t"])
    return out

def bulk_snapshots(tickers):
    """/v2/snapshot/locale/us/markets/stocks/tickers?tickers=..."""
    out = {}
    if not tickers: return out
    for i in range(0, len(tickers), 50):
        batch = tickers[i:i+50]
        url = f"{POLY_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
        js = poly_json(url, {"tickers": ",".join(batch)})
        for t in js.get("tickers", []) or []:
            sym = t.get("ticker")
            if sym: out[sym] = t
        time.sleep(0.35)  # polite
    return out

def date_str(dt): return dt.strftime("%Y-%m-%d")

def bars_last_n_days(ticker, n_days):
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(20, n_days + 5))
    return fetch_range_daily(ticker, date_str(start), date_str(end))[-15:]  # keep last ~15 sessions

# ---------------- CSV / Sectors ----------------
def read_symbols(path):
    syms = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s: syms.append(s)
    return syms

def discover_sectors():
    if not os.path.isdir(SECTORS_DIR):
        raise SystemExit(f"Missing folder: {SECTORS_DIR}\nCreate CSVs like data/sectors/Tech.csv with header 'Symbol'")
    sectors = {}
    for name in os.listdir(SECTORS_DIR):
        if not name.lower().endswith(".csv"): continue
        sector = os.path.splitext(name)[0]
        path = os.path.join(SECTORS_DIR, name)
        symbols = read_symbols(path)
        if symbols: sectors[sector] = symbols
    if not sectors:
        raise SystemExit(f"No sector CSVs found in {SECTORS_DIR}")
    return sectors

# ---------------- Per-symbol flags ----------------
def compute_flags_from_bars(bars):
    """
    EOD flags from completed daily bars.
    Returns (is_10NH, is_10NL, is_3U, is_3D)
    """
    if len(bars) < 11: return (False, False, False, False)
    today   = bars[-1]
    prior10 = bars[-11:-1]
    max_high_10 = max(b["h"] for b in prior10)
    min_low_10  = min(b["l"] for b in prior10)
    is_10NH = today["h"] > max_high_10
    is_10NL = today["l"] < min_low_10
    last3 = bars[-3:]
    is_3U = (len(last3) == 3) and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"])
    is_3D = (len(last3) == 3) and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"])
    return (is_10NH, is_10NL, is_3U, is_3D)

def compute_intraday_flags(h10, l10, c_2, c_1, day_high, day_low, last_price):
    """
    Intraday flags using watermarks and today-so-far:
      10NH: day_high_so_far > H10
      10NL: day_low_so_far  < L10
      3U  : c1 > c2 AND last_price >= c1
      3D  : c1 < c2 AND last_price <= c1
    Returns (nh, nl, u3, d3)
    """
    nh = int(h10 is not None and day_high is not None and day_high > h10)
    nl = int(l10 is not None and day_low  is not None and day_low  < l10)
    u3 = int((c_1 is not None and c_2 is not None and c_1 > c_2) and (last_price is not None and last_price >= c_1))
    d3 = int((c_1 is not None and c_2 is not None and c_1 < c_2) and (last_price is not None and last_price <= c_1))
    return nh, nl, u3, d3

def build_sector_counts_daily(symbols):
    counts = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    for i, sym in enumerate(symbols):
        bars = bars_last_n_days(sym, 11)
        if not bars: continue
        nh, nl, u, d = compute_flags_from_bars(bars)
        counts["nh"] += int(nh)
        counts["nl"] += int(nl)
        counts["u"]  += int(u)
        counts["d"]  += int(d)
        if (i + 1) % 10 == 0:
            time.sleep(0.25)
    return counts

def precompute_watermarks(symbols):
    """Return dict: sym -> (H10, L10, c_2, c_1) from completed daily bars (exclude today)."""
    out = {}
    for i, sym in enumerate(symbols):
        bars = bars_last_n_days(sym, 12)
        if len(bars) >= 3:
            highs = [b["h"] for b in bars]
            lows  = [b["l"] for b in bars]
            closes= [b["c"] for b in bars]
            highs_ex = highs[:-1] if len(highs) > 1 else highs
            lows_ex  = lows[:-1]  if len(lows)  > 1 else lows
            if len(highs_ex) >= 10 and len(lows_ex) >= 10:
                H10 = max(highs_ex[-10:])
                L10 = min(lows_ex[-10:])
            else:
                H10 = max(highs_ex) if highs_ex else None
                L10 = min(lows_ex)  if lows_ex  else None
            c_1 = closes[-1]
            c_2 = closes[-2]
            out[sym] = (H10, L10, c_2, c_1)
        if (i + 1) % 20 == 0:
            time.sleep(0.15)
    return out

def build_sector_counts_intraday(symbols, wm_cache, snapshots):
    counts = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    for sym in symbols:
        H10, L10, c_2, c_1 = wm_cache.get(sym, (None, None, None, None))
        snap = snapshots.get(sym, {})
        day = snap.get("day") or {}
        last_trade = snap.get("lastTrade") or {}
        last_quote = snap.get("lastQuote") or {}
        day_high   = day.get("h")
        day_low    = day.get("l")
        last_price = last_trade.get("p") or last_quote.get("p")
        nh, nl, u3, d3 = compute_intraday_flags(H10, L10, c_2, c_1, day_high, day_low, last_price)
        counts["nh"] += nh; counts["nl"] += nl; counts["u"] += u3; counts["d"] += d3
    return counts

# ---------------- History helpers ----------------
def load_history():
    if not os.path.exists(HIST_PATH):
        return {"days": []}
    with open(HIST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

def save_history(hist):
    os.makedirs(os.path.dirname(HIST_PATH), exist_ok=True)
    with open(HIST_PATH, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=2)

# ---------------- LuxAlgo Squeeze (PSI) ----------------
def compute_psi_from_closes(closes, conv=50, length=20):
    if len(closes) < max(5, length + 2): return None
    mx = None; mn = None; diffs = []
    for src in closes:
        if mx is None: mx = src
        if mn is None: mn = src
        mx = max(src, mx - (mx - src) / conv)
        mn = min(src, mn + (src - mn) / conv)
        span = max(mx - mn, 1e-12)
        diffs.append(log(span))
    n = length
    if len(diffs) < n: return None
    xs = list(range(n))
    xbar = sum(xs)/n
    ybar = sum(diffs[-n:])/n
    num = sum((x - xbar)*(y - ybar) for x, y in zip(xs, diffs[-n:]))
    den = sum((x - xbar)**2 for x in xs) * sum((y - ybar)**2 for y in diffs[-n:]) or 1.0
    r = num / math.sqrt(den)
    psi = -50.0 * r + 50.0
    return float(max(0.0, min(100.0, psi)))

def compute_squeeze_fields(ticker="SPY", conv=50, length=20):
    end = datetime.utcnow().date()
    start = end - timedelta(days=90)
    bars = fetch_range_daily(ticker, date_str(start), date_str(end))
    closes = [b["c"] for b in bars]
    psi = compute_psi_from_closes(closes, conv=conv, length=length)
    if psi is None:
        return {"squeeze_pressure_pct": 50, "squeeze_state": "none"}
    last_up = len(closes) >= 2 and (closes[-1] > closes[-2])
    if psi >= 80:
        state = "firingUp" if last_up else "firingDown"
    elif psi < 50:
        state = "on"
    else:
        state = "none"
    return {"squeeze_pressure_pct": int(round(psi)), "squeeze_state": state}

# ---------------- Volatility (ATR14% percentile) ----------------
def compute_atr14_percent(closes, highs, lows):
    n = len(closes)
    if n < 20: return None
    trs = []
    for i in range(1, n):
        tr = max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1]))
        trs.append(tr)
    period = 14
    if len(trs) < period: return None
    atr = sum(trs[:period]) / period
    for x in trs[period:]:
        atr = (atr * (period - 1) + x) / period
    c = closes[-1]
    if c <= 0: return None
    return (atr / c) * 100.0

def percentile_rank(values, value):
    if not values: return 50
    less = sum(1 for v in values if v <= value)
    return round(100 * less / len(values))

def compute_volatility_pct(ticker="SPY"):
    end = datetime.utcnow().date()
    start = end - timedelta(days=140)
    bars = fetch_range_daily(ticker, date_str(start), date_str(end))
    if len(bars) < 30:
        return 50
    closes = [b["c"] for b in bars]
    highs  = [b["h"] for b in bars]
    lows   = [b["l"] for b in bars]
    atrp_series = []
    for i in range(20, len(bars)+1):
        atrp = compute_atr14_percent(closes[:i], highs[:i], lows[:i])
        if atrp is not None: atrp_series.append(atrp)
    if not atrp_series:
        return 50
    current_atrp = atrp_series[-1]
    vol_pct = percentile_rank(atrp_series, current_atrp)
    return int(max(0, min(100, vol_pct)))

# ---------------- Liquidity (5d vs 20d volume) -> 0..120 PSI ----------------
def compute_liquidity_pct(ticker="SPY"):
    end = datetime.utcnow().date()
    start = end - timedelta(days=60)
    bars = fetch_range_daily(ticker, date_str(start), date_str(end))
    if len(bars) < 20: return 70
    vols = [b["v"] for b in bars]
    avgv5  = sum(vols[-5:])  / 5
    avgv20 = sum(vols[-20:]) / 20
    if avgv20 <= 0: return 70
    ratio = (avgv5 / avgv20) * 100.0  # percentage
    psi   = int(round(max(0, min(120, ratio))))  # clamp to 0..120
    return psi

# ---------------- Main ----------------
def main():
    ap = argparse.ArgumentParser(description="Build outlook_source.json (daily or intraday)")
    ap.add_argument("--mode", choices=["daily","intraday"], default="daily")
    args = ap.parse_args()

    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY (or POLYGON_API_KEY) with your Polygon API key")

    sectors = discover_sectors()
    total_symbols = sum(len(v) for v in sectors.values())
    print(f"[discovered] {total_symbols} symbols across {len(sectors)} sectors (mode={args.mode})")

    groups = {}
    sizes  = {}

    if args.mode == "daily":
        # Original behavior using completed daily bars
        for sector, symbols in sectors.items():
            sizes[sector] = len(symbols)
            print(f"[{sector}] tickers={len(symbols)} (daily)...")
            c = build_sector_counts_daily(symbols)
            groups[sector] = {
                "nh": c["nh"], "nl": c["nl"], "u": c["u"], "d": c["d"],
                "vol_state": "Mixed", "breadth_state": "Neutral",
                "history": { "nh": [] }
            }

    else:
        # Intraday: use daily bars to get watermarks, then snapshots to evaluate today-so-far
        # Precompute once for the whole universe
        all_syms = sorted({s for arr in sectors.values() for s in arr})
        print(f"[intraday] precomputing watermarks for {len(all_syms)} symbols…")
        wm = precompute_watermarks(all_syms)

        print("[intraday] fetching snapshots…")
        snaps = {}
        # batch snapshots to reduce memory/latency
        for i in range(0, len(all_syms), 200):
            part = all_syms[i:i+200]
            snaps.update(bulk_snapshots(part))

        for sector, symbols in sectors.items():
            sizes[sector] = len(symbols)
            print(f"[{sector}] tickers={len(symbols)} (intraday)…")
            c = build_sector_counts_intraday(symbols, wm_cache=wm, snapshots=snaps)
            groups[sector] = {
                "nh": c["nh"], "nl": c["nl"], "u": c["u"], "d": c["d"],
                "vol_state": "Mixed", "breadth_state": "Neutral",
                "history": { "nh": [] }
            }

    # Global fields (SPY): squeeze PSI, volatility pct, liquidity psi
    squeeze_fields = compute_squeeze_fields("SPY", conv=50, length=20)
    vol_pct        = compute_volatility_pct("SPY")
    liq_psi        = compute_liquidity_pct("SPY")

    # Write outlook_source.json  (global consumed by make_dashboard.py)
    payload = {
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "mode": args.mode,
        "groups": groups,
        "global": {
            **squeeze_fields,
            "volatility_pct": vol_pct,   # 0..100 -> Water Temp
            "liquidity_pct":  liq_psi    # 0..120 -> Oil PSI
        }
    }
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {OUT_PATH}")

    for s, g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']}  u={g['u']} d={g['d']}")
    summary = ", ".join(f"{k}={v}" for k, v in sorted(sizes.items()))
    print(f"[summary] {summary}")
    print(f"[squeeze] psi%={squeeze_fields['squeeze_pressure_pct']} state={squeeze_fields['squeeze_state']}")
    print(f"[volatility] pct={vol_pct}")
    print(f"[liquidity] psi={liq_psi}")

    # Append today's snapshot to history.json (same behavior)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snap  = { s: {"nh": g["nh"], "nl": g["nl"], "u": g["u"], "d": g["d"]} for s, g in groups.items() }
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
