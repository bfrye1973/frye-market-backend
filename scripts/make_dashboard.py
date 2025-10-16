#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (10m-pure metrics)

What this script does
- Fetches SPY & QQQ 10-minute bars from Polygon (closed bars only; drops the in-flight bar)
- Computes:
    • EMA10 / EMA20, ema_cross, ema_sign, ema10_dist_pct (SPY drives overall light)
    • Squeeze %  (pure 10m): Bollinger(20,2) width vs Keltner(20,1.5 ATR) width
    • Liquidity % (pure 10m): EMA(volume, HL=3) / EMA(volume, HL=12) × 100
    • Volatility % (pure 10m): ATR(14, Wilder) smoothed (HL=3) / price × 100
- Builds Overall Market Light:
    Green  if EMA10 > EMA20 AND score ≥ 60
    Red    if EMA10 < EMA20 AND score <  60
    Neutral otherwise
- Optionally blends breadth/momentum from a provided --source JSON (if present).
  If not provided, those two default to neutral (50).

Usage:
  python -u scripts/make_dashboard.py --mode intraday --out data/outlook_intraday.json
Optional:
  --source <path-to-json>   # if you already have sectorCards/metrics to blend

Env (required):
  POLYGON_API_KEY
"""

import argparse, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------- Config ----------------------------
POLY_10M_URL = (
  "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
  "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

SYMS = ["SPY", "QQQ"]          # SPY drives the Overall Light; QQQ included for parity/logs
# Score weights
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60           # % distance for full ±40 EMA points

# ------------------------- Helpers -------------------------
def now_iso_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")

def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x

def pct(a, b):
    return 0.0 if not b else 100.0 * a / b

def fetch_json(url, timeout=30, headers=None):
    req = urllib.request.Request(
        url,
        headers=headers or {"User-Agent": "make-dashboard/1.0", "Cache-Control": "no-store"},
    )
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
        t = int(r["t"]) // 1000  # ms -> s
        bars.append({
            "time": t,
            "open": float(r["o"]),
            "high": float(r["h"]),
            "low":  float(r["l"]),
            "close":float(r["c"]),
            "volume": float(r.get("v", 0.0)),
        })
    # Drop any in-flight 10m bar (ensure CLOSED only)
    if bars:
        BUCKET = 600
        now = int(time.time())
        curr_bucket = (now // BUCKET) * BUCKET
        if (bars[-1]["time"] // BUCKET) * BUCKET == curr_bucket:
            bars = bars[:-1]
    return bars

# -------------------- Indicators (10m-pure) --------------------
def ema_series(vals, n):
    """Standard EMA (alpha=2/(n+1)) for a full series."""
    a = 2.0 / (n + 1.0)
    e = None
    out = []
    for v in vals:
        e = v if e is None else (e + a * (v - e))
        out.append(e)
    return out

def ema_hl_series(vals, hl):
    """Half-life EMA: alpha = 1 - 0.5**(1/hl)."""
    if hl is None or hl <= 0:
        return list(vals)
    a = 1.0 - pow(0.5, 1.0 / hl)
    e = None
    out = []
    for v in vals:
        e = v if e is None else (e + a * (v - e))
        out.append(e)
    return out

def wilder_rma(vals, n):
    """Wilder's RMA used for ATR. First value = SMA, then recursive smooth."""
    out = []
    if not vals:
        return out
    # seed with SMA
    n = int(n)
    s = sum(vals[:n]) / max(n, 1) if len(vals) >= n else sum(vals) / max(len(vals), 1)
    out.append(s)
    alpha = 1.0 / max(n, 1)
    for i in range(1, len(vals)):
        s = (out[-1] * (1 - alpha)) + (vals[i] * alpha)
        out.append(s)
    return out

def true_range_series(highs, lows, closes):
    out = []
    prev_c = None
    for h, l, c in zip(highs, lows, closes):
        if prev_c is None:
            tr = h - l
        else:
            tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        out.append(tr)
        prev_c = c
    return out

def bollinger_width(closes, n=20, k=2.0):
    if len(closes) < n:
        return None
    # rolling mean/std over last n only (use final window)
    win = closes[-n:]
    mean = sum(win) / n
    var = sum((x - mean) ** 2 for x in win) / n
    sd = var ** 0.5
    upper = mean + k * sd
    lower = mean - k * sd
    return max(0.0, upper - lower)  # width

def keltner_width(closes, highs, lows, n=20, atr_mult=1.5):
    if len(closes) < n or len(highs) < n or len(lows) < n:
        return None
    trs = true_range_series(highs, lows, closes)
    atr = wilder_rma(trs, n)[-1]  # ATR(n), Wilder
    if atr is None:
        return None
    ema_mid = ema_series(closes, n)[-1]  # middle line (EMA n)
    upper = ema_mid + atr_mult * atr
    lower = ema_mid - atr_mult * atr
    return max(0.0, upper - lower)  # width

def squeeze_pct_10m(closes, highs, lows):
    """100 when BB(20,2) << KC(20,1.5), 0 when BB >= KC."""
    bw = bollinger_width(closes, n=20, k=2.0)
    kw = keltner_width(closes, highs, lows, n=20, atr_mult=1.5)
    if bw is None or kw is None or kw == 0:
        return 50.0  # neutral when insufficient history
    ratio = bw / kw
    # Compression → ratio << 1. Map to 100..0 with clamp.
    comp = clamp(100.0 - 100.0 * ratio, 0.0, 100.0)
    return comp

def liquidity_pct_10m(volumes):
    """EMA(vol, HL=3) / EMA(vol, HL=12) × 100."""
    if len(volumes) < 12:
        return 50.0
    v3 = ema_hl_series(volumes, hl=3.0)[-1]
    v12 = ema_hl_series(volumes, hl=12.0)[-1]
    if v12 <= 0:
        return 50.0
    return clamp(100.0 * (v3 / v12), 0.0, 200.0)  # cap to 200 for safety

def volatility_pct_10m(highs, lows, closes):
    """ATR14 (Wilder) smoothed with HL=3, divided by price × 100."""
    if len(closes) < 15:
        return 50.0
    trs = true_range_series(highs, lows, closes)
    atr14 = wilder_rma(trs, 14)[-1]
    atr_react = ema_hl_series([atr14], hl=3.0)[-1] if atr14 is not None else None
    px = closes[-1]
    if not atr_react or px <= 0:
        return 50.0
    return clamp(100.0 * (atr_react / px), 0.0, 500.0)

def lin_points(percent, weight):
    # 50% -> 0; 100% -> +weight; 0% -> -weight
    return int(round(weight * ((float(percent or 0.0) - 50.0) / 50.0)))

# ------------------------- Core builder -------------------------
def build_intraday(source_js=None):
    """
    Returns a dict suitable for outlook_intraday.json
    (All metrics computed from 10m Polygon bars except breadth/momentum,
     which are taken from source if provided, else neutral 50.)
    """
    # Optional: carry sectorCards/breadth/momentum if you passed --source
    sector_cards = []
    live_mom = None
    live_br  = None
    if isinstance(source_js, dict):
        sector_cards = source_js.get("sectorCards") or source_js.get("outlook",{}).get("sectorCards") or []
        live_mom = (source_js or {}).get("metrics",{}).get("momentum_pct", None)
        live_br  = (source_js or {}).get("metrics",{}).get("breadth_pct",  None)

    # Polygon 10m bars
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API")
    if not key:
        raise RuntimeError("POLYGON_API_KEY not set")

    bars_by_sym = {sym: fetch_polygon_10m(key, sym) for sym in SYMS}
    spy_bars = bars_by_sym["SPY"]
    if len(spy_bars) < 25:
        raise RuntimeError("Not enough SPY 10m bars after sanitizer")

    closes = [b["close"] for b in spy_bars]
    highs  = [b["high"]  for b in spy_bars]
    lows   = [b["low"]   for b in spy_bars]
    vols   = [b["volume"] for b in spy_bars]

    # EMA10/EMA20 & crossover
    ema10 = ema_series(closes, 10)
    ema20 = ema_series(closes, 20)
    e10_prev, e20_prev = ema10[-2], ema20[-2]
    e10_now,  e20_now  = ema10[-1], ema20[-1]
    px_now              = closes[-1]

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

    # Pure 10m Squeeze / Liquidity / Volatility
    squeeze_pct = squeeze_pct_10m(closes, highs, lows)
    liquidity_pct = liquidity_pct_10m(vols)
    volatility_pct = volatility_pct_10m(highs, lows, closes)

    # Breadth/Momentum (from source if provided, else neutral)
    if live_br is None:  live_br  = 50.0
    if live_mom is None: live_mom = 50.0

    # Risk-On (keep neutral unless sourced elsewhere)
    live_risk = (source_js or {}).get("intraday", {}).get("riskOn10m", {}).get("riskOnPct", 50.0)

    # Points
    momentum_pts = lin_points(live_mom, W_MOM)
    breadth_pts  = lin_points(live_br,  W_BR)
    squeeze_pts  = lin_points(squeeze_pct,  W_SQ)
    liq_pts      = lin_points(liquidity_pct, W_LIQ)
    riskon_pts   = lin_points(live_risk, W_RISK)

    components = {
        "ema10":     ema_pts,
        "momentum":  momentum_pts,
        "breadth":   breadth_pts,
        "squeeze":   squeeze_pts,
        "liquidity": liq_pts,
        "riskOn":    riskon_pts,
    }
    overall_score = int(sum(components.values()))

    # Overall light rule
    if ema_sign > 0 and overall_score >= 60:
        overall_state = "bull"
    elif ema_sign < 0 and overall_score < 60:
        overall_state = "bear"
    else:
        overall_state = "neutral"

    metrics = {
        "breadth_pct":    round(float(live_br), 2),
        "momentum_pct":   round(float(live_mom), 2),
        "squeeze_pct":    round(float(squeeze_pct), 2),
        "liquidity_pct":  round(float(liquidity_pct), 2),
        "volatility_pct": round(float(volatility_pct), 2),  # display only (not scored)
        "ema_cross":      ema_cross,
        "ema10_dist_pct": round(float(ema10_dist_pct), 2),
        "ema_sign":       int(ema_sign),
    }

    intraday = (source_js or {}).get("intraday", {})
    if "riskOn10m" not in intraday:
        intraday["riskOn10m"] = {"riskOnPct": float(live_risk or 50.0)}
    if "sectorDirection10m" not in intraday:
        intraday["sectorDirection10m"] = {"risingPct": 0.0}
    intraday["overall10m"] = {
        "state": overall_state,
        "score": int(overall_score),
        "components": components,
    }

    return {
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "updated_at_utc": now_iso_utc(),
        "timestamp": now_iso_utc(),
        "metrics": metrics,
        "intraday": intraday,
        "sectorCards": sector_cards,
    }

# ------------------------------ CLI -------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")
    ap.add_argument("--source")  # optional: path to JSON to blend breadth/momentum/sectorCards
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if (args.mode or "intraday").lower() != "intraday":
        print("[warn] only 'intraday' supported; continuing", file=sys.stderr)

    source_js = None
    if args.source and os.path.isfile(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                source_js = json.load(f)
        except Exception:
            source_js = None

    out = build_intraday(source_js=source_js)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("[ok] wrote", args.out)
    print(
        "overall10m.state=", out["intraday"]["overall10m"]["state"],
        "score=", out["intraday"]["overall10m"]["score"],
        "ema_sign=", out["metrics"]["ema_sign"],
        "ema10_dist_pct=", out["metrics"]["ema10_dist_pct"],
        "squeeze_pct=", out["metrics"]["squeeze_pct"],
        "liquidity_pct=", out["metrics"]["liquidity_pct"],
        "volatility_pct=", out["metrics"]["volatility_pct"],
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
