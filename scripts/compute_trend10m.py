#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend10m.py — Lux Trend (10m) post-processor

- Two-color mapping (green/red) for Trend/Vol/Sq/Flow (dialog-style)
- Writes Lux mini-pill summary in strategy.trend10m
- Writes numeric fields for Engine-Lights row: j["lux10m"].*
- Mirrors into engineLights.lux10m and engineLights.metrics.lux10m_* (legacy FE reads)
- Volume Sentiment:
    * if builders provide close_prev/close/volume/volSma -> compute OBV-based %
    * else default 0.0 so FE never sees blanks
"""

import json, datetime

INTRADAY_PATH = "data/outlook_intraday.json"

THRESH = {
    "trend_green_min": 60.0,
    "vol_low_max": 40.0,
    "squeeze_open_max": 30.0,
    "volsent_green_gt": 0.0
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x, lo, hi): return max(lo, min(hi, x))

def load_json(p):
    try: return json.load(open(p,"r",encoding="utf-8"))
    except Exception: return {}

def save_json(p, obj):
    json.dump(obj, open(p,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def carry_last_changed(prev, new_state, stamp):
    prev_state = (prev or {}).get("state")
    last = (prev or {}).get("lastChanged") or stamp
    if prev_state != new_state: last = stamp
    return last

def color_trend(ts):      return "green" if (isinstance(ts,(int,float)) and ts >= THRESH["trend_green_min"]) else "red"
def color_vol_scaled(vs): return "green" if (isinstance(vs,(int,float)) and vs <  THRESH["vol_low_max"]) else "red"
def color_squeeze(sq):    return "green" if (isinstance(sq,(int,float)) and sq <  THRESH["squeeze_open_max"]) else "red"
def color_volume(vs):     return "green" if (isinstance(vs,(int,float)) and vs >  THRESH["volsent_green_gt"]) else "red"

def compute_volume_sentiment_pct(metrics: dict) -> float:
    """
    OBV-style proxy if builder provides minimal fields:
      close_prev_10m, close_10m, volume_10m, volSma_10m
    Otherwise return 0.0 (FE won't be blank).
    """
    close_prev = metrics.get("close_prev_10m") or metrics.get("close_10m_prev")
    close_curr = metrics.get("close_10m")
    volume     = metrics.get("volume_10m") or metrics.get("vol_10m")
    volSma     = metrics.get("volSma_10m") or metrics.get("vol_sma_10m")

    if not all(isinstance(x,(int,float)) for x in (close_prev, close_curr, volume, volSma)):
        return 0.0

    if close_curr > close_prev:
        obv_delta = volume
    elif close_curr < close_prev:
        obv_delta = -volume
    else:
        obv_delta = 0.0

    vs_pct = 100.0 * (obv_delta / max(volSma, 1.0))
    return clamp(vs_pct, -20.0, 20.0)

def main():
    j = load_json(INTRADAY_PATH)
    if not j:
        print("[10m] outlook_intraday.json missing; nothing to do")
        return

    now = utc_now()
    m  = j.get("metrics") or {}
    el = j.get("engineLights") or {}
    prev = (el.get("signals") or {})

    ts = m.get("trend_strength_10m_pct")
    sq = m.get("squeeze_10m_pct") or m.get("squeeze_pct")
    vol_pct = m.get("volatility_10m_pct") or m.get("volatility_pct")
    vol_scaled = m.get("volatility_10m_scaled") or m.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        MIN_PCT, MAX_PCT = 0.50, 4.00
        vol_scaled = 100.0 * clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9), 0.0, 1.0)

    # real computation if possible, else keep 0.0
    vs = m.get("volume_sentiment_10m_pct") or m.get("volume_sentiment_pct")
    if not isinstance(vs,(int,float)):
        vs = compute_volume_sentiment_pct(m)

    # fallback trend if missing
    if not isinstance(ts,(int,float)):
        ema_sign = m.get("ema_sign_10m") or m.get("ema_sign")
        base = 45.0 if (isinstance(ema_sign,(int,float)) and ema_sign != 0) else 30.0
        if isinstance(sq,(int,float)):
            base += (100.0 - clamp(sq,0.0,100.0)) * 0.15
        ts = clamp(base, 0.0, 100.0)

    trend_color = color_trend(ts)
    vol_color   = color_vol_scaled(vol_scaled)
    sq_color    = color_squeeze(sq)
    flow_color  = color_volume(vs)

    # --- Lux mini-pill summary ---
    j.setdefault("strategy", {})
    j["strategy"]["trend10m"] = {
        "state": trend_color,
        "reason": f"Trend {ts:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({sq:.1f}% {sq_color})" if isinstance(sq,(int,float)) else "")
                  + (f" | Flow({vs:+.2f}% {flow_color})" if isinstance(vs,(int,float)) else ""),
        "updatedAt": now
    }

    # --- Numeric fields for Engine-Lights row ---
    j["lux10m"] = {
        "trendStrength": float(ts),
        "volatility": float(vol_pct) if isinstance(vol_pct,(int,float)) else None,
        "volatilityScaled": float(vol_scaled) if isinstance(vol_scaled,(int,float)) else None,
        "squeezePct": float(sq) if isinstance(sq,(int,float)) else None,
        "volumeSentiment": float(vs)
    }
    # Mirror to legacy FE paths
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

    # --- 10m pills ---
    sigs = dict(prev) if isinstance(prev,dict) else {}
    overall = "bull" if trend_color=="green" else "bear"
    sigs["sigOverall10m"] = {"state": overall, "lastChanged": carry_last_changed(sigs.get("sigOverall10m",{}), overall, now)}

    ema_sign = m.get("ema_sign_10m") or m.get("ema_sign")
    ema_state = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else overall)
    sigs["sigEMA10m"] = {"state": ema_state, "lastChanged": carry_last_changed(sigs.get("sigEMA10m",{}), ema_state, now)}

    b_now, m_now = m.get("breadth_10m_pct"), m.get("momentum_10m_pct")
    b_prev, m_prev = m.get("breadth_10m_pct_prev"), m.get("momentum_10m_pct_prev")
    if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
        accel = (b_now+m_now) - (b_prev+m_prev)
        acc_state = "bull" if accel>=0 else "bear"
    else:
        acc_state = overall
    sigs["sigAccel10m"] = {"state": acc_state, "lastChanged": carry_last_changed(sigs.get("sigAccel10m",{}), acc_state, now)}

    candle_up = m.get("candle_up_10m")
    c_state = "bull" if candle_up is True else ("bear" if candle_up is False else overall)
    sigs["sigCandle10m"] = {"state": c_state, "lastChanged": carry_last_changed(sigs.get("sigCandle10m",{}), c_state, now)}

    j["engineLights"]["signals"] = sigs
    save_json(INTRADAY_PATH, j)
    print("[10m] Lux summary + numeric fields + OBV flow written.")
