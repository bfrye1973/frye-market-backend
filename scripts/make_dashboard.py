#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (R1.2, Option-A + groups adapter + version tag)

- Emits complete gauges (rpm/speed/fuel/water/oil) and summary (score, verdict, bullets)
- Adds Option-A aliases used by GaugeCluster.jsx:
  gauges.waterTemp, gauges.oilPsi, gauges.fuelPct
  summary.breadthIdx, summary.momentumIdx, breadth/momentum State
  lights.breadth, lights.momentum ("bullish"|"bearish"|"neutral")
  odometers.breadthOdometer, odometers.momentumOdometer, odometers.squeeze
- Accepts both new `sectors` (list) and old `groups` (dict) shapes from source
"""

from __future__ import annotations
import argparse, json, os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

SCHEMA_VERSION = "r1.2"

WATER_MIN_F, WATER_MAX_F = 170, 255
OIL_MIN_PSI, OIL_MAX_PSI = 25, 80

WEIGHT_BREADTH = 0.35
WEIGHT_MOMENTUM = 0.35
WEIGHT_FUEL = 0.15
WEIGHT_LIQ = 0.075
WEIGHT_WATER = 0.075  # inverse

FUEL_LOW_PCT = 25
OIL_LOW_PCT = 25
WATER_OVERHEAT_PCT = 80

def clamp(x, lo, hi): return max(lo, min(hi, x))
def to_pct(val, assume_0_to_1=False):
    if val is None: return 50.0
    try: v = float(val)
    except Exception: return 50.0
    if assume_0_to_1 and v <= 1.0: return clamp(v*100.0, 0.0, 100.0)
    return clamp(v, 0.0, 100.0)
def map_linear(p, lo, hi): p = clamp(p,0,100); return lo + (hi-lo)*(p/100.0)

def derive_breadth_momentum(sectors: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    NH_KEYS = {"10NH","nh10","ten_day_new_highs","newhighs10","nh"}
    NL_KEYS = {"10NL","nl10","ten_day_new_lows","newlows10","nl"}
    U_KEYS  = {"3U","three_up","threedayup","three_up_count","u"}
    D_KEYS  = {"3D","three_down","threedaydown","three_down_count","d"}
    def get_lower(d, keys):
        for k in d.keys():
            if k.lower() in keys:
                try: return int(d[k])
                except: pass
        return 0
    total_nh=total_nl=total_u=total_d=0
    for s in sectors or []:
        total_nh += get_lower(s, NH_KEYS); total_nl += get_lower(s, NL_KEYS)
        total_u  += get_lower(s, U_KEYS);  total_d  += get_lower(s, D_KEYS)
    net_nh_nl = total_nh - total_nl; denom_b = max(1, total_nh + total_nl)
    net_u_d   = total_u  - total_d;  denom_m = max(1, total_u  + total_d)
    breadth_pct  = clamp(50.0 + 50.0*(net_nh_nl/float(denom_b)), 0.0, 100.0)
    momentum_pct = clamp(50.0 + 50.0*(net_u_d/float(denom_m)),   0.0, 100.0)
    breadth = {"pct": breadth_pct, "label": "Breadth", "raw": {"netNHNL": net_nh_nl, "totalNHNL": denom_b}}
    momentum= {"pct": momentum_pct,"label": "Momentum","raw":{"net3U3D": net_u_d,  "total3U3D": denom_m}}
    return breadth, momentum

def compute_score_and_verdict(b, m, f, w, o):
    water_inv = 100.0 - clamp(w, 0, 100)
    score = WEIGHT_BREADTH*b + WEIGHT_MOMENTUM*m + WEIGHT_FUEL*f + WEIGHT_LIQ*o + WEIGHT_WATER*water_inv
    score_i = int(round(score))
    if score_i >= 70: verdict = "Risk-On"
    elif score_i >= 55: verdict = "Constructive"
    elif score_i >= 45: verdict = "Neutral"
    elif score_i >= 35: verdict = "Caution"
    else: verdict = "Risk-Off"
    return score_i, verdict

def extract_from_source(src: Dict[str, Any]) -> Dict[str, Any]:
    sectors = src.get("sectors") or src.get("sector_counts") or []

    # Adapter: map old {"groups": { sector: {nh,nl,u,d} }} to list for breadth/momentum
    if not sectors and isinstance(src.get("groups"), dict):
        sectors = []
        for sec_name, cnt in src["groups"].items():
            sectors.append({
                "sector": sec_name,
                "10NH": cnt.get("nh", 0),
                "10NL": cnt.get("nl", 0),
                "3U":   cnt.get("u",  0),
                "3D":   cnt.get("d",  0),
            })

    squeeze_state = (src.get("squeeze_state")
                     or src.get("global", {}).get("squeeze_state")
                     or src.get("squeeze", {}).get("state") or "neutral").lower()

    raw_psi = src.get("squeeze_psi") or src.get("squeeze", {}).get("psi")
    if raw_psi is None:
        psi_pct = to_pct(src.get("squeeze_pressure_pct") or src.get("global", {}).get("squeeze_pressure_pct"))
        psi_value = None
    else:
        psi_pct = to_pct(raw_psi, assume_0_to_1=True)
        psi_value = float(raw_psi)

    fuel_pct = to_pct(src.get("squeeze_pressure_pct") or src.get("global", {}).get("squeeze_pressure_pct") or psi_pct)
    water_pct= to_pct(src.get("volatility_pct") or src.get("global", {}).get("volatility_pct"))
    oil_pct  = to_pct(src.get("liquidity_pct")  or src.get("global", {}).get("liquidity_pct"))

    return {"sectors": sectors, "squeeze_state": squeeze_state, "fuel_pct": fuel_pct,
            "psi_value": psi_value, "water_pct": water_pct, "oil_pct": oil_pct}

def compute_lights_and_bullets(b, m, f, w, o, verdict, stale, squeeze_state, psi_value):
    def ring_state(pct):
        if pct >= 55: return "bullish"
        if pct <= 45: return "bearish"
        return "neutral"
    lights = {
        "risk_off": verdict in ("Caution","Risk-Off"),
        "low_fuel": f <= FUEL_LOW_PCT,
        "low_oil":  o <= OIL_LOW_PCT,
        "overheat": w >= WATER_OVERHEAT_PCT,
        "stale_data": bool(stale),
        "breadth":  ring_state(b),
        "momentum": ring_state(m),
    }
    bullets = [f"Breadth {int(round(b))}/100; Momentum {int(round(m))}/100."]
    if psi_value is not None:
        if 0.0 <= psi_value <= 1.0: bullets.append(f"Squeeze: {squeeze_state}; Fuel PSI {psi_value:.2f} (~{int(round(f))}/100).")
        else:                       bullets.append(f"Squeeze: {squeeze_state}; Fuel PSI {psi_value:.0f} (~{int(round(f))}/100).")
    else:
        bullets.append(f"Squeeze: {squeeze_state}; Fuel ~{int(round(f))}/100.")
    bullets.append(f"Volatility ~{int(round(w))}/100; Liquidity ~{int(round(o))}/100.")
    if lights["overheat"]: bullets.append("Volatility running hot — expect chop/risk.")
    if lights["low_fuel"]: bullets.append("Fuel low — fewer squeezes powering trends.")
    if lights["low_oil"]:  bullets.append("Liquidity thin — size down / wider slips possible.")
    if stale:              bullets.append("Data looks stale — check backend fetch.")
    return lights, bullets

def load_json(path):
    try:
        with open(path,"r",encoding="utf-8") as f: return json.load(f)
    except Exception: return None

def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path,"w",encoding="utf-8") as f: json.dump(payload,f,ensure_ascii=False,indent=2)

def main():
    ap = argparse.ArgumentParser(description="Build Ferrari Dashboard outlook.json")
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--history",default="data/outlook_history.jsonl")
    args = ap.parse_args()

    source = load_json(args.source) or {}
    prev   = load_json(args.out) or {}

    s = extract_from_source(source)

    # Breadth/Momentum
    if not s["sectors"] and prev:
        breadth_pct = float(prev.get("gauges",{}).get("rpm",{}).get("pct",50.0))
        momentum_pct= float(prev.get("gauges",{}).get("speed",{}).get("pct",50.0))
        breadth = {"pct":breadth_pct,"label":"Breadth","raw":{"netNHNL":0,"totalNHNL":1}}
        momentum={"pct":momentum_pct,"label":"Momentum","raw":{"net3U3D":0,"total3U3D":1}}
    else:
        breadth, momentum = derive_breadth_momentum(s["sectors"])

    fuel_pct  = s["fuel_pct"]; water_pct = s["water_pct"]; oil_pct = s["oil_pct"]
    water_degF = int(round(map_linear(water_pct, WATER_MIN_F, WATER_MAX_F)))
    oil_psi    = int(round(map_linear(oil_pct,   OIL_MIN_PSI, OIL_MAX_PSI)))

    score, verdict = compute_score_and_verdict(breadth["pct"], momentum["pct"], fuel_pct, water_pct, oil_pct)

    stale=False
    src_ts = source.get("timestamp") or source.get("updated_at")
    if isinstance(src_ts, str):
        try:
            dt = datetime.fromisoformat(src_ts.replace("Z","+00:00"))
            stale = (datetime.now(timezone.utc)-dt.astimezone(timezone.utc)).total_seconds()/60.0 > 240
        except Exception:
            pass

    lights, bullets = compute_lights_and_bullets(breadth["pct"], momentum["pct"], fuel_pct, water_pct, oil_pct,
                                                 verdict, stale, s["squeeze_state"], s["psi_value"])

    now_iso = datetime.now(timezone.utc).isoformat()
    gauges = {
        "rpm": breadth,
        "speed": momentum,
        "fuel":  {"pct": fuel_pct, "psi": s["psi_value"], "state": s["squeeze_state"], "label":"Squeeze"},
        "water": {"pct": water_pct, "degF": water_degF, "label":"Volatility"},
        "oil":   {"pct": oil_pct,   "psi": oil_psi,    "label":"Liquidity"},
        # Option-A flat readouts
        "waterTemp": water_degF,
        "oilPsi":    oil_psi,
        "fuelPct":   float(round(fuel_pct,2)),
    }
    odometers = {
        "breadth_net": gauges["rpm"]["raw"]["netNHNL"],
        "momentum_net":gauges["speed"]["raw"]["net3U3D"],
        "squeeze_psi": s["psi_value"] if s["psi_value"] is not None else round(fuel_pct,2),
        "breadthOdometer": gauges["rpm"]["raw"]["netNHNL"],
        "momentumOdometer":gauges["speed"]["raw"]["net3U3D"],
        "squeeze": s["psi_value"] if s["psi_value"] is not None else round(fuel_pct,2),
    }
    summary = {
        "score": score,
        "verdict": verdict,
        "bullets": bullets,
        "breadthIdx": float(round(breadth["pct"],2)),
        "momentumIdx":float(round(momentum["pct"],2)),
        "breadthState": "Strong" if breadth["pct"]>=55 else ("Weak" if breadth["pct"]<=45 else "Neutral"),
        "momentumState":"Strong" if momentum["pct"]>=55 else ("Weak" if momentum["pct"]<=45 else "Neutral"),
        "sectors": { "total": len(s["sectors"]) if isinstance(s["sectors"], list) else 0 }
    }
    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": now_iso,
        "meta": {"ts": now_iso, "version": "1.2-hourly"},
        "gauges": gauges,
        "odometers": odometers,
        "lights": lights,
        "summary": summary,
        "outlook": {"sectorCards": source.get("sectorCards") or []}
    }
    write_json(args.out, out)
    print(f"Wrote {args.out} (schema={SCHEMA_VERSION}) | score={score} verdict={verdict}")

if __name__ == "__main__":
    main()
