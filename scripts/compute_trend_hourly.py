#!/usr/bin/env python3
"""
compute_trend_hourly.py
--------------------------------
Derives hourly Lux/strategy posture and always-on signals from the
already-built hourly JSON (no Polygon, no external deps).

Writes back to data/outlook_hourly.json:

- hourly.signals:
    - sigOverall1h: { state: bull|bear|neutral, lastChanged: ISO }
    - sigEMA1h:     { state: bull|bear|neutral, lastChanged: ISO }
    - sigSMI1h:     { state: bull|bear|neutral, lastChanged: ISO }

- strategy.trend1h:
    - { state: bull|bear|neutral, reason: "...", updatedAt: ISO }
"""

import json
import os
from datetime import datetime, timezone

HOUR_PATH = os.environ.get("HOURLY_PATH", "data/outlook_hourly.json")

# ------------------------ helpers ------------------------ #
def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def to_float(v, default=None):
    try:
        if v is None:
            return default
        return float(v)
    except Exception:
        return default

def state_from_threshold(x, bull_hi=55.0, bear_lo=45.0) -> str:
    """Return bull/bear/neutral based on >55 / <45 bands."""
    x = to_float(x, None)
    if x is None:
        return "neutral"
    if x > bull_hi:
        return "bull"
    if x < bear_lo:
        return "bear"
    return "neutral"

def ensure_dict(d, key):
    """Ensure nested dict exists and return it."""
    node = d.get(key)
    if not isinstance(node, dict):
        node = {}
        d[key] = node
    return node

def set_signal(signals, key, new_state):
    s = signals.get(key) or {}
    last = s.get("state")
    if new_state != last:
        s["lastChanged"] = now_iso()
    s["state"] = new_state
    signals[key] = s

# ------------------------ main ------------------------ #
def main():
    # Load
    try:
        with open(HOUR_PATH, "r", encoding="utf-8") as f:
            j = json.load(f)
    except Exception as e:
        print("[hourly-trend] load failed:", e)
        return

    metrics = j.get("metrics") or {}
    hourly = ensure_dict(j, "hourly")
    signals = ensure_dict(hourly, "signals")
    strategy = ensure_dict(j, "strategy")

    # Pull metrics
    breadth = to_float(metrics.get("breadth_1h_pct"))
    mom     = to_float(metrics.get("momentum_1h_pct"))
    combo   = to_float(metrics.get("momentum_combo_1h_pct"))  # SMI proxy (0..100)
    squeeze = to_float(metrics.get("squeeze_1h_pct"))         # 0..100 compression
    ema_sign = to_float(metrics.get("ema_sign"), 0.0)         # >0 bull, <0 bear

    # Derive component states
    ema_state = "bull" if ema_sign > 0 else "bear" if ema_sign < 0 else "neutral"
    smi_state = state_from_threshold(combo)   # use combo as SMI-like posture
    br_state  = state_from_threshold(breadth)
    mo_state  = state_from_threshold(mom)

    # Overall (simple, robust rule)
    bull_votes = sum(s == "bull" for s in (ema_state, smi_state, br_state, mo_state))
    bear_votes = sum(s == "bear" for s in (ema_state, smi_state, br_state, mo_state))

    if bull_votes >= 3:
        overall = "bull"
    elif bear_votes >= 3:
        overall = "bear"
    else:
        overall = "neutral"

    # Reason string
    parts = [
        f"EMA={ema_state}",
        f"SMI~={smi_state}",
        f"BR={br_state}",
        f"MO={mo_state}",
    ]
    if squeeze is not None:
        parts.append(f"SQZ={int(round(squeeze))}")

    reason = " | ".join(parts)

    # Update signals (only 1h signals here)
    set_signal(signals, "sigOverall1h", overall)
    set_signal(signals, "sigEMA1h", ema_state)
    set_signal(signals, "sigSMI1h", smi_state)
    hourly["signals"] = signals  # ensure persisted

    # Update strategy block
    trend1h = {
        "state": overall,
        "reason": reason,
        "updatedAt": now_iso(),
    }
    strategy["trend1h"] = trend1h
    j["strategy"] = strategy
    j["hourly"] = hourly

    # Save
    try:
        with open(HOUR_PATH, "w", encoding="utf-8") as f:
            json.dump(j, f, ensure_ascii=False, separators=(",", ":"))
        print("[hourly-trend] updated strategy.trend1h and hourly.signals")
        print("[hourly-trend]", trend1h)
    except Exception as e:
        print("[hourly-trend] save failed:", e)

if __name__ == "__main__":
    main()
