#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compute strategy.trendEOD for /live/eod (or /live/daily) Lux-style
- Colors: green (bull), red (bear), yellow (compression/chop)
- Uses daily EMA posture + SMI if present + PSI (tightness)
"""

import json, sys, datetime

IN = "data/outlook.json"      # your EOD file path
OUT = IN

def now_iso():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def pick(obj, *path):
    for k in path:
        if not isinstance(obj, dict): return None
        obj = obj.get(k)
    return obj

def main():
    try:
        j = json.load(open(IN,"r",encoding="utf-8"))
    except Exception as e:
        print("[trendEOD] cannot read", IN, e, file=sys.stderr)
        sys.exit(0)

    m = j.get("metrics") or {}
    # Expected (if available): daily psi, ema_sign_daily, a momentum proxy
    psi  = m.get("squeeze_daily_pct") or m.get("psi_daily")   # treat ≥80 as compression
    ema  = m.get("ema_sign_daily")     # +1/-1 if you emit this
    mom  = m.get("momentum_daily_pct") # optional momentum proxy

    # Strict Lux rule: compression first
    if isinstance(psi,(int,float)) and psi >= 80.0:
        state, reason = ("yellow", f"Compression (daily PSI≥80, psi={psi:.0f}%)")
    else:
        if isinstance(ema,(int,float)) and ema > 0 and (not isinstance(mom,(int,float)) or mom>=50):
            state, reason = ("green", "EMA10>20 daily & momentum supportive")
        elif isinstance(ema,(int,float)) and ema < 0 and (not isinstance(mom,(int,float)) or mom<50):
            state, reason = ("red", "EMA10<20 daily & momentum weak")
        else:
            # fallback to trendDaily.trend if present
            td = pick(j,"trendDaily","trend","state")
            if str(td).lower()=="bull": state, reason=("green","trendDaily bull")
            elif str(td).lower()=="bear": state, reason=("red","trendDaily bear")
            else: state, reason=("yellow","Neutral/transition")

    j.setdefault("strategy", {})
    j["strategy"]["trendEOD"] = {
        "state": state,
        "reason": reason,
        "updatedAt": j.get("updated_at_utc") or j.get("updated_at") or now_iso()
    }
    json.dump(j, open(OUT,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    print("[trendEOD]", j["strategy"]["trendEOD"])

if __name__ == "__main__":
    main()
