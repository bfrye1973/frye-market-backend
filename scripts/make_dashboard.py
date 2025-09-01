#!/usr/bin/env python3
# scripts/make_dashboard.py
#
# INPUT  (from your ETL):  data/outlook_source.json
# OUTPUT (served by API):  data/outlook.json
#
# This version drives:
# - Gauges: rpm (breadth), speed (momentum), fuelPct (squeeze pressure), waterTemp (volatility), oilPsi (liquidity)
# - Odometers: breadthOdometer, momentumOdometer, squeeze (none|on|firingUp|firingDown)
# - Engine lights: breakout, turbo, compression, expansion, distribution, divergence, overheat, lowLiquidity
# - Sector cards + dailyOutlook
#
# It uses fields if present; otherwise falls back to safe computations from NH/NL/3U/3D.

import json, os
from datetime import datetime, timezone

SRC = os.path.join("data", "outlook_source.json")
DST = os.path.join("data", "outlook.json")

def clamp(v, lo, hi): return max(lo, min(hi, v))
def pct(a, b): return (a / max(1, a + b))

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def squeeze_enum(s: str) -> str:
    s = (s or "").lower()
    if "firingdown" in s: return "firingDown"
    if "firingup"   in s or "release" in s or "expand" in s: return "firingUp"
    if "on" in s or "contract" in s or "tight" in s: return "on"
    return "none"

def compute_indices(groups: dict):
    Bs, Ms, compression_fracs, cards = [], [], [], []
    for sector, g in groups.items():
        nh = int(g.get("nh", 0)); nl = int(g.get("nl", 0))
        u  = int(g.get("u",  0)); d  = int(g.get("d",  0))
        B_s = (nh - nl) / max(1, nh + nl)     # [-1..+1]
        M_s = (u  - d ) / max(1, u  + d )     # [-1..+1]
        Bs.append(B_s); Ms.append(M_s)

        # simple compression proxy if no squeeze pressure provided for sector
        compression_fracs.append(d / max(1, u + d))

        hist = g.get("history", {})
        cards.append({
            "sector":  sector,
            "outlook": g.get("breadth_state", "Neutral"),
            "spark":   (hist.get("nh") or [])[-5:]
        })

    mean_B = sum(Bs)/len(Bs) if Bs else 0.0
    mean_M = sum(Ms)/len(Ms) if Ms else 0.0
    breadth_index  = clamp(round(50 * (1 + mean_B)),  0, 100)  # 0..100
    momentum_index = clamp(round(50 * (1 + mean_M)),  0, 100)  # 0..100
    comp_avg = sum(compression_fracs)/len(compression_fracs) if compression_fracs else 0.5

    return breadth_index, momentum_index, comp_avg, cards

def main():
    src = load_json(SRC)

    # Expect a top-level "groups": {...} and optional "global": {...}
    groups = src.get("groups", {})
    if not groups:
        raise SystemExit("No groups found in outlook_source.json")

    global_in = src.get("global", {})  # optional overrides from your ETL (volatility, liquidity, squeeze, etc.)

    # --- Core indices / sector cards ---
    breadth_idx, momentum_idx, comp_avg, sector_cards = compute_indices(groups)

    # --- Gauges: rpm/speed from indices (−1000..+1000 range) ---
    rpm   = clamp(round(1000 * (breadth_idx/50 - 1)),  -1000, 1000)
    speed = clamp(round(1000 * (momentum_idx/50 - 1)), -1000, 1000)

    # --- Fuel: squeeze pressure (%). Prefer provided value; else infer from compression proxy ---
    fuelPct = global_in.get("squeeze_pressure_pct")
    if fuelPct is None:
        fuelPct = round(100 * comp_avg)  # more compression → higher fuel
    fuelPct = clamp(int(fuelPct), 0, 100)

    # --- Water Temp: volatility. Prefer provided normalized percentage (0–100). Map to ~180–240°F ---
    vol_pct = global_in.get("volatility_pct")  # 0..100 if provided by ETL (e.g., ATR/ADR %)
    if vol_pct is None:
        # fallback: use momentum strength as a rough stand-in (not ideal; replace when real vol arrives)
        vol_pct = momentum_idx
    vol_pct = clamp(int(vol_pct), 0, 100)
    waterTemp = int(round(180 + (60 * (vol_pct / 100))))  # 180–240°F

    # --- Oil PSI: liquidity. Prefer provided liquidity_pct (0–100) else neutral 70 ---
    liq_pct = global_in.get("liquidity_pct")
    if liq_pct is None:
        liq_pct = 70
    oilPsi = clamp(int(round(liq_pct)), 0, 120)

    # --- Odometers ---
    squeeze_state = squeeze_enum(global_in.get("squeeze_state") or (groups.get("Tech", {}) or {}).get("vol_state", ""))

    # --- Totals for signals ---
    NH_total = sum(int(g.get("nh",0)) for g in groups.values())
    NL_total = sum(int(g.get("nl",0)) for g in groups.values())
    U_total  = sum(int(g.get("u",0))  for g in groups.values())
    D_total  = sum(int(g.get("d",0))  for g in groups.values())
    NHpct = pct(NH_total, NL_total)
    Upct  = pct(U_total,  D_total)

    # --- Signals: prefer explicit booleans from ETL; else compute safe defaults ---
    # Bullish/Setup
    sigBreakout    = bool(global_in.get("breakout_confirmed")) \
                     or (momentum_idx >= 60 and NHpct >= 0.66)               # conservative fallback
    sigTurbo       = bool(global_in.get("overdrive")) \
                     or (momentum_idx >= 70)                                  # RSI/SMI extreme proxy
    sigCompression = (global_in.get("squeeze_on") is True) \
                     or (squeeze_state == "on") or (fuelPct >= 60)
    sigExpansion   = bool(global_in.get("squeeze_firing")) \
                     or (squeeze_state in ("firingUp","firingDown")) or (Upct >= 0.60 and momentum_idx >= 55)

    # Bearish/Risk
    sigDistribution = bool(global_in.get("distribution")) \
                      or (NL_total > NH_total*1.5 or breadth_idx <= 45)
    sigDivergence   = bool(global_in.get("breadth_momo_divergence"))          # provide from ETL when slopes disagree
    sigOverheat     = bool(global_in.get("overheat")) \
                      or (momentum_idx >= 85)
    sigLowLiquidity = bool(global_in.get("low_liquidity")) \
                      or (oilPsi <= 40)

    def sev(active, base="info"): return {"active": bool(active), "severity": base}

    signals = {
        # bullish/setup
        "sigBreakout":     sev(sigBreakout,     "warn"),
        "sigTurbo":        sev(sigTurbo,        "info"),
        "sigCompression":  sev(sigCompression,  "info"),
        "sigExpansion":    sev(sigExpansion,    "info"),
        # bearish/risk
        "sigDistribution": sev(sigDistribution, "warn"),
        "sigDivergence":   sev(sigDivergence,   "warn"),
        "sigOverheat":     sev(sigOverheat,     "danger"),
        "sigLowLiquidity": sev(sigLowLiquidity, "warn"),
    }

    dashboard = {
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
        "signals": signals,
        "outlook": {
            "dailyOutlook": clamp(round((breadth_idx + momentum_idx)/2), 0, 100),
            "sectorCards": sorted(sector_cards, key=lambda x: x["sector"])
        },
        "meta": { "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z") }
    }

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        json.dump(dashboard, f, ensure_ascii=False, indent=2)
    print(f"[OK] wrote {DST}")

if __name__ == "__main__":
    main()
