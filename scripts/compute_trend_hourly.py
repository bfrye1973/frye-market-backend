#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_hourly.py — robust, validator-safe

Reads data/outlook_hourly.json and guarantees:
- strategy.trend1h populated (Lux-style summary with bands)
- hourly.signals has ALL of:
    sigOverall1h, sigEMA1h, sigSMI1h
  even when input metrics are missing (defaults to 'neutral', lastChanged preserved).

No external API calls.
"""

import json
import datetime
from typing import Dict, Any

HOURLY_PATH = "data/outlook_hourly.json"

# ------------------------
# Dashboard thresholds (R/Y/G)
# ------------------------
TREND_GREEN = 60.0     # >= 60 -> green
TREND_YELLOW_LOW = 40.0

VOL_GREEN = 40.0       # < 40 -> green (Low)
VOL_RED = 70.0         # >= 70 -> red (High)

SQ_GREEN = 30.0        # < 30 -> green (Open)
SQ_RED = 70.0          # >= 70 -> red (Compression)

VS_NEUTRAL = 3.0       # +/- 3% window for neutral


# ------------------------
# Utility helpers
# ------------------------
def utc_now() -> str:
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_json(path: str, obj: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def carry_last_changed(prev_sig: Dict[str, Any], new_state: str, default_ts: str) -> str:
    """Preserve lastChanged unless state flips."""
    prev_state = (prev_sig or {}).get("state")
    last = (prev_sig or {}).get("lastChanged") or default_ts
    if prev_state != new_state:
        last = default_ts
    return last


def band_trend(x: float) -> str:
    if x >= TREND_GREEN:
        return "green"
    if x >= TREND_YELLOW_LOW:
        return "yellow"
    return "red"


def band_vol_scaled(x: float) -> str:
    if x < VOL_GREEN:
        return "green"   # Low
    if x >= VOL_RED:
        return "red"     # High
    return "yellow"      # Moderate


def band_squeeze(tight_pct: float) -> str:
    if tight_pct >= SQ_RED:
        return "red"     # Compression
    if tight_pct >= SQ_GREEN:
        return "yellow"  # Building
    return "green"       # Open/Expanding


def band_vol_sentiment(signed_pct: float) -> str:
    if signed_pct > VS_NEUTRAL:
        return "green"   # Bull flow
    if signed_pct < -VS_NEUTRAL:
        return "red"     # Bear flow
    return "yellow"      # Neutral


def posture_score_from_gap_pct(gap_pct: float, full_credit: float = 0.60) -> float:
    """Convert EMA gap (% of slow EMA) to a 0..100 signed posture score around 50."""
    if full_credit <= 0:
        full_credit = 0.60
    unit = clamp(gap_pct / full_credit, -1.0, 1.0)  # normalized distance in [-1,1]
    return 50.0 + 50.0 * unit


def trend_strength(ema_gap_pct: float, smi_combo_pct: float, squeeze_pct: float) -> float:
    """
    Blend: EMA posture (dominant) + SMI combo + context (open=100, tight=0).
    Output: 0..100 magnitude (direction handled separately).
    """
    ema_score = posture_score_from_gap_pct(ema_gap_pct, full_credit=0.60)
    smi_score = smi_combo_pct if isinstance(smi_combo_pct, (int, float)) else ema_score
    ctx = 100.0 - clamp(float(squeeze_pct or 0.0), 0.0, 100.0)  # open=100, tight=0

    w_ema, w_smi, w_ctx = 0.60, 0.25, 0.15
    raw = w_ema * abs(ema_score - 50.0) + w_smi * abs(smi_score - 50.0) + w_ctx * ctx
    return clamp(raw, 0.0, 100.0)


def ensure_vol_scaled(metrics: Dict[str, Any]) -> None:
    """
    Ensure metrics.volatility_1h_scaled exists (0..100).
    If missing, normalize ATR% using conservative bounds that work for SPY 1h.
    """
    if "volatility_1h_scaled" in metrics:
        return
    atr_pct = metrics.get("volatility_1h_pct")
    if not isinstance(atr_pct, (int, float)):
        return
    MIN_PCT = 0.30
    MAX_PCT = 3.50
    scaled = 100.0 * clamp((atr_pct - MIN_PCT) / max(MAX_PCT - MIN_PCT, 1e-9), 0.0, 1.0)
    metrics["volatility_1h_scaled"] = round(scaled, 2)


# ------------------------
# Main
# ------------------------
def main() -> None:
    j = load_json(HOURLY_PATH)
    if not j:
        print("[hourly] file missing or invalid; nothing to do")
        return

    metrics = j.get("metrics") or {}
    hourly = j.get("hourly") or {}
    prev_signals = hourly.get("signals") or {}
    now = utc_now()

    # Pull defensively
    ema_sign = metrics.get("ema_sign")                  # +1/-1/0
    ema_gap_pct = metrics.get("ema_gap_pct")            # optional; % of slow EMA
    combo = metrics.get("momentum_combo_1h_pct")        # 0..100
    squeeze_pct = metrics.get("squeeze_1h_pct", 0.0)    # 0..100 tightness
    vol_pct = metrics.get("volatility_1h_pct")          # ATR%
    vs_signed = metrics.get("volume_sentiment_1h_pct")  # signed flow (−50..+50)

    # If ema_gap_pct is missing, approximate from ema_sign so posture still works
    if not isinstance(ema_gap_pct, (int, float)):
        if isinstance(ema_sign, (int, float)) and ema_sign != 0:
            ema_gap_pct = 0.30 * (1 if ema_sign > 0 else -1)  # ~±0.3%
        else:
            ema_gap_pct = 0.0

    # Compute Trend Strength
    ts_mag = trend_strength(
        ema_gap_pct=ema_gap_pct,
        smi_combo_pct=combo if isinstance(combo, (int, float)) else None,
        squeeze_pct=squeeze_pct
    )
    ts_band = band_trend(ts_mag)

    # Direction score to help fallback for sigOverall1h
    direction_score = 0.0
    if isinstance(ema_sign, (int, float)):
        direction_score += 1.0 if ema_sign > 0 else (-1.0 if ema_sign < 0 else 0.0)
    if isinstance(combo, (int, float)):
        direction_score += (1.0 if combo >= 50.0 else -1.0)

    # Volatility scaled + band
    ensure_vol_scaled(metrics)
    vol_scaled = metrics.get("volatility_1h_scaled")
    vol_band = band_vol_scaled(vol_scaled) if isinstance(vol_scaled, (int, float)) else "yellow"

    # Squeeze band
    sq_band = band_squeeze(float(squeeze_pct or 0.0))

    # Volume sentiment band
    if isinstance(vs_signed, (int, float)):
        vs_band = band_vol_sentiment(vs_signed)
    else:
        vs_band = "yellow"

    # --------------- strategy.trend1h ---------------
    strat = j.get("strategy") or {}
    strat["trend1h"] = {
        "state": ts_band,
        "reason": f"Trend {ts_mag:.1f} | Vol({vol_band}) | Sq({squeeze_pct:.1f}%)"
                  + (f" | Flow({vs_signed:.2f})" if isinstance(vs_signed, (int, float)) else ""),
        "updatedAt": now
    }
    j["strategy"] = strat

    # --------------- hourly.signals (ALWAYS create all three) ---------------
    signals = dict(prev_signals) if isinstance(prev_signals, dict) else {}

    # sigOverall1h
    st_overall_src = (hourly.get("overall1h") or {}).get("state")
    if isinstance(st_overall_src, str) and st_overall_src.lower() in ("bull", "bear", "neutral"):
        overall_state = st_overall_src.lower()
    else:
        overall_state = "bull" if direction_score > 0 else ("bear" if direction_score < 0 else "neutral")
    signals["sigOverall1h"] = {
        "state": overall_state,
        "lastChanged": carry_last_changed(signals.get("sigOverall1h", {}), overall_state, now)
    }

    # sigEMA1h (create even if ema_sign missing -> neutral)
    if isinstance(ema_sign, (int, float)):
        ema_state = "bull" if ema_sign > 0 else ("bear" if ema_sign < 0 else "neutral")
    else:
        ema_state = "neutral"
    signals["sigEMA1h"] = {
        "state": ema_state,
        "lastChanged": carry_last_changed(signals.get("sigEMA1h", {}), ema_state, now)
    }

    # sigSMI1h (create even if combo missing -> neutral)
    if isinstance(combo, (int, float)):
        if combo > 50.0:
            smi_state = "bull"
        elif combo < 50.0:
            smi_state = "bear"
        else:
            smi_state = "neutral"
    else:
        smi_state = "neutral"
    signals["sigSMI1h"] = {
        "state": smi_state,
        "lastChanged": carry_last_changed(signals.get("sigSMI1h", {}), smi_state, now)
    }

    hourly["signals"] = signals
    j["hourly"] = hourly

    # --------------- panel helper (optional) ---------------
    j.setdefault("luxTrend1h", {})
    j["luxTrend1h"]["trendStrength_pct"] = round(ts_mag, 2)
    j["luxTrend1h"]["trendStrength_band"] = ts_band
    if isinstance(vol_pct, (int, float)):
        j["luxTrend1h"]["volatility_pct"] = round(vol_pct, 3)
    if isinstance(vol_scaled, (int, float)):
        j["luxTrend1h"]["volatility_scaled"] = round(vol_scaled, 2)
    j["luxTrend1h"]["volatility_band"] = vol_band
    j["luxTrend1h"]["squeeze_pct"] = round(float(squeeze_pct or 0.0), 2)
    j["luxTrend1h"]["squeeze_band"] = sq_band
    if isinstance(vs_signed, (int, float)):
        j["luxTrend1h"]["volumeSentiment_pct"] = round(vs_signed, 2)
    j["luxTrend1h"]["volumeSentiment_band"] = vs_band

    save_json(HOURLY_PATH, j)
    print("[hourly] strategy.trend1h.state:", ts_band)
    print("[hourly] signals:", {k: v.get("state") for k, v in signals.items()})


if __name__ == "__main__":
    main()
