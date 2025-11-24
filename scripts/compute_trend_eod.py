#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — compute_trend_eod.py (R12.8)

EOD (Daily) Engine — 10-day Breadth & Momentum + Lux + SectorCards.

This script post-processes data/outlook.json (built by make_eod.py) and computes:

- Per-sector 10-day breadth & momentum using nh/nl/up/down from daily sector cards
- Daily "trendDaily" object:
    - trend.emaSlope          (proxy for trend strength, -50..+50)
    - participation.pctAboveMA (pct of sectors with breadth >= 50)
    - volatilityRegime.{atrPct, band}
    - liquidityRegime.{psi, band}
- Daily squeeze PSI (metrics["daily_squeeze_pct"]) using existing value if present
- Composite daily score metrics["overall_eod_score"] and metrics["overall_eod_state"]
  and daily["overallEOD"] with components:

    overall_eod_score =
        0.40 * trend_pct
      + 0.25 * participation_pct
      + 0.10 * squeeze_expansion_pct   (100 - PSI)
      + 0.10 * liquidity_norm_pct
      + 0.10 * volatility_score_pct    (100 - min(vol_pct, 100))
      + 0.05 * riskOn_pct

It writes:

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

NOTE: This script assumes that `data/outlook.json` contains either:
    - `daily["sectors"]` with fields: "sector","nh","nl","up","down"
      (as built by make_eod.py from `outlook_source.json`), or
    - a fallback `sectorCards` array with the same fields.

Adjust key names in `compute_sector_breadth_momentum` if needed.
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

EOD_PATH = "data/outlook.json"

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

    Expected / tolerated keys per sector (first match wins):
      breadth core:
        "nh10" or "nh" or "NH"     -> 10d new highs count
        "nl10" or "nl" or "NL"     -> 10d new lows count
      up/down counts:
        "up10" or "up" or "u"
        "down10" or "down" or "d"
    """
    out: List[dict] = []
    for c in sectors or []:
        name = (c.get("sector") or "").strip()
        if not name:
            continue

        def _get_any(k: List[str]) -> float:
            for kk in k:
                if kk in c:
                    try:
                        v = float(c.get(kk, 0) or 0)
                        return v
                    except Exception:
                        return 0.0
            return 0.0

        nh = _get_any(["nh10", "nh", "NH"])
        nl = _get_any(["nl10", "nl", "NL"])
        up = _get_any(["up10", "up", "u"])
        dn = _get_any(["down10", "down", "d"])

        breadth_pct = pct(nh, nh + nl) if nh + nl > 0 else 50.0
        mom_pct = pct(up, up + dn) if up + dn > 0 else 50.0

        c_out = dict(c)
        c_out["sector"] = name
        c_out["breadth_pct"] = round(breadth_pct, 2)
        c_out["momentum_pct"] = round(mom_pct, 2)
        c_out["nh10"] = nh
        c_out["nl10"] = nl
        c_out["up10"] = up
        c_out["down10"] = dn
        out.append(c_out)

    return out


# --------------- Composite daily EOD metrics ----------------


def compute_daily_composites(
    sectors: List[dict],
    metrics: dict,
) -> Tuple[float, float, float, float, float, float, float, dict]:
    """
    Compute:
      - trend_pct           (0-100)
      - participation_pct   (0-100)
      - squeeze_psi         (0-100)
      - vol_pct             (0-100)
      - liq_psi             (0-200)
      - risk_on_pct         (0-100)
      - overall_score       (0-100)
      - trend_daily (dict for j["trendDaily"])
    """

    # --- Trend & Participation from sector breadth/momentum ---
    breadth_vals: List[float] = []
    mom_vals: List[float] = []
    n_good = 0
    total = 0

    for c in sectors:
        try:
            b = float(c.get("breadth_pct", 50.0))
            m = float(c.get("momentum_pct", 50.0))
        except Exception:
            continue
        breadth_vals.append(b)
        mom_vals.append(m)
        total += 1
        if b >= 50.0 and m >= 50.0:
            n_good += 1

    if total > 0:
        trend_pct = sum(breadth_vals) / total
        participation_pct = pct(n_good, total)
    else:
        trend_pct = 50.0
        participation_pct = 50.0

    # Trend "slope" proxy: deviation from 50, clamped to [-50, +50]
    ema_slope = clamp(trend_pct - 50.0, -50.0, 50.0)

    # --- Squeeze PSI (tightness) ---
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
    vol_pct = metrics.get("volatility_pct")
    try:
        vol_pct = float(vol_pct)
    except Exception:
        vol_pct = 20.0
    vol_pct = max(0.0, float(vol_pct))
    vol_score = 100.0 - clamp(vol_pct, 0.0, 100.0)

    # Volatility band
    if vol_pct < 1.0:
        vol_band = "low"
    elif vol_pct < 2.0:
        vol_band = "normal"
    elif vol_pct < 3.0:
        vol_band = "elevated"
    else:
        vol_band = "high"

    # --- Liquidity (volume ratio) ---
    liq_psi = metrics.get("liquidity_pct")
    try:
        liq_psi = float(liq_psi)
    except Exception:
        liq_psi = 100.0
    liq_psi = clamp(liq_psi, 0.0, 200.0)

    if liq_psi < 80.0:
        liq_band = "light"
    elif liq_psi < 120.0:
        liq_band = "normal"
    else:
        liq_band = "good"

    liq_norm_pct = clamp(liq_psi, 0.0, 200.0) / 2.0  # 0..100

    # --- Risk-On (offense vs defense) ---
    risk_on = 50.0
    if sectors:
        n = 0
        acc = 0.0
        for c in sectors:
            sec_name = (c.get("sector") or "").strip().lower()
            try:
                b = float(c.get("breadth_pct", 50.0))
            except Exception:
                continue
            if sec_name in OFFENSIVE_SECTORS:
                n += 1
                if b >= 55.0:
                    acc += 1.0
            elif sec_name in DEFENSIVE_SECTORS:
                n += 1
                if b <= 45.0:
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
    j = load_json(EOD_PATH)
    if not j:
        print(f"[eod] {EOD_PATH} missing or empty")
        return

    # Root blocks
    metrics = j.get("metrics") or {}
    daily = j.get("daily") or {}

    # Locate sector list with NH/NL/UP/DOWN (10d)
    sectors_raw = daily.get("sectors")
    if not sectors_raw:
        sectors_raw = j.get("sectorCards") or []

    sectors = compute_sector_breath_momentum = compute_sector_breadth_momentum(sectors_raw)

    # Write enriched sectors back into daily block
    daily["sectors"] = sectors

    (
        trend_pct,
        participation_pct,
        squeeze_psi,
        vol_pct,
        liq_psi,
        risk_on_pct,
        overall_score,
        trend_daily,
    ) = compute_daily_composites(sectors, metrics,)

    # Update metrics for EOD
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

    # Build daily.overallEOD block with components for UI
    prev_overall = daily.get("overallEOD") or {}
    last_changed = prev_overall.get("lastChanged") or now_utc_iso()
    if prev_overall.get("state") != overall_state:
        last_changed = now_utc_iso()

    daily["overallEOD"] = {
        "state": overall_state,
        "score": round(overall_score, 1),
        "components": {
            "trend": round(trend_pct, 1),
            "participation": round(participation_pct, 1),
            "squeeze": round(100.0 - squeeze_psi, 1),
            "liquidity": round(liq_psi, 1),
            "volatility": round(vol_pct, 1),
            "riskOn": round(risk_on_pct, 1),
        },
        "lastChanged": last_changed,
    }

    # Attach trendDaily structure
    j["trendDaily"] = trend_daily
    j["metrics"] = metrics
    j["daily"] = daily

    save_json(EOD_PATH, j)
    print(
        "[eod] trend_eod=%.2f, part=%.2f, squeeze=%.1f, vol=%.2f, liq=%.1f, riskOn=%.1f, overall=%.1f %s"
        % (trend_pct, participation_pct, squeeze_psi, vol_pct, liq_psi, risk_on_pct, overall_score, overall_state)
    )


if __name__ == "__main__":
    try:
        compute_eod()
    except Exception as exc:
        print("[eod-error]", exc, file=sys.stderr)
        sys.exit(1)
