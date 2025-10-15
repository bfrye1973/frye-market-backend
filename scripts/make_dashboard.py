#!/usr/bin/env python3
"""
make_dashboard.py — Ferrari Dashboard builder (intraday)
Usage:
  python -u scripts/make_dashboard.py --mode intraday --source data/outlook_source.json --out data/outlook_intraday.json
Notes:
- No external deps; stdlib only.
- Fixes Overall light to use *current* EMA10 vs EMA20 sign + distance (not only cross events).
- Tolerant to slightly different source shapes; searches for SPY 10m bars and sector cards.
"""

import argparse, json, math, os, sys, time
from datetime import datetime, timezone

# -------------------------- Helpers --------------------------
def now_iso():
    # America/Phoenix stamp is often stored too, but we keep UTC for consistency
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z")

def pct(a, b):
    return 0.0 if not b else 100.0 * a / b

def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x

def ema_series(vals, n):
    """Return entire EMA series (no warmup removal)."""
    a = 2.0 / (n + 1.0)
    e = None
    out = []
    for v in vals:
        e = v if e is None else (e + a*(v - e))
        out.append(e)
    return out

def get(obj, path, default=None):
    """Small JSON getter with dotted path."""
    cur = obj
    for k in path.split("."):
        if isinstance(cur, dict) and k in cur:
            cur = cur[k]
        else:
            return default
    return cur

def deep_find_bars_spy(obj):
    """
    Walk the JSON and return a list of OHLC bars for SPY 10m if possible.
    Accepts dicts like {t/o/h/l/c} or {time/open/high/low/close}.
    """
    stack = [obj]
    best = None
    while stack:
        x = stack.pop()
        if isinstance(x, dict):
            # If key hints exist, prefer SPY
            sym = str(x.get("symbol") or x.get("sym") or "").upper()
            tf  = str(x.get("timeframe") or x.get("tf") or "").lower()
            bars = x.get("bars")
            if isinstance(bars, list) and len(bars) >= 25:
                # Prefer SPY 10m if present
                if (sym == "SPY") and ("10" in tf or "10m" in tf or "10-min" in tf):
                    return bars
                # Otherwise, remember first viable list and keep searching for SPY
                if best is None:
                    best = bars
            # keep walking
            for v in x.values():
                stack.append(v)
        elif isinstance(x, list):
            stack.extend(x)
    return best

def close_from_bar(b):
    if "c" in b: return float(b["c"])
    if "close" in b: return float(b["close"])
    # Some shapes embed last price under 'p'—fallback
    if "p" in b: return float(b["p"])
    raise ValueError("Bar missing close price")

def ts_from_bar(b):
    # seconds or ms; tolerate both
    t = b.get("t", b.get("time"))
    if t is None: return None
    t = int(t)
    return t // 1000 if t > 2_000_000_000 else t

def drop_inflight_last_bar_if_any(bars, bucket_sec=600):
    """
    Extra guard (your workflow already sanitizes). If last bar starts in
    the *current* 10-minute bucket, drop it so we only use CLOSED bars.
    """
    if not bars:
        return bars
    now = int(time.time())
    curr_bucket = (now // bucket_sec) * bucket_sec
    t = ts_from_bar(bars[-1])
    if t is not None and ((t // bucket_sec) * bucket_sec) == curr_bucket:
        return bars[:-1]
    return bars

def summarize_sector_cards(cards):
    """Return NH/NL/UP/DN plus breadth/momentum/rising/risk-on from sectorCards array."""
    OFF = {"Information Technology","Communication Services","Consumer Discretionary"}
    DEF = {"Consumer Staples","Utilities","Health Care","Real Estate"}

    NH=NL=UP=DN=rising=offUp=defDn=0
    for c in cards or []:
        nh = int(c.get("nh",0)); nl = int(c.get("nl",0))
        up = int(c.get("up",0)); dn = int(c.get("down",0))
        NH += nh; NL += nl; UP += up; DN += dn
        b = pct(nh, nh+nl)
        if b > 50.0: rising += 1
        sec = str(c.get("sector",""))
        if sec in OFF and b > 50.0: offUp += 1
        if sec in DEF and b < 50.0: defDn += 1

    return {
        "NH": NH, "NL": NL, "UP": UP, "DN": DN,
        "breadth_pct": pct(NH, NH+NL),
        "momentum_pct": pct(UP, UP+DN),
        "risingPct": pct(rising, 11.0),
        "riskOnPct": pct(offUp + defDn, len(OFF) + len(DEF)),
    }

# -------------------------- Core build --------------------------
def build_intraday(source):
    """
    Build the final intraday outlook JSON from a source object.
    Returns a new dict with metrics + intraday.overall10m and a few helpful fields.
    """
    out = {}
    # Start by copying over core useful bits if present
    for k in ("indices","sectorCards","updated_at","updated_at_utc","timestamp","intraday","metrics"):
        if k in source: out[k] = source[k]

    # sectorCards are the backbone for breadth/momentum
    cards = out.get("sectorCards") or get(source,"sectorCards",[]) or []

    # Summarize sector internals
    sums = summarize_sector_cards(cards)

    # Try to get SPY 10m bars
    bars = deep_find_bars_spy(source)
    if not bars or len(bars) < 25:
        raise ValueError("Could not find sufficient SPY 10m bars in source JSON")

    # Guard: drop any in-flight (open) bar to ensure CLOSED-only series
    bars = drop_inflight_last_bar_if_any(bars, bucket_sec=600)
    if len(bars) < 25:
        raise ValueError("Not enough CLOSED bars after sanitizer")

    closes = [close_from_bar(b) for b in bars]
    ema10 = ema_series(closes, 10)
    ema20 = ema_series(closes, 20)

    e10_prev, e20_prev = ema10[-2], ema20[-2]
    e10_now,  e20_now  = ema10[-1], ema20[-1]
    px_now              = closes[-1]

    # Event-style cross (for info)
    if e10_prev < e20_prev and e10_now > e20_now:
        ema_cross = "bull"
    elif e10_prev > e20_prev and e10_now < e20_now:
        ema_cross = "bear"
    else:
        ema_cross = "none"

    # Continuous EMA state (+1 above, -1 below, 0 equal)
    ema_sign = 1 if e10_now > e20_now else (-1 if e10_now < e20_now else 0)
    ema10_dist_pct = 0.0 if e10_now == 0 else 100.0 * (px_now - e10_now) / e10_now

    # ------------------ Component scoring (0–100) ------------------
    # Weights (as agreed)
    W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5

    # EMA component: sign * scaled distance (±0.60% → full weight)
    dist_unit = clamp(ema10_dist_pct / 0.60, -1.0, 1.0) if ema10_dist_pct is not None else 0.0
    ema_pts   = int(round(W_EMA * (1.0 * (1 if ema_sign > 0 else -1) * abs(dist_unit)))) if ema_sign != 0 else 0

    # Momentum/Breadth/Squeeze/Liquidity/RiskOn from live or recompute
    # Pull live if present, otherwise use recomputed (sums)
    live_mom = get(source,"metrics.momentum_pct", sums["momentum_pct"])
    live_br  = get(source,"metrics.breadth_pct",  sums["breadth_pct"])
    # Squeeze/Liquidity may exist; otherwise lightly neutral (5/10 pts)
    live_sq  = get(source,"metrics.squeeze_pct",  50.0)
    live_liq = get(source,"metrics.liquidity_pct",50.0)
    # Risk-On: prefer source intraday, else recompute
    live_risk = get(source,"intraday.riskOn10m.riskOnPct", sums["riskOnPct"])

    # Map % (0..100) → points by simple linear scaling around 50 (neutral)
    def pts_lin(percent, weight):
        # 50% => 0; 100% => +weight; 0% => -weight
        return int(round(weight * ((percent - 50.0) / 50.0)))

    momentum_pts = pts_lin(float(live_mom or 0.0), W_MOM)
    breadth_pts  = pts_lin(float(live_br  or 0.0), W_BR)
    squeeze_pts  = pts_lin(float(live_sq  or 50.0), W_SQ)
    liq_pts      = pts_lin(float(live_liq or 50.0), W_LIQ)
    riskon_pts   = pts_lin(float(live_risk or 50.0), W_RISK)

    components = {
        "ema10":     ema_pts,
        "momentum":  momentum_pts,
        "breadth":   breadth_pts,
        "squeeze":   squeeze_pts,
        "liquidity": liq_pts,
        "riskOn":    riskon_pts,
    }
    overall_score = int(sum(components.values()))

    # State: prioritize EMA sign, with score thresholds
    # If trend is down and score is not strongly positive → bear
    # If trend is up and score is positive enough → bull
    # Else neutral.
    if ema_sign < 0 and overall_score < 60:
        overall_state = "bear"
    elif ema_sign > 0 and overall_score >= 60:
        overall_state = "bull"
    else:
        overall_state = "neutral"

    # Build output
    metrics = {
        "breadth_pct": round(float(sums["breadth_pct"]), 2),
        "momentum_pct": round(float(sums["momentum_pct"]), 2),
        "ema_cross": ema_cross,
        "ema10_dist_pct": round(float(ema10_dist_pct), 2),
        "ema_sign": int(ema_sign),
    }

    # Prefer to keep existing intraday dict and merge
    intraday = out.get("intraday") or {}
    # keep rising% / risk-on if present; else populate from recompute
    if "sectorDirection10m" not in intraday:
        intraday["sectorDirection10m"] = {}
    intraday["sectorDirection10m"]["risingPct"] = float(get(intraday,"sectorDirection10m.risingPct", sums["risingPct"]))

    if "riskOn10m" not in intraday:
        intraday["riskOn10m"] = {}
    intraday["riskOn10m"]["riskOnPct"] = float(get(intraday,"riskOn10m.riskOnPct", sums["riskOnPct"]))

    intraday["overall10m"] = {
        "state": overall_state,
        "score": int(overall_score),
        "components": components
    }

    out["metrics"] = (out.get("metrics") or {}) | metrics
    out["intraday"] = intraday
    out["updated_at_utc"] = now_iso()

    # Ensure sectorCards exist (even empty list)
    out["sectorCards"] = cards

    return out

# -------------------------- CLI --------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday", help="intraday (default)")
    ap.add_argument("--source", required=True, help="path to outlook_source.json")
    ap.add_argument("--out", required=True, help="path to write outlook_intraday.json")
    args = ap.parse_args()

    with open(args.source, "r", encoding="utf-8") as f:
        src = json.load(f)

    if (args.mode or "intraday").lower() != "intraday":
        print("[warn] only 'intraday' supported in this builder; continuing...", file=sys.stderr)

    out = build_intraday(src)

    # Make sure output folder exists
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    print("[ok] wrote", args.out)
    print("overall10m.state=", out["intraday"]["overall10m"]["state"], "score=", out["intraday"]["overall10m"]["score"])
    print("ema_cross=", out["metrics"]["ema_cross"], "ema_sign=", out["metrics"]["ema_sign"], "ema10_dist_pct=", out["metrics"]["ema10_dist_pct"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
