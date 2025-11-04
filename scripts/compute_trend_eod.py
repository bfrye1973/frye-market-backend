#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_eod.py — Lux Trend (Daily/EOD) post-processor
- Two-color mapping (green/red)
- Lux mini-pill + numeric fields + engineLights mirrors
- OBV-style volume sentiment if fields exist; else 0.0 fallback
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

def compute_volume_sentiment_pct(metrics: dict) -> float:
    close_prev = metrics.get("close_prev_1d") or metrics.get("close_1d_prev")
    close_curr = metrics.get("close_1d")
    volume     = metrics.get("volume_1d") or metrics.get("vol_1d")
    volSma     = metrics.get("volSma_1d") or metrics.get("vol_sma_1d")
    if not all(isinstance(x,(int,float)) for x in (close_prev,close_curr,volume,volSma)):
        return 0.0
    obv_delta = volume if close_curr > close_prev else (-volume if close_curr < close_prev else 0.0)
    vs_pct = 100.0 * (obv_delta / max(volSma, 1.0))
    return clamp(vs_pct, -20.0, 20.0)

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
    if not isinstance(vs,(int,float)):
        vs = compute_volume_sentiment_pct(m)

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

    j.setdefault("strategy", {})
    j["strategy"]["trendEOD"] = {
        "state": trend_color,
        "reason": f"Trend {ts:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({sq:.1f}% {sq_color})" if isinstance(sq,(int,float)) else "")
                  + (f" | Flow({vs:+.2f}% {flow_color})" if isinstance(vs,(int,float)) else ""),
        "updatedAt": now
    }

    j["lux1d"] = {
        "trendStrength": float(ts),
        "volatility": float(vol_pct) if isinstance(vol_pct,(int,float)) else None,
        "volatilityScaled": float(vol_scaled) if isinstance(vol_scaled,(int,float)) else None,
        "squeezePct": float(sq) if isinstance(sq,(int,float)) else None,
        "volumeSentiment": float(vs)
    }

    j.setdefault("engineLights", {})
    j["engineLights"].setdefault("lux1d", {})
    j["engineLights"]["lux1d"].update(j["lux1d"])
    j["engineLights"].setdefault("metrics", {})
    j["engineLights"]["metrics"].update({
        "lux1d_trendStrength": j["lux1d"]["trendStrength"],
        "lux1d_volatility": j["lux1d"]["volatility"],
        "lux1d_volatilityScaled": j["lux1d"]["volatilityScaled"],
        "lux1d_squeezePct": j["lux1d"]["squeezePct"],
        "lux1d_volumeSentiment": j["lux1d"]["volumeSentiment"]
    })

    save_json(DAILY_PATH, j)
    print("[EOD] Lux summary + numeric fields + OBV flow written.")

if __name__ == "__main__":
    main()
