#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (Clean Rewrite R1.1, Option-A aliases)

What’s new vs R1:
- Adds Option-A fields used by GaugeCluster.jsx:
  gauges.waterTemp (°F), gauges.oilPsi (PSI), gauges.fuelPct (0–100)
  summary.breadthIdx, summary.momentumIdx, summary.breadthState, summary.momentumState,
  summary.sectors.{upBreadth, upMomentum, total}
  lights.breadth, lights.momentum  (ring color tokens: "bullish"|"bearish"|"neutral")
  odometers.breadthOdometer, odometers.momentumOdometer
  meta.ts (ISO timestamp, mirrors updated_at)

Keeps backward-compatible fields from R1:
  gauges.rpm/speed/fuel/water/oil, odometers.*, lights.*, summary.{score, verdict, bullets}
"""
from __future__ import annotations
import argparse, json, os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

SCHEMA_VERSION = "r1.1"

WATER_MIN_F, WATER_MAX_F = 170, 255
OIL_MIN_PSI, OIL_MAX_PSI = 25, 80

WEIGHT_BREADTH = 0.35
WEIGHT_MOMENTUM = 0.35
WEIGHT_FUEL = 0.15
WEIGHT_LIQ = 0.075
WEIGHT_WATER = 0.075  # inverse (lower vol is better)

FUEL_LOW_PCT = 25
OIL_LOW_PCT = 25
WATER_OVERHEAT_PCT = 80

INCLUDE_HISTORY_N = 0

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def to_pct(value: Optional[float], assume_0_to_1: bool = False) -> float:
    if value is None:
        return 50.0
    try:
        v = float(value)
    except Exception:
        return 50.0
    if assume_0_to_1 and v <= 1.0:
        return clamp(v * 100.0, 0.0, 100.0)
    return clamp(v, 0.0, 100.0)

def map_linear(pct: float, lo: float, hi: float) -> float:
    pct = clamp(pct, 0.0, 100.0)
    return lo + (hi - lo) * (pct / 100.0)

def derive_breadth_momentum(sectors: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str,int]]:
    NH_KEYS = {"10NH", "nh10", "ten_day_new_highs", "newhighs10"}
    NL_KEYS = {"10NL", "nl10", "ten_day_new_lows",  "newlows10"}
    U_KEYS  = {"3U", "three_up", "threedayup", "three_up_count"}
    D_KEYS  = {"3D", "three_down","threedaydown","three_down_count"}

    def get_lower(d: Dict[str, Any], keys: set) -> int:
        for k in d.keys():
            if k.lower() in keys:
                try: return int(d[k])
                except Exception: pass
        return 0

    total_nh = total_nl = total_u = total_d = 0
    up_breadth = up_momentum = total_sectors = 0

    for s in sectors or []:
        nh = get_lower(s, NH_KEYS)
        nl = get_lower(s, NL_KEYS)
        u  = get_lower(s, U_KEYS)
        d  = get_lower(s, D_KEYS)
        total_nh += nh; total_nl += nl
        total_u  += u;  total_d  += d
        total_sectors += 1
        if nh >= nl: up_breadth += 1
        if u  >= d:  up_momentum += 1

    net_nh_nl = total_nh - total_nl
    denom_b = max(1, total_nh + total_nl)
    breadth_pct = clamp(50.0 + 50.0 * (net_nh_nl / float(denom_b)), 0.0, 100.0)

    net_u_d = total_u - total_d
    denom_m = max(1, total_u + total_d)
    momentum_pct = clamp(50.0 + 50.0 * (net_u_d / float(denom_m)), 0.0, 100.0)

    breadth = {"pct": breadth_pct, "label": "Breadth", "raw": {"netNHNL": net_nh_nl, "totalNHNL": denom_b}}
    momentum = {"pct": momentum_pct, "label": "Momentum", "raw": {"net3U3D": net_u_d, "total3U3D": denom_m}}
    sector_meta = {"upBreadth": up_breadth, "upMomentum": up_momentum, "total": total_sectors}
    return breadth, momentum, sector_meta

def compute_score_and_verdict(breadth_pct: float, momentum_pct: float, fuel_pct: float, water_pct: float, oil_pct: float) -> Tuple[int,str]:
    water_inv = 100.0 - clamp(water_pct, 0.0, 100.0)
    score = (WEIGHT_BREADTH * clamp(breadth_pct, 0.0, 100.0)
           + WEIGHT_MOMENTUM * clamp(momentum_pct, 0.0, 100.0)
           + WEIGHT_FUEL * clamp(fuel_pct, 0.0, 100.0)
           + WEIGHT_LIQ * clamp(oil_pct, 0.0, 100.0)
           + WEIGHT_WATER * water_inv)
    score_i = int(round(score))
    if score_i >= 70: verdict = "Risk-On"
    elif score_i >= 55: verdict = "Constructive"
    elif score_i >= 45: verdict = "Neutral"
    elif score_i >= 35: verdict = "Caution"
    else: verdict = "Risk-Off"
    return score_i, verdict

def extract_from_source(src: Dict[str, Any]) -> Dict[str, Any]:
    sectors = src.get("sectors") or src.get("sector_counts") or []
    squeeze_state = (src.get("squeeze_state") or src.get("squeeze", {}).get("state") or "neutral").lower()
    raw_psi = src.get("squeeze_psi")
    if raw_psi is None:
        raw_psi = src.get("squeeze", {}).get("psi")
    if raw_psi is None:
        psi_pct = to_pct(src.get("squeeze_pressure_pct"))
        psi_value = None
    else:
        psi_pct = to_pct(raw_psi, assume_0_to_1=True)
        psi_value = float(raw_psi)
    fuel_pct = to_pct(src.get("squeeze_pressure_pct", psi_pct))
    water_pct = to_pct(src.get("volatility_pct") or src.get("volatility", {}).get("percentile"))
    oil_pct   = to_pct(src.get("liquidity_pct")  or src.get("liquidity", {}).get("pct"))
    return {"sectors": sectors, "squeeze_state": squeeze_state, "fuel_pct": fuel_pct,
            "psi_value": psi_value, "water_pct": water_pct, "oil_pct": oil_pct}

def compute_lights_and_bullets(breadth_pct: float, momentum_pct: float,
                               fuel_pct: float, water_pct: float, oil_pct: float,
                               verdict: str, stale: bool,
                               squeeze_state: str, psi_value: Optional[float]) -> Tuple[Dict[str, Any], List[str]]:
    # Ring color tokens for Option-A:
    def ring_state(pct: float) -> str:
        if pct >= 55: return "bullish"
        if pct <= 45: return "bearish"
        return "neutral"

    lights = {
        "risk_off": verdict in ("Caution", "Risk-Off"),
        "low_fuel": fuel_pct <= FUEL_LOW_PCT,
        "low_oil":  oil_pct  <= OIL_LOW_PCT,
        "overheat": water_pct >= WATER_OVERHEAT_PCT,
        "stale_data": bool(stale),
        # Option-A ring tokens:
        "breadth":  ring_state(breadth_pct),
        "momentum": ring_state(momentum_pct),
    }

    bullets: List[str] = []
    bullets.append(f"Breadth {int(round(breadth_pct))}/100; Momentum {int(round(momentum_pct))}/100.")
    if psi_value is not None:
        if 0.0 <= psi_value <= 1.0:
            bullets.append(f"Squeeze: {squeeze_state}; Fuel PSI {psi_value:.2f} (~{int(round(fuel_pct))}/100).")
        else:
            bullets.append(f"Squeeze: {squeeze_state}; Fuel PSI {psi_value:.0f} (~{int(round(fuel_pct))}/100).")
    else:
        bullets.append(f"Squeeze: {squeeze_state}; Fuel ~{int(round(fuel_pct))}/100.")
    bullets.append(f"Volatility ~{int(round(water_pct))}/100; Liquidity ~{int(round(oil_pct))}/100.")
    if lights["overheat"]: bullets.append("Volatility running hot — expect chop/risk.")
    if lights["low_fuel"]: bullets.append("Fuel low — fewer squeezes powering trends.")
    if lights["low_oil"]:  bullets.append("Liquidity thin — size down / wider slips possible.")
    if stale:              bullets.append("Data looks stale — check backend fetch.")
    return lights, bullets

def build_dashboard(source: Dict[str, Any], prev_outlook: Optional[Dict[str, Any]]=None,
                    include_history_n: int = INCLUDE_HISTORY_N,
                    history_lines: Optional[List[Dict[str, Any]]]=None) -> Dict[str, Any]:
    s = extract_from_source(source or {})
    sectors = s["sectors"]
    if not sectors and prev_outlook:
        prev_b = float(prev_outlook.get("gauges", {}).get("rpm", {}).get("pct", 50.0))
        prev_m = float(prev_outlook.get("gauges", {}).get("speed", {}).get("pct", 50.0))
        breadth = {"pct": prev_b, "label":"Breadth", "raw":{"netNHNL":0,"totalNHNL":1}}
        momentum = {"pct": prev_m, "label":"Momentum","raw":{"net3U3D":0,"total3U3D":1}}
        sector_meta = {"upBreadth": 0, "upMomentum": 0, "total": 0}
    else:
        breadth, momentum, sector_meta = derive_breadth_momentum(sectors)

    fuel_pct, water_pct, oil_pct = s["fuel_pct"], s["water_pct"], s["oil_pct"]
    water_degF = int(round(map_linear(water_pct, WATER_MIN_F, WATER_MAX_F)))
    oil_psi    = int(round(map_linear(oil_pct,   OIL_MIN_PSI, OIL_MAX_PSI)))

    score, verdict = compute_score_and_verdict(breadth["pct"], momentum["pct"], fuel_pct, water_pct, oil_pct)

    stale = False
    src_ts = source.get("timestamp") or source.get("updated_at")
    if isinstance(src_ts, str):
        try:
            from datetime import datetime, timezone
            dt = datetime.fromisoformat(src_ts.replace("Z", "+00:00"))
            stale = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 60.0 > 240
        except Exception:
            pass

    lights, bullets = compute_lights_and_bullets(
        breadth["pct"], momentum["pct"], fuel_pct, water_pct, oil_pct,
        verdict, stale, s["squeeze_state"], s["psi_value"]
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    gauges = {
        # Original names (kept)
        "rpm":   breadth,
        "speed": momentum,
        "fuel":  {"pct": fuel_pct, "psi": s["psi_value"], "state": s["squeeze_state"], "label":"Squeeze"},
        "water": {"pct": water_pct, "degF": water_degF, "label":"Volatility"},
        "oil":   {"pct": oil_pct,   "psi": oil_psi,    "label":"Liquidity"},
        # Option-A aliases (flat numeric readouts)
        "waterTemp": water_degF,
        "oilPsi":    oil_psi,
        "fuelPct":   float(round(fuel_pct, 2)),
    }

    # Odometers: keep old + provide Option-A names
    odometers = {
        "breadth_net": breadth["raw"]["netNHNL"],
        "momentum_net": momentum["raw"]["net3U3D"],
        "squeeze_psi": s["psi_value"] if s["psi_value"] is not None else round(fuel_pct, 2),
        "breadthOdometer": breadth["raw"]["netNHNL"],     # Option-A
        "momentumOdometer": momentum["raw"]["net3U3D"],   # Option-A
        "squeeze": s["psi_value"] if s["psi_value"] is not None else round(fuel_pct, 2),  # Option-A
    }

    # Summary expanded for Option-A
    def state_from_idx(idx: float) -> str:
        if idx >= 55: return "Strong"
        if idx <= 45: return "Weak"
        return "Neutral"

    summary = {
        "score": score,
        "verdict": verdict,
        "bullets": bullets,
        # Option-A fields
        "breadthIdx": float(round(breadth["pct"], 2)),
        "momentumIdx": float(round(momentum["pct"], 2)),
        "breadthState": state_from_idx(breadth["pct"]),
        "momentumState": state_from_idx(momentum["pct"]),
        "sectors": sector_meta,  # {upBreadth, upMomentum, total}
    }

    out: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": now_iso,
        "meta": { "ts": now_iso },  # Option-A convenience
        "gauges": gauges,
        "odometers": odometers,
        "lights": lights,
        "summary": summary,
        # pass through any prebuilt outlook/sectors if present upstream (frontend uses these)
        "outlook": {
            "sectorCards": source.get("sectorCards") or source.get("sectors_cards") or []
        }
    }

    if INCLUDE_HISTORY_N and history_lines:
        out["history"] = history_lines[-INCLUDE_HISTORY_N:]

    return out

def load_json(path: str) -> Optional[Dict[str, Any]]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path: str, payload: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def append_history_line(path: str, snapshot: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    line = json.dumps({
        "t": snapshot.get("updated_at"),
        "score": snapshot.get("summary", {}).get("score"),
        "verdict": snapshot.get("summary", {}).get("verdict"),
        "rpm": snapshot.get("gauges", {}).get("rpm", {}).get("pct"),
        "speed": snapshot.get("gauges", {}).get("speed", {}).get("pct"),
        "fuel": snapshot.get("gauges", {}).get("fuel", {}).get("pct"),
        "water": snapshot.get("gauges", {}).get("water", {}).get("pct"),
        "oil": snapshot.get("gauges", {}).get("oil", {}).get("pct"),
    }, ensure_ascii=False)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def read_history_lines(path: str, max_lines: int = 2000) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if not line.strip(): continue
                try: out.append(json.loads(line))
                except Exception: pass
                if len(out) >= max_lines: break
    except FileNotFoundError:
        pass
    return out

def main():
    ap = argparse.ArgumentParser(description="Build Ferrari Dashboard outlook.json (Option-A aliases)")
    ap.add_argument("--source",  default="data/outlook_source.json")
    ap.add_argument("--out",     default="data/outlook.json")
    ap.add_argument("--history", default="data/outlook_history.jsonl")
    ap.add_argument("--include-history", type=int, default=INCLUDE_HISTORY_N)
    args = ap.parse_args()

    source = load_json(args.source) or {}
    prev   = load_json(args.out) or {}
    hist   = read_history_lines(args.history)

    payload = build_dashboard(source, prev_outlook=prev,
                              include_history_n=args.include_history,
                              history_lines=hist)

    write_json(args.out, payload)
    append_history_line(args.history, payload)
    print(f"Wrote {args.out} (schema={SCHEMA_VERSION}) | score={payload['summary']['score']} verdict={payload['summary']['verdict']}")

if __name__ == "__main__":
    main()
