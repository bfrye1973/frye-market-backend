#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Update /live/intraday engineLights.signals with:
- Posture (latched) signals that stay on while conditions hold
- Edge 'cross' signals (kept if you already emit them)
- Accel Up/Down with hysteresis (+2 on / <+1 off) to avoid flicker
Carries lastChanged from previous live JSON.

Writes back into data/outlook_intraday.json
"""

import json, sys, urllib.request, datetime, os

LIVE_INTRADAY_URL = os.environ.get("INTRADAY_URL") or "https://frye-market-backend-1.onrender.com/live/intraday"
IN_OUT = "data/outlook_intraday.json"

def now_iso(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def fetch_json(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"User-Agent":"signals-10m/1.0", "Cache-Control":"no-store"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}

def get(j, *keys, default=None):
    for k in keys:
        if not isinstance(j, dict): return default
        j = j.get(k)
    return j

def onoff(prev_latched: bool, cond_now: bool, default_ts: str, prev_sig: dict):
    """Return (latched, lastChanged) with timestamp carry."""
    was = bool(prev_latched)
    latched = bool(cond_now)
    if prev_sig and isinstance(prev_sig, dict):
        was = bool(prev_sig.get("latched", was))
    last_changed = prev_sig.get("lastChanged") if isinstance(prev_sig, dict) else None
    if last_changed is None: last_changed = default_ts
    if latched != was:
        last_changed = default_ts
    return latched, last_changed

def main():
    try:
        j = json.load(open(IN_OUT, "r", encoding="utf-8"))
    except Exception as e:
        print("[10m] cannot read", IN_OUT, e, file=sys.stderr)
        sys.exit(0)

    prev = fetch_json(LIVE_INTRADAY_URL) or {}
    prev_sigs = get(prev, "engineLights", "signals", default={}) or {}
    cur_sigs  = get(j, "engineLights", "signals", default={}) or {}
    updated   = j.get("updated_at_utc") or j.get("updated_at") or now_iso()

    # Pull metrics we need (use 0 if missing)
    m = j.get("metrics") or {}
    # EMA posture sign (+1/-1) and 10m shove parts
    ema_sign = m.get("ema_sign_10m")
    b_now = m.get("breadth_10m_pct"); m_now = m.get("momentum_10m_pct")
    b_prev = m.get("breadth_10m_pct_prev"); m_prev = m.get("momentum_10m_pct_prev")
    # candle color (last closed bar)
    last_candle_up = bool(m.get("candle_up_10m", False))  # optional; default False

    # Build deltas safely
    accel_delta = None
    try:
        if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
            accel_delta = (b_now + m_now) - (b_prev + m_prev)
    except Exception:
        accel_delta = None

    # --- Posture conditions (latched) ---
    ema_bull_posture = (isinstance(ema_sign,(int,float)) and ema_sign > 0)
    ema_bear_posture = (isinstance(ema_sign,(int,float)) and ema_sign < 0)

    # Accel hysteresis: turn ON at +2.0, turn OFF below +1.0
    prev_accel_up_sig   = cur_sigs.get("sigAccelUp") or {}
    prev_accel_down_sig = cur_sigs.get("sigAccelDown") or {}
    prev_accel_up_lat   = bool(prev_accel_up_sig.get("latched", False))
    prev_accel_dn_lat   = bool(prev_accel_down_sig.get("latched", False))

    accel_up_now = False
    accel_dn_now = False
    if isinstance(accel_delta,(int,float)):
        if prev_accel_up_lat:
            accel_up_now = (accel_delta >= 1.0)   # stay on unless it fades under +1
        else:
            accel_up_now = (accel_delta >= 2.0)   # require a bit more to turn on

        if prev_accel_dn_lat:
            accel_dn_now = (accel_delta <= -1.0)
        else:
            accel_dn_now = (accel_delta <= -2.0)

    # Overall state latch (if you publish it under engineLights.overall.state)
    overall_state = get(j, "engineLights", "overall", "state", default=None)
    overall_bull = str(overall_state).lower() == "bull"
    overall_bear = str(overall_state).lower() == "bear"

    # Compose/merge signals ---------------

    out_sigs = dict(cur_sigs)  # start from current (so we keep any legacy keys)

    def put(key, active, latched, severity, reason):
        prev_sig = prev_sigs.get(key) or cur_sigs.get(key) or {}
        latched, last_changed = onoff(bool(prev_sig.get("latched", False)), bool(latched), updated, prev_sig)
        out_sigs[key] = {
            "active": bool(active),
            "latched": bool(latched),
            "severity": severity,
            "reason": reason if (active or latched) else "",
            "lastChanged": last_changed
        }

    # EMA posture pills (these are the ones you want to stay green/red)
    put("sigEMA10BullPosture", active=False, latched=ema_bull_posture, severity="info",
        reason="EMA10>EMA20 (10m)")

    put("sigEMA10BearPosture", active=False, latched=ema_bear_posture, severity="warn",
        reason="EMA10<EMA20 (10m)")

    # Overall posture pill
    put("sigOverallBull", active=False, latched=overall_bull, severity="info",
        reason="overall(10m)=bull")

    put("sigOverallBear", active=False, latched=overall_bear, severity="warn",
        reason="overall(10m)=bear")

    # Accel Up/Down with hysteresis
    put("sigAccelUp", active=(accel_delta is not None and accel_delta >= 2.0),
        latched=accel_up_now, severity="info",
        reason=f"Δ(breadth+momentum)={accel_delta:.2f}" if accel_delta is not None else "n/a")

    put("sigAccelDown", active=(accel_delta is not None and accel_delta <= -2.0),
        latched=accel_dn_now, severity="warn",
        reason=f"Δ(breadth+momentum)={accel_delta:.2f}" if accel_delta is not None else "n/a")

    # Optional: candle alignment pill (on while green candle + bullish posture)
    if last_candle_up and ema_bull_posture:
        put("sigCandleUp10m", active=True, latched=True, severity="info", reason="Close>Open + EMA bull")
    else:
        put("sigCandleUp10m", active=False, latched=False, severity="info", reason="")

    # Write back
    j.setdefault("engineLights", {}).setdefault("signals", {})
    j["engineLights"]["signals"].update(out_sigs)
    with open(IN_OUT, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, separators=(",",":"))
    print("[10m] signals updated:", list(out_sigs.keys()))

if __name__ == "__main__":
    main()
