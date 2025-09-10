#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (R1.3, robust + indentation-safe)
- Keeps your gauges/odometers/lights/summary logic
- Builds sectorCards from source['sectors'] (pref) or fallback to groups
- Writes BOTH top-level "sectorCards" and "outlook": {"sectorCards": [...]}
"""

from __future__ import annotations
import argparse
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

SCHEMA_VERSION = "r1.2"

WATER_MIN_F, WATER_MAX_F = 170, 255
OIL_MIN_PSI, OIL_MAX_PSI = 25, 80

WEIGHT_BREADTH  = 0.35
WEIGHT_MOMENTUM = 0.35
WEIGHT_FUEL     = 0.15
WEIGHT_LIQ      = 0.075
WEIGHT_WATER    = 0.075

FUEL_LOW_PCT = 25
OIL_LOW_PCT  = 25
WATER_OVERHEAT_PCT = 80

PREFERRED_ORDER = [
    "tech","materials","healthcare","communication services","real estate",
    "energy","consumer staples","consumer discretionary","financials","utilities","industrials"
]

# ---------------- utilities ----------------

def clamp(x, lo, hi): 
    return max(lo, min(hi, x))

def to_pct(v, assume_0_to_1=False):
    if v is None:
        return 50.0
    try:
        x = float(v)
    except:
        return 50.0
    if assume_0_to_1 and x <= 1.0:
        return clamp(x * 100.0, 0, 100)
    return clamp(x, 0, 100)

def map_linear(p, lo, hi):
    p = clamp(p, 0, 100)
    return lo + (hi - lo) * (p / 100.0)

def norm(s: str) -> str:
    return (s or "").strip().lower()

def order_key(sector_name: str) -> int:
    n = norm(sector_name)
    return PREFERRED_ORDER.index(n) if n in PREFERRED_ORDER else 999

def title_case(name: str) -> str:
    return " ".join(w.capitalize() for w in (name or "").split())

# ---------------- breadth / momentum ----------------

def derive_breadth_momentum(sectors: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    NH={"10NH","nh10","ten_day_new_highs","newhighs10","nh"}; NL={"10NL","nl10","ten_day_new_lows","newlows10","nl"}
    U ={"3U","three_up","threedayup","three_up_count","u"};  D ={"3D","three_down","threedaydown","three_down_count","d"}

    def get(d,keys):
        lk = {s.lower() for s in keys}
        for k in d.keys():
            if k.lower() in lk:
                try:
                    return int(d[k])
                except:
                    pass
        return 0

    tnh=tnl=tu=td=0
    for s in sectors or []:
        tnh += get(s,NH)
        tnl += get(s,NL)
        tu  += get(s,U)
        td  += get(s,D)

    nb = tnh - tnl
    db = max(1, tnh + tnl)
    nm = tu - td
    dm = max(1, tu + td)

    b = clamp(50 + 50*(nb/db), 0, 100)
    m = clamp(50 + 50*(nm/dm), 0, 100)

    breadth  = {"pct": b, "label": "Breadth",  "raw": {"netNHNL": nb, "totalNHNL": db}}
    momentum = {"pct": m, "label": "Momentum", "raw": {"net3U3D": nm, "total3U3D": dm}}
    return breadth, momentum

# ---------------- scoring ----------------

def score_and_verdict(b, m, f, w, o):
    s = WEIGHT_BREADTH*b + WEIGHT_MOMENTUM*m + WEIGHT_FUEL*f + WEIGHT_LIQ*o + WEIGHT_WATER*(100-w)
    s = int(round(s))
    if   s >= 70: v = "Risk-On"
    elif s >= 55: v = "Constructive"
    elif s >= 45: v = "Neutral"
    elif s >= 35: v = "Caution"
    else:         v = "Risk-Off"
    return s, v

# ---------------- source extraction ----------------

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
        "groups": src.get("groups"),
    }

# ---------------- lights & bullets ----------------

def lights_and_bullets(b,m,f,w,o,verdict,stale,sq,psi):
    def ring(p):
        if p >= 55: return "bullish"
        if p <= 45: return "bearish"
        return "neutral"
    lights = {
        "risk_off": verdict in ("Caution","Risk-Off"),
        "low_fuel": f <= FUEL_LOW_PCT,
        "low_oil":  o <= OIL_LOW_PCT,
        "overheat": w >= WATER_OVERHEAT_PCT,
        "stale_data": bool(stale),
        "breadth": ring(b),
        "momentum": ring(m)
    }
    bullets = [f"Breadth {int(round(b))}/100; Momentum {int(round(m))}/100."]
    if psi is not None:
        psi_str = f"{psi:.2f}" if 0.0 <= psi <= 1.0 else str(int(round(psi)))
        bullets.append(f"Squeeze: {sq}; Fuel PSI {psi_str} (~{int(round(f))}/100).")
    else:
        bullets.append(f"Squeeze: {sq}; Fuel ~{int(round(f))}/100.")
    bullets.append(f"Volatility ~{int(round(w))}/100; Liquidity ~{int(round(o))}/100.")
    if lights["overheat"]: bullets.append("Volatility running hot — expect chop/risk.")
    if lights["low_fuel"]: bullets.append("Fuel low — fewer squeezes powering trends.")
    if lights["low_oil"]:  bullets.append("Liquidity thin — size down / wider slips possible.")
    if stale: bullets.append("Data looks stale — check backend fetch.")
    return lights, bullets

# ---------------- sector helpers ----------------

def _groups_to_sector_list(groups: Dict[str, Any]) -> List[Dict[str, Any]]:
    sectors: List[Dict[str, Any]] = []
    if isinstance(groups, dict):
        for sec, cnt in groups.items():
            try:
                nh = int(cnt.get("nh",0)); nl = int(cnt.get("nl",0))
                u  = int(cnt.get("u",0));  d  = int(cnt.get("d",0))
            except Exception:
                nh = nl = u = d = 0
            sectors.append({"sector": sec, "10NH": nh, "10NL": nl, "3U": u, "3D": d})
    return sectors

def _classify_outlook(net_nh: float) -> str:
    if net_nh > 0: return "Bullish"
    if net_nh < 0: return "Bearish"
    return "Neutral"

def _title_case(name: str) -> str:
    return " ".join(w.capitalize() for w in (name or "").split())

def _build_cards_from_sectors_obj(sectors_obj: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    for name, vals in (sectors_obj or {}).items():
        nh  = int(vals.get("nh", 0))
        nl  = int(vals.get("nl", 0))
        u   = int(vals.get("u", 0))
        d   = int(vals.get("d", 0))
        net_nh = int(vals.get("netNH", nh - nl))
        net_ud = int(vals.get("netUD", u - d))
        spark  = vals.get("spark", [])
        cards.append({
            "sector":  _title_case(name),
            "outlook": _classify_outlook(net_nh),
            "spark":   spark if isinstance(spark, list) else [],
            "nh": nh, "nl": nl, "netNH": net_nh, "netUD": net_ud
        })
    cards.sort(key=lambda c: order_key(c["sector"]))
    return cards

def _build_cards_from_groups(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    groups = source.get("groups") or {}
    if isinstance(groups, dict):
        for sector, cnt in groups.items():
            try:
                nh = int(cnt.get("nh", 0))
                nl = int(cnt.get("nl", 0))
                u  = int(cnt.get("u", 0))
                d  = int(cnt.get("d", 0))
            except Exception:
                nh = nl = u = d = 0
            cards.append({
                "sector": _title_case(sector),
                "nh": nh, "nl": nl, "u": u, "d": d,
                "netNH": nh - nl, "netUD": u - d,
                "spark": cnt.get("spark", [])
            })
    cards.sort(key=lambda c: order_key(c["sector"]))
    return cards

# ---------------- JSON I/O ----------------

def jread(p):
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return None

def jwrite(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")  # ensure trailing newline

# ---------------- main ----------------

def main():
    ap = argparse.ArgumentParser(description="Build Ferrari Dashboard outlook.json")
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--mode",   default="intraday", choices=["intraday","eod"])
    args = ap.parse_args()

    source = jread(args.source) or {}
    prev   = jread(args.out) or {}

    s = extract_from_source(source)

    # choose sectors for calc
    if s["sectors"]:
        sectors_for_calc = s["sectors"]
    elif s.get("groups"):
        sectors_for_calc = _groups_to_sector_list(s["groups"])
    else:
        sectors_for_calc = []

    # breadth / momentum
    if not sectors_for_calc and prev:
        b_pct = float(prev.get("gauges",{}).get("rpm",{}).get("pct",50))
        m_pct = float(prev.get("gauges",{}).get("speed",{}).get("pct",50))
        breadth  = {"pct": b_pct, "label": "Breadth",  "raw":{"netNHNL":0,"totalNHNL":1}}
        momentum = {"pct": m_pct, "label": "Momentum", "raw":{"net3U3D":0,"total3U3D":1}}
    else:
        breadth, momentum = derive_breadth_momentum(sectors_for_calc)

    # map gauges
    fuel  = s["fuel"]; water = s["water"]; oil = s["oil"]
    waterF = int(round(map_linear(water, WATER_MIN_F, WATER_MAX_F)))
    oilPSI = int(round(map_linear(oil,   OIL_MIN_PSI,  OIL_MAX_PSI)))

    score, verdict = score_and_verdict(breadth["pct"], momentum["pct"], fuel, water, oil)

    # staleness
    stale = False
    ts = source.get("timestamp")
    if isinstance(ts, str):
        try:
            dt = datetime.fromisoformat(ts.replace("Z","+00:00"))
            stale = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds()/60.0 > 240
        except:
            pass

    lights, bullets = lights_and_bullets(breadth["pct"], momentum["pct"], fuel, water, oil, verdict, stale, s["sq"], s["psi"])

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    gauges = {
        "rpm":    {"pct": breadth["pct"],  "label":"Breadth",  "raw": breadth["raw"]},
        "speed":  {"pct": momentum["pct"], "label":"Momentum", "raw": momentum["raw"]},
        "fuel":   {"pct": fuel,  "psi": s["psi"], "state": s["sq"], "label": "Squeeze"},
        "water":  {"pct": water, "degF": waterF, "label": "Volatility"},
        "oil":    {"pct": oil,   "psi": oilPSI,  "label": "Liquidity"},

        "waterTemp": waterF,
        "oilPsi":    oilPSI,
        "fuelPct":   float(round(fuel, 2))
    }

    odos = {
        "breadth_net": breadth["raw"]["netNHNL"],
        "momentum_net": momentum["raw"]["net3U3D"],
        "squeeze_psi": s["psi"] if s["psi"] is not None else round(fuel,2),
        "breadthOdometer": breadth["raw"]["netNHNL"],
        "momentumOdometer": momentum["raw"]["net3U3D"],
        "squeeze": s["psi"] if s["psi"] is not None else round(fuel,2)
    }

    summary = {
        "score": score,
        "verdict": verdict,
        "bullets": bullets,
        "breadthIdx": float(round(breadth["pct"],2)),
        "momentumIdx": float(round(momentum["pct"],2)),
        "breadthState":  "Strong" if breadth["pct"]  >= 55 else ("Weak" if breadth["pct"]  <= 45 else "Neutral"),
        "momentumState": "Strong" if momentum["pct"] >= 55 else ("Weak" if momentum["pct"] <= 45 else "Neutral"),
        "sectors": {"total": len(sectors_for_calc)}
    }

    # ---- normalize sectorCards ----
    src_sectors = source.get("sectors")
    if isinstance(src_sectors, dict) and len(src_sectors) > 0:
        sector_cards = _build_cards_from_sectors_obj(src_sectors)
    else:
        sector_cards = _build_cards_from_groups(source)

    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": now,
        "ts": now,
        "version": "1.2-hourly",
        "pipeline": os.environ.get("PIPELINE_TAG","hourly"),
        "gauges": gauges,
        "odometers": odos,
        "lights": lights,
        "summary": summary,

        # keep old location for compatibility
        "sectorCards": sector_cards,

        # new preferred location: embed in outlook
        "outlook": {
            "sectorCards": sector_cards
        },

        "signals": {}   # optional: fill later
    }

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sector_cards)} | score={score} verdict={verdict}")

if __name__ == "__main__":
    main()
