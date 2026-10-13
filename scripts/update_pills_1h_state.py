#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Engine Lights — 1h pills as ALWAYS-ON STATE
- Writes hourly.signals.<key> = {state: bull|bear|neutral, recentCross, lastChanged}
- EMA posture from metrics.ema_sign
- SMI posture from combo >=/< 50 (or neutral if missing)
"""
import os
from _signals_utils import now_iso, fetch_json, load_json, save_json, carry_last_changed

IN_OUT = "data/outlook_hourly.json"
LIVE_URL = os.environ.get("HOURLY_URL") or "https://frye-market-backend-1.onrender.com/live/hourly"

def main():
    j = load_json(IN_OUT)
    prev_live = fetch_json(LIVE_URL)
    prev_sigs = ((prev_live.get("hourly") or {}).get("signals") or {})
    cur       = ((j.get("hourly") or {}).get("signals") or {})
    m = j.get("metrics") or {}
    stamp = j.get("updated_at_utc") or j.get("updated_at") or now_iso()

    ema_sign = m.get("ema_sign")  # your fast file emits +1/-1 for 8/18 posture
    ema_state = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else "neutral")

    combo = m.get("momentum_combo_1h_pct")
    if isinstance(combo,(int,float)):
        smi_state = "bull" if combo >= 50.0 else "bear"
    else:
        smi_state = "neutral"

    ov = ((j.get("hourly") or {}).get("overall1h") or {})
    over_state = str(ov.get("state") or "").lower()
    if over_state not in ("bull","bear","neutral"): over_state="neutral"

    # edge markers if your cross pills still populate (optional)
    rcross = False
    for k in ("sigEMA1hBullCross","sigEMA1hBearCross","sigSMI1hBullCross","sigSMI1hBearCross"):
        if cur.get(k,{}).get("active"): rcross=True

    out = dict(cur)
    def put(key, st, recent=False, reason=""):
        prev = prev_sigs.get(key) or cur.get(key) or {}
        last = carry_last_changed(prev, st, stamp)
        out[key] = {"state": st, "recentCross": bool(recent), "lastChanged": last, "reason": reason}

    put("sigOverall1h", over_state, False, f"overall(1h)={over_state}")
    put("sigEMA1h",     ema_state,  rcross, "EMA10 vs 20 (1h) posture")
    put("sigSMI1h",     smi_state,  rcross, "SMI/Combo (1h) posture")

    j.setdefault("hourly", {}).setdefault("signals", {})
    j["hourly"]["signals"].update(out)
    save_json(IN_OUT, j)
    print("[1h] pills:", {k: out[k]["state"] for k in ("sigOverall1h","sigEMA1h","sigSMI1h")})

if __name__ == "__main__":
    main()
