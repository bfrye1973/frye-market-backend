#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_dashboard.py — compose dashboard payloads (intraday / hourly / eod)

- Stamps updated_at (America/Phoenix) + updated_at_utc (UTC)
- Ensures 11 canonical sectorCards (Title-case, fixed order)
- Normalizes intraday metrics to the UI schema
- For intraday (10m): attaches an `outlook` field to each sectorCard
  using config-driven thresholds from config/sector_outlook_10m.json.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# -------------------------------------------------------------------
# Timezones
# -------------------------------------------------------------------

PHX = ZoneInfo("America/Phoenix")
UTC = timezone.utc


def now_phx() -> str:
    """Return local AZ timestamp 'YYYY-MM-DD HH:MM:SS' (no DST issues)."""
    return datetime.now(PHX).replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


def now_utc() -> str:
    """Return strict ISO-8601 Zulu timestamp."""
    return (
        datetime.now(UTC)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


# -------------------------------------------------------------------
# Canonical sector order (Title-case)
# -------------------------------------------------------------------

ORDER = [
    "Information Technology",
    "Materials",
    "Health Care",
    "Communication Services",
    "Real Estate",
    "Energy",
    "Consumer Staples",
    "Consumer Discretionary",
    "Financials",
    "Utilities",
    "Industrials",
]

# -------------------------------------------------------------------
# Config-driven 10m outlook thresholds
# -------------------------------------------------------------------

# We expect: config/sector_outlook_10m.json at repo root.
# Example:
# {
#   "bullish_breadth": 52,
#   "bullish_momentum": 52,
#   "bearish_breadth": 48,
#   "bearish_momentum": 48,
#   "default": "Neutral"
# }

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTLOOK_CFG_PATH = os.path.join(ROOT, "config", "sector_outlook_10m.json")

DEFAULT_OUTLOOK_CFG: Dict[str, Any] = {
    "bullish_breadth": 55.0,
    "bullish_momentum": 55.0,
    "bearish_breadth": 45.0,
    "bearish_momentum": 45.0,
    "default": "Neutral",
}


def load_outlook_cfg() -> Dict[str, Any]:
    try:
        with open(OUTLOOK_CFG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        # Merge onto defaults so missing keys don't crash anything
        out = dict(DEFAULT_OUTLOOK_CFG)
        out.update({k: v for k, v in cfg.items() if k in DEFAULT_OUTLOOK_CFG})
        return out
    except Exception as e:
        print(f"[warn] sector_outlook_10m.json not found or invalid: {e}. Using defaults.", file=sys.stderr)
        return dict(DEFAULT_OUTLOOK_CFG)


OUTLOOK_CFG = load_outlook_cfg()


def label_outlook_10m(card: Dict[str, Any]) -> str:
    """
    10m sector outlook for Index Sectors row.

    Tuned via config/sector_outlook_10m.json:
      - Bullish: breadth >= bullish_breadth AND momentum >= bullish_momentum
      - Bearish: breadth <= bearish_breadth AND momentum <= bearish_momentum
      - Else: default (usually "Neutral")
    """
    try:
        b = float(card.get("breadth_pct", 0.0))
        m = float(card.get("momentum_pct", 0.0))
    except Exception:
        return OUTLOOK_CFG["default"]

    if b >= OUTLOOK_CFG["bullish_breadth"] and m >= OUTLOOK_CFG["bullish_momentum"]:
        return "Bullish"
    if b <= OUTLOOK_CFG["bearish_breadth"] and m <= OUTLOOK_CFG["bearish_momentum"]:
        return "Bearish"
    return OUTLOOK_CFG["default"]


# -------------------------------------------------------------------
# Generic helpers
# -------------------------------------------------------------------


def coalesce(*vals):
    for v in vals:
        if isinstance(v, (int, float)) and v == v:  # not NaN
            return float(v)
    return None


def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else round(100.0 * float(a) / float(b), 2)


def load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[error] cannot read {path}: {e}", file=sys.stderr)
        return {}


# -------------------------------------------------------------------
# Sector card normalization
# -------------------------------------------------------------------


def ensure_sector_cards(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Return 11 sectorCards in canonical ORDER.

    - If source["sectorCards"] exists, we:
        * keep their breadth/momentum/nh/nl/up/down
        * fill any missing sectors with zeroed cards
        * sort into canonical ORDER

    - Else if source["groups"] exists (sector -> {nh,nl,u,d}), we derive:
        * breadth_pct  = nh / (nh+nl)
        * momentum_pct = up / (up+down)
        * and build cards from scratch.
    """
    cards = source.get("sectorCards")
    if isinstance(cards, list) and cards:
        # Ensure all canonical sectors exist
        got = {c.get("sector") for c in cards if isinstance(c, dict)}
        for name in ORDER:
            if name not in got:
                cards.append(
                    {
                        "sector": name,
                        "breadth_pct": 0.0,
                        "momentum_pct": 0.0,
                        "nh": 0,
                        "nl": 0,
                        "up": 0,
                        "down": 0,
                    }
                )
        # Sort into canonical order
        key = {n: i for i, n in enumerate(ORDER)}
        cards.sort(key=lambda c: key.get(c.get("sector", ""), 999))
        return cards

    # Derive from groups if no sectorCards provided
    groups = source.get("groups") or {}
    derived: List[Dict[str, Any]] = []
    for name in ORDER:
        g = groups.get(name) or {}
        nh = int(g.get("nh", 0))
        nl = int(g.get("nl", 0))
        up = int(g.get("u", 0))
        dn = int(g.get("d", 0))
        b = pct(nh, nh + nl)
        m = pct(up, up + dn)
        derived.append(
            {
                "sector": name,
                "breadth_pct": b,
                "momentum_pct": m,
                "nh": nh,
                "nl": nl,
                "up": up,
                "down": dn,
            }
        )
    return derived


# -------------------------------------------------------------------
# Intraday composition (10m)
# -------------------------------------------------------------------


def compose_intraday(src: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize intraday payload:

      - Normalize metrics to the 10m schema.
      - Preserve intraday / engineLights from the source.
      - Ensure we always have 11 canonical sectorCards.
      - Attach a 10m `outlook` field to each sectorCard using config-driven rules.
    """
    cards = ensure_sector_cards(src)

    # Attach or override outlook for 10m cards using config thresholds,
    # but only if upstream hasn't already set an outlook.
    for c in cards:
        if "outlook" not in c:
            c["outlook"] = label_outlook_10m(c)

    m_in = dict(src.get("metrics") or {})

    # Normalize metrics
    breadth = coalesce(m_in.get("breadth_10m_pct"), m_in.get("breadth_pct"))
    if breadth is None:
        breadth = (
            round(
                sum(c.get("breadth_pct", 0.0) for c in cards) / len(cards),
                2,
            )
            if cards
            else 50.0
        )

    momentum = coalesce(m_in.get("momentum_10m_pct"), m_in.get("momentum_pct"), 50.0)
    psi = coalesce(m_in.get("squeeze_psi_10m_pct"), m_in.get("squeeze_psi"), 50.0)
    liq = coalesce(m_in.get("liquidity_psi"), 70.0)
    vol = coalesce(m_in.get("volatility_10m_pct"), m_in.get("volatility_pct"), 0.20)
    ema_sign = int(m_in.get("ema_sign") or 0)
    ema_gap = coalesce(m_in.get("ema_gap_pct"), 0.0)

    m_out = dict(m_in)
    m_out["breadth_10m_pct"] = round(breadth, 2)
    m_out["momentum_10m_pct"] = round(momentum, 2)
    m_out["squeeze_psi_10m_pct"] = round(psi, 2)
    m_out["squeeze_expansion_pct"] = round(100.0 - psi, 2)
    # UI "squeeze_pct" tile shows expansion
    m_out["squeeze_pct"] = m_out["squeeze_expansion_pct"]
    m_out["liquidity_psi"] = round(liq, 2)
    m_out["volatility_pct"] = round(vol, 3)
    m_out["ema_sign"] = ema_sign
    m_out["ema_gap_pct"] = round(ema_gap, 2)

    intraday = src.get("intraday") or {}
    engine = src.get("engineLights") or {}

    return {
        "version": src.get("version") or "r-intraday-v1",
        "updated_at": now_phx(),
        "updated_at_utc": now_utc(),
        "mode": "intraday",
        "metrics": m_out,
        "intraday": intraday,
        "engineLights": engine,
        "sectorCards": cards,
        "meta": {"last_full_run_utc": now_utc()},
    }


# -------------------------------------------------------------------
# Hourly / EOD passthrough
# -------------------------------------------------------------------


def compose_hourly(src: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(src)
    out["updated_at"] = now_phx()
    out["updated_at_utc"] = now_utc()
    out["mode"] = "hourly"
    return out


def compose_eod(src: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(src)
    out["updated_at"] = now_phx()
    out["updated_at_utc"] = now_utc()
    out["mode"] = "eod"
    return out


# -------------------------------------------------------------------
# CLI
# -------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description="Compose dashboard payloads.")
    ap.add_argument("--mode", choices=["intraday", "hourly", "eod"], required=True)
    ap.add_argument("--source", required=True)
    ap_argument = "--out"  # to keep line short
    ap.add_argument(ap_argument, required=True)
    args = ap.parse_args()

    src = load_json(args.source)
    if not src:
        print(f"[error] invalid or missing source: {args.source}", file=sys.stderr)
        sys.exit(1)

    if args.mode == "intraday":
        out = compose_intraday(src)
    elif args.mode == "hourly":
        out = compose_hourly(src)
    else:
        out = compose_eod(src)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    # Tiny QA log
    try:
        m = out.get("metrics") or {}
        print(
            f"[ok] wrote {args.out} mode={args.mode}  updated_at={out.get('updated_at')}  "
            f"breadth_10m={m.get('breadth_10m_pct')}  momentum_10m={m.get('momentum_10m_pct')}  "
            f"squeeze_exp={m.get('squeeze_expansion_pct')}"
        )
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main() or 0)
