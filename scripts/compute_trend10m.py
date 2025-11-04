#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend10m.py — Lux Trend (10m) post-processor

- Two-color mapping only (green/red) for Trend, Volatility, Squeeze, Volume Flow
- Writes BOTH:
    1) Lux summary text in strategy.trend10m (for the mini-pill)
    2) Plain numeric fields for Engine-Lights row:
       j["lux10m"] = {
         "trendStrength": float,
         "volatility": float|None,           # ATR % if present
         "volatilityScaled": float|None,     # 0..100 if present/derived
         "squeezePct": float|None,
         "volumeSentiment": float            # never blank (defaults to 0.0)
       }
    + mirrors into engineLights.lux10m and engineLights.metrics.lux10m_*

- Also ensures 10m pills exist: sigOverall10m, sigEMA10m, sigAccel10m, sigCandle10m.
- No network; reads data/outlook_intraday.json only.
"""

import json, datetime

INTRADAY_PATH = "data/outlook_intraday.json"

# Two-color thresholds (aligned to your Lux dialog behavior)
THRESH = {
    "trend_green_min": 60.0,      # Trend >= 60 → green
    "vol_low_max": 40.0,          # Vol scaled < 40 → green (Low), else red
    "squeeze_open_max": 30.0,     # Squeeze < 30 → green (Open), else red (Compression)
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

    # Pull numeric inputs (tolerant)
    ts = m.get("trend_strength_10m_pct")
    sq = m.get("squeeze_10m_pct") or m.get("squeeze_pct")
    vol_pct = m.get("volatility_10m_pct") or m.get("volatility_pct")
    vol_scaled = m.get("volatility_10m_scaled") or m.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        # normalize ATR% to scaled 0..100 for color
        MIN_PCT, MAX_PCT = 0.50, 4.00
        vol_scaled = 100.0 * clamp((vol_pct - MIN_PCT)/max(MAX_PCT - MIN_PCT,1e-9), 0.0, 1.0)

    vs = m.get("volume_sentiment_10m_pct") or m.get("volume_sentiment_pct")
    if not isinstance(vs,(int,float)): vs = 0.0   # NEVER blank

    # Fallback Trend Strength (light posture bias) if missing
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

    # ===== Lux dialog summary (mini-pill) =====
    j.setdefault("strategy", {})
    j["strategy"]["trend10m"] = {
        "state": trend_color,
        "reason": f"Trend {ts:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({sq:.1f}% {sq_color})" if isinstance(sq,(int,float)) else "")
                  + (f" | Flow({vs:+.2f}% {flow_color})" if isinstance(vs,(int,float)) else ""),
        "updatedAt": now
    }

    # ===== Numeric fields for Engine-Lights row =====
    j["lux10m"] = {
        "trendStrength": float(ts),
        "volatility": float(vol_pct) if isinstance(vol_pct,(int,float)) else None,
        "volatilityScaled": float(vol_scaled) if isinstance(vol_scaled,(int,float)) else None,
        "squeezePct": float(sq) if isinstance(sq,(int,float)) else None,
        "volumeSentiment": float(vs)
    }

    # Mirror for legacy FE paths
    j.setdefault("engineLights", {})
    j["engineLights"].setdefault("lux10m", {})
    j["engineLights"]["lux10m"].update(j["lux10m"])
    j["engineLights"].setdefault("metrics", {})
    j["engineLights"]["metrics"].update({
        "lux10m_trendStrength": j["lux10m"]["trendStrength"],
        "lux10m_volatility": j["lux10m"]["volatility"],
        "lux10m_volatilityScaled": j["lux10m"]["volatilityScaled"],
        "lux10m_squeezePct": j["lux10m"]["squeezePct"],
        "lux10m_volumeSentiment": j["lux10m"]["volumeSentiment"]
    })

    # ===== 10m pills (always-on) =====
    sigs = dict(prev) if isinstance(prev,dict) else {}
    overall = "bull" if trend_color=="green" else "bear"
    sigs["sigOverall10m"] = {
        "state": overall,
        "lastChanged": carry_last_changed(sigs.get("sigOverall10m",{}), overall, now)
    }
    ema_sign = m.get("ema_sign_10m") or m.get("ema_sign")
    ema_state = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else overall)
    sigs["sigEMA10m"] = {
        "state": ema_state,
        "lastChanged": carry_last_changed(sigs.get("sigEMA10m",{}), ema_state, now)
    }

    b_now, m_now = m.get("breadth_10m_pct"), m.get("momentum_10m_pct")
    b_prev, m_prev = m.get("breadth_10m_pct_prev"), m.get("momentum_10m_pct_prev")
    if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
        accel = (b_now+m_now) - (b_prev+m_prev)
        acc_state = "bull" if accel>=0 else "bear"
    else:
        acc_state = overall
    sigs["sigAccel10m"] = {
        "state": acc_state,
        "lastChanged": carry_last_changed(sigs.get("sigAccel10m",{}), acc_state, now)
    }

    candle_up = m.get("candle_up_10m")
    c_state = "bull" if candle_up is True else ("bear" if candle_up is False else overall)
    sigs["sigCandle10m"] = {
        "state": c_state,
        "lastChanged": carry_last_changed(sigs.get("sigCandle10m",{}), c_state, now)
    }

    j["engineLights"]["signals"] = sigs
    save_json(INTRADAY_PATH, j)
    print("[10m] Lux summary + Engine-Lights numeric fields written.")

if __name__ == "__main__":
    main()
