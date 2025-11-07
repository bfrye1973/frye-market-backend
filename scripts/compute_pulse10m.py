#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_pulse10m.py  —  10-minute Sector Rotation Pulse

Reads `data/outlook_intraday.json`, computes a 10m “Pulse” from sectorCards and writes:
  1) `pulse10m` object:
      {
        "signal": 0..100,                # rotation signal (50 = neutral)
        "pulse": -100..+100,             # offenseTilt - defensiveTilt
        "pulseDelta": number,            # diff in signal vs previous live value, if available
        "offenseTilt": 0..100,
        "defensiveTilt": 0..100,
        "greenCount": int,               # sectors with tilt >= 50
        "redCount": int,                 # sectors with tilt < 50
        "avgBreadth": 0..100 or null,
        "avgMomentum": 0..100 or null,
        "risingPct": 0..100              # % of sectors with tilt >= 50
      }

  2) Mirrors in `metrics` for FE convenience:
      "pulse10m_signal", "pulse10m_offenseTilt", "pulse10m_defensiveTilt",
      "pulse10m_greenCount", "pulse10m_redCount", "pulse10m_risingPct"

  3) Sector Direction light for 10m (so UI never defaults to 50):
      intraday.sectorDirection10m.risingPct = <same risingPct>

No external calls required. If you want `pulseDelta`, optionally set PREV_JSON_URL to your
live intraday JSON (e.g. https://raw.githubusercontent.com/.../data-live-10min/data/outlook_intraday.json).
"""

from __future__ import annotations
import json, sys, os, math, urllib.request

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

# Neutral (optional, low weight – can change weight via env)
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
    try:
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
      { "sector": "Information Technology", "breadth_pct": 54.2, "momentum_pct": 61.3, ... }
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

    # Tilt per sector = mean(breadth, momentum)
    tilts = []
    offense_tilts = []
    defense_tilts = []
    neutral_tilts = []

    for r in cards:
        sec = (r.get("sector") or "").strip()
        b = safe_num(r.get("breadth_pct"))
        m = safe_num(r.get("momentum_pct"))
        if b is None or m is None or not sec:
            continue
        tilt = (b + m) / 2.0
        tilts.append((sec, tilt))

        if sec in OFFENSIVE:
            offense_tilts.append(tilt)
        elif sec in DEFENSIVE:
            defense_tilts.append(tilt)
        elif sec in NEUTRAL:
            neutral_tilts.append(tilt)

    # No valid tilts? return neutral
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

    # Offense/Defense tilt (neutral weighted)
    off = mean_safe(offense_tilts)
    dfc = mean_safe(defense_tilts)
    neu = mean_safe(neutral_tilts)

    # Weighted offense with neutral
    if off is not None and neu is not None and NEUTRAL_WEIGHT > 0:
        off = off * (1.0 - NEUTRAL_WEIGHT) + neu * NEUTRAL_WEIGHT

    # Participation
    greens = sum(1 for (_, t) in tilts if t >= 50.0)
    reds   = len(tilts) - greens
    rising = (greens / len(tilts)) * 100.0

    # Aggregate summaries
    avg_b = mean_safe([safe_num(r.get("breadth_pct")) for r in cards])
    avg_m = mean_safe([safe_num(r.get("momentum_pct")) for r in cards])

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
    Combine offense vs defense and participation into a [0..100] signal.
    - Map tilt diff to ±50
    - Add small participation spread term
    """
    if off is None or dfc is None:
        return 50.0
    diff = clamp(off - dfc, -100, 100)        # -100..+100
    base = 50.0 + (diff / 2.0)               # -100->0, +100->100
    spread = clamp((greens - reds) * 1.5, -15, 15)  # participation boost
    return clamp(base + spread, 0, 100)

def read_json(path: str):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def write_json(path: str, obj: dict):
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

    # optional: read previous live JSON if provided via env
    if prev_signal is None and PREV_JSON_URL:
        prev = fetch_json(PREV_JSON_URL)
        if isinstance(prev, dict):
            try:
                prev_signal = float(prev.get("pulse10m", {}).get("signal", None))
                if not math.isfinite(prev_signal):
                    prev_signal = None
            except Exception:
                prev_signal = None

    # signal now
    signal_now = compute_signal(comp["offenseTilt"], comp["defensiveTilt"], comp["greenCount"], comp["redCount"])
    pulse_delta = None
    if isinstance(prev_signal, (int, float)) and math.isfinite(prev_signal):
        pulse_delta = fmt2(signal_now - prev_signal)
    else:
        pulse_delta = 0.0

    # build pulse object
    pulse = {
        "signal": fmt2(signal_now),
        "pulse": fmt2((comp["offenseTilt"] or 0.0) - (comp["defensiveTilt"] or 0.0)),
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
    metrics["pulse10m_signal"]       = pulse["signal"]
    metrics["pulse10m_offenseTilt"]  = pulse["offenseTilt"]
    metrics["pulse10m_defensiveTilt"]= pulse["defensiveTilt"]
    metrics["pulse10m_greenCount"]   = pulse["greenCount"]
    metrics["pulse10m_redCount"]     = pulse["redCount"]
    metrics["pulse10m_risingPct"]    = pulse["risingPct"]

    # ensure 10m sector direction light is not stuck at 50
    intraday = doc.setdefault("intraday", {})
    sd10 = intraday.setdefault("sectorDirection10m", {})
    try:
        rp = float(pulse["risingPct"]) if pulse["risingPct"] is not None else None
        sd10["risingPct"] = rp if rp is not None and math.isfinite(rp) else 50.0
    except Exception:
        sd10["risingPct"] = 50.0

    # save
    if write_json(OUT_PATH, doc):
        print("[pulse10m] Updated", OUT_PATH)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[pulse10m] FATAL:", e, file=sys.stderr)
        # do not fail the pipeline; write nothing if error
        sys.exit(0)
