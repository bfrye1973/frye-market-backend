#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_eod.py — Lux Trend (Daily/EOD) post-processor
Two-color mapping (Green/Red only) for Trend, Volatility, Squeeze, Volume Sentiment.
Writes:
  strategy.trendEOD
  luxTrend1d: {
      trendStrength_pct, trend_color,
      volatility_pct, volatility_scaled, volatility_color,
      squeeze_pct, squeeze_color,
      volumeSentiment_pct, volume_color
  }
Also emits a daily signals block if you want to show EOD pills later.
No external API calls.
"""

import json, datetime

DAILY_PATH = "data/outlook.json"

THRESH = {
    "trend_green_min": 60.0,      # Trend >= 60 → green, else red
    "vol_low_max": 40.0,          # Vol scaled < 40 → green (Low), else red
    "squeeze_open_max": 30.0,     # Squeeze < 30 → green (Open), else red
    "volsent_green_gt": 0.0       # Flow > 0 → green, else red
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x, lo, hi): return max(lo, min(hi, x))

def load_json(p):
    try: return json.load(open(p, "r", encoding="utf-8"))
    except Exception: return {}

def save_json(p, obj):
    json.dump(obj, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def color_trend(ts):      return "green" if (isinstance(ts,(int,float)) and ts >= THRESH["trend_green_min"]) else "red"
def color_vol_scaled(vs): return "green" if (isinstance(vs,(int,float)) and vs <  THRESH["vol_low_max"]) else "red"
def color_squeeze(sq):    return "green" if (isinstance(sq,(int,float)) and sq <  THRESH["squeeze_open_max"]) else "red"
def color_volume(vs):     return "green" if (isinstance(vs,(int,float)) and vs >  THRESH["volsent_green_gt"]) else "red"

def carry_last_changed(prev, new_state, stamp):
    prev_state = (prev or {}).get("state")
    last = (prev or {}).get("lastChanged") or stamp
    if prev_state != new_state: last = stamp
    return last

def main():
    j = load_json(DAILY_PATH)
    if not j:
        print("[EOD] outlook.json missing"); return
    now = utc_now()

    m = j.get("metrics") or {}

    # Pull Daily metrics (be tolerant with names)
    ts_pct    = m.get("trend_strength_daily_pct") or m.get("trend_strength_pct")
    squeeze   = m.get("squeeze_daily_pct") or m.get("squeeze_pct")
    vol_pct   = m.get("volatility_daily_pct") or m.get("volatility_pct")
    vol_scaled= m.get("volatility_daily_scaled") or m.get("volatility_scaled")
    vs_signed = m.get("volume_sentiment_daily_pct") or m.get("volume_sentiment_pct")

    # Default Volume Sentiment: never blank → 0.0 (red) if missing
    if not isinstance(vs_signed, (int, float)):
        vs_signed = 0.0

    # If scaled not provided, normalize ATR% to [0..100] for color decision (conservative bounds for daily SPY)
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        MIN_PCT, MAX_PCT = 0.20, 2.50
        vol_scaled = 100.0 * clamp((vol_pct - MIN_PCT) / max(MAX_PCT - MIN_PCT, 1e-9), 0.0, 1.0)

    # If Trend Strength missing, bias to daily ema-slope (if available) or default trending
    if not isinstance(ts_pct,(int,float)):
        # Try legacy trendDaily path if you have it
        daily_trend = ((j.get("trendDaily") or {}).get("trend") or {}).get("emaSlope")
        if isinstance(daily_trend, (int, float)):
            ts_pct = clamp(50.0 + daily_trend * 0.5, 0.0, 100.0)
        else:
            ts_pct = 60.0  # default trending bias for daily

    # Colors: GREEN/RED only
    trend_color = color_trend(ts_pct)
    vol_color   = color_vol_scaled(vol_scaled if isinstance(vol_scaled,(int,float)) else None)
    sq_color    = color_squeeze(squeeze if isinstance(squeeze,(int,float)) else None)
    flow_color  = color_volume(vs_signed)

    # Dialog payload
    j.setdefault("strategy", {})
    j["strategy"]["trendEOD"] = {
        "state": trend_color,
        "reason": f"Trend {ts_pct:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({squeeze:.1f}% {sq_color})" if isinstance(squeeze,(int,float)) else "")
                  + (f" | Flow({vs_signed:+.2f}% {flow_color})" if isinstance(vs_signed,(int,float)) else ""),
        "updatedAt": now
    }

    # Optional: daily pills (if you want EOD row pills later)
    daily = j.get("daily") or {}
    sigs  = daily.get("signals") or {}
    overall = "bull" if trend_color == "green" else "bear"
    sigs["sigOverall1d"] = {
        "state": overall,
        "lastChanged": carry_last_changed(sigs.get("sigOverall1d", {}), overall, now)
    }
    ema_sign_daily = m.get("ema_sign_daily")
    ema_state = "bull" if isinstance(ema_sign_daily,(int,float)) and ema_sign_daily>0 else ("bear" if isinstance(ema_sign_daily,(int,float)) and ema_sign_daily<0 else overall)
    sigs["sigEMA1d"] = {
        "state": ema_state,
        "lastChanged": carry_last_changed(sigs.get("sigEMA1d", {}), ema_state, now)
    }
    smi_combo_daily = m.get("momentum_combo_1d_pct") or m.get("momentum_combo_daily_pct")
    if isinstance(smi_combo_daily,(int,float)):
        smi_state = "bull" if smi_combo_daily>50.0 else "bear" if smi_combo_daily<50.0 else overall
    else:
        smi_state = overall
    sigs["sigSMI1d"] = {
        "state": smi_state,
        "lastChanged": carry_last_changed(sigs.get("sigSMI1d", {}), smi_state, now)
    }
    daily["signals"] = sigs
    j["daily"] = daily

    # Panel helper (FE reads these for colors)
    j.setdefault("luxTrend1d", {})
    j["luxTrend1d"]["trendStrength_pct"] = round(float(ts_pct),2)
    j["luxTrend1d"]["trend_color"] = trend_color
    if isinstance(vol_pct,(int,float)): j["luxTrend1d"]["volatility_pct"] = round(vol_pct,3)
    if isinstance(vol_scaled,(int,float)): j["luxTrend1d"]["volatility_scaled"] = round(vol_scaled,2)
    j["luxTrend1d"]["volatility_color"] = vol_color
    if isinstance(squeeze,(int,float)): j["luxTrend1d"]["squeeze_pct"] = round(squeeze,2)
    j["luxTrend1d"]["squeeze_color"] = sq_color
    j["luxTrend1d"]["volumeSentiment_pct"] = round(float(vs_signed),2)
    j["luxTrend1d"]["volume_color"] = flow_color

    save_json(DAILY_PATH, j)
    print("[EOD] trendEOD color:", trend_color, "| vol:", vol_color, "| sq:", sq_color, "| flow:", flow_color)

if __name__ == "__main__":
    main()
