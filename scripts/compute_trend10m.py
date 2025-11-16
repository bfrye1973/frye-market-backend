#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — compute_trend10m.py

Goal
----
Post-process data/outlook_intraday.json (10m snapshot) and:

  1. Compute optional metrics:
       - riskOn_10m_pct
       - breadth_align_fast_pct  (stub V1: neutral 50)
  2. Compute 10m Engine Lights block:

     "engineLights": {
       "10m": {
         "state": "bull|bear|neutral",
         "score": 0-100,
         "components": {
           "breadth":   int,
           "momentum":  int,
           "squeeze":   int,
           "liquidity": int,
           "volatility":int,
           "riskOn":    int
         },
         "lastChanged": "YYYY-MM-DDTHH:MM:SSZ"
       }
     }

Inputs
------
- Assumes outlook_intraday.json has been written by make_dashboard.py and
  contains:

    metrics.breadth_10m_pct
    metrics.momentum_10m_pct
    metrics.squeeze_pct
    metrics.liquidity_psi
    metrics.volatility_pct

    sectorCards[ {sector,breadth_pct,momentum_pct,...} ]

Outputs
-------
- Updates metrics with:
    riskOn_10m_pct
    breadth_align_fast_pct (stub 50.0)
- Updates/creates engineLights["10m"] block.

This script is idempotent and safe to run multiple times.
"""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

IN_PATH  = os.path.join("data", "outlook_intraday.json")
OUT_PATH = IN_PATH  # in-place update

UTC = timezone.utc

def now_utc_iso() -> str:
  return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def to_num(x, default=0.0) -> float:
  try:
    v = float(x)
    if math.isnan(v):
      return default
    return v
  except Exception:
    return default

def clamp(x: float, lo: float, hi: float) -> float:
  return max(lo, min(hi, x))

def lin_points(pct_val: float, weight: int) -> int:
  """
  Convert a 0-100 metric into +/- weight around 50.
  e.g. pct=50 => 0 pts, pct=100 => +weight, pct=0 => -weight
  """
  v = clamp(pct_val, 0.0, 100.0)
  return int(round(weight * ((v - 50.0) / 50.0)))

def compute_risk_on_pct(sector_cards: List[Dict[str, Any]]) -> float:
  """
  Approximate risk-on percentage = fraction of sectors where
    breadth_pct >= 55 AND momentum_pct >= 55.

  Simple, transparent, and consistent with teammate's intent.
  """
  if not sector_cards:
    return 50.0
  good = 0
  total = 0
  for c in sector_cards:
    b = to_num(c.get("breadth_pct"), 50.0)
    m = to_num(c.get("momentum_pct"), 50.0)
    total += 1
    if b >= 55.0 and m >= 55.0:
      good += 1
  if total == 0:
    return 50.0
  return round(100.0 * good / float(total), 2)

def main() -> int:
  if not os.path.exists(IN_PATH):
    print("[10m-trend] no outlook_intraday.json to process; skipping.")
    return 0

  with open(IN_PATH, "r", encoding="utf-8") as f:
    j = json.load(f)

  metrics: Dict[str, Any] = j.get("metrics") or {}
  cards: List[Dict[str, Any]] = j.get("sectorCards") or []

  breadth = to_num(metrics.get("breadth_10m_pct"), 50.0)
  mom     = to_num(metrics.get("momentum_10m_pct"), 50.0)
  sq      = to_num(metrics.get("squeeze_pct"), 50.0)        # expansion %
  liq     = to_num(metrics.get("liquidity_psi"), 70.0)      # 0-120, we cap later
  vol     = to_num(metrics.get("volatility_pct"), 0.0)      # 0+ (% ATR-ish)

  # 1) RiskOn 10m %
  risk_on_pct = compute_risk_on_pct(cards)

  # 2) breadth_align_fast_pct (V1 stub: neutral baseline 50)
  #    This can be upgraded later with EMA10>20 alignment logic.
  align_fast_pct = 50.0

  metrics["riskOn_10m_pct"]        = risk_on_pct
  metrics["breadth_align_fast_pct"]= align_fast_pct

  # 3) Engine Lights components
  #    We reuse a linear around 50 with weights. Feel free to tweak weights later.
  comps: Dict[str, int] = {}

  comps["breadth"]   = lin_points(breadth, weight=20)
  comps["momentum"]  = lin_points(mom,     weight=20)
  comps["squeeze"]   = lin_points(sq,      weight=10)   # high expansion => + pts
  comps["liquidity"] = lin_points(clamp(liq, 0.0, 120.0) / 1.2, weight=10)
  # Lower vol is generally "better" for trend = invert:
  vol_scaled = clamp(vol * 10.0, 0.0, 100.0)
  comps["volatility"] = lin_points(100.0 - vol_scaled, weight=5)
  comps["riskOn"]     = lin_points(risk_on_pct, weight=15)

  # Composite score around 50
  score = int(clamp(50 + sum(comps.values()), 0, 100))

  # State logic per teammate:
  # "Use 10m metrics only for now"
  # We treat:
  #   - bull: breadth >= 55, mom >= 55, score >= 60
  #   - bear: breadth <= 45, mom <= 45, score <= 40
  #   - else: neutral
  if breadth >= 55.0 and mom >= 55.0 and score >= 60:
    state = "bull"
  elif breadth <= 45.0 and mom <= 45.0 and score <= 40:
    state = "bear"
  else:
    state = "neutral"

  eng = j.get("engineLights") or {}
  prev_10m = eng.get("10m") or {}
  prev_state = prev_10m.get("state")
  prev_changed = prev_10m.get("lastChanged")

  # lastChanged only updates when state flips
  if prev_state == state and prev_changed:
    last_changed = prev_changed
  else:
    last_changed = now_utc_iso()

  eng["10m"] = {
    "state": state,
    "score": score,
    "components": comps,
    "lastChanged": last_changed,
  }
  j["engineLights"] = eng
  j["metrics"] = metrics

  with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(j, f, ensure_ascii=False, separators=(",", ":"))

  print(f"[10m-trend] state={state} score={score} comps={comps} riskOn={risk_on_pct}")
  return 0

if __name__ == "__main__":
  raise SystemExit(main() or 0)
