#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_dashboard.py — compose dashboard payloads (intraday / hourly / eod)

- Stamps updated_at (America/Phoenix) + updated_at_utc (UTC)
- Ensures 11 canonical sectorCards (Title-case, fixed order)
- Normalizes intraday metrics to the UI schema
- For intraday (10m): attaches an `outlook` field to each sectorCard
  using config-driven thresholds from config/sector_outlook_10m.json.

UPDATE (per your request):
✅ Adds "hysteresis" so 10m Index Sector outlook does NOT flip fast.
Mode B (Balanced):
  - Enter Bullish: breadth >= 55 AND momentum >= 55
  - Stay Bullish until breadth < 51 OR momentum < 51
  - Enter Bearish: breadth <= 45 AND momentum <= 45
  - Stay Bearish until breadth > 49 OR momentum > 49
This requires remembering the last outlook per sector, so we persist a tiny cache:
  data/sector_outlook_state_10m.json
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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTLOOK_CFG_PATH = os.path.join(ROOT, "config", "sector_outlook_10m.json")

# ✅ State cache (so hysteresis can “stick” between runs)
OUTLOOK_STATE_PATH = os.path.join(ROOT, "data", "sector_outlook_state_10m.json")

# Default config supports old keys and new hysteresis keys.
# If you keep a simple config file, these defaults will be used.
DEFAULT_OUTLOOK_CFG: Dict[str, Any] = {
    # OLD (kept for compatibility)
    "bullish_breadth": 55.0,
    "bullish_momentum": 55.0,
    "bearish_breadth": 45.0,
    "bearish_momentum": 45.0,
    "default": "Neutral",

    # NEW (Mode B Balanced hysteresis)
    "bull_enter_breadth": 55.0,
    "bull_enter_momentum": 55.0,
    "bull_exit_breadth": 51.0,
    "bull_exit_momentum": 51.0,

    "bear_enter_breadth": 45.0,
    "bear_enter_momentum": 45.0,
    "bear_exit_breadth": 49.0,
    "bear_exit_momentum": 49.0,
}


def load_outlook_cfg() -> Dict[str, Any]:
    try:
        with open(OUTLOOK_CFG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        out = dict(DEFAULT_OUTLOOK_CFG)
        if isinstance(cfg, dict):
            for k in DEFAULT_OUTLOOK_CFG:
                if k in cfg:
                    out[k] = cfg[k]
        return out
    except Exception as e:
        print(f"[warn] sector_outlook_10m.json not found or invalid: {e}. Using defaults.", file=sys.stderr)
        return dict(DEFAULT_OUTLOOK_CFG)


OUTLOOK_CFG = load_outlook_cfg()


def load_outlook_state() -> Dict[str, str]:
    """
    Load last-known outlook per sector so we can apply hysteresis (stickiness).
    Expected shape:
      { "Information Technology": "Bullish", ... }
    """
    try:
        with open(OUTLOOK_STATE_PATH, "r", encoding="utf-8") as f:
            j = json.load(f)
        if isinstance(j, dict):
            # normalize values
            out: Dict[str, str] = {}
            for k, v in j.items():
                if isinstance(k, str) and isinstance(v, str):
                    out[k] = v
            return out
    except Exception:
        pass
    return {}


def save_outlook_state(state: Dict[str, str]) -> None:
    try:
        os.makedirs(os.path.dirname(OUTLOOK_STATE_PATH), exist_ok=True)
        with open(OUTLOOK_STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, separators=(",", ":"))
    except Exception as e:
        print(f"[warn] could not write outlook state cache: {e}", file=sys.stderr)


def label_outlook_10m(card: Dict[str, Any], prev: str) -> str:
    """
    10m sector outlook with hysteresis (Mode B Balanced).

    Enter Bullish:
      b >= 55 AND m >= 55
    Stay Bullish until:
      b < 51 OR m < 51

    Enter Bearish:
      b <= 45 AND m <= 45
    Stay Bearish until:
      b > 49 OR m > 49

    Else: Neutral
    """
    try:
        b = float(card.get("breadth_pct", 0.0))
        m = float(card.get("momentum_pct", 0.0))
    except Exception:
        return OUTLOOK_CFG["default"]

    # Normalize prev
    prev_norm = prev if prev in ("Bullish", "Bearish", "Neutral") else OUTLOOK_CFG["default"]

    bull_enter_b = float(OUTLOOK_CFG["bull_enter_breadth"])
    bull_enter_m = float(OUTLOOK_CFG["bull_enter_momentum"])
    bull_exit_b  = float(OUTLOOK_CFG["bull_exit_breadth"])
    bull_exit_m  = float(OUTLOOK_CFG["bull_exit_momentum"])

    bear_enter_b = float(OUTLOOK_CFG["bear_enter_breadth"])
    bear_enter_m = float(OUTLOOK_CFG["bear_enter_momentum"])
    bear_exit_b  = float(OUTLOOK_CFG["bear_exit_breadth"])
    bear_exit_m  = float(OUTLOOK_CFG["bear_exit_momentum"])

    # If currently Bullish, only drop when it truly breaks
    if prev_norm == "Bullish":
        if b < bull_exit_b or m < bull_exit_m:
            return "Neutral"
        return "Bullish"

    # If currently Bearish, only lift when it truly recovers
    if prev_norm == "Bearish":
        if b > bear_exit_b or m > bear_exit_m:
            return "Neutral"
        return "Bearish"

    # If Neutral, require strong confirmation to enter states
    if b >= bull_enter_b and m >= bull_enter_m:
        return "Bullish"
    if b <= bear_enter_b and m <= bear_enter_m:
        return "Bearish"

    return "Neutral"


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
        key = {n: i for i, n in enumerate(ORDER)}
        cards.sort(key=lambda c: key.get(c.get("sector", ""), 999))
        return cards

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
      - Attach a 10m `outlook` field to each sectorCard using hysteresis + persisted state.
    """
    cards = ensure_sector_cards(src)

    # Load last-known outlook so the outlook doesn't chatter
    prev_state = load_outlook_state()
    next_state: Dict[str, str] = dict(prev_state)

    for c in cards:
        sector = c.get("sector") or ""
        prev = prev_state.get(sector, OUTLOOK_CFG["default"])
        new_outlook = label_outlook_10m(c, prev=prev)
        c["outlook"] = new_outlook
        if sector:
            next_state[sector] = new_outlook

    # Persist the new outlook state
    save_outlook_state(next_state)

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
