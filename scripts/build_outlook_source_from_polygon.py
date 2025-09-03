#!/usr/bin/env python3
"""
Builds data/outlook_source.json from Polygon REST.

- Reads sector CSVs under data/sectors/{Sector}.csv
- Each CSV must have a header 'Symbol' and tickers below it
- For each ticker, fetch ~15 daily bars from Polygon
- Compute per-sector totals:
  nh = 10-day NEW HIGHS (today's HIGH > max HIGH of prior 10 sessions)
  nl = 10-day NEW LOWS  (today's LOW  < min LOW  of prior 10 sessions)
  u  = 3U (close up 3 days in a row)
  d  = 3D (close down 3 days in a row)
- Writes results to data/outlook_source.json
"""

import csv, json, os, time
from datetime import datetime, timedelta
import urllib.request, urllib.error

POLY_KEY = os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API_KEY")
SECTORS_DIR = os.path.join("data", "sectors")
OUT_PATH = os.path.join("data", "outlook_source.json")

# --- HTTP helpers ------------------------------------------------------------

def http_get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "frye-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")

def poly_json(url):
    sep = "&" if "?" in url else "?"
    if "apiKey=" not in url:
        if not POLY_KEY:
            raise SystemExit("Set POLY_KEY environment variable with your Polygon API key")
        url = f"{url}{sep}apiKey={POLY_KEY}"
    tries = 0
    while True:
        tries += 1
        try:
            txt = http_get(url)
            return json.loads(txt)
        except urllib.error.HTTPError as e:
            if e.code == 429 and tries < 5:     # rate limit
                time.sleep(1.2 * tries)
                continue
            raise
        except Exception:
            if tries < 3:
                time.sleep(0.8 * tries)
                continue
            raise

# --- Data helpers ------------------------------------------------------------

def read_symbols(path):
    syms = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        for row in r:
            s = (row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s:
                syms.append(s)
    return syms

def date_str(dt): return dt.strftime("%Y-%m-%d")

def bars_last_n_days(ticker, n_days):
    end = datetime.utcnow().date()
    start = end - timedelta(days=max(20, n_days + 5))  # buffer for weekends/holidays
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/"
        f"{date_str(start)}/{date_str(end)}?adjusted=true&sort=asc&limit=50000"
    )
    js = poly_json(url)
    if js.get("status") != "OK":
        return []
    res = []
    for r in js.get("results", []) or []:
        res.append({
            "t": int(r.get("t", 0)),
            "o": float(r.get("o", 0)),
            "h": float(r.get("h", 0)),
            "l": float(r.get("l", 0)),
            "c": float(r.get("c", 0)),
            "v": float(r.get("v", 0)),
        })
    res.sort(key=lambda x: x["t"])
    return res[-15:]

def compute_flags_from_bars(bars):
    if len(bars) < 11:
        return (False, False, False, False)

    today = bars[-1]
    prior10 = bars[-11:-1]

    max_high_10 = max(b["h"] for b in prior10)
    min_low_10  = min(b["l"] for b in prior10)
    is_10NH = today["h"] > max_high_10
    is_10NL = today["l"] < min_low_10

    last3 = bars[-3:]
    is_3U = (len(last3) == 3) and (last3[0]["c"] < last3[1]["c"] < last3[2]["c"])
    is_3D = (len(last3) == 3) and (last3[0]["c"] > last3[1]["c"] > last3[2]["c"])

    return (is_10NH, is_10NL, is_3U, is_3D)

# --- Main build --------------------------------------------------------------

def build_sector_counts(symbols):
    counts = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    for i, sym in enumerate(symbols):
        bars = bars_last_n_days(sym, 11)
        if not bars:
            continue
        nh, nl, u, d = compute_flags_from_bars(bars)
        counts["nh"] += int(nh)
        counts["nl"] += int(nl)
        counts["u"]  += int(u)
        counts["d"]  += int(d)
        if (i + 1) % 10 == 0:
            time.sleep(0.25)  # polite pause to avoid 429s
    return counts

def discover_sectors():
    if not os.path.isdir(SECTORS_DIR):
        raise SystemExit(
            f"Missing folder: {SECTORS_DIR}\n"
            "Create CSVs like data/sectors/Tech.csv with header 'Symbol'"
        )
    sectors = {}
    for name in os.listdir(SECTORS_DIR):
        if not name.lower().endswith(".csv"):
            continue
        sector = os.path.splitext(name)[0]
        path = os.path.join(SECTORS_DIR, name)
        symbols = read_symbols(path)
        if symbols:
            sectors[sector] = symbols
    if not sectors:
        raise SystemExit(f"No sector CSVs found in {SECTORS_DIR}")
    return sectors

def main():
    if not POLY_KEY:
        raise SystemExit("Set POLY_KEY environment variable with your Polygon API key")

    sectors = discover_sectors()
    total_symbols = sum(len(v) for v in sectors.values())
    print(f"[discovered] {total_symbols} symbols across {len(sectors)} sectors")

    groups = {}
    sizes = {}  # keep per-sector symbol counts for summary
    for sector, symbols in sectors.items():
        sizes[sector] = len(symbols)
        print(f"[{sector}] tickers={len(symbols)} ...")
        c = build_sector_counts(symbols)
        groups[sector] = {
            "nh": c["nh"], "nl": c["nl"], "u": c["u"], "d": c["d"],
            "vol_state": "Mixed",
            "breadth_state": "Neutral",
            "history": { "nh": [] }
        }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump({"groups": groups}, f, ensure_ascii=False, indent=2)

    print(f"[OK] wrote {OUT_PATH}")
    for s, g in groups.items():
        print(f"  {s}: nh={g['nh']} nl={g['nl']}  u={g['u']} d={g['d']}")

    # one-line sector size summary
    summary = ", ".join(f"{k}={v}" for k, v in sorted(sizes.items()))
    print(f"[summary] {summary}")
    print(f"[total] symbols={total_symbols}")

if __name__ == "__main__":
    main()
