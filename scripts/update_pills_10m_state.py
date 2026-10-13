#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Engine Lights — 10m pills as ALWAYS-ON STATE
- Writes engineLights.signals.<key> = {state: bull|bear|neutral, recentCross: bool, lastChanged: ts}
- Uses EMA posture, overall, accel (with mild hysteresis), candle color optional
"""
import os
from _signals_utils import now_iso, fetch_json, load_json, save_json, carry_last_changed

IN_OUT = "data/outlook_intraday.json"
LIVE_URL = os.environ.get("INTRADAY_URL") or "https://frye-market-backend-1.onrender.com/live/intraday"

def tone_from_bool(up: bool, down: bool):
    if up and not down: return "bull"
    if down and not up: return "bear"
    return "neutral"

def main():
    j = load_json(IN_OUT)
    prev_live = fetch_json(LIVE_URL)
    prev_sigs = ((prev_live.get("engineLights") or {}).get("signals") or {})
    cur = ((j.get("engineLights") or {}).get("signals") or {})
    m = j.get("metrics") or {}
    stamp = j.get("updated_at_utc") or j.get("updated_at") or now_iso()

    # ---- Inputs (defensive) ----
    ema_sign = m.get("ema_sign_10m")              # +1/-1 if present
    overall  = (j.get("engineLights") or {}).get("overall") or {}
    overall_state = str(overall.get("state") or "").lower()  # bull|bear|neutral
    b_now,m_now,b_prev,m_prev = m.get("breadth_10m_pct"), m.get("momentum_10m_pct"), m.get("breadth_10m_pct_prev"), m.get("momentum_10m_pct_prev")
    accel = None
    if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
        accel = (b_now+m_now) - (b_prev+m_prev)

    # Mild hysteresis for accel to avoid flicker
    prev_acc = (prev_sigs.get("sigAccel10m") or {}).get("state")
    if isinstance(accel,(int,float)):
        if prev_acc == "bull" and accel < +1.0:   accel_state = "neutral" if accel > -1.0 else "bear"
        elif prev_acc == "bear" and accel > -1.0: accel_state = "neutral" if accel < +1.0 else "bull"
        else:
            accel_state = "bull" if accel >= +2.0 else ("bear" if accel <= -2.0 else "neutral")
    else:
        accel_state = prev_acc or "neutral"

    ema_state  = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else "neutral")
    over_state = overall_state if overall_state in ("bull","bear","neutral") else "neutral"

    # Optional: “Candle up” alignment (if you emit it)
    candle_up_state = "bull" if bool(m.get("candle_up_10m", False)) else "bear" if m.get("candle_down_10m", False) else "neutral"

    # Edge cross markers if your builder drops them (bool recentCross)
    recent_ema_cross_up   = bool(cur.get("sigEMA10BullCross",{}).get("active") or 0)
    recent_ema_cross_down = bool(cur.get("sigEMA10BearCross",{}).get("active") or 0)
    recent_cross = recent_ema_cross_up or recent_ema_cross_down

    # ---- Compose ALWAYS-ON pills ----
    out = dict(cur)

    def put(key, new_state: str, recent: bool=False, reason: str=""):
        prev = prev_sigs.get(key) or cur.get(key) or {}
        last = carry_last_changed(prev, new_state, stamp)
        out[key] = {"state": new_state, "recentCross": bool(recent), "lastChanged": last, "reason": reason}

    put("sigOverall10m",  over_state, False, f"overall(10m)={over_state}")
    put("sigEMA10m",      ema_state,  recent_cross, "EMA10 vs 20 (10m) posture")
    put("sigAccel10m",    accel_state, False, f"Δ(breadth+momentum)={'n/a' if accel is None else round(accel,2)}")
    put("sigCandle10m",   candle_up_state, False, "close>open → bull; close<open → bear")

    # ---- Write back ----
    j.setdefault("engineLights", {}).setdefault("signals", {})
    j["engineLights"]["signals"].update(out)
    save_json(IN_OUT, j)
    print("[10m] pills:", {k: out[k]["state"] for k in ("sigOverall10m","sigEMA10m","sigAccel10m","sigCandle10m")})

if __name__ == "__main__":
    main()
