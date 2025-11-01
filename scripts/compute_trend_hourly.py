#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_hourly.py — Lux Trend (1h) post-processor
- Reads data/outlook_hourly.json (no external API)
- Writes strategy.trend1h and luxTrend1h
- Guarantees hourly.signals: sigOverall1h, sigEMA1h, sigSMI1h
"""

import json, datetime

HOURLY_PATH = "data/outlook_hourly.json"

CAL = {
    "trend_strength": {"red_max": 39.99, "yellow_min": 40.0, "green_min": 60.0},
    "vol_scaled": {"low_max": 39.99, "moderate_min": 40.0, "high_min": 70.0},
    "squeeze": {"open_max": 29.99, "building_min": 30.0, "tight_min": 70.0},
    "vol_flow": {"bear_max": -3.0, "neutral_min": -3.0, "bull_min": 3.0},
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x, lo, hi): return max(lo, min(hi, x))

def load_json(path):
    try: return json.load(open(path,"r",encoding="utf-8"))
    except Exception: return {}

def save_json(path, obj):
    json.dump(obj, open(path,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

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

def band_squeeze(pct):
    if pct is None: return "yellow"
    return "red" if pct >= CAL["squeeze"]["tight_min"] else ("yellow" if pct >= CAL["squeeze"]["building_min"] else "green")

def band_flow(signed_pct):
    if signed_pct is None: return "yellow"
    return "green" if signed_pct > CAL["vol_flow"]["bull_min"] else ("red" if signed_pct < CAL["vol_flow"]["bear_max"] else "yellow")

def posture_score_from_gap_pct(gap_pct, full_credit=0.60):
    unit = clamp((gap_pct or 0.0)/max(full_credit,1e-9), -1.0, 1.0)
    return 50.0 + 50.0*unit

def main():
    j = load_json(HOURLY_PATH)
    if not j:
        print("[1h] hourly file missing"); return
    now = utc_now()
    metrics = j.get("metrics") or {}
    hourly  = j.get("hourly")  or {}
    prevsig = hourly.get("signals") or {}

    ema_sign = metrics.get("ema_sign")
    ema_gap_pct = metrics.get("ema_gap_pct")
    if not isinstance(ema_gap_pct,(int,float)):
        ema_gap_pct = 0.30*(1 if isinstance(ema_sign,(int,float)) and ema_sign>0 else -1 if isinstance(ema_sign,(int,float)) and ema_sign<0 else 0.0)

    combo = metrics.get("momentum_combo_1h_pct")
    squeeze = metrics.get("squeeze_1h_pct")
    vol_pct = metrics.get("volatility_1h_pct")
    vol_scaled = metrics.get("volatility_1h_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        MIN_PCT, MAX_PCT = 0.30, 3.50
        vol_scaled = 100.0*clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9),0.0,1.0)
    vs_signed = metrics.get("volume_sentiment_1h_pct")

    # Trend Strength magnitude (0..100)
    ema_score = posture_score_from_gap_pct(ema_gap_pct, 0.60)
    smi_score = combo if isinstance(combo,(int,float)) else ema_score
    ctx = 100.0 - clamp(float(squeeze or 0.0), 0.0, 100.0)
    ts_mag = clamp(0.60*abs(ema_score-50.0) + 0.25*abs(smi_score-50.0) + 0.15*ctx, 0.0, 100.0)
    ts_band = band_trend(ts_mag)

    # Strategy dialog payload
    j.setdefault("strategy", {})
    j["strategy"]["trend1h"] = {
        "state": ts_band,
        "reason": f"Trend {ts_mag:.1f} | Vol({band_vol_scaled(vol_scaled)})"
                  + (f" | Sq({squeeze:.1f}%)" if isinstance(squeeze,(int,float)) else "")
                  + (f" | Flow({vs_signed:+.2f}%)" if isinstance(vs_signed,(int,float)) else ""),
        "updatedAt": now
    }

    # Always-on pills (guaranteed)
    sigs = dict(prevsig) if isinstance(prevsig,dict) else {}
    # Overall from overall1h.state (fallback to band trend)
    ov_state_src = (hourly.get("overall1h") or {}).get("state")
    overall = ov_state_src.lower() if isinstance(ov_state_src,str) and ov_state_src.lower() in ("bull","bear","neutral") else \
              ("bull" if ts_band=="green" else "bear" if ts_band=="red" else "neutral")
    sigs["sigOverall1h"] = {"state": overall, "lastChanged": carry_last_changed(sigs.get("sigOverall1h",{}), overall, now)}

    # EMA posture pill
    ema_state = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else "neutral")
    sigs["sigEMA1h"] = {"state": ema_state, "lastChanged": carry_last_changed(sigs.get("sigEMA1h",{}), ema_state, now)}

    # SMI posture pill from combo ≥ 50
    if isinstance(combo,(int,float)):
        smi_state = "bull" if combo>50.0 else ("bear" if combo<50.0 else "neutral")
    else:
        smi_state = "neutral"
    sigs["sigSMI1h"] = {"state": smi_state, "lastChanged": carry_last_changed(sigs.get("sigSMI1h",{}), smi_state, now)}

    hourly["signals"] = sigs
    j["hourly"] = hourly

    # Panel helper block
    j.setdefault("luxTrend1h", {})
    j["luxTrend1h"]["trendStrength_pct"] = round(ts_mag,2)
    j["luxTrend1h"]["trendStrength_band"]= ts_band
    if isinstance(vol_pct,(int,float)): j["luxTrend1h"]["volatility_pct"] = round(vol_pct,3)
    if isinstance(vol_scaled,(int,float)): j["luxTrend1h"]["volatility_scaled"]= round(vol_scaled,2)
    j["luxTrend1h"]["volatility_band"] = band_vol_scaled(vol_scaled)
    if isinstance(squeeze,(int,float)): j["luxTrend1h"]["squeeze_pct"] = round(squeeze,2)
    j["luxTrend1h"]["squeeze_band"] = band_squeeze(squeeze if isinstance(squeeze,(int,float)) else None)
    if isinstance(vs_signed,(int,float)): j["luxTrend1h"]["volumeSentiment_pct"] = round(vs_signed,2)
    j["luxTrend1h"]["volumeSentiment_band"] = band_flow(vs_signed if isinstance(vs_signed,(int,float)) else None)

    save_json(HOURLY_PATH, j)
    print("[1h] trend1h:", j["strategy"]["trend1h"]["state"])
    print("[1h] signals:", {k:v.get("state") for k,v in sigs.items()})

if __name__ == "__main__":
    main()
