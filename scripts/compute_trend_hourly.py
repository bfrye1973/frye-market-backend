#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_hourly.py — Lux Trend (1h) post-processor (R12.8)
- Adds 3-color mapping: green / yellow / red
- Yellow band: 49..59
- Writes strategy.trend1h, lux1h numeric mirrors, and legacy signals
"""

import json, datetime

HOURLY_PATH = "data/outlook_hourly.json"

THRESH = {
    "trend_green_min": 60.0,
    "trend_yellow_min": 49.0,   # NEW
    "vol_low_max": 40.0,
    "squeeze_open_max": 30.0,
    "volsent_green_gt": 0.0
}

def utc_now(): return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x, lo, hi): return max(lo, min(hi, x))
def load_json(p):
    try: return json.load(open(p,"r",encoding="utf-8"))
    except Exception: return {}
def save_json(p,obj): json.dump(obj, open(p,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def carry_last_changed(prev,new_state,stamp):
    prev_state=(prev or {}).get("state")
    last=(prev or {}).get("lastChanged") or stamp
    if prev_state!=new_state: last=stamp
    return last

def color_trend(ts):
    # green >=60, yellow 49..59, red <=48
    if not isinstance(ts,(int,float)):
        return "red"
    if ts >= THRESH["trend_green_min"]:
        return "green"
    if ts >= THRESH["trend_yellow_min"]:
        return "yellow"
    return "red"

def color_vol_scaled(vs): return "green" if (isinstance(vs,(int,float)) and vs<THRESH["vol_low_max"]) else "red"
def color_squeeze(sq):    return "green" if (isinstance(sq,(int,float)) and sq<THRESH["squeeze_open_max"]) else "red"
def color_volume(vs):     return "green" if (isinstance(vs,(int,float)) and vs>THRESH["volsent_green_gt"]) else "red"

def compute_volume_sentiment_pct(metrics: dict) -> float:
    close_prev = metrics.get("close_prev_1h") or metrics.get("close_1h_prev")
    close_curr = metrics.get("close_1h")
    volume     = metrics.get("volume_1h") or metrics.get("vol_1h")
    volSma     = metrics.get("volSma_1h") or metrics.get("vol_sma_1h")
    if not all(isinstance(x,(int,float)) for x in (close_prev,close_curr,volume,volSma)):
        return 0.0
    obv_delta = volume if close_curr > close_prev else (-volume if close_curr < close_prev else 0.0)
    vs_pct = 100.0 * (obv_delta / max(volSma, 1.0))
    return clamp(vs_pct, -20.0, 20.0)

def main():
    j = load_json(HOURLY_PATH)
    if not j:
        print("[1h] hourly file missing"); return
    now = utc_now()
    m = j.get("metrics") or {}
    h = j.get("hourly") or {}
    prev = (h.get("signals") or {})

    # IMPORTANT: we now expect trend_strength_1h_pct to exist (set by make_dashboard_hourly.py)
    ts = m.get("trend_strength_1h_pct") or m.get("trend_strength_pct")
    sq = m.get("squeeze_1h_pct")
    vol_pct = m.get("volatility_1h_pct")
    vol_scaled = m.get("volatility_1h_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        MIN_PCT, MAX_PCT = 0.30, 3.50
        vol_scaled = 100.0 * clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9), 0.0, 1.0)

    vs = m.get("volume_sentiment_1h_pct")
    if not isinstance(vs,(int,float)):
        vs = compute_volume_sentiment_pct(m)

    # fallback if ts missing
    if not isinstance(ts,(int,float)):
        ema_sign = m.get("ema_sign")
        base = 45.0 if (isinstance(ema_sign,(int,float)) and ema_sign!=0) else 30.0
        if isinstance(sq,(int,float)):
            base += (100.0 - clamp(sq,0.0,100.0)) * 0.15
        ts = clamp(base, 0.0, 100.0)

    trend_color = color_trend(ts)
    vol_color   = color_vol_scaled(vol_scaled)
    sq_color    = color_squeeze(sq)
    flow_color  = color_volume(vs)

    j.setdefault("strategy", {})
    j["strategy"]["trend1h"] = {
        "state": trend_color,
        "reason": f"Trend {ts:.1f} ({trend_color})"
                  + (f" | Vol({vol_color})" if vol_color else "")
                  + (f" | Sq({sq:.1f}% {sq_color})" if isinstance(sq,(int,float)) else "")
                  + (f" | Flow({vs:+.2f}% {flow_color})" if isinstance(vs,(int,float)) else ""),
        "updatedAt": now
    }

    j["lux1h"] = {
        "trendStrength": float(ts),
        "volatility": float(vol_pct) if isinstance(vol_pct,(int,float)) else None,
        "volatilityScaled": float(vol_scaled) if isinstance(vol_scaled,(int,float)) else None,
        "squeezePct": float(sq) if isinstance(sq,(int,float)) else None,
        "volumeSentiment": float(vs)
    }

    j.setdefault("engineLights", {})
    j["engineLights"].setdefault("lux1h", {})
    j["engineLights"]["lux1h"].update(j["lux1h"])
    j["engineLights"].setdefault("metrics", {})
    j["engineLights"]["metrics"].update({
        "lux1h_trendStrength": j["lux1h"]["trendStrength"],
        "lux1h_volatility": j["lux1h"]["volatility"],
        "lux1h_volatilityScaled": j["lux1h"]["volatilityScaled"],
        "lux1h_squeezePct": j["lux1h"]["squeezePct"],
        "lux1h_volumeSentiment": j["lux1h"]["volumeSentiment"]
    })

    sigs = dict(prev) if isinstance(prev,dict) else {}

    # NEW: overall state matches 3-color
    if trend_color == "green":
        overall = "bull"
    elif trend_color == "red":
        overall = "bear"
    else:
        overall = "neutral"

    sigs["sigOverall1h"] = {"state": overall, "lastChanged": carry_last_changed(sigs.get("sigOverall1h",{}), overall, now)}

    ema_sign = m.get("ema_sign")
    ema_state = "bull" if isinstance(ema_sign,(int,float)) and ema_sign>0 else ("bear" if isinstance(ema_sign,(int,float)) and ema_sign<0 else overall)
    sigs["sigEMA1h"] = {"state": ema_state, "lastChanged": carry_last_changed(sigs.get("sigEMA1h",{}), ema_state, now)}

    combo = m.get("momentum_combo_1h_pct")
    if isinstance(combo,(int,float)):
        smi_state = "bull" if combo>50.0 else "bear" if combo<50.0 else overall
    else:
        smi_state = overall
    sigs["sigSMI1h"] = {"state": smi_state, "lastChanged": carry_last_changed(sigs.get("sigSMI1h",{}), smi_state, now)}

    h["signals"] = sigs
    j["hourly"] = h

    save_json(HOURLY_PATH, j)
    print("[1h] Lux summary + 3-color trend (green/yellow/red) written.")
