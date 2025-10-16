#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (FINAL)

What this does
- Pulls SPY & QQQ 10-minute bars from Polygon (closed bars only; drops in-flight bar)
- Computes EMA10/EMA20, ema_cross, ema_sign, ema10_dist_pct
- Builds Overall Market Light from EMA sign + distance:
    Green  if EMA10 > EMA20 and score ≥ 60
    Red    if EMA10 < EMA20 and score <  60
    Neutral otherwise
- Blends Breadth/Momentum/Squeeze/Liquidity/Volatility from a source JSON (if provided)
  or falls back to your HOURLY endpoint (/live/hourly)
- Writes canonical outlook_intraday.json for the dashboard

Usage:
  python -u scripts/make_dashboard.py --mode intraday --out data/outlook_intraday.json
Optional:
  --source <path-to-json>   # blend sectorCards/metrics if you already built a source snapshot
  --hourly_url <url>        # override hourly endpoint (default = backend-1 /live/hourly)

Env (required):
  POLYGON_API_KEY

Env (optional):
  HOURLY_URL  (default: https://frye-market-backend-1.onrender.com/live/hourly)
"""

import argparse, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------- Config ----------------------------
HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"
POLY_10M_URL = (
  "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
  "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

SYMS = ["SPY", "QQQ"]          # SPY drives the overall market light; QQQ computed for parity/logs
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60           # % distance for full ±40 EMA points

# ------------------------- Small helpers ------------------------
def now_iso_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")

def clamp(x, lo, hi): 
    return lo if x < lo else hi if x > hi else x

def pct(a, b): 
    return 0.0 if not b else 100.0 * a / b

def ema_series(vals, n):
    a = 2.0 / (n + 1.0)
    e = None
    out = []
    for v in vals:
        e = v if e is None else (e + a*(v - e))
        out.append(e)
    return out

def fetch_json(url, timeout=30, headers=None):
    req = urllib.request.Request(
        url,
        headers=headers or {"User-Agent":"make-dashboard/1.0","Cache-Control":"no-store"}
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
            "volume": float(r.get("v",0.0))
        })
    # Drop any in-flight 10m bar (ensure CLOSED bars only)
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
    # 50% -> 0; 100% -> +weight; 0% -> -weight
    return int(round(weight * ((float(percent or 0.0) - 50.0) / 50.0)))

def pick_numeric(*vals, default=None):
    for v in vals:
        if v is None:
            continue
        # accept raw numeric
        try:
            return float(v)
        except Exception:
            pass
        # accept dict with pct
        try:
            return float(v.get("pct"))
        except Exception:
            pass
    return default

# ------------------------- Core builder -------------------------
def build_intraday(source_js=None, hourly_url=HOURLY_URL_DEFAULT):
    """
    Returns a dict suitable for outlook_intraday.json
    """
    # ---------- sector cards (for breadth/momentum fallback) ----------
    sector_cards = []
    if isinstance(source_js, dict):
        sector_cards = (
            source_js.get("sectorCards")
            or source_js.get("outlook",{}).get("sectorCards")
            or []
        )

    hourly_js = None
    if not sector_cards or not isinstance(sector_cards, list):
        try:
            hourly_js = fetch_json(hourly_url)
            sector_cards = hourly_js.get("sectorCards") or hourly_js.get("sectors") or []
        except Exception:
            sector_cards = []
            hourly_js = None

    sums = summarize_sector_cards(sector_cards)

    # ---------- Polygon EMAs (SPY drives the overall light) ----------
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API")
    if not key:
        raise RuntimeError("POLYGON_API_KEY not set")

    bars_by_sym = {sym: fetch_polygon_10m(key, sym) for sym in SYMS}
    spy_bars = bars_by_sym["SPY"]
    if len(spy_bars) < 25:
        raise RuntimeError("Not enough SPY 10m bars after sanitizer")

    closes = [b["close"] for b in spy_bars]
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

    # ---------- Other components (from source or HOURLY fallback) ----------
    # momentum/breadth from source -> else sectorCards summary
    live_mom = (source_js or {}).get("metrics",{}).get("momentum_pct", None)
    live_br  = (source_js or {}).get("metrics",{}).get("breadth_pct",  None)
    if live_mom is None or live_br is None:
        live_br  = sums["breadth_pct"]  if live_br  is None else live_br
        live_mom = sums["momentum_pct"] if live_mom is None else live_mom

    # squeeze / liquidity / volatility from hourly when missing
    h_metrics = (hourly_js or {}).get("metrics", {}) if hourly_js else {}
    h_summary = (hourly_js or {}).get("summary", {}) if hourly_js else {}

    live_sq = (source_js or {}).get("metrics", {}).get("squeeze_pct", None)
    if live_sq is None:
        live_sq = pick_numeric(
            h_summary.get("squeezeCompressionPct"),
            h_metrics.get("squeezeCompressionPct"),
            h_metrics.get("squeeze_pct"),
            default=50.0
        )

    live_liq = (source_js or {}).get("metrics", {}).get("liquidity_pct", None)
    if live_liq is None:
        live_liq = pick_numeric(
            h_summary.get("liquidityPct"),
            h_metrics.get("liquidity_pct"),
            (hourly_js or {}).get("water", {}),
            default=50.0
        )

    live_vol = pick_numeric(
        h_metrics.get("volatility_pct"),
        h_summary.get("volatilityPct"),
        default=50.0
    )

    live_risk = (source_js or {}).get("intraday", {}).get("riskOn10m", {}).get("riskOnPct", 50.0)

    momentum_pts = lin_points(live_mom, W_MOM)
    breadth_pts  = lin_points(live_br,  W_BR)
    squeeze_pts  = lin_points(live_sq,  W_SQ)
    liq_pts      = lin_points(live_liq, W_LIQ)
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

    # State rule (as requested)
    #  Green if EMA10>EMA20 and score ≥ 60
    #  Red   if EMA10<EMA20 and score < 60
    #  Neutral otherwise (incl. near-flat)
    if ema_sign > 0 and overall_score >= 60:
        overall_state = "bull"
    elif ema_sign < 0 and overall_score < 60:
        overall_state = "bear"
    else:
        overall_state = "neutral"

    # ---------- Build output ----------
    metrics = {
        "breadth_pct":      round(float(live_br or 0.0), 2),
        "momentum_pct":     round(float(live_mom or 0.0), 2),
        "squeeze_pct":      round(float(live_sq or 50.0), 2),
        "liquidity_pct":    round(float(live_liq or 50.0), 2),
        "volatility_pct":   round(float(live_vol or 50.0), 2),  # display only (not in score)
        "ema_cross":        ema_cross,
        "ema10_dist_pct":   round(float(ema10_dist_pct), 2),
        "ema_sign":         int(ema_sign),
    }

    intraday = (source_js or {}).get("intraday", {})
    if "riskOn10m" not in intraday:
        intraday["riskOn10m"] = {"riskOnPct": float(live_risk or 50.0)}
    if "sectorDirection10m" not in intraday:
        intraday["sectorDirection10m"] = {"risingPct": 0.0}
    intraday["overall10m"] = {
        "state": overall_state,
        "score": int(overall_score),
        "components": components
    }

    return {
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "updated_at_utc": now_iso_utc(),
        "timestamp": now_iso_utc(),
        "metrics": metrics,
        "intraday": intraday,
        "sectorCards": sector_cards
    }

# ------------------------------ CLI -------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")
    ap.add_argument("--source")  # optional
    ap.add_argument("--out", required=True)
    ap.add_argument("--hourly_url", default=os.environ.get("HOURLY_URL", HOURLY_URL_DEFAULT))
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

    out = build_intraday(source_js=source_js, hourly_url=args.hourly_url)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    print("[ok] wrote", args.out)
    print(
        "overall10m.state=", out["intraday"]["overall10m"]["state"],
        "score=", out["intraday"]["overall10m"]["score"],
        "ema_sign=", out["metrics"]["ema_sign"],
        "ema10_dist_pct=", out["metrics"]["ema10_dist_pct"]
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
