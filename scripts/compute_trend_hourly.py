#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_hourly.py
================================
Post-processor for the hourly JSON. No external API calls.

What it does:
- Reads data/outlook_hourly.json
- Derives Lux-style Trend Strength (0..100) using EMA posture + SMI blend
- Adds normalized Volatility (scaled 0..100) while preserving ATR%
- Adds bands for Trend, Volatility, Squeeze, Volume Sentiment (dashboard R/Y/G)
- Writes strategy.trend1h
- Synthesizes hourly.signals:
    sigOverall1h  (from hourly.overall1h.state)
    sigEMA1h      (from metrics.ema_sign)
    sigSMI1h      (from metrics.momentum_combo_1h_pct)

This script is intentionally defensive: it tolerates missing fields and preserves
lastChanged timestamps when states don’t flip.
"""

import json
import datetime
from typing import Dict, Any

HOURLY_PATH = "data/outlook_hourly.json"

# ------------------------
# Dashboard color thresholds (global & stable)
# ------------------------
# Trend Strength (0..100)
TREND_GREEN = 60.0
TREND_YELLOW_LOW = 40.0

# Volatility (scaled 0..100)
VOL_GREEN = 40.0
VOL_RED = 70.0

# Squeeze (tightness %, higher = tighter)
SQ_RED = 70.0
SQ_GREEN = 30.0

# Volume sentiment (signed deviation from 50%)
VS_NEUTRAL = 3.0  # +/- 3% window around neutral


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
        return "green"   # Low (calm)
    if x >= VOL_RED:
        return "red"     # High (expanding)
    return "yellow"      # Moderate


def band_squeeze(tight_pct: float) -> str:
    if tight_pct >= SQ_RED:
        return "red"     # High compression
    if tight_pct >= SQ_GREEN:
        return "yellow"  # Building
    return "green"       # Open / Expanding


def band_vol_sentiment(signed_pct: float) -> str:
    if signed_pct > VS_NEUTRAL:
        return "green"   # Bull flow
    if signed_pct < -VS_NEUTRAL:
        return "red"     # Bear flow
    return "yellow"      # Neutral


def posture_score_from_gap_pct(gap_pct: float, full_credit: float = 0.60) -> float:
    """Convert EMA gap (% of slow EMA) to a 0..100 signed posture score around 50."""
    # normalized distance in [-1, 1]
    if full_credit <= 0:
        full_credit = 0.60
    unit = clamp(gap_pct / full_credit, -1.0, 1.0)
    return 50.0 + 50.0 * unit  # 0..100, signed around 50


def trend_strength(ema_gap_pct: float,
                   smi_combo_pct: float,
                   squeeze_pct: float) -> float:
    """
    Blend EMA posture (dominant) + SMI combo + context (inverse of squeeze).
    Output 0..100 magnitude (direction sign is inferred from posture/SMI).
    """
    ema_score = posture_score_from_gap_pct(ema_gap_pct, full_credit=0.60)
    # If SMI combo missing, mirror EMA posture; otherwise mix.
    smi_score = smi_combo_pct if isinstance(smi_combo_pct, (int, float)) else ema_score
    # context: open = 100, tight = 0
    ctx = 100.0 - clamp(float(squeeze_pct or 0.0), 0.0, 100.0)

    # Weights (dominant EMA)
    w_ema, w_smi, w_ctx = 0.60, 0.25, 0.15
    raw = w_ema * abs(ema_score - 50.0) + w_smi * abs(smi_score - 50.0) + w_ctx * ctx
    return clamp(raw, 0.0, 100.0)


def ensure_vol_scaled(metrics: Dict[str, Any]) -> None:
    """
    Ensure metrics.volatility_1h_scaled exists (0..100).
    If missing, normalize ATR% using conservative min/max bounds that work well on SPY.
    """
    if "volatility_1h_scaled" in metrics:
        return
    atr_pct = metrics.get("volatility_1h_pct")
    if not isinstance(atr_pct, (int, float)):
        return
    # Heuristic min/max for SPY 1h ATR% (adjust if you later prove better bounds)
    MIN_PCT = 0.30
    MAX_PCT = 3.50
    scaled = 100.0 * clamp((atr_pct - MIN_PCT) / max(MAX_PCT - MIN_PCT, 1e-9), 0.0, 1.0)
    metrics["volatility_1h_scaled"] = round(scaled, 2)


def main() -> None:
    j = load_json(HOURLY_PATH)
    if not j:
        print("[hourly] nothing to do (file missing)")
        return

    metrics = j.get("metrics") or {}
    hourly = j.get("hourly") or {}
    prev_signals = (hourly.get("signals") or {})
    now = utc_now()

    # Pull ingredients defensively
    ema_sign = metrics.get("ema_sign")             # +1 / -1 posture sign
    ema_gap_pct = metrics.get("ema_gap_pct")       # If you compute (% of slow EMA)
    combo = metrics.get("momentum_combo_1h_pct")
    squeeze_pct = metrics.get("squeeze_1h_pct", 0.0)
    vol_pct = metrics.get("volatility_1h_pct")
    vs_signed = metrics.get("volume_sentiment_1h_pct")  # signed vs neutral; optional

    # If ema_gap_pct is missing, approximate from ema_sign only
    if not isinstance(ema_gap_pct, (int, float)):
        # A small default gap to give posture some shape; adjust if you later export real gap
        if isinstance(ema_sign, (int, float)) and ema_sign != 0:
            ema_gap_pct = 0.30 * (1 if ema_sign > 0 else -1)  # +/- 0.3%
        else:
            ema_gap_pct = 0.0

    # Compute Trend Strength (magnitude 0..100)
    ts_mag = trend_strength(ema_gap_pct=ema_gap_pct,
                            smi_combo_pct=combo if isinstance(combo, (int, float)) else None,
                            squeeze_pct=squeeze_pct)

    # Direction arrow inferred from ema_sign + combo > 50
    direction_score = 0.0
    if isinstance(ema_sign, (int, float)):
        direction_score += 1.0 if ema_sign > 0 else (-1.0 if ema_sign < 0 else 0.0)
    if isinstance(combo, (int, float)):
        direction_score += (1.0 if combo >= 50.0 else -1.0)

    # Trend "state" (R/Y/G band) from magnitude only (direction handled in signals)
    ts_band = band_trend(ts_mag)

    # Ensure volatility scaled (visual) while preserving truth
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

    # ------------------------
    # strategy.trend1h payload
    # ------------------------
    strat = j.get("strategy") or {}
    trend1h = {
        "state": ts_band,                      # green|yellow|red by magnitude
        "reason": f"Trend {ts_mag:.1f} "
                  f"| Vol({vol_band}) "
                  f"| Sq({squeeze_pct:.1f}%) "
                  f"| Flow({vs_signed if isinstance(vs_signed,(int,float)) else 'n/a'})",
        "updatedAt": now
    }
    strat["trend1h"] = trend1h
    j["strategy"] = strat

    # ------------------------
    # hourly.signals (always-on pills)
    # ------------------------
    signals = dict(prev_signals) if isinstance(prev_signals, dict) else {}

    # sigOverall1h: from hourly.overall1h.state if present, else infer from direction_score
    oh = hourly.get("overall1h") or {}
    st_overall = (oh.get("state") or "").lower()
    if st_overall in ("bull", "bear", "neutral"):
        new_state = st_overall
    else:
        # fallback: infer from direction score
        new_state = "bull" if direction_score > 0 else ("bear" if direction_score < 0 else "neutral")
    last = carry_last_changed(signals.get("sigOverall1h", {}), new_state, now)
    signals["sigOverall1h"] = {"state": new_state, "lastChanged": last}

    # sigEMA1h: posture from ema_sign
    if isinstance(ema_sign, (int, float)):
        new_state = "bull" if ema_sign > 0 else ("bear" if ema_sign < 0 else "neutral")
        last = carry_last_changed(signals.get("sigEMA1h", {}), new_state, now)
        signals["sigEMA1h"] = {"state": new_state, "lastChanged": last}

    # sigSMI1h: use combo >= 50 as bull, <50 as bear (neutral if exactly 50 or missing)
    if isinstance(combo, (int, float)):
        if combo > 50.0:
            new_state = "bull"
        elif combo < 50.0:
            new_state = "bear"
        else:
            new_state = "neutral"
        last = carry_last_changed(signals.get("sigSMI1h", {}), new_state, now)
        signals["sigSMI1h"] = {"state": new_state, "lastChanged": last}

    hourly["signals"] = signals
    j["hourly"] = hourly

    # Also attach metric bands (for panel display convenience)
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
    print("[hourly] trend1h:", trend1h)
    print("[hourly] signals:", {k: v.get("state") for k, v in signals.items()})


if __name__ == "__main__":
    main()
