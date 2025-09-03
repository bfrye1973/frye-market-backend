#!/usr/bin/env python3
# make_dashboard.py — adds sector counts, trends, and gauge lights

import json, os, statistics
from datetime import datetime, timezone

SRC = os.path.join("data", "outlook_source.json")
HIST = os.path.join("data", "history.json")
DST = os.path.join("data", "outlook.json")

def clamp(v, lo, hi): return max(lo, min(hi, v))
def pct(a, b): return (a / max(1, a + b))

def load_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default

def squeeze_enum(s: str) -> str:
    s = (s or "").lower()
    if "firingdown" in s: return "firingDown"
    if "firingup"   in s or "release" in s or "expand" in s: return "firingUp"
    if "on" in s or "contract" in s or "tight" in s: return "on"
    return "none"

def last_n(lst, n): return lst[-n:] if lst else []

def linear_slope(vals):
    """Simple slope (least-squares on 0..n-1). Positive => rising trend."""
    if len(vals) < 3: return 0.0
    n = len(vals)
    xs = list(range(n))
    xbar = sum(xs)/n
    ybar = sum(vals)/n
    num = sum((x - xbar)*(y - ybar) for x, y in zip(xs, vals))
    den = sum((x - xbar)**2 for x in xs) or 1
    return num / den

def build_sector_cards(groups, history):
    """Return (cards, breadth_idx 0..100, momentum_idx 0..100, trend dict)"""
    Bs, Ms, comp_fracs, cards = [], [], [], []
    # Build per-sector spark from history: net breadth = NH - NL
    hist_days = history.get("days", [])
    # Make a fast lookup per day
    per_day = hist_days

    for sector, g in groups.items():
        nh = int(g.get("nh", 0)); nl = int(g.get("nl", 0))
        u  = int(g.get("u",  0)); d  = int(g.get("d",  0))

        # sector breadth/momentum point estimates
        B_s = (nh - nl) / max(1, nh + nl)  # [-1..+1]
        M_s = (u  - d ) / max(1, u  + d )  # [-1..+1]
        Bs.append(B_s); Ms.append(M_s)

        comp_fracs.append(d / max(1, u + d))

        # build spark from history — last 5 days of (NH-NL)
        spark_vals = []
        for day in per_day[-5:]:
            gmap = day.get("groups", {})
            if sector in gmap:
                spark_vals.append(int(gmap[sector].get("nh",0)) - int(gmap[sector].get("nl",0)))
            else:
                spark_vals.append(0)
        # if no history yet, keep empty list (UI shows "(no data)")
        spark = spark_vals if any(spark_vals) else []

        cards.append({
            "sector":  sector,
            "outlook": g.get("breadth_state", "Neutral"),
            "spark":   spark,
            "counts": {"nh": nh, "nl": nl, "u": u, "d": d}
        })

    mean_B = sum(Bs)/len(Bs) if Bs else 0.0
    mean_M = sum(Ms)/len(Ms) if Ms else 0.0
    breadth_idx  = clamp(round(50 * (1 + mean_B)),  0, 100)
    momentum_idx = clamp(round(50 * (1 + mean_M)),  0, 100)

    # market-wide net breadth & net momentum time series (history)
    series_netB, series_netM = [], []
    for day in per_day:
        gmap = day.get("groups", {})
        # sum across sectors present that day
        tot_nh = sum(int(v.get("nh",0)) for v in gmap.values())
        tot_nl = sum(int(v.get("nl",0)) for v in gmap.values())
        tot_u  = sum(int(v.get("u" ,0)) for v in gmap.values())
        tot_d  = sum(int(v.get("d" ,0)) for v in gmap.values())
        series_netB.append(tot_nh - tot_nl)
        series_netM.append(tot_u  - tot_d)

    slopeB = linear_slope(last_n(series_netB, 7))   # last week breadth trend
    slopeM = linear_slope(last_n(series_netM, 7))   # last week momentum trend

    trend = {
        "breadthSlope": slopeB,  # >0 improving, <0 deteriorating
        "momentumSlope": slopeM
    }
    return cards, breadth_idx, momentum_idx, sum(comp_fracs)/len(comp_fracs) if comp_fracs else 0.5, trend

def main():
    src = load_json(SRC, {"groups": {}, "global": {}})
    groups = src.get("groups", {})
    if not groups:
        raise SystemExit("No groups found in data/outlook_source.json")

    hist  = load_json(HIST, {"days": []})
    global_in = src.get("global", {})

    sector_cards, breadth_idx, momentum_idx, comp_avg, trend = build_sector_cards(groups, hist)

    # big gauges values
    rpm   = clamp(round(1000 * (breadth_idx/50 - 1)),  -1000, 1000)
    speed = clamp(round(1000 * (momentum_idx/50 - 1)), -1000, 1000)

    # lights / colors for the big gauges based on index and slope
    def color_for(index, slope):
        # green/yellow/red by level; bias with slope
        lvl = "neutral"
        if index >= 60: lvl = "strong"
        elif index <= 40: lvl = "weak"
        # tilt with slope
        if slope > 0.2: lvl = "improving" if lvl != "strong" else "strong"
        if slope < -0.2: lvl = "deteriorating" if lvl != "weak" else "weak"
        return lvl

    breadth_state  = color_for(breadth_idx,  trend["breadthSlope"])
    momentum_state = color_for(momentum_idx, trend["momentumSlope"])

    # mini gauges
    fuelPct = clamp(int(round(100 * comp_avg)), 0, 100)
    vol_pct = int(global_in.get("volatility_pct", momentum_idx))
    waterTemp = int(round(180 + 60 * clamp(vol_pct, 0, 100) / 100))
    liq_pct = int(global_in.get("liquidity_pct", 70))
    oilPsi = clamp(liq_pct, 0, 120)

    squeeze_state = squeeze_enum(global_in.get("squeeze_state") or (groups.get("Tech") or groups.get("tech") or {}).get("vol_state", ""))

    # totals for signals (market-wide)
    NH_total = sum(int(g.get("nh",0)) for g in groups.values())
    NL_total = sum(int(g.get("nl",0)) for g in groups.values())
    U_total  = sum(int(g.get("u",0))  for g in groups.values())
    D_total  = sum(int(g.get("d",0))  for g in groups.values())
    NHpct = pct(NH_total, NL_total)
    Upct  = pct(U_total,  D_total)

    # conservative signals — can fine-tune later
    sigBreakout     = (momentum_idx >= 60 and NHpct >= 0.66)
    sigDistribution = (NL_total > NH_total*1.5 or breadth_idx <= 45)
    sigTurbo        = (momentum_idx >= 70)
    sigCompression  = (squeeze_state == "on" or fuelPct >= 60)
    sigExpansion    = (squeeze_state in ("firingUp","firingDown") or (Upct >= 0.60 and momentum_idx >= 55))
    sigDivergence   = (trend["momentumSlope"] > 0 and trend["breadthSlope"] < 0) or (trend["momentumSlope"] < 0 and trend["breadthSlope"] > 0)
    sigOverheat     = (momentum_idx >= 85)
    sigLowLiquidity = (oilPsi <= 40)

    def sev(active, base="info"): return {"active": bool(active), "severity": base}

    payload = {
        "gauges": {
            "rpm": rpm,
            "speed": speed,
            "fuelPct": fuelPct,
            "waterTemp": waterTemp,
            "oilPsi": oilPsi
        },
        "odometers": {
            "breadthOdometer": breadth_idx,
            "momentumOdometer": momentum_idx,
            "squeeze": squeeze_state
        },
        "lights": {  # <<=== NEW: tells the UI how to color the big gauges
            "breadth":  breadth_state,      # "strong" | "improving" | "neutral" | "deteriorating" | "weak"
            "momentum": momentum_state
        },
        "signals": {
            "sigBreakout":     sev(sigBreakout,     "warn"),
            "sigDistribution": sev(sigDistribution, "warn"),
            "sigTurbo":        sev(sigTurbo,        "info"),
            "sigCompression":  sev(sigCompression,  "info"),
            "sigExpansion":    sev(sigExpansion,    "info"),
            "sigDivergence":   sev(sigDivergence,   "warn"),
            "sigOverheat":     sev(sigOverheat,     "danger"),
            "sigLowLiquidity": sev(sigLowLiquidity, "warn")
        },
        "outlook": {
            "dailyOutlook": clamp(round((breadth_idx + momentum_idx)/2), 0, 100),
            "sectorCards": sorted(sector_cards, key=lambda x: x["sector"].lower())
        },
        "meta": {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
            "version": "1.1"
        }
    }

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {DST}")

if __name__ == "__main__":
    main()
