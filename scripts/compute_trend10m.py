#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend10m.py — Lux Trend (10m) post-processor
- Reads data/outlook_intraday.json (no external API)
- Writes strategy.trend10m and luxTrend10m
- Guarantees Engine-Lights 10m pills exist:
    sigOverall10m, sigEMA10m, sigAccel10m, sigCandle10m
- Uses calibrated R/Y/G bands you approved
- Optionally peeks at /live/hourly to bias neutrality only (safe if unavailable)
"""

import json, datetime, urllib.request

INTRADAY_PATH = "data/outlook_intraday.json"
HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"

# === Calibrated bands (shared across TFs) ===
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

def carry_last_changed(prev, new_state, stamp):
    prev_state = (prev or {}).get("state")
    last = (prev or {}).get("lastChanged") or stamp
    if prev_state != new_state: last = stamp
    return last

def try_fetch(url, timeout=6):
    try:
        req = urllib.request.Request(url, headers={"User-Agent":"compute-trend10m/1.0","Cache-Control":"no-store"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {}

def main():
    j = load_json(INTRADAY_PATH)
    if not j:
        print("[10m] outlook_intraday.json missing; nothing to do")
        return

    now = utc_now()
    metrics = j.get("metrics") or {}
    eng = j.get("engineLights") or {}
    prev_signals = (eng.get("signals") or {})

    # Pull defensively (field names vary across builders)
    # Trend Strength: prefer a computed value if present; else derive a light proxy from overall/EMA/Accel
    ts_pct = metrics.get("trend_strength_10m_pct")
    overall_state = (eng.get("overall") or {}).get("state")

    # EMA posture sign (+1/-1) if your builder exports it
    ema_sign = metrics.get("ema_sign_10m") or metrics.get("ema_sign")
    # Accel proxy: Δ(breadth+momentum)
    b_now = metrics.get("breadth_10m_pct"); m_now = metrics.get("momentum_10m_pct")
    b_prev = metrics.get("breadth_10m_pct_prev"); m_prev = metrics.get("momentum_10m_pct_prev")
    accel = None
    if all(isinstance(x,(int,float)) for x in (b_now,m_now,b_prev,m_prev)):
        accel = (b_now+m_now) - (b_prev+m_prev)

    # Squeeze (tightness %)
    squeeze = (metrics.get("squeeze_10m_pct")
               or metrics.get("squeeze_pct")
               or metrics.get("squeeze_intraday_pct"))

    # Volatility
    vol_pct = (metrics.get("volatility_10m_pct")
               or metrics.get("volatility_pct"))
    vol_scaled = metrics.get("volatility_10m_scaled") or metrics.get("volatility_scaled")
    if isinstance(vol_pct,(int,float)) and not isinstance(vol_scaled,(int,float)):
        # Normalize ATR% to 0..100 with conservative bounds for 10m SPY
        MIN_PCT, MAX_PCT = 0.50, 4.00
        vol_scaled = 100.0*clamp((vol_pct - MIN_PCT)/max(MAX_PCT-MIN_PCT,1e-9), 0.0, 1.0)

    # Volume sentiment (signed, −50..+50)
    vs_signed = (metrics.get("volume_sentiment_10m_pct")
                 or metrics.get("volume_sentiment_pct"))

    # If Trend Strength not precomputed, derive a safe magnitude proxy (EMA posture dominance + context)
    if not isinstance(ts_pct,(int,float)):
        # posture magnitude: +40 if ema bull/bear, +10 if accel confirms, + (open context)
        base = 0.0
        if isinstance(ema_sign,(int,float)) and ema_sign != 0:
            base += 45.0
        if isinstance(accel,(int,float)):
            if accel >= 2.0: base += 10.0
            elif accel <= -2.0: base += 0.0
            else: base += 5.0
        if isinstance(squeeze,(int,float)):
            base += (100.0 - clamp(squeeze,0.0,100.0)) * 0.20   # more open -> stronger
        ts_pct = clamp(base, 0.0, 100.0)

    # Bands for panel
    ts_band = band_trend(ts_pct)
    vol_band = band_vol_scaled(vol_scaled if isinstance(vol_scaled,(int,float)) else None)
    sq_band  = band_squeeze(squeeze if isinstance(squeeze,(int,float)) else None)
    flow_band= band_flow(vs_signed if isinstance(vs_signed,(int,float)) else None)

    # strategy.trend10m (dialog)
    j.setdefault("strategy", {})
    j["strategy"]["trend10m"] = {
        "state": ts_band,
        "reason": f"Trend {ts_pct:.1f} | Vol({vol_band})"
                  + (f" | Sq({squeeze:.1f}%)" if isinstance(squeeze,(int,float)) else "")
                  + (f" | Flow({vs_signed:+.2f}%)" if isinstance(vs_signed,(int,float)) else ""),
        "updatedAt": now
    }

    # Always-on 10m pills
    sigs = dict(prev_signals) if isinstance(prev_signals,dict) else {}

    # Overall from engineLights.overall.state when available
    ov_state = (eng.get("overall") or {}).get("state")
    if isinstance(ov_state,str) and ov_state.lower() in ("bull","bear","neutral"):
        overall = ov_state.lower()
    else:
        # fallback: trend band → overall neutral/bull/bear
        overall = "bull" if ts_band=="green" else ("bear" if ts_band=="red" else "neutral")
    sigs["sigOverall10m"] = {
        "state": overall,
        "lastChanged": carry_last_changed(sigs.get("sigOverall10m",{}), overall, now)
    }

    # EMA 10/20 posture pill
    if isinstance(ema_sign,(int,float)):
        ema_state = "bull" if ema_sign>0 else ("bear" if ema_sign<0 else "neutral")
    else:
        ema_state = "neutral"
    sigs["sigEMA10m"] = {
        "state": ema_state,
        "lastChanged": carry_last_changed(sigs.get("sigEMA10m",{}), ema_state, now)
    }

    # Accel pill (use hysteresis-like interpretation over last delta)
    if isinstance(accel,(int,float)):
        acc_state = "bull" if accel>=2.0 else ("bear" if accel<=-2.0 else "neutral")
    else:
        acc_state = "neutral"
    sigs["sigAccel10m"] = {
        "state": acc_state,
        "lastChanged": carry_last_changed(sigs.get("sigAccel10m",{}), acc_state, now)
    }

    # CandleUp pill (optional; neutral if your builder doesn’t export it)
    candle_up = metrics.get("candle_up_10m")
    if isinstance(candle_up,bool):
        c_state = "bull" if candle_up else "bear"
    else:
        c_state = "neutral"
    sigs["sigCandle10m"] = {
        "state": c_state,
        "lastChanged": carry_last_changed(sigs.get("sigCandle10m",{}), c_state, now)
    }

    # Panel convenience block
    j.setdefault("luxTrend10m", {})
    j["luxTrend10m"]["trendStrength_pct"] = round(float(ts_pct),2)
    j["luxTrend10m"]["trendStrength_band"]= ts_band
    if isinstance(vol_pct,(int,float)): j["luxTrend10m"]["volatility_pct"] = round(vol_pct,3)
    if isinstance(vol_scaled,(int,float)): j["luxTrend10m"]["volatility_scaled"]= round(vol_scaled,2)
    j["luxTrend10m"]["volatility_band"] = vol_band
    if isinstance(squeeze,(int,float)): j["luxTrend10m"]["squeeze_pct"] = round(squeeze,2)
    j["luxTrend10m"]["squeeze_band"] = sq_band
    if isinstance(vs_signed,(int,float)): j["luxTrend10m"]["volumeSentiment_pct"] = round(vs_signed,2)
    j["luxTrend10m"]["volumeSentiment_band"] = flow_band

    # write back
    j.setdefault("engineLights", {}).setdefault("signals", {})
    j["engineLights"]["signals"].update(sigs)
    save_json(INTRADAY_PATH, j)
    print("[10m] trend10m:", j["strategy"]["trend10m"]["state"], j["strategy"]["trend10m"]["reason"])
    print("[10m] pills:", {k:v.get("state") for k,v in j["engineLights"]["signals"].items() if k.startswith("sig")})

if __name__ == "__main__":
    main()
