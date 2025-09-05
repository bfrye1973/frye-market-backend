#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (R1.3)

- Emits complete gauges + summary (Option A fields for your UI)
- Accepts source in either "sectors" (list) or legacy "groups" (dict)
- NEW: Populates outlook.sectorCards from source["groups"] so the Sectors grid renders
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
            if k.lower() in keys:
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
    """Normalize multiple source shapes to what we need downstream."""
    sectors = src.get("sectors") or src.get("sector_counts") or []
    # If only legacy groups exist, we still build breadth/momentum later from groups->sectors (below)
    squeeze_state = (src.get("squeeze_state") or src.get("global", {}).get("squeeze_state") or "neutral").lower()
    raw_psi = src.get("squeeze_psi")
    if raw_psi is None:
        raw_psi = src.get("global",{}).get("squeeze_pressure_pct")
    psi_value = float(raw_psi) if raw_psi is not None else None

    fuel  = to_pct(src.get("squeeze_pressure_pct") or src.get("global",{}).get("squeeze_pressure_pct") or raw_psi, True)
    water = to_pct(src.get("volatility_pct")        or src.get("global",{}).get("volatility_pct"))
    oil   = to_pct(src.get("liquidity_pct")         or src.get("global",{}).get("liquidity_pct"))
    return {"sectors":sectors,"fuel":fuel,"water":water,"oil":oil,"psi":psi_value,"sq":squeeze_state, "groups": src.get("groups")}


def lights_and_bullets(b,m,f,w,o,verdict,stale,sq,psi):
    def ring(p):
        if p>=55: return "bullish"
        if p<=45: return "bearish"
        return "neutral"
    lights={"risk_off": verdict in ("Caution","Risk-Off"),
            "low_fuel": f<=FUEL_LOW_PCT, "low_oil": o<=OIL_LOW_PCT,
            "overheat": w>=WATER_OVERHEAT_PCT, "stale_data": bool(stale),
            "breadth": ring(b), "momentum": ring(m)}
    bullets=[f"Breadth {int(round(b))}/100; Momentum {int(round(m))}/100."]
    if psi is not None:
        psi_str = f"{psi:.2f}" if 0.0<=psi<=1.0 else str(int(round(psi)))
        bullets.append(f"Squeeze: {sq}; Fuel PSI {psi_str} (~{int(round(f))}/100).")
    else:
        bullets.append(f"Squeeze: {sq}; Fuel ~{int(round(f))}/100.")
    bullets.append(f"Volatility ~{int(round(w))}/100; Liquidity ~{int(round(o))}/100.")
    if lights["overheat"]: bullets.append("Volatility running hot — expect chop/risk.")
    if lights["low_fuel"]: bullets.append("Fuel low — fewer squeezes powering trends.")
    if lights["low_oil"]:  bullets.append("Liquidity thin — size down / wider slips possible.")
    if stale: bullets.append("Data looks stale — check backend fetch.")
    return lights, bullets


def _groups_to_sector_list(groups: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Convert legacy source['groups'] into a sectors list for breadth/momentum derivation."""
    sectors: List[Dict[str, Any]] = []
    if isinstance(groups, dict):
        for sec, cnt in groups.items():
            try:
                nh=int(cnt.get("nh",0)); nl=int(cnt.get("nl",0)); u=int(cnt.get("u",0)); d=int(cnt.get("d",0))
            except Exception:
                nh=nl=u=d=0
            sectors.append({"sector": sec, "10NH": nh, "10NL": nl, "3U": u, "3D": d})
    return sectors

def _build_sector_cards_from_groups(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Create frontend-ready sector cards from legacy `groups` in the source:
    cards = [{sector, outlook, spark, counts:{nh,nl,u,d}}]
    """
    cards: List[Dict[str, Any]] = []
    groups = source.get("groups") or {}
    if isinstance(groups, dict):
        for sector, cnt in groups.items():
            try:
                nh=int(cnt.get("nh",0)); nl=int(cnt.get("nl",0)); u=int(cnt.get("u",0)); d=int(cnt.get("d",0))
            except Exception:
                nh=nl=u=d=0
            spark = [nh - nl, nh - nl]   # simple 2-point spark so the grid renders
            cards.append({
                "sector": sector,
                "outlook": "Neutral",   # refine later if desired
                "spark": spark,
                "counts": {"nh": nh, "nl": nl, "u": u, "d": d}
            })
    return cards


def jread(p): 
    try:
        with open(p,"r",encoding="utf-8") as f: return json.load(f)
    except: return None

def jwrite(p,obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p,"w",encoding="utf-8") as f: json.dump(obj,f,ensure_ascii=False,indent=2)


# ----------------- main build -----------------
def main():
    ap=argparse.ArgumentParser(description="Build Ferrari Dashboard outlook.json (with sectorCards)")
    ap.add_argument("--source",default="data/outlook_source.json")
    ap.add_argument("--out",default="data/outlook.json")
    args=ap.parse_args()

    source = jread(args.source) or {}
    prev   = jread(args.out) or {}
    s = extract_from_source(source)

    # Derive sectors for breadth/momentum:
    sectors_for_calc: List[Dict[str,Any]] = []
    if s["sectors"]:
        sectors_for_calc = s["sectors"]
    elif s.get("groups"):
        sectors_for_calc = _groups_to_sector_list(s["groups"])
    # If still empty, fall back to previous dials (keeps UI from going blank)
    if not sectors_for_calc and prev:
        b_pct = float(prev.get("gauges",{}).get("rpm",{}).get("pct",50))
        m_pct = float(prev.get("gauges",{}).get("speed",{}).get("pct",50))
        breadth  = {"pct": b_pct,"label":"Breadth","raw":{"netNHNL":0,"totalNHNL":1}}
        momentum = {"pct": m_pct,"label":"Momentum","raw":{"net3U3D":0,"total3U3D":1}}
    else:
        breadth, momentum = derive_breadth_momentum(sectors_for_calc)

    fuel=s["fuel"]; water=s["water"]; oil=s["oil"]
    waterF=int(round(map_linear(water,WATER_MIN_F,WATER_MAX_F)))
    oilPSI=int(round(map_linear(oil,OIL_MIN_PSI,OIL_MAX_PSI)))
    score, verdict = score_and_verdict(breadth["pct"], momentum["pct"], fuel, water, oil)

    stale=False
    ts=source.get("timestamp")
    if isinstance(ts,str):
        try:
            dt=datetime.fromisoformat(ts.replace("Z","+00:00"))
            stale=(datetime.now(timezone.utc)-dt.astimezone(timezone.utc)).total_seconds()/60.0 > 240
        except: pass

    lights, bullets = lights_and_bullets(breadth["pct"], momentum["pct"], fuel, water, oil, verdict, stale, s["sq"], s["psi"])
    now=datetime.now(timezone.utc).isoformat()

    gauges={"rpm":breadth,"speed":momentum,
            "fuel":{"pct":fuel,"psi":s["psi"],"state":s["sq"],"label":"Squeeze"},
            "water":{"pct":water,"degF":waterF,"label":"Volatility"},
            "oil":{"pct":oil,"psi":oilPSI,"label":"Liquidity"},
            "waterTemp":waterF,"oilPsi":oilPSI,"fuelPct":float(round(fuel,2))}
    odos={"breadth_net":breadth["raw"]["netNHNL"],"momentum_net":momentum["raw"]["net3U3D"],
          "squeeze_psi": s["psi"] if s["psi"] is not None else round(fuel,2),
          "breadthOdometer":breadth["raw"]["netNHNL"],"momentumOdometer":momentum["raw"]["net3U3D"],
          "squeeze": s["psi"] if s["psi"] is not None else round(fuel,2)}
    summary={"score":score,"verdict":verdict,"bullets":bullets,
             "breadthIdx":float(round(breadth["pct"],2)),"momentumIdx":float(round(momentum["pct"],2)),
             "breadthState":"Strong" if breadth["pct"]>=55 else ("Weak" if breadth["pct"]<=45 else "Neutral"),
             "momentumState":"Strong" if momentum["pct"]>=55 else ("Weak" if momentum["pct"]<=45 else "Neutral"),
             "sectors":{"total": len(sectors_for_calc)}}

    # Build sector cards for the UI:
    sector_cards = source.get("sectorCards")
    if not sector_cards:
        sector_cards = _build_sector_cards_from_groups(source)

    out={"schema_version":SCHEMA_VERSION,"updated_at":now,
         "meta":{"ts":now,"version":"1.2-hourly","pipeline": os.environ.get("PIPELINE_TAG","hourly")},
         "gauges":gauges,"odometers":odos,"lights":lights,"summary":summary,
         "outlook":{"sectorCards": sector_cards}}
    jwrite(args.out,out)
    print(f"Wrote {args.out} | score={score} verdict={verdict}")

if __name__=="__main__":
    main()
