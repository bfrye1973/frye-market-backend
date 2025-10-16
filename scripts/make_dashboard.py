#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (10-Minute Full Version)
- Computes EMA10/EMA20 (SPY & QQQ) using Polygon 10-minute bars
- Calculates Squeeze, Liquidity, and Volatility directly from SPY 10m data
- Blends sector breadth/momentum from source JSON or hourly fallback
- Writes canonical outlook_intraday.json for Frye Dashboard

Usage:
  python -u scripts/make_dashboard.py --mode intraday \
    --out data/outlook_intraday.json \
    [--source data/outlook_source.json]

Env:
  POLYGON_API_KEY  (required)
  HOURLY_URL       (optional; fallback)
    default: https://frye-market-backend-1.onrender.com/live/hourly
"""

import argparse, json, math, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------- Config ----------------------------
HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"
POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/"
    "{start}/{end}?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)
SYMS = ["SPY", "QQQ"]
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60

# ------------------------- Small helpers ------------------------
def now_iso_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

def clamp(x, lo, hi): return lo if x < lo else hi if x > hi else x
def pct(a, b): return 0.0 if not b else 100.0 * a / b

def ema_series(vals, n):
    a = 2.0 / (n + 1.0)
    e = None
    out = []
    for v in vals:
        e = v if e is None else (e + a*(v - e))
        out.append(e)
    return out

def fetch_json(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} for {url}")
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_10m(key, sym, lookback_days=4):
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_10M_URL.format(sym=sym, start=start, end=end, key=key)
    js = fetch_json(url)
    rows = js.get("results") or []
    bars = []
    for r in rows:
        t = int(r["t"]) // 1000
        bars.append({
            "time": t,
            "open": float(r["o"]),
            "high": float(r["h"]),
            "low":  float(r["l"]),
            "close":float(r["c"]),
            "volume": float(r.get("v",0.0))
        })
    # Drop any in-flight 10m bar
    BUCKET = 600
    if bars:
        now = int(time.time())
        curr_bucket = (now // BUCKET) * BUCKET
        if (bars[-1]["time"] // BUCKET) * BUCKET == curr_bucket:
            bars = bars[:-1]
    return bars

def summarize_sector_cards(cards):
    NH=NL=UP=DN=0
    for c in cards or []:
        NH += int(c.get("nh",0)); NL += int(c.get("nl",0))
        UP += int(c.get("up",0)); DN += int(c.get("down",0))
    return {"breadth_pct": pct(NH, NH+NL), "momentum_pct": pct(UP, UP+DN)}

def lin_points(percent, weight):
    return int(round(weight * ((float(percent or 0.0) - 50.0) / 50.0)))

# ------------------ Technical metric helpers -------------------
def atr14(highs, lows, closes):
    trs = [max(h - l, abs(h - c), abs(l - c)) for h, l, c in zip(highs, lows, closes)]
    a = 1/14
    e = trs[0]
    for t in trs[1:]:
        e = e * (1 - a) + a * t
    return e

def squeeze_pct(closes, highs, lows):
    n = 20
    if len(closes) < n: return 50.0
    mean = sum(closes[-n:]) / n
    sd = (sum((x - mean) ** 2 for x in closes[-n:]) / n) ** 0.5
    bw = 4 * sd  # Bollinger (2σ)
    tr14 = atr14(highs, lows, closes)
    kw = tr14 * 3.0  # Keltner (1.5×ATR×2)
    return clamp(100.0 - 100.0 * bw / kw, 0.0, 100.0)

def liquidity_pct(volumes):
    if len(volumes) < 12: return 50.0
    def ema(vals, n):
        a = 2/(n+1); e=None
        for v in vals:
            e = v if e is None else (e + a*(v - e))
        return e
    v3 = ema(volumes[-12:], 3)
    v12 = ema(volumes[-30:], 12)
    if not v12 or v12 <= 0: return 50.0
    return clamp(100.0 * (v3 / v12), 0.0, 200.0)

def volatility_pct(highs, lows, closes):
    if len(closes) < 15: return 50.0
    atr = atr14(highs, lows, closes)
    return clamp(100.0 * atr / closes[-1], 0.0, 500.0)

# ------------------------- Core builder -------------------------
def build_intraday(source_js=None, hourly_url=HOURLY_URL_DEFAULT):
    out = {}
    # ---- Load sector cards (prefer source) ----
    sector_cards = []
    if isinstance(source_js, dict):
        sector_cards = source_js.get("sectorCards") or source_js.get("outlook",{}).get("sectorCards") or []
    if not sector_cards:
        try:
            hourly = fetch_json(hourly_url)
            sector_cards = hourly.get("sectorCards") or hourly.get("sectors") or []
        except Exception:
            sector_cards = []

    sums = summarize_sector_cards(sector_cards)
    # ---- Polygon Data (EMA & metrics) ----
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY")
    if not key:
        raise RuntimeError("POLYGON_API_KEY not set")

    bars_by_sym = {sym: fetch_polygon_10m(key, sym) for sym in SYMS}
    spy_bars = bars_by_sym["SPY"]
    if len(spy_bars) < 25:
        raise RuntimeError("Not enough SPY 10m bars after sanitizer")

    closes = [b["close"] for b in spy_bars]
    highs  = [b["high"] for b in spy_bars]
    lows   = [b["low"] for b in spy_bars]
    vols   = [b["volume"] for b in spy_bars]

    ema10 = ema_series(closes, 10)
    ema20 = ema_series(closes, 20)
    e10_prev, e20_prev = ema10[-2], ema20[-2]
    e10_now,  e20_now  = ema10[-1], ema20[-1]
    px_now = closes[-1]

    if e10_prev < e20_prev and e10_now > e20_now:
        ema_cross = "bull"
    elif e10_prev > e20_prev and e10_now < e20_now:
        ema_cross = "bear"
    else:
        ema_cross = "none"

    ema_sign = 1 if e10_now > e20_now else (-1 if e10_now < e20_now else 0)
    ema10_dist_pct = 0.0 if e10_now == 0 else 100.0 * (px_now - e10_now) / e10_now
    dist_unit = clamp(ema10_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = int(round(W_EMA * (1 if ema_sign > 0 else -1) * abs(dist_unit))) if ema_sign != 0 else 0

    # ---- 10-Minute Squeeze / Liquidity / Volatility ----
    live_sq = squeeze_pct(closes, highs, lows)
    live_liq = liquidity_pct(vols)
    live_vol = volatility_pct(highs, lows, closes)

    # ---- Other Components ----
    live_mom = (source_js or {}).get("metrics", {}).get("momentum_pct", None)
    live_br  = (source_js or {}).get("metrics", {}).get("breadth_pct", None)
    if live_mom is None or live_br is None:
        live_br, live_mom = sums["breadth_pct"], sums["momentum_pct"]
    live_risk = (source_js or {}).get("intraday", {}).get("riskOn10m", {}).get("riskOnPct", 50.0)

    momentum_pts = lin_points(live_mom, W_MOM)
    breadth_pts  = lin_points(live_br,  W_BR)
    squeeze_pts  = lin_points(live_sq,  W_SQ)
    liq_pts      = lin_points(live_liq, W_LIQ)
    riskon_pts   = lin_points(live_risk, W_RISK)

    components = {
        "ema10": ema_pts,
        "momentum": momentum_pts,
        "breadth": breadth_pts,
        "squeeze": squeeze_pts,
        "liquidity": liq_pts,
        "riskOn": riskon_pts,
    }
    overall_score = int(sum(components.values()))

    if ema_sign > 0 and overall_score >= 60:
        overall_state = "bull"
    elif ema_sign < 0 and overall_score < 60:
        overall_state = "bear"
    else:
        overall_state = "neutral"

    metrics = {
        "breadth_pct": round(float(live_br or 0.0), 2),
        "momentum_pct": round(float(live_mom or 0.0), 2),
        "ema_cross": ema_cross,
        "ema10_dist_pct": round(float(ema10_dist_pct), 2),
        "ema_sign": int(ema_sign),
        "squeeze_pct": round(float(live_sq), 2),
        "liquidity_pct": round(float(live_liq), 2),
        "volatility_pct": round(float(live_vol), 2),
    }

    intraday = (source_js or {}).get("intraday", {})
    intraday.setdefault("riskOn10m", {"riskOnPct": float(live_risk or 50.0)})
    intraday.setdefault("sectorDirection10m", {"risingPct": 0.0})
    intraday["overall10m"] = {"state": overall_state, "score": int(overall_score), "components": components}

    out = {
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "updated_at_utc": now_iso_utc(),
        "timestamp": now_iso_utc(),
        "metrics": metrics,
        "intraday": intraday,
        "sectorCards": sector_cards,
    }
    return out

# ------------------------------ CLI ------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")
    ap.add_argument("--source", help="optional source json to blend metrics/sectorCards")
    ap.add_argument("--out", required=True)
    ap.add_argument("--hourly_url", default=os.environ.get("HOURLY_URL", HOURLY_URL_DEFAULT))
    args = ap.parse_args()

    source_js = None
    if args.source and os.path.isfile(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                source_js = json.load(f)
        except Exception:
            source_js = None

    out = build_intraday(source_js=source_js, hourly_url=args.hourly_url)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("[ok] wrote", args.out)
    print(
        "overall10m.state=", out["intraday"]["overall10m"]["state"],
        "score=", out["intraday"]["overall10m"]["score"],
        "ema_sign=", out["metrics"]["ema_sign"],
        "ema10_dist_pct=", out["metrics"]["ema10_dist_pct"],
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
