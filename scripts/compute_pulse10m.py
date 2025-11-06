#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_pulse10m.py

Computes a 10-minute Sector Rotation Pulse from `sectorCards` and writes:
  - `pulse10m` object:
      {
        "signal": 0..100 (50 = neutral),
        "offenseTilt": 0..100,
        "defensiveTilt": 0..100,
        "greenCount": int (# sectors with tilt >= 50),
        "redCount": int (# sectors with tilt < 50),
        "avgBreadth": 0..100 (all sectors),
        "avgMomentum": 0..100 (all sectors),
        "risingPct": number if present (fallback to % of sectors with tilt>=50)
      }
  - mirrors in `metrics`:
      "pulse10m_signal", "pulse10m_offenseTilt", "pulse10m_defenseTilt",
      "pulse10m_greenCount", "pulse10m_redCount"

• No external API calls. Pure math on existing JSON.
• Lightweight (~1–2 ms), safe to run every 10m.
"""

from __future__ import annotations
import json, math, statistics, sys, os

IN_PATH  = os.environ.get("INTRADAY_JSON_PATH", "data/outlook_intraday.json")
OUT_PATH = IN_PATH  # in-place update

# Offense/defense buckets (adjustable if you want)
OFFENSIVE = {
    "Information Technology",
    "Consumer Discretionary",
    "Communication Services",
    "Industrials",
    "Materials",
    "Financials",
    "Energy",
}
DEFENSIVE = {
    "Consumer Staples",
    "Health Care",
    "Utilities",
    "Real Estate",
}


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def mean_safe(vals):
    vals = [v for v in vals if isinstance(v, (int, float))]
    return (sum(vals) / len(vals)) if vals else None


def compute_pulse(sector_cards: list[dict]) -> dict:
    """
    sector_cards: list of dicts like
      {"sector": "Information Technology", "breadth_pct": 54.2, "momentum_pct": 61.3, ...}
    """
    if not sector_cards:
        return {
            "signal": 50.0,
            "offenseTilt": None,
            "defensiveTilt": None,
            "greenCount": 0,
            "redCount": 0,
            "avgBreadth": None,
            "avgMomentum": None,
            "risingPct": None,
        }

    # Compute tilt per sector (simple average of breadth & momentum)
    entries = []
    for r in sector_cards:
        sec = r.get("sector")
        b = r.get("breadth_pct")
        m = r.get("momentum_pct")
        if isinstance(b, (int, float)) and isinstance(m, (int, float)) and sec:
            tilt = (b + m) / 2.0
            entries.append((sec, b, m, tilt))

    if not entries:
        return {
            "signal": 50.0,
            "offenseTilt": None,
            "defensiveTilt": None,
            "greenCount": 0,
            "redCount": 0,
            "avgBreadth": None,
            "avgMomentum": None,
            "risingPct": None,
        }

    # Tilt per side
    off_tilts = [t for (sec, b, m, t) in entries if sec in OFFENSIVE]
    def_tilts = [t for (sec, b, m, t) in entries if sec in DEFENSIVE]
    off_tilt = mean_safe(off_tilts)
    def_tilt = mean_safe(def_tilts)

    # Participation (counts of green/red sectors by tilt >= 50)
    greens = sum(1 for (_, _, _, t) in entries if t >= 50.0)
    reds   = len(entries) - greens

    # Signal from difference in average tilts (map [-100..+100] -> [0..100])
    diff = 0.0
    if off_tilt is not None and def_tilt is not None:
        diff = off_tilt - def_tilt
    signal = clamp(50.0 + (diff / 2.0), 0.0, 100.0)  # 0 = extreme defensive, 100 = extreme offense

    # Aggregate breadth/momentum means for info
    avg_b = mean_safe([b for (_, b, _, _) in entries])
    avg_m = mean_safe([m for (_, _, m, _) in entries])

    return {
        "signal": round(signal, 2),
        "offenseTilt": round(off_tilt, 2) if off_tilt is not None else None,
        "defensiveTilt": round(def_tilt, 2) if def_tilt is not None else None,
        "greenCount": int(greens),
        "redCount": int(reds),
        "avgBreadth": round(avg_b, 2) if avg_b is not None else None,
        "avgMomentum": round(avg_m, 2) if avg_m is not None else None,
    }


def main():
    # Read
    try:
        with open(IN_PATH, "r", encoding="utf-8") as f:
            doc = json.load(f)
    except Exception as e:
        print(f"[pulse10m] ERROR reading {IN_PATH}: {e}", file=sys.stderr)
        sys.exit(0)

    sector_cards = doc.get("sectorCards", [])
    pulse = compute_pulse(sector_cards)

    # Include risingPct if present in existing doc (for continuity)
    rising_pct = None
    sd = doc.get("sectorDirection10m") or {}
    if isinstance(sd, dict):
        rp = sd.get("risingPct")
        if isinstance(rp, (int, float)):
            rising_pct = rp
    if rising_pct is None:
        total = len([1 for _ in sector_cards])
        greens = pulse.get("greenCount", 0) or 0
        rising_pct = round((greens / total) * 100.0, 2) if total else None
    pulse["risingPct"] = rising_pct

    # Write primary block
    doc["pulse10m"] = pulse

    # Mirror into metrics for compatibility with legacy readers
    m = doc.setdefault("metrics", {})
    m["pulse10m_signal"]        = pulse["signal"]
    m["pulse10m_offenseTilt"]   = pulse.get("offenseTilt")
    m["pulse10m_defenseTilt"]   = pulse.get("defensiveTilt")
    m["pulse10m_greenCount"]    = pulse.get("greenCount")
    m["pulse10m_redCount"]      = pulse.get("redCount")
    m["pulse10m_risingPct"]     = pulse.get("risingPct")

    # Save
    try:
        with open(OUT_PATH, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        print(f"[pulse10m] Updated {OUT_PATH} with pulse10m.", flush=True)
    except Exception as e:
        print(f"[pulse10m] ERROR writing {OUT_PATH}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
