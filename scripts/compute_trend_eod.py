#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_eod.py — Lux Trend (Daily) post-processor
- Reads data/outlook.json (no external API)
- Writes strategy.trendEOD and luxTrend1d
- Guarantees daily pills (sigOverall1d, sigEMA1d, sigSMI1d) in j["daily"]["signals"]
  If you don't use a 'daily' block, we still write strategy/lux blocks safely.
"""

import json, datetime

DAILY_PATH = "data/outlook.json"

CAL = {
    "trend_strength": {"red_max": 39.99, "yellow_min": 40.0, "green_min": 60.0},
    "vol_scaled": {"low_max": 39.99, "moderate_min": 40.0, "high_min": 70.0},
    "squeeze": {"open_max": 29.99, "building_min": 30.0, "tight_min": 70.0},
    "vol_flow": {"bear_max": -3.0, "neutral_min": -3.0, "bull_min": 3.0},
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x,lo,hi): return max(lo,min(hi,x))

def load_json(p):
    try: return json.load(open(p,"r",encoding="utf-8"))
    except Exception: return {}

def save_json(p,obj):
    json.dump(obj, open(p,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def carry_last_changed(prev,new_state,stamp):
    prev_state=(prev or {}).get("state")
    last=(prev or {}).get("lastChanged") or stamp
    if prev_state!=new_state: last=stamp
    return last

def band_trend(x):
    if x is None: return "yellow"
    return "green" if x >= CAL["trend_strength"]["green_min"] else ("yellow" if x >= CAL["trend_strength"]["yellow_min"] else "red")

def band_vol_scaled(x):
    if x is None: return "yellow"
    return "green" if x < CAL["vol_scaled"]["low_max"] else ("red" if x >= CAL["vol_scaled"]["high_min"] else "yellow")

def band_squeeze(p): 
    if p is None: return "yellow"
    return "red" if p >= CAL["squeeze"]["tight_min"] else ("yellow" if p >= CAL["squeeze"]["building_min"] else "green")

def band_flow(vs):
    if vs is None: return "yellow"
    return "green" if vs > CAL["vol_flow"]["bull_min"] else ("red" if vs < CAL["vol_flow"]["bear_max"] else "yellow")

def main():
    j = load_json(DAILY_PATH)
    if not j:
        print("[daily] outlook.json missing"); return
    now = utc_now()

    m = j.get("metrics") or {}
    # Try daily-specific names first; fallback to generic if absent
    ts_pct = m.get("trend_strength_daily_pct") or m.get("trend_strength_pct")
    squeeze = m.get("squeeze_daily_pct") or m.get("squeeze_pct")
    vol_pct = m.get("volatility_daily_pct") or m.get("volatility_pct")
    vol_scaled = m.get("volatility_daily_scaled") or m.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        MIN_PCT, MAX_PCT = 0.20, 2.50
        vol_scaled = 100.0*max(0.0, min(1.0, (vol_pct-MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9)))

    vs_signed = m.get("volume_sentiment_daily_pct") or m.get("volume_sentiment_pct")

    # If trend strength missing, derive light proxy from daily trendDaily/trend or EMA posture flags if you have them
    if not isinstance(ts_pct,(int,float)):
        daily_trend = ((j.get("trendDaily") or {}).get("trend") or {}).get("emaSlope")
        if isinstance(daily_trend,(int,float)):
            ts_pct = clamp(50.0 + daily_trend*0.5, 0.0, 100.0)
        else:
            ts_pct = 60.0  # default to trending bias for daily if unknown (safe, will be green)

    ts_band = band_trend(ts_pct)
    vol_band = band_vol_scaled(vol_scaled if isinstance(vol_scaled,(int,float)) else None)
    sq_band  = band_squeeze(squeeze if isinstance(squeeze,(int,float)) else None)
    flow_band= band_flow(vs_signed if isinstance(vs_signed,(int,float)) else None)

    # strategy.trendEOD
    j.setdefault("strategy", {})
    j["strategy"]["trendEOD"] = {
        "state": ts_band,
        "reason": f"Trend {ts_pct:.1f} | Vol({vol_band})"
                  + (f" | Sq({squeeze:.1f}%)" if isinstance(squeeze,(int,float)) else "")
                  + (f" | Flow({vs_signed:+.2f}%)" if isinstance(vs_signed,(int,float)) else ""),
        "updatedAt": now
    }

    # Optional daily signals block for completeness (not required by your FE today)
    daily = j.get("daily") or {}
    sigs  = (daily.get("signals") or {})
    # overall: follow band
    overall = "bull" if ts_band=="green" else "bear" if ts_band=="red" else "neutral"
    sigs["sigOverall1d"] = {"state": overall, "lastChanged": carry_last_changed(sigs.get("sigOverall1d",{}), overall, now)}
    # EMA daily posture if you export it (ema_sign_daily), else neutral
    ema_sign_daily = m.get("ema_sign_daily")
    ema_state = "bull" if isinstance(ema_sign_daily,(int,float)) and ema_sign_daily>0 else ("bear" if isinstance(ema_sign_daily,(int,float)) and ema_sign_daily<0 else "neutral")
    sigs["sigEMA1d"] = {"state": ema_state, "lastChanged": carry_last_changed(sigs.get("sigEMA1d",{}), ema_state, now)}
    # SMI daily posture if you export it (smi_combo_daily_pct), else neutral
    smi_combo_daily = m.get("momentum_combo_1d_pct") or m.get("momentum_combo_daily_pct")
    if isinstance(smi_combo_daily,(int,float)):
        smi_state = "bull" if smi_combo_daily>50.0 else ("bear" if smi_combo_daily<50.0 else "neutral")
    else:
        smi_state = "neutral"
    sigs["sigSMI1d"] = {"state": smi_state, "lastChanged": carry_last_changed(sigs.get("sigSMI1d",{}), smi_state, now)}
    daily["signals"] = sigs
    j["daily"] = daily

    # Panel helper
    j.setdefault("luxTrend1d", {})
    j["luxTrend1d"]["trendStrength_pct"] = round(float(ts_pct),2)
    j["luxTrend1d"]["trendStrength_band"]= ts_band
    if isinstance(vol_pct,(int,float)): j["luxTrend1d"]["volatility_pct"] = round(vol_pct,3)
    if isinstance(vol_scaled,(int,float)): j["luxTrend1d"]["volatility_scaled"]= round(vol_scaled,2)
    j["luxTrend1d"]["volatility_band"] = vol_band
    if isinstance(squeeze,(int,float)): j["luxTrend1d"]["squeeze_pct"] = round(squeeze,2)
    j["luxTrend1d"]["squeeze_band"] = sq_band
    if isinstance(vs_signed,(int,float)): j["luxTrend1d"]["volumeSentiment_pct"] = round(vs_signed,2)
    j["luxTrend1d"]["volumeSentiment_band"] = flow_band

    save_json(DAILY_PATH, j)
    print("[daily] trendEOD:", j["strategy"]["trendEOD"]["state"])

if __name__ == "__main__":
    main()
