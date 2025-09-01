#!/usr/bin/env python3
# scripts/make_dashboard.py
#
# Reads:  data/outlook_source.json   (sector-level indicator counts from your ETL)
# Writes: data/outlook.json          (frontend-ready: gauges, odometers, signals, sectorCards)

import json, math, os
from datetime import datetime, timezone

SRC = os.path.join("data", "outlook_source.json")   # ETL output (counts per sector)
DST = os.path.join("data", "outlook.json")          # what your backend serves at /api/dashboard

def clamp(v, lo, hi): 
    return max(lo, min(hi, v))

def load_source():
    with open(SRC, "r", encoding="utf-8") as f:
        return json.load(f)

def rollup(groups: dict):
    """Compute breadth/momentum composites and sector cards from per-sector counts."""
    Bs, Ms, compression_fracs, sector_cards = [], [], [], []
    for sector, g in groups.items():
        nh = int(g.get("nh", 0))
        nl = int(g.get("nl", 0))
        u  = int(g.get("u",  0))
        d  = int(g.get("d",  0))

        denom_b = max(1, nh + nl)
        denom_m = max(1, u  + d)

        B_s = (nh - nl) / denom_b
        M_s = (u  - d ) / denom_m

        Bs.append(B_s)
        Ms.append(M_s)
        compression_fracs.append(d / denom_m)  # simple proxy (refine later)

        # spark mini-series (optional): last 5 NH values if provided
        hist = g.get("history", {})
        spark = hist.get("nh") or []
        sector_cards.append({
            "sector":  sector,
            "outlook": g.get("breadth_state", "Neutral"),
            "spark":   spark[-5:]
        })

    mean_B = sum(Bs)/len(Bs) if Bs else 0.0
    mean_M = sum(Ms)/len(Ms) if Ms else 0.0

    breadth_index  = clamp(round(50 * (1 + mean_B)),  0, 100)
    momentum_index = clamp(round(50 * (1 + mean_M)),  0, 100)

    rpm   = clamp(round(1000 * (breadth_index/50 - 1)),  -1000, 1000)
    speed = clamp(round(1000 * (momentum_index/50 - 1)), -1000, 1000)

    fuelPct   = clamp(round(100 * (sum(compression_fracs)/len(compression_fracs))) if compression_fracs else 50, 0, 100)
    waterTemp = round(180 + (60 * (momentum_index/100)))  # 180–240 °F
    oilPsi    = 70  # placeholder; wire to liquidity when available

    # squeeze state: use Tech if present else first sector
    squeeze = "none"
    pick = groups.get("Tech") or (next(iter(groups.values())) if groups else {})
    if isinstance(pick, dict):
        vs = str(pick.get("vol_state", "Mixed")).lower()
        if "contract" in vs: squeeze = "on"
        elif "expand" in vs: squeeze = "firingUp"

    # global totals for signals
    NH_total = sum(int(g.get("nh",0)) for g in groups.values())
    NL_total = sum(int(g.get("nl",0)) for g in groups.values())
    U_total  = sum(int(g.get("u",0))  for g in groups.values())
    D_total  = sum(int(g.get("d",0))  for g in groups.values())
    NHpct = NH_total / max(1, NH_total + NL_total)
    Upct  = U_total  / max(1, U_total  + D_total)

    def sev(active, base="info"): return {"active": bool(active), "severity": base}

    signals = {
        "sigBreakout":     sev(NHpct >= 0.66 and breadth_index >= 60, "warn"),
        "sigDistribution": sev(NL_total > NH_total*1.5 or breadth_index <= 45, "warn"),
        "sigTurbo":        sev(momentum_index >= 70, "info"),
        "sigCompression":  sev(fuelPct >= 60, "info"),
        "sigExpansion":    sev(Upct >= 0.60 and momentum_index >= 55, "info"),
        "sigDivergence":   sev(False, "info"),  # needs slopes; wire later
        "sigOverheat":     sev(momentum_index >= 85, "danger"),
        "sigLowLiquidity": sev(False, "warn"),  # wire to volume later
    }

    dashboard = {
        "gauges": {
            "rpm": rpm, "speed": speed, "fuelPct": fuelPct,
            "waterTemp": waterTemp, "oilPsi": oilPsi
        },
        "odometers": {
            "breadthOdometer": breadth_index,
            "momentumOdometer": momentum_index,
            "squeeze": squeeze
        },
        "signals": signals,
        "outlook": {
            "dailyOutlook": clamp(round((breadth_index + momentum_index)/2), 0, 100),
            "sectorCards": sorted(sector_cards, key=lambda x: x["sector"])
        },
        "meta": { "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z") }
    }
    return dashboard

def main():
    src = load_source()
    # expected: {"groups": { "Tech": {"nh":..,"nl":..,"u":..,"d":..,"vol_state":"Contracting", "history":{"nh":[..]}} , ... }}
    groups = src.get("groups", {})
    if not groups:
        raise SystemExit("No groups[] in outlook_source.json")
    dash = rollup(groups)
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(dash, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {DST}")

if __name__ == "__main__":
    main()
