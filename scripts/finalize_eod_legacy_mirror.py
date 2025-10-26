#!/usr/bin/env python3
"""
finalize_eod_legacy_mirror.py — mirror v1 EOD metrics to legacy daily block

Input (current /live/eod metrics):
  metrics.daily_trend_pct
  metrics.participation_pct
  metrics.daily_squeeze_pct
  metrics.volatility_pct
  metrics.liquidity_pct
  metrics.risk_on_daily_pct

Output mirrors (legacy names the old UI expects):
  trendDaily.trend.emaSlope              <- daily_trend_pct (pass-through as %)
  trendDaily.participation.pctAboveMA    <- participation_pct
  metrics.squeeze_daily_pct              <- daily_squeeze_pct
  trendDaily.volatilityRegime.atrPct     <- volatility_pct
  trendDaily.volatilityRegime.band       <- "calm"|"elevated"|"high" (simple bands)
  trendDaily.liquidityRegime.psi         <- liquidity_pct
  trendDaily.liquidityRegime.band        <- "good"|"normal"|"light"|"thin" (simple bands)
  rotation.riskOnPct                     <- risk_on_daily_pct
"""

import json, sys

def band_vol(v):
    if v is None: return None
    # choose bands that match your dial colors
    return "high" if v >= 1.0 else ("elevated" if v >= 0.5 else "calm")

def band_liq(v):
    if v is None: return None
    return "good" if v >= 60 else ("normal" if v >= 40 else "light")

def num(x):
    try:
        v=float(x)
        if v != v: return None
        return v
    except: return None

def main():
    if len(sys.argv) < 3:
        print("usage: finalize_eod_legacy_mirror.py --in IN --out OUT", file=sys.stderr)
        sys.exit(2)
    args = sys.argv[1:]
    p_in  = args[args.index("--in")+1]
    p_out = args[args.index("--out")+1]

    with open(p_in,"r",encoding="utf-8") as f:
        j=json.load(f)

    m = j.get("metrics") or {}
    daily = j.get("daily") or {}   # keep if you already use it

    # v1 fields you publish now
    t  = num(m.get("daily_trend_pct"))
    p  = num(m.get("participation_pct"))
    sq = num(m.get("daily_squeeze_pct"))
    v  = num(m.get("volatility_pct"))
    li = num(m.get("liquidity_pct"))
    ro = num(m.get("risk_on_daily_pct"))

    # prepare legacy containers
    trendDaily = j.get("trendDaily") or {}
    trendDaily.setdefault("trend", {})
    trendDaily.setdefault("participation", {})
    trendDaily.setdefault("volatilityRegime", {})
    trendDaily.setdefault("liquidityRegime", {})

    # mirrors
    if t is not None:  trendDaily["trend"]["emaSlope"] = t
    if p is not None:  trendDaily["participation"]["pctAboveMA"] = p
    if sq is not None: j.setdefault("metrics", {})["squeeze_daily_pct"] = sq
    if v is not None:
        trendDaily["volatilityRegime"]["atrPct"] = v
        b = band_vol(v)
        if b: trendDaily["volatilityRegime"]["band"] = b
    if li is not None:
        trendDaily["liquidityRegime"]["psi"] = li
        b = band_liq(li)
        if b: trendDaily["liquidityRegime"]["band"] = b
    if ro is not None:
        rot = j.get("rotation") or {}
        rot["riskOnPct"] = ro
        j["rotation"] = rot

    j["trendDaily"] = trendDaily

    with open(p_out,"w",encoding="utf-8") as f:
        json.dump(j,f,ensure_ascii=False,separators=(",",":"))

    print("[eod-mirror] trend=", trendDaily.get("trend"),
          " participation=", trendDaily.get("participation"),
          " vol=", trendDaily.get("volatilityRegime"),
          " liq=", trendDaily.get("liquidityRegime"),
          " riskOn=", j.get("rotation",{}).get("riskOnPct"))

if __name__ == "__main__":
    main()
