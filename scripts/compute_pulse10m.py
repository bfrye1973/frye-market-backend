#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_pulse10m.py  —  10-minute Sector Rotation Pulse (FULL FILE)

Reads `data/outlook_intraday.json`, computes a 10m “Pulse” from sectorCards and writes:
  1) `pulse10m` object:
      {
        "signal": 0..100,                # rotation signal (50 = neutral)
        "pulse": -100..+100,             # offenseTilt - defensiveTilt
        "pulseDelta": number,            # diff in signal vs previous run (optional)
        "offenseTilt": 0..100,
        "defensiveTilt": 0..100,
        "greenCount": int,               # sectors with tilt >= 50
        "redCount": int,                 # sectors with tilt < 50
        "avgBreadth": 0..100 or null,
        "avgMomentum": 0..100 or null,
        "risingPct": 0..100              # % sectors with tilt >= 50
      }

  2) Mirrors in `metrics` for FE convenience:
      "pulse10m_signal", "pulse10m_offenseTilt", "pulse10m_defensiveTilt",
      "pulse10m_greenCount", "pulse10m_redCount", "pulse10m_risingPct"

  3) Sector Direction light for 10m (so UI never defaults to 50):
      intraday.sectorDirection10m.risingPct = <same risingPct>

No external calls are required. If you want `pulseDelta`, optionally set PREV_JSON_URL to your
live intraday JSON (e.g. https://raw.githubusercontent.com/.../data-live-10min/data/outlook_intraday.json).
"""

from __future__ import annotations
import json
import math
import os
import sys
import urllib.request

# ---------- File locations ----------
IN_PATH  = os.environ.get("INTRADAY_JSON_PATH", "data/outlook_intraday.json")
OUT_PATH = IN_PATH  # in-place write
PREV_JSON_URL = os.environ.get("PREV_JSON_URL", "")  # optional, to compute pulseDelta

# ---------- Sector buckets ----------
# Offensive (risk-on)
OFFENSIVE = {
    "Information Technology",
    "Consumer Discretionary",
    "Communication Services",
    "Industrials",
}

# Defensive (risk-off)
DEFENSIVE = {
    "Consumer Staples",
    "Health Care",
    "Utilities",
    "Real Estate",
}

# Neutral (low weight to smooth noise)
NEUTRAL = {
    "Materials",
    "Energy",
    "Financials",
}
NEUTRAL_WEIGHT = float(os.environ.get("PULSE_NEUTRAL_WEIGHT", "0.5"))  # 0.0..1.0

# ---------- Helpers ----------
def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def mean_safe(vals):
    vals = [v for v in vals if isinstance(v, (int, float)) and math.isfinite(v)]
    return (sum(vals) / len(vals)) if vals else None

def safe_num(v, default=None):
    """
    Convert to float; treat 0.0 as valid.
    Returns default only if v is None/empty or not numeric.
    """
    try:
        if v is None or (isinstance(v, str) and not v.strip()):
            return default
        n = float(v)
        return n if math.isfinite(n) else default
    except Exception:
        return default

def fetch_json(url: str):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Cache-Control": "no-store"}), timeout=6) as r:
            return json.load(r)
    except Exception:
        return None

def fmt2(x):
    return round(float(x), 2) if isinstance(x, (int, float)) and math.isfinite(x) else None

# ---------- Core compute ----------
def compute_pulse_from_cards(cards: list[dict]) -> dict:
    """
    cards: list of sector entries like:
      {"sector": "Information Technology","breadth_pct": 54.2,"momentum_pct": 61.3, ...}
    Returns dict with offenseTilt, defensiveTilt, risingPct, etc.
    """
    if not isinstance(cards, list) or not cards:
        return {
            "offenseTilt": None,
            "defensiveTilt": None,
            "greenCount": 0,
            "redCount": 0,
            "avgBreadth": None,
            "avgMomentum": None,
            "risingPct": None,
        }

    tilts = []
    offense_tilts = []
    defense_tilts = []
    neutral_tilts = []

    for r in cards:
        sec = (r.get("sector") or "").strip()
        b = safe_num(r.get("breadth_pct"))
        m = safe_num(r.get("momentum_pct"))
        if b is None or m is None or not sec:
            # invalid, skip (None/NaN only; 0.0 is VALID)
            continue
        tilt = (b + m) / 2.0
        tilts.append((sec, tilt))
        if sec in OFFENSIVE:
            offense_tilts.append(tilt)
        elif sec in DEFENSIVE:
            defense_tilts.append(tilt)
        elif sec in NEUTRAL:
            neutral_tilts.append(tilt)

    if not tilts:
        return {
            "offenseTilt": None,
            "defensiveTilt": None,
            "greenCount": 0,
            "redCount": 0,
            "avgBreadth": None,
            "avgMomentum": None,
            "risingPct": None,
        }

    # Weighted offense/defense with neutral smoothing
    off = mean_safe(offense_tilts)
    dfc = mean_safe(defense_tilts)
    neu = mean_safe(neutral_tilts)
    if off is not None and neu is not None and NEUTRAL_WEIGHT > 0:
        off = off * (1.0 - NEUTRAL_WEIGHT) + neu * NEUTRAL_WEIGHT

    greens = sum(1 for (_, t) in tilts if t >= 50.0)
    reds   = len(tilts) - greens

    avg_b = mean_safe([safe_num(r.get("breadth_pct")) for r in cards])
    avg_m = mean_safe([safe_num(r.get("momentum_pct")) for r in cards])

    rising = (greens / len(tilts)) * 100.0 if len(tilts) else None

    return {
        "offenseTilt": fmt2(off),
        "defensiveTilt": fmt2(dfc),
        "greenCount": greens,
        "redCount": reds,
        "avgBreadth": fmt2(avg_b),
        "avgMomentum": fmt2(avg_m),
        "risingPct": fmt2(rising),
    }

def compute_signal(off: float|None, dfc: float|None, greens: int, reds: int) -> float:
    """
    Combine offense vs defense and participation spread => [0..100] signal.
    """
    if off is None or dfc is None:
        return 50.0
    diff = clamp(off - dfc, -100, 100)       # -100..+100
    base = 50.0 + (diff / 2.0)              # map -100->0, +100->100
    spread = clamp((greens - reds) * 1.5, -15, 15)
    return clamp(base + spread, 0, 100)

def read_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path: str, obj: dict) -> bool:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        return True
    except Exception as e:
        print(f"[pulse10m] ERROR writing {path}: {e}", file=sys.stderr)
        return False

def main():
    doc = read_json(IN_PATH)
    if not isinstance(doc, dict):
        print(f"[pulse10m] WARNING: cannot read {IN_PATH}; skipping.")
        return

    cards = doc.get("sectorCards") or []
    comp = compute_pulse_from_cards(cards)

    # compute signal + delta (requires previous)
    prev_signal = None

    # try prior from pulse10m in current file first
    try:
        prev_signal = float(doc.get("pulse10m", {}).get("signal", None))
        if not math.isfinite(prev_signal):
            prev_signal = None
    except Exception:
        prev_signal = None

    # optional previous live JSON for delta
    if prev_signal is None and PREV_JSON_URL:
        try:
            prev = fetch_json(PREV_JSON_URL)
            if isinstance(prev, dict):
                pv = prev.get("pulse10m", {}).get("signal", None)
                if isinstance(pv, (int, float)) and math.isfinite(pv):
                    prev_signal = float(pv)
        except Exception:
            prev_signal = None

    signal_now = compute_signal(comp["offenseTilt"], comp["defensiveTilt"], comp["greenCount"], comp["redCount"])
    pulse_delta = 0.0
    if isinstance(prev_signal, (int, float)) and math.isfinite(prev_signal):
        pulse_delta = round(signal_now - prev_signal, 2)

    # build pulse object
    pulse = {
        "signal": round(signal_now, 2),
        "pulse": round((comp["offenseTilt"] or 0.0) - (comp["defensiveTilt"] or 0.0), 2),
    #   "pulseDelta": pulse_delta,  # enable when PREV_JSON_URL is set and stable in your env
        "pulseDelta": pulse_delta,
        "offenseTilt": comp["offenseTilt"],
        "defensiveTilt": comp["defensiveTilt"],
        "greenCount": comp["greenCount"],
        "redCount": comp["redCount"],
        "avgBreadth": comp["avgBreadth"],
        "avgMomentum": comp["avgMomentum"],
        "risingPct": comp["risingPct"],
    }

    # write primary block
    doc["pulse10m"] = pulse

    # mirror to metrics for FE convenience
    metrics = doc.setdefault("metrics", {})
    metrics["pulse10m_signal"]        = pulse["signal"]
    metrics["pulse10m_offenseTilt"]   = pulse["offenseTilt"]
    metrics["pulse10m_defensiveTilt"] = pulse["defensiveTilt"]
    metrics["pulse10m_greenCount"]    = pulse["greenCount"]
    metrics["pulse10m_redCount"]      = pulse["redCount"]
    metrics["pulse10m_risingPct"]     = pulse["risingPct"]

    # ensure sectorDirection10m.risingPct is written for the 10m light
    intraday = doc.setdefault("intraday", {})
    sd10 = intraday.setdefault("sectorDirection10m", {})
    rp = pulse.get("risingPct")
    sd10["risingPct"] = rp if isinstance(rp, (int, float)) and math.isfinite(rp) else 50.0

    # FINAL fallback (if rising still None in pulse): recompute crude risingPct from current cards
    if pulse.get("risingPct") is None:
        try:
            tilts = []
            for r in cards or []:
                b = safe_num(r.get("breadth_pct"))
                m = safe_num(r.get("momentum_pct"))
                if b is None or m is None:
                    continue
                tilts.append((b + m) / 2.0)
            if tilts:
                greens = sum(1 for t in tilts if t >= 50.0)
                rp2 = round(100.0 * greens / len(tilts), 2)
                pulse["risingPct"] = rp2
                metrics["pulse10m_risingPct"] = rp2
                sd10["risingPct"] = rp2
        except Exception as e:
            print("[pulse10m] fallback risingPct error:", e)

    # save
    if write_json(OUT_PATH, doc):
        print("[pulse10m] Updated", OUT_PATH)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[pulse10m] FATAL:", e, file=sys.stderr)
        # Do not fail pipeline
        sys.exit(0)
