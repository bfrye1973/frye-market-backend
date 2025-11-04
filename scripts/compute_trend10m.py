#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend10m.py — Lux Trend (10m) post-processor

- Two-color mapping only (green/red) for Trend, Volatility, Squeeze, Volume Flow
- Writes BOTH:
    1) Lux summary text in strategy.trend10m
    2) Plain numeric fields for Engine-Lights:
       j["lux10m"] = {
         "trendStrength": float,
         "volatility": float|None,           # ATR % if present
         "volatilityScaled": float|None,     # 0..100 if present/derived
         "squeezePct": float|None,
         "volumeSentiment": float            # never blank (defaults to 0.0)
       }
- Always creates 10m pills: sigOverall10m, sigEMA10m, sigAccel10m, sigCandle10m
- No network calls; reads only data/outlook_intraday.json
"""

import json, datetime

INTRADAY_PATH = "data/outlook_intraday.json"

# Two-color mapping cutoffs (aligned to your dialog calibration)
THRESH = {
    "trend_green_min": 60.0,      # Trend >= 60 → green, else red
    "vol_low_max": 40.0,          # Vol scaled < 40 → green (Low), else red
    "squeeze_open_max": 30.0,     # Squeeze < 30 → green (open), else red (compression)
    "volsent_green_gt": 0.0       # Flow > 0 → green, else red
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

# === Color helpers (two-color only) ===
def color_trend(ts):      return "green" if (isinstance(ts,(int,float)) and ts >= THRESH["trend_green_min"]) else "red"
def color_vol_scaled(vs): return "green" if (isinstance(vs,(int,float)) and vs <  THRESH["vol_low_max"]) else "red"
def color_squeeze(sq):    return "green" if (isinstance(sq,(int,float)) and sq <  THRESH["squeeze_open_max"]) else "red"
def color_volume(vs):     return "green" if (isinstance(vs,(int,float)) and vs >  THRESH["volsent_green_gt"]) else "red"

def main():
    j = load_json(INTRADAY_PATH)
    if not j:
        print("[10m] outlook_intraday.json missing; nothing to do")
        return

    now = utc_now()
    m  = j.get("metrics") or {}
    el = j.get("engineLights") or {}
    prev = (el.get("signals") or {})

    # Pull possible fields (be tolerant)
    ts = m.get("trend_strength_10m_pct")
    sq = m.get("squeeze_10m_pct") or m.get("squeeze_pct")
    vol_pct = m.get("volatility_10m_pct") or m.get("volatility_pct")
    vol_scaled = m.get("volatility_10m_scaled") or m.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        # normalize ATR% for color decision; conservative bounds for 10m SPY
        MIN_PCT, MAX_PCT = 0.50, 4.00
        vol_scaled = 100.0 * clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9), 0.0, 1.0)

    vs = m.get("volume_sentiment_10m_pct") or m.get("volume_sentiment_pct")
    if not isinstance(vs,(int,float)): vs = 0.0   # NEVER blank

    # If Trend Strength missing, derive a modest bias from posture + open context
    if not isinstance(ts,(int,float)):
        ema_sign = m.get("ema_sign_10m") or m.get("ema_sign")
        base = 45.0 if (isinstance(ema_sign,(int,float)) and ema_sign != 0) else 30.0
        if isinstance(sq,(int,float)):
            base += (100.0 - clamp(sq,0.0,100.0)) * 0.15
        ts = clamp(base, 0.0, 100.0)

    # Colors (Green/Red only)
    trend_color = color_trend(ts)
    vol_color   = color_vol_scaled(vol_scaled)
    sq_color    = color_squeeze(sq)
    flow_color  = color_volume(vs)

    # ========== Lux dialog summary ==========
    j.setdefault("strategy", {})
    j["strategy"]["trend10m"] = {
        "state": trend_color,
        "reason": f"Trend {ts:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({sq:.1f}% {sq_color})" if isinstance(sq,(int,float)) else "")
                  + (f" | Flow({vs:+.2f}% {flow_color})" if isinstance(vs,(int,float)) else ""),
        "updatedAt": now
    }

    # ========== Numeric values for Engine-Lights row ==========
    j["lux10m"] = {
        "trendStrength": float(ts),
        "volatility": float(vol_pct) if isinstance(vol_pct,(int,float)) else None,
        "volatilityScaled": float(vol_scaled) if isinstance(vol_scaled,(int,float)) else None,
        "squeezePct": float(sq) if isinstance(sq,(int,float)) else None,
        "volumeSentiment": float(vs)
    }

    # ========== 10m pills (always-on) ==========
    sigs = dict(prev) if isinstance(prev,dict) else {}
    overall = "bull" if trend_color=="green" else "bear"
    sigs["sigOverall10m"] = {"state": overall, "lastChanged": carry_last_changed(sigs.get("sigOverall10m",{}), overall, now)}

    ema_sign = m.get("ema_sign_10m") or m.get("ema_sign")
    ema_state = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else overall)
    sigs["sigEMA10m"] = {"state": ema_state, "lastChanged": carry_last_changed(sigs.get("sigEMA10m",{}), ema_state, now)}

    # Acceleration pill
    b_now, m_now = m.get("breadth_10m_pct"), m.get("momentum_10m_pct")
    b_prev, m_prev = m.get("breadth_10m_pct_prev"), m.get("momentum_10m_pct_prev")
    if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
        accel = (b_now+m_now) - (b_prev+m_prev)
        acc_state = "bull" if accel>=0 else "bear"
    else:
        acc_state = overall
    sigs["sigAccel10m"] = {"state": acc_state, "lastChanged": carry_last_changed(sigs.get("sigAccel10m",{}), acc_state, now)}

    # CandleUp pill (optional)
    candle_up = m.get("candle_up_10m")
    c_state = "bull" if candle_up is True else ("bear" if candle_up is False else overall)
    sigs["sigCandle10m"] = {"state": c_state, "lastChanged": carry_last_changed(sigs.get("sigCandle10m",{}), c_state, now)}

    j.setdefault("engineLights", {}).setdefault("signals", {})
    j["engineLights"]["signals"].update(sigs)

    save_json(INTRADAY_PATH, j)
    print("[10m] Lux summary done; numeric lux10m fields written.")
    print("[10m] colors:", trend_color, vol_color, sq_color, flow_color)

if __name__ == "__main__":
    main()
