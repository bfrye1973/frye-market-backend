#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_eod.py — Lux Trend (Daily/EOD) post-processor
Two-color mapping for Trend/Vol/Squeeze/Flow.
Writes Lux summary AND numeric fields for Engine-Lights (lux1d.*).
"""

import json, datetime

DAILY_PATH = "data/outlook.json"

THRESH = {
    "trend_green_min": 60.0,
    "vol_low_max": 40.0,
    "squeeze_open_max": 30.0,
    "volsent_green_gt": 0.0
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x,lo,hi): return max(lo,min(hi,x))
def load_json(p):
    try: return json.load(open(p,"r",encoding="utf-8"))
    except Exception: return {}
def save_json(p,obj): json.dump(obj, open(p,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def color_trend(ts):      return "green" if (isinstance(ts,(int,float)) and ts>=THRESH["trend_green_min"]) else "red"
def color_vol_scaled(vs): return "green" if (isinstance(vs,(int,float)) and vs<THRESH["vol_low_max"]) else "red"
def color_squeeze(sq):    return "green" if (isinstance(sq,(int,float)) and sq<THRESH["squeeze_open_max"]) else "red"
def color_volume(vs):     return "green" if (isinstance(vs,(int,float)) and vs>THRESH["volsent_green_gt"]) else "red"

def main():
    j = load_json(DAILY_PATH)
    if not j:
        print("[EOD] outlook.json missing"); return
    now = utc_now()

    m = j.get("metrics") or {}
    ts = m.get("trend_strength_daily_pct") or m.get("trend_strength_pct")
    sq = m.get("squeeze_daily_pct") or m.get("squeeze_pct")
    vol_pct = m.get("volatility_daily_pct") or m.get("volatility_pct")
    vol_scaled = m.get("volatility_daily_scaled") or m.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        MIN_PCT, MAX_PCT = 0.20, 2.50
        vol_scaled = 100.0 * clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9), 0.0, 1.0)

    vs = m.get("volume_sentiment_daily_pct") or m.get("volume_sentiment_pct")
    if not isinstance(vs,(int,float)): vs = 0.0   # never blank

    # If Trend Strength missing, bias to daily ema slope if present
    if not isinstance(ts,(int,float)):
        daily_trend = ((j.get("trendDaily") or {}).get("trend") or {}).get("emaSlope")
        if isinstance(daily_trend,(int,float)):
            ts = clamp(50.0 + daily_trend*0.5, 0.0, 100.0)
        else:
            ts = 60.0

    trend_color = color_trend(ts)
    vol_color   = color_vol_scaled(vol_scaled)
    sq_color    = color_squeeze(sq)
    flow_color  = color_volume(vs)

    # Lux dialog summary (EOD)
    j.setdefault("strategy", {})
    j["strategy"]["trendEOD"] = {
        "state": trend_color,
        "reason": f"Trend {ts:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({sq:.1f}% {sq_color})" if isinstance(sq,(int,float)) else "")
                  + (f" | Flow({vs:+.2f}% {flow_color})" if isinstance(vs,(int,float)) else ""),
        "updatedAt": now
    }

    # Numeric values for Engine-Lights row (daily/EOD)
    j["lux1d"] = {
        "trendStrength": float(ts),
        "volatility": float(vol_pct) if isinstance(vol_pct,(int,float)) else None,
        "volatilityScaled": float(vol_scaled) if isinstance(vol_scaled,(int,float)) else None,
        "squeezePct": float(sq) if isinstance(sq,(int,float)) else None,
        "volumeSentiment": float(vs)
    }

    save_json(DAILY_PATH, j)
    print("[EOD] Lux summary done; numeric lux1d fields written.")
    print("[EOD] colors:", trend_color, vol_color, sq_color, flow_color)

if __name__ == "__main__":
    main()
