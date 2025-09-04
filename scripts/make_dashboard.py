#!/usr/bin/env python3
# scripts/make_dashboard.py  —  clean v1.3
#
# INPUTS:
#   data/outlook_source.json  (per-sector NH/NL/3U/3D + "global" fields: squeeze_pressure_pct, squeeze_state, volatility_pct, liquidity_pct)
#   data/history.json         (optional: appended daily by the builder)
#
# OUTPUT:
#   data/outlook.json         (frontend payload for /api/dashboard)
#
# Adds:
#   - sectorCards[].counts = { nh, nl, u, d }
#   - sectorCards[].spark  = last 5 values of (NH - NL)
#   - gauges: rpm/speed (−1000..+1000), fuelPct (0..100), waterTemp (180–240°F), oilPsi (0..120)
#   - odometers: breadth/momentum (0..100), squeeze state
#   - lights tokens: strong|improving|neutral|deteriorating|weak
#   - signals (starter set)
#   - summary { score, verdict, breadthIdx, momentumIdx, breadthState, momentumState, sector participation }
#   - meta { ts, version }

import json, os
from datetime import datetime, timezone

SRC  = os.path.join("data", "outlook_source.json")
HIST = os.path.join("data", "history.json")
DST  = os.path.join("data", "outlook.json")

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
    """Least-squares slope on 0..n-1; positive => rising trend."""
    if len(vals) < 3: return 0.0
    n = len(vals); xs = list(range(n))
    xbar = sum(xs)/n; ybar = sum(vals)/n
    num = sum((x-xbar)*(y-ybar) for x, y in zip(xs, vals))
    den = sum((x-xbar)**2 for x in xs) or 1
    return num / den

def classify(index):
    """Map 0..100 index to a state token."""
    if index >= 70: return "strong"
    if index >= 55: return "improving"
    if index >  45: return "neutral"
    if index >  30: return "deteriorating"
    return "weak"

def build_sector_cards(groups, history):
    """
    Returns:
      cards          — list of {sector, outlook, counts, spark}
      breadth_idx    — 0..100 (mean of per-sector breadth)
      momentum_idx   — 0..100 (mean of per-sector momentum)
      comp_avg       — avg compression proxy (for fuel fallback)
      trend          — {'breadthSlope','momentumSlope'}
    """
    Bs, Ms, comp_fracs, cards = [], [], [], []
    hist_days = history.get("days", [])

    # market-wide history series (net breadth / net momentum per day)
    series_netB, series_netM = [], []
    for day in hist_days:
        gmap = day.get("groups", {})
        tot_nh = sum(int(v.get("nh",0)) for v in gmap.values())
        tot_nl = sum(int(v.get("nl",0)) for v in gmap.values())
        tot_u  = sum(int(v.get("u" ,0)) for v in gmap.values())
        tot_d  = sum(int(v.get("d" ,0)) for v in gmap.values())
        series_netB.append(tot_nh - tot_nl)
        series_netM.append(tot_u  - tot_d)

    for sector, g in groups.items():
        nh = int(g.get("nh", 0)); nl = int(g.get("nl", 0))
        u  = int(g.get("u",  0)); d  = int(g.get("d",  0))

        # sector breadth/momentum point estimates
        B_s = (nh - nl) / max(1, nh + nl)  # [-1..+1]
        M_s = (u  - d ) / max(1, u  + d )  # [-1..+1]
        Bs.append(B_s); Ms.append(M_s)

        comp_fracs.append(d / max(1, u + d))

        # spark: last 5 days of (NH-NL) for this sector
        spark_vals = []
        for day in hist_days[-5:]:
            gmap = day.get("groups", {})
            if sector in gmap:
                spark_vals.append(int(gmap[sector].get("nh",0)) - int(gmap[sector].get("nl",0)))
            else:
                spark_vals.append(0)
        spark = spark_vals if any(spark_vals) else []

        cards.append({
            "sector":  sector,
            "outlook": g.get("breadth_state", "Neutral"),
            "spark":   spark,
            "counts": {"nh": nh, "nl": nl, "u": u, "d": d}
        })

    mean_B = sum(Bs)/len(Bs) if Bs else 0.0
