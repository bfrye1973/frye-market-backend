#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — compute_trend_eod.py

EOD (Daily) Engine — R12.8

This script post-processes data/outlook_eod.json and computes:

- Per-sector 10-day breadth & momentum using 10d NH/NL and 10d UP/DOWN counts
- Daily "trendDaily" object:
    - trend.emaSlope             (proxy for 10d trend strength, in pct space  -100..+100)
    - participation.pctAboveMA   (pct of sectors with breadth >= 50%)
    - volatilityRegime.{atrPct, band}
    - liquidityRegime.{psi, band}
- Daily squeeze PSI (`metrics.daily_squeeze_pct`), using existing PSI if present
- Composite daily score (`metrics.overall_eod_score` & daily.overallEOD.*) using:

    overall_eod_score =
        40% * trend_pct
      + 25% * participation_pct
      + 10% * squeeze_expansion_pct   (100 - PSI)
      + 10% * liquidity_norm_pct
      + 10% * volatility_score_pct    (100 - min(vol_pct, 100))
      + 5%  * riskOn_pct

Writes into:
- j["metrics"]["daily_squeeze_pct"]
- j["metrics"]["trend_eod_pct"]
- j["metrics"]["participation_eod_pct"]
- j["metrics"]["volatility_eod_pct"]
- j["metrics"]["liquidity_eod_psi"]
- j["metrics"]["riskOn_eod_pct"]
- j["metrics"]["overall_eod_score"]
- j["metrics"]["overall_eod_state"]
- j["daily"]["overallEOD"] = { state, score, components, lastChanged }
- j["trendDaily"] = { trend, participation, volatilityRegime, liquidityRegime }
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

EOD_PATH = "data/outlook_eod.json"

OFFENSIVE_SECTORS = {
    "information technology",
    "consumer discretionary",
    "communication services",
    "industrials",
}

DEFENSIVE_SECTORS = {
    "consumer staples",
    "utilities",
    "health care",
    "real estate",
}

# ------------------------- Helpers --------------------------


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo


def pct(a: float, b: float) -> float:
    try:
        if b <= 0:
            return 0.0
        return 100.0 * float(a) / float(b)
    except Exception:
        return 0.0


def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_json(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


# ---------------- Sector-level EOD metrics ------------------


def compute_sector_breadth_momentum(sectors: List[dict]) -> List[dict]:
    """
    For each sector entry, compute 10-day breadth & momentum.

    Expected keys per sector (adjust if your schema differs):
      - "sector": name
      - "nh10" or "nh": 10-day new highs count
      - "nl10" or "nl": 10-day new lows count
      - "up10" or "up": 10-day up bars (or 3xADR up count)
      - "down10" or "down": 10-day down bars (or 3xADR down count)
    """
    out: List[dict] = []
    for c in sectors or []:
        name = (c.get("sector") or "").strip()
        if not name:
            continue

        nh = c.get("nh10", c.get("nh", 0)) or 0.0
        nl = c.get("nl10", c.get("nl", 0)) or 0.0
        up = c.get("up10", c.get("up", 0)) or 0.0
        dn = c.get("down10", c.get("down", 0)) or 0.0

        try:
            nh = float(nh)
            nl = float(nl)
            up = float(up)
            dn = float(dn)
        except Exception:
            nh = nl = up = dn = 0.0

        breadth_pct = pct(nh, nh + nl) if nh + nl > 0 else 50.0
        # momentum ~ % of "up" over (up+down)
        mom_pct = pct(up, up + dn) if up + dn > 0 else 50.0

        c_out = dict(c)
        c_out["sector"] = name
        c_out["breadth_pct"] = round(breadth_pct, 2)
        c_out["momentum_pct"] = round(mom_pct, 2)
        out.append(c_out)

    return out


# ---------------- Composite EOD metrics ---------------------


def compute_daily_composites(
    sectors: List[dict],
    metrics: dict,
    daily_root: dict,
) -> Tuple[float, float, float, float, float, float, float, dict]:
    """
    Compute:
      - trend_pct      (0-100)
      - participation_pct
      - squeeze_psi
      - vol_pct
      - liq_psi
      - riskOn_pct
      - overall_eod_score
      - trendDaily (structure for frontend)
    """

    # --- Trend & Participation from sector breadth/momentum ---
    breadth_vals: List[float] = []
    mom_vals: List[float] = []

    n_good = 0
    total = 0

    for c in sectors:
        b = c.get("breadth_pct")
        m = c.get("momentum_pct")
        try:
            b_val = float(b)
            m_val = float(m)
        except Exception:
            continue
        breadth_vals.append(b_val)
        mom_vals.append(m_val)
        total += 1
        if b_val >= 50.0 and m_val >= 50.0:
            n_good += 1

    if total > 0:
        trend_pct = sum(breadth_vals) / total
        participation_pct = pct(n_good, total)
    else:
        trend_pct = 50.0
        participation_pct = 50.0

    # Trend "slope" proxy in range ~[-50, +50], based on deviation from 50
    ema_slope = clamp(trend_pct - 50.0, -50.0, 50.0)

    # --- Squeeze PSI (tightness, 0..100) ---
    # Expect either metrics["daily_squeeze_pct"] or metrics["squeeze_daily_pct"]
    squeeze_psi = metrics.get("daily_squeeze_pct")
    if squeeze_psi is None:
        squeeze_psi = metrics.get("squeeze_daily_pct")
    try:
        squeeze_psi = float(squeeze_psi)
    except Exception:
        squeeze_psi = 50.0
    squeeze_psi = clamp(squeeze_psi, 0.0, 100.0)
    squeeze_exp = 100.0 - squeeze_psi  # expansion score

    # --- Volatility (ATR%) ---
    # Expect daily volatility pct in metrics["volatility_eod_pct"] or daily["volatility"]["atrPct"]
    vol_pct = metrics.get("volatility_eod_pct")
    if vol_pct is None:
        vol_root = daily_root.get("volatility", {})
        vol_pct = vol_root.get("atrPct")
    try:
        vol_pct = float(vol_pct)
    except Exception:
        vol_pct = 20.0
    vol_pct = max(0.0, float(vol_pct))
    vol_score = 100.0 - clamp(vol_pct, 0.0, 100.0)  # higher vol = lower score

    # Volatility band for trendDaily
    if vol_pct < 1.0:
        vol_band = "low"
    elif vol_pct < 2.0:
        vol_band = "normal"
    elif vol_pct < 3.0:
        vol_band = "elevated"
    else:
        vol_band = "high"

    # --- Liquidity (volume ratio) ---
    # Expect metrics["liquidity_eod_psi"] or daily["liquidity"]["psi"]
    liq_psi = metrics.get("liquidity_eod_psi")
    if liq_psi is None:
        liq_root = daily_root.get("liquidity", {})
        liq_psi = liq_root.get("psi")
    try:
        liq_psi = float(liq_psi)
    except Exception:
        liq_psi = 100.0  # neutral
    liq_psi = clamp(liq_psi, 0.0, 200.0)

    # Liquidity band for trendDaily
    if liq_psi < 80.0:
        liq_band = "weak"
    elif liq_psi < 120.0:
        liq_band = "normal"
    else:
        liq_band = "good"

    # Normalize liquidity for composite score (0-100)
    liq_norm = clamp(liq_psi, 0.0, 200.0)
    if liq_norm > 0:
        liq_norm_pct = clamp(liq_norm, 0.0, 200.0) / 2.0  # 0..100
    else:
        liq_norm_pct = 50.0

    # --- Risk-On (offense vs defense) ---
    risk_on = 50.0
    if sectors:
        n = 0
        acc = 0.0
        for c in sectors:
            sec_name = (c.get("sector") or "").strip().lower()
            b = c.get("breadth_pct")
            try:
                b_val = float(b)
            except Exception:
                continue
            if sec_name in OFFENSIVE_SECTORS:
                n += 1
                if b_val >= 55.0:
                    acc += 1.0
            elif sec_name in DEFENSIVE_SECTORS:
                n += 1
                if b_val <= 45.0:
                    acc += 1.0
        risk_on = pct(acc, n) if n > 0 else 50.0

    # --- Composite daily score ---
    trend_pct_clamped = clamp(trend_pct, 0.0, 100.0)
    participation_pct_clamped = clamp(participation_pct, 0.0, 100.0)
    squeeze_exp_pct = clamp(squeeze_exp, 0.0, 100.0)
    vol_score_pct = clamp(vol_score, 0.0, 100.0)
    liq_pct = clamp(liq_norm_pct, 0.0, 100.0)
    risk_on_pct = clamp(risk_on, 0.0, 100.0)

    overall = (
        0.40 * trend_pct_clamped
        + 0.25 * participation_pct_clamped
        + 0.10 * squeeze_exp_pct
        + 0.10 * liq_pct
        + 0.10 * vol_score_pct
        + 0.05 * risk_on_pct
    )
    overall = clamp(overall, 0.0, 100.0)

    # EOD state
    if overall >= 60.0 and trend_pct_clamped >= 55.0:
        state = "bull"
    elif overall <= 40.0 and trend_pct_clamped <= 45.0:
        state = "bear"
    else:
        state = "neutral"

    trend_daily = {
        "trend": {"emaSlope": ema_slope},
        "participation": {"pctAboveMA": participation_pct_clamped},
        "volatilityRegime": {"atrPct": vol_pct, "band": vol_band},
        "liquidityRegime": {"psi": liq_psi, "band": liq_band},
    }

    return (
        trend_pct_clamped,
        participation_pct_clamped,
        squeeze_psi,
        vol_pct,
        liq_psi,
        risk_on_pct,
        overall,
        trend_daily,
    )


# ------------------------------ Main -------------------------


def compute_eod():
  """
  Main entrypoint. Reads data/outlook_eod.json, computes daily EOD metrics,
  and writes back the updated JSON.
  """
  j = load_json(EOD_PATH)
  if not j:
      print("[eod] outlook JSON missing or empty")
      return

  # Root structures
  metrics = j.get("metrics") or {}
  daily = j.get("daily") or {}
  sectors_raw = daily.get("sectors") or j.get("sectors") or []

  # 1) Compute sector-level breadth & momentum (in-place)
  sectors_enriched = compute_sector_breadth_momentum(sectors_raw)
  # Persist enriched sectors back into daily.sectors
  daily["sectors"] = sectors_enriched

  # 2) Compute composite scores
  (
      trend_pct,
      participation_pct,
      squeeze_psi,
      vol_pct,
      liq_psi,
      risk_on_pct,
      overall_score,
      trend_daily,
  ) = compute_daily_composites(sectors_enriched, metrics, daily)

  # 3) Update metrics
  metrics["daily_squeeze_pct"] = round(squeeze_psi, 2)
  metrics["trend_eod_pct"] = round(trend_pct, 2)
  metrics["participation_eod_pct"] = round(participation_pct, 2)
  metrics["volatility_eod_pct"] = round(vol_pct, 2)
  metrics["liquidity_eod_psi"] = round(liq_psi, 2)
  metrics["riskOn_eod_pct"] = round(risk_on_pct, 2)
  metrics["overall_eod_score"] = round(overall_score, 1)

  if overall_score >= 60.0 and trend_pct >= 55.0:
      overall_state = "bull"
  elif overall_score <= 40.0 and trend_pct <= 45.0:
      overall_state = "bear"
  else:
      overall_state = "neutral"

  metrics["overall_eod_state"] = overall_state

  # 4) Update daily.overallEOD
  prev_overall = (daily.get("overallEOD") or {})
  last_changed = prev_overall.get("lastChanged") or now_utc_iso()
  if prev_overall.get("state") != overall_state:
      last_changed = now_utc_iso()

  daily["overallEOD"] = {
      "state": overall_state,
      "score": round(overall_score, 1),
      "components": {
          "trend": round(trend_pct, 2),
          "participation": round(participation_pct, 2),
          "squeeze": round(100.0 - squeeze_psi, 2),
          "liquidity": round(liq_psi, 2),
          "volatility": round(vol_pct, 2),
          "riskOn": round(risk_on_pct, 2),
      },
      "lastChanged": last_changed,
  }

  # 5) Attach trendDaily structure
  j["trendDaily"] = trend_daily
  j["metrics"] = metrics
  j["daily"] = daily

  save_json(EOD_P
