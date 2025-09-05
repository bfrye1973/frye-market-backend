#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (R1.3, fixed sectorCards)
- Preserves your working gauges/lights/summary shape
- Builds TOP-LEVEL outlook.sectorCards from outlook_source["groups"]
- Keeps version/pipeline at the root (as your frontend expects)
"""

from __future__ import annotations
import argparse, json, os
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

SCHEMA_VERSION = "r1.2"

# Visual mappings
WATER_MIN_F, WATER_MAX_F = 170, 255
OIL_MIN_PSI, OIL_MAX_PSI = 25, 80

# Score weights
WEIGHT_BREADTH  = 0.35
WEIGHT_MOMENTUM = 0.35
WEIGHT_FUEL     = 0.15
WEIGHT_LIQ      = 0.075
WEIGHT_WATER    = 0.075  # inverse

# Lights thresholds
FUEL_LOW_PCT = 25
OIL_LOW_PCT  = 25
WATER_OVERHEAT_PCT = 80

# ----------------- helpers -----------------
def clamp(x, lo, hi): return max(lo, min(hi, x))

def to_pct(v, assume_0_to_1=False):
    if v is None: return 50.0
    try: x = float(v)
    except: return 50.0
    if assume_0_to_1 and x <= 1.0: return clamp(x * 100.0, 0, 100)
    return clamp(x, 0, 100)

def map_linear(p, lo, hi):
    p = clamp(p, 0, 100)
    return lo + (hi - lo) * (p / 100.0)

def derive_breadth_momentum(sectors: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    NH={"10NH","nh10","ten_day_new_highs","newhighs10","nh"}; NL={"10NL","nl10","ten_day_new_lows","newlows10","nl"}
    U ={"3U","three_up","threedayup","three_up_count","u"};  D ={"3D","three_down","threedaydown","three_down_count","d"}
    def get(d,keys):
        for k in d.keys():
            if k.lower() in {s.lower() for s in keys}:
                try: return int(d[k])
                except: pass
        return 0
    tnh=tnl=tu=td=0
    for s in sectors or []:
        tnh+=get(s,NH); tnl+=get(s,NL); tu+=get(s,U); td+=get(s,D)
    nb=tnh-tnl; db=max(1,tnh+tnl); nm=tu-td; dm=max(1,tu+td)
    b=clamp(50+50*(nb/db),0,100); m=clamp(50+50*(nm/dm),0,100)
    breadth = {"pct":b,"label":"Breadth","raw":{"netNHNL":nb,"totalNHNL":db}}
    momentum= {"pct":m,"label":"Momentum","raw":{"net3U3D":nm,"total3U3D":dm}}
    return breadth, momentum

def score_and_verdict(b,m,f,w,o):
    s = WEIGHT_BREADTH*b + WEIGHT_MOMENTUM*m + WEIGHT_FUEL*f + WEIGHT_LIQ*o + WEIGHT_WATER*(100-w)
    s = int(round(s))
    if   s>=70: v="Risk-On"
    elif s>=55: v="Constructive"
    elif s>=45: v="Neutral"
    elif s>=35: v="Caution"
    else:        v="Risk-Off"
    return s, v

def extract_from_source(src: Dict[str,Any]) -> Dict[str,Any]:
    sectors = src.get("sectors") or src.get("sector_counts") or []
    squeeze_state = (src.get("squeeze_state") or src.get("global", {}).get("squeeze_state") or "neutral").lower()
    raw_psi = src.get("squeeze_psi")
    if raw_psi is None:
        raw_psi = src.get("global",{}).get("squeeze_pressure_pct")
    psi_value = float(raw_psi) if raw_psi is not None else None

    fuel  = to_pct(src.get("squeeze_pressure_pct") or src.get("global",{}).get("squeeze_pressure_pct") or raw_psi, True)
    water = to_pct(src.get("volatility_pct")        or src.get("global",{}).get("volatility_pct"))
    oil   = to_pct(src.get("liquidity_pct")         or src.get("global",{}).get("liquidity_pct"))
    return {
        "sectors": sectors,
        "fuel": fuel,
        "water": water,
        "oil": oil,
        "psi": psi_value,
        "sq": squeeze_state,
        "groups": src
