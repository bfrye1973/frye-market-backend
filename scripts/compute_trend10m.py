#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend10m.py — Lux Trend (10m) post-processor
Two-color mapping (Green/Red only) for Trend, Volatility, Squeeze, VolumeSent.

Writes:
  strategy.trend10m
  luxTrend10m: { trendStrength_pct, trend_color, vol_color, squeeze_pct + squeeze_color,
                 volumeSentiment_pct + volume_color }
Always creates 10m pills (sigOverall10m, sigEMA10m, sigAccel10m, sigCandle10m).
"""

import json, datetime

INTRADAY_PATH = "data/outlook_intraday.json"

# Two-color thresholds you asked for:
# Trend:   Green if >= 60, else Red
# Vol:     Green (Low) if scaled < 40, else Red
# Squeeze: Green if < 30 (open), else Red (compression)
# Volume:  Green if > 0.0, else Red
THRESH = {
    "trend_green_min": 60.0,
    "vol_low_max": 40.0,
    "squeeze_open_max": 30.0,
    "volsent_green_gt": 0.0
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x, lo, hi): return max(lo, min(hi, x))

def load_json(path):
    try: return json.load(open(path,"r",encoding="utf-8"))
    except Exception: return {}

def save_json(path, obj):
    json.dump(obj, open(path,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def carry_last_changed(prev, new_state, stamp):
    prev_state = (prev or {}).get("state")
    last = (prev or {}).get("lastChanged") or stamp
    if prev_state != new_state: last = stamp
    return last

def color_trend(ts):
    return "green" if (isinstance(ts,(int,float)) and ts >= THRESH["trend_green_min"]) else "red"

def color_volatility_scaled(vs):
    return "green" if (isinstance(vs,(int,float)) and vs < THRESH["vol_low_max"]) else "red"

def color_squeeze(sq):
    return "green" if (isinstance(sq,(int,float)) and sq < THRESH["squeeze_open_max"]) else "red"

def color_volume_sent(vs):
    return "green" if (isinstance(vs,(int,float)) and vs > THRESH["volsent_green_gt"]) else "red"

def main():
    j = load_json(INTRADAY_PATH)
    if not j:
        print("[10m] outlook_intraday.json missing; nothing to do")
        return

    now = utc_now()
    metrics = j.get("metrics") or {}
    eng = j.get("engineLights") or {}
    prev_signals = (eng.get("signals") or {})

    # Pull numeric inputs (be tolerant with names)
    ts_pct = metrics.get("trend_strength_10m_pct")
    squeeze = metrics.get("squeeze_10m_pct") or metrics.get("squeeze_pct")
    vol_pct = metrics.get("volatility_10m_pct") or metrics.get("volatility_pct")
    vol_scaled = metrics.get("volatility_10m_scaled") or metrics.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        # normalize ATR% to scaled (0..100) for the color decision; bounds are conservative for 10m SPY
        MIN_PCT, MAX_PCT = 0.50, 4.00
        vol_scaled = 100.0*clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9), 0.0, 1.0)

    vs_signed = metrics.get("volume_sentiment_10m_pct") \
                or metrics.get("volume_sentiment_pct") \
                or 0.0  # NEVER blank -> default to 0 (red)

    # If Trend Strength missing, derive a modest proxy (keeps colors meaningful)
    if not isinstance(ts_pct,(int,float)):
        ema_sign = metrics.get("ema_sign_10m") or metrics.get("ema_sign")
        base = 45.0 if (isinstance(ema_sign,(int,float)) and ema_sign != 0) else 30.0
        if isinstance(squeeze,(int,float)):
            base += (100.0 - clamp(squeeze,0.0,100.0)) * 0.15
        ts_pct = clamp(base, 0.0, 100.0)

    # Colors (Green/Red only)
    trend_color = color_trend(ts_pct)
    vol_color   = color_volatility_scaled(vol_scaled if isinstance(vol_scaled,(int,float)) else None)
    sq_color    = color_squeeze(squeeze if isinstance(squeeze,(int,float)) else None)
    flow_color  = color_volume_sent(vs_signed)

    # Dialog payload
    j.setdefault("strategy", {})
    j["strategy"]["trend10m"] = {
        "state": trend_color,  # using color word for state is fine (two-color)
        "reason": f"Trend {ts_pct:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({squeeze:.1f}% {sq_color})" if isinstance(squeeze,(int,float)) else "")
                  + (f" | Flow({vs_signed:+.2f}% {flow_color})" if isinstance(vs_signed,(int,float)) else ""),
        "updatedAt": now
    }

    # Always-on 10m pills
    sigs = dict(prev_signals) if isinstance(prev_signals,dict) else {}

    # Overall pill from trend color
    overall = "bull" if trend_color=="green" else "bear"
    sigs["sigOverall10m"] = {
        "state": overall,
        "lastChanged": carry_last_changed(sigs.get("sigOverall10m",{}), overall, now)
    }

    # EMA 10/20 posture
    ema_sign = metrics.get("ema_sign_10m") or metrics.get("ema_sign")
    if isinstance(ema_sign,(int,float)): ema_state = "bull" if ema_sign>0 else ("bear" if ema_sign<0 else "bear")
    else: ema_state = overall
    sigs["sigEMA10m"] = {
        "state": ema_state,
        "lastChanged": carry_last_changed(sigs.get("sigEMA10m",{}), ema_state, now)
    }

    # Accel pill (optional)
    b_now = metrics.get("breadth_10m_pct"); m_now = metrics.get("momentum_10m_pct")
    b_prev = metrics.get("breadth_10m_pct_prev"); m_prev = metrics.get("momentum_10m_pct_prev")
    if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
        accel = (b_now+m_now) - (b_prev+m_prev)
        acc_state = "bull" if accel>=0.0 else "bear"
    else:
        acc_state = overall
    sigs["sigAccel10m"] = {
        "state": acc_state,
        "lastChanged": carry_last_changed(sigs.get("sigAccel10m",{}), acc_state, now)
    }

    # CandleUp pill (optional if you export it)
    candle_up = metrics.get("candle_up_10m")
    if isinstance(candle_up,bool): c_state = "bull" if candle_up else "bear"
    else: c_state = overall
    sigs["sigCandle10m"] = {
        "state": c_state,
        "lastChanged": carry_last_changed(sigs.get("sigCandle10m",{}), c_state, now)
    }

    # Panel convenience block — two-color fields added
    j.setdefault("luxTrend10m", {})
    j["luxTrend10m"]["trendStrength_pct"] = round(float(ts_pct),2)
    j["luxTrend10m"]["trend_color"] = trend_color
    if isinstance(vol_pct,(int,float)): j["luxTrend10m"]["volatility_pct"] = round(vol_pct,3)
    if isinstance(vol_scaled,(int,float)): j["luxTrend10m"]["volatility_scaled"]= round(vol_scaled,2)
    j["luxTrend10m"]["volatility_color"] = vol_color
    if isinstance(squeeze,(int,float)): j["luxTrend10m"]["squeeze_pct"] = round(squeeze,2)
    j["luxTrend10m"]["squeeze_color"] = sq_color
    j["luxTrend10m"]["volumeSentiment_pct"] = round(float(vs_signed),2)
    j["luxTrend10m"]["volume_color"] = flow_color

    # write back
    j.setdefault("engineLights", {}).setdefault("signals", {})
    j["engineLights"]["signals"].update(sigs)
    save_json(INTRADAY_PATH, j)
    print("[10m] trend10m color:", trend_color, "| vol:", vol_color, "| sq:", sq_color, "| flow:", flow_color)

if __name__ == "__main__":
    main()
