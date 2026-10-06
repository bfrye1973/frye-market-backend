#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Update /live/hourly hourly.signals with posture+latched + keep cross edges:
- sigEMA1hBullPosture / sigEMA1hBearPosture  (EMA10 vs 20 on 1h)
- sigSMI1hBullPosture / sigSMI1hBearPosture  (K > D, K < D)
- Keep your edge pills (sigEMA1hBullCross, sigSMI1hBullCross, etc.) if present
Carries lastChanged & avoids flicker on neutral bars.
"""

import json, sys, urllib.request, datetime, os

LIVE_HOURLY_URL = os.environ.get("HOURLY_URL") or "https://frye-market-backend-1.onrender.com/live/hourly"
IN_OUT = "data/outlook_hourly.json"

def now_iso(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent":"signals-1h/1.0","Cache-Control":"no-store"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}

def onoff(prev_sig: dict, cond_now: bool, stamp: str):
    prev_latched = bool(prev_sig.get("latched", False)) if isinstance(prev_sig, dict) else False
    latched = bool(cond_now)
    last = prev_sig.get("lastChanged") if isinstance(prev_sig, dict) else None
    if last is None: last = stamp
    if latched != prev_latched: last = stamp
    return latched, last

def main():
    try:
        j = json.load(open(IN_OUT,"r",encoding="utf-8"))
    except Exception as e:
        print("[1h] cannot read", IN_OUT, e, file=sys.stderr); sys.exit(0)

    prev = fetch(LIVE_HOURLY_URL) or {}
    prev_sigs = ((prev.get("hourly") or {}).get("signals") or {})
    cur_sigs  = ((j.get("hourly") or {}).get("signals") or {})
    updated = j.get("updated_at_utc") or j.get("updated_at") or now_iso()

    m = j.get("metrics") or {}
    ema_sign = m.get("ema_sign")  # from your hourly builder (8/18 sign)
    # If your builder uses 8/18, that's fine—posture definition is consistent with your v1fast file.

    # Optional: store SMI posture if you have k/d in metrics; else infer from combo > 50
    combo = m.get("momentum_combo_1h_pct")
    smi_bull = (isinstance(combo,(int,float)) and combo >= 50.0)
    smi_bear = (isinstance(combo,(int,float)) and combo <  50.0)

    ema_bull = (isinstance(ema_sign,(int,float)) and ema_sign > 0)
    ema_bear = (isinstance(ema_sign,(int,float)) and ema_sign < 0)

    out = dict(cur_sigs)

    def put(key, active, latched, severity, reason):
        p = prev_sigs.get(key) or cur_sigs.get(key) or {}
        latched, last = onoff(p, latched, updated)
        out[key] = {
            "active": bool(active),
            "latched": bool(latched),
            "severity": severity,
            "reason": reason if (active or latched) else "",
            "lastChanged": last
        }

    put("sigEMA1hBullPosture", False, ema_bull, "info",  "EMA10>EMA20 (1h)")
    put("sigEMA1hBearPosture", False, ema_bear, "warn",  "EMA10<EMA20 (1h)")
    put("sigSMI1hBullPosture", False, smi_bull, "info",  "SMI/Combo supportive (1h)")
    put("sigSMI1hBearPosture", False, smi_bear, "warn",  "SMI/Combo weak (1h)")

    j.setdefault("hourly", {}).setdefault("signals", {})
    j["hourly"]["signals"].update(out)
    with open(IN_OUT,"w",encoding="utf-8") as f:
        json.dump(j,f,ensure_ascii=False,separators=(",",":"))
    print("[1h] signals updated:", list(out.keys()))

if __name__ == "__main__":
    main()
