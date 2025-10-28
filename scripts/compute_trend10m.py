#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compute strategy.trend10m for /live/intraday (Lux-style)
- Colors: green (bull), red (bear), yellow (compression/chop)
- Uses EMA10 vs EMA20 posture, Accel (Δ breadth + Δ momentum), and PSI (tightness proxy)
"""

import json, sys, datetime, os

IN = "data/outlook_intraday.json"
OUT = IN

def now_iso():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def pick(obj, *path):
    for k in path:
        if not isinstance(obj, dict): return None
        obj = obj.get(k)
    return obj

def compute_state(j):
    # Inputs (with fallbacks)
    # You may already emit these; otherwise we infer from metrics/engineLights
    metrics = j.get("metrics") or {}
    eng     = j.get("engineLights") or {}

    # Posture/overall (fallbacks)
    overall_state = pick(eng, "overall", "state") or metrics.get("overall10m_state")
    ema_sign10m   = metrics.get("ema_sign_10m")    # +1 / -1 if you emit this
    accel10m      = metrics.get("accel_10m")       # Δ(breadth10m + momentum10m)
    psi10m        = metrics.get("psi_10m")         # 0..100 (tight=80..100)

    # Derive accel if not provided (best-effort)
    if accel10m is None:
        b_now = metrics.get("breadth_10m_pct")
        m_now = metrics.get("momentum_10m_pct")
        b_prev = metrics.get("breadth_10m_pct_prev")
        m_prev = metrics.get("momentum_10m_pct_prev")
        if all(isinstance(x, (int,float)) for x in (b_now,m_now,b_prev,m_prev)):
            accel10m = (b_now + m_now) - (b_prev + m_prev)

    # Decide
    reason = []
    # Compression rule first
    if isinstance(psi10m, (int,float)) and psi10m >= 80.0:
        return ("yellow", f"Compression (10m PSI≥80, psi={psi10m:.0f}%)")

    # Direction + momentum
    if isinstance(ema_sign10m, (int,float)) and isinstance(accel10m, (int,float)):
        if ema_sign10m > 0 and accel10m >= 3.0:
            return ("green", f"EMA10>20 and Accel+ ({accel10m:.1f})")
        if ema_sign10m < 0 and accel10m <= -3.0:
            return ("red", f"EMA10<20 and Accel- ({accel10m:.1f})")

    # Fallback to overall
    if str(overall_state).lower() == "bull":  return ("green",  "Overall(10m)=bull")
    if str(overall_state).lower() == "bear":  return ("red",    "Overall(10m)=bear")
    return ("yellow", "Neutral/transition")

def main():
    try:
        j = json.load(open(IN,"r",encoding="utf-8"))
    except Exception as e:
        print("[trend10m] cannot read", IN, e, file=sys.stderr)
        sys.exit(0)

    state, reason = compute_state(j)
    j.setdefault("strategy", {})
    j["strategy"]["trend10m"] = {
        "state": state,
        "reason": reason,
        "updatedAt": j.get("updated_at_utc") or j.get("updated_at") or now_iso()
    }

    json.dump(j, open(OUT,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    print("[trend10m]", j["strategy"]["trend10m"])

if __name__ == "__main__":
    main()
