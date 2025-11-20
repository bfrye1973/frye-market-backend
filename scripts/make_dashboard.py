#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard.py (R12.9 intraday squeeze fix)

Compose dashboard payloads (intraday / hourly / eod).

What this script does:

- For --mode intraday:
    * Ensures sectorCards are present, even if source only has `groups`.
    * Normalises 10m metrics, especially Lux Squeeze:
        - metrics.squeeze_psi_10m_pct     -> Lux PSI (tightness 0–100)
        - metrics.squeeze_pct             -> expansion = 100 - PSI
        - metrics.squeeze_expansion_pct   -> same expansion value
- For --mode hourly/eod:
    * Pass-through, only refreshing updated_at / updated_at_utc and mode.
"""

from __future__ import annotations
import argparse
import json
import os
import sys
from typing import Any, Dict, List
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

# ---------------- Time helpers ----------------

try:
    PHX = ZoneInfo("America/Phoenix")
except Exception:
    PHX = ZoneInfo("UTC")

UTC = timezone.utc


def now_phx_iso() -> str:
    return datetime.now(PHX).replace(microsecond=0).isoformat(sep=" ")


def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ---------------- Sector helpers ----------------

ORDER = [
    "information technology",
    "materials",
    "health care",
    "communication services",
    "real estate",
    "energy",
    "consumer staples",
    "consumer discretionary",
    "financials",
    "utilities",
    "industrials",
]

ALIAS = {
    "healthcare": "health care",
    "health-care": "health care",
    "info tech": "information technology",
    "technology": "information technology",
    "tech": "information technology",
    "communications": "communication services",
    "comm services": "communication services",
    "comm": "communication services",
    "telecom": "communication services",
    "staples": "consumer staples",
    "discretionary": "consumer discretionary",
    "finance": "financials",
    "industry": "industrials",
    "reit": "real estate",
    "reits": "real estate",
}


def norm(s: str) -> str:
    return (s or "").strip().lower()


def pct(a: float, b: float) -> float:
    if not b:
        return 0.0
    try:
        return round(100.0 * float(a) / float(b), 2)
    except Exception:
        return 0.0


def build_sector_cards_from_groups(groups: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    groups: { "Tech": {"nh":..,"nl":..,"u":..,"d":..}, ... }
    -> normalized 11 sectorCards with nh/nl/up/down + breadth_pct/momentum_pct.
    """
    bucket: Dict[str, Dict[str, Any]] = {}

    for raw, g in (groups or {}).items():
        k = ALIAS.get(norm(raw), norm(raw))
        if not k:
            continue
        nh = int((g or {}).get("nh", 0))
        nl = int((g or {}).get("nl", 0))
        up = int((g or {}).get("u", 0))
        dn = int((g or {}).get("d", 0))
        b = pct(nh, nh + nl)
        m = pct(up, up + dn)
        bucket[k] = {
            "sector": k.title(),
            "breadth_pct": b,
            "momentum_pct": m,
            "nh": nh,
            "nl": nl,
            "up": up,
            "down": dn,
        }

    rows: List[Dict[str, Any]] = []
    for name in ORDER:
        if name in bucket:
            rows.append(bucket[name])
        else:
            rows.append(
                {
                    "sector": name.title(),
                    "breadth_pct": 0.0,
                    "momentum_pct": 0.0,
                    "nh": 0,
                    "nl": 0,
                    "up": 0,
                    "down": 0,
                }
            )
    return rows


def composite_average(cards: List[Dict[str, Any]], key: str) -> float:
    vals = [float(c.get(key, 0.0)) for c in cards if isinstance(c.get(key), (int, float))]
    return round(sum(vals) / len(vals), 2) if vals else 0.0


def load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


# ---------------- Intraday composer ----------------


def compose_intraday(src: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build the final /live/intraday payload.

    - Ensures sectorCards exist.
    - Normalises 10m metrics.
    - Fixes squeeze fields (PSI vs expansion).
    """
    # 1) sector cards
    if isinstance(src.get("sectorCards"), list) and src["sectorCards"]:
        sector_cards = src["sectorCards"]
    else:
        sector_cards = build_sector_cards_from_groups(src.get("groups") or {})

    # 2) metrics (start from source, then patch as needed)
    src_metrics = src.get("metrics") or {}
    metrics: Dict[str, Any] = dict(src_metrics)

    # --- breadth / momentum fallback if missing ---
    breadth_10m = metrics.get("breadth_10m_pct")
    if not isinstance(breadth_10m, (int, float)):
        breadth_10m = composite_average(sector_cards, "breadth_pct")

    momentum_10m = metrics.get("momentum_10m_pct")
    if not isinstance(momentum_10m, (int, float)):
        momentum_10m = composite_average(sector_cards, "momentum_pct")

    metrics["breadth_10m_pct"] = float(round(breadth_10m, 2))
    metrics["momentum_10m_pct"] = float(round(momentum_10m, 2))

    # --- SQUEEZE: use Lux PSI if present; otherwise keep old behaviour ---
    # Expectation from upstream builder:
    #   - metrics.squeeze_psi_10m_pct = Lux PSI (tightness 0–100)
    #   - metrics.squeeze_pct         = expansion (100 - PSI)
    # But this has been inconsistent, so we normalise here.

    psi = None

    # 1) Prefer explicit Lux PSI field if set
    cand_psi_keys = [
        "squeeze_psi_10m_pct",
        "lux_squeeze_psi_10m",
        "lux_squeeze_psi",
        "psi_10m",
    ]
    for k in cand_psi_keys:
        if isinstance(metrics.get(k), (int, float)):
            psi = float(metrics[k])
            break

    # 2) If we don't have PSI but we have an "expansion" we can invert
    if psi is None:
        # some older builds wrote `squeeze_expansion_pct` as expansion
        exp_candidate = None
        for k in ("squeeze_expansion_pct", "squeeze_pct"):
            if isinstance(metrics.get(k), (int, float)):
                exp_candidate = float(metrics[k])
                break
        if exp_candidate is not None:
            psi = max(0.0, min(100.0, 100.0 - exp_candidate))

    # 3) If we *still* don’t have PSI, fall back to 50 (neutral)
    if psi is None:
        psi = 50.0

    psi = float(round(max(0.0, min(100.0, psi)), 2))
    expansion = float(round(100.0 - psi, 2))

    metrics["squeeze_psi_10m_pct"] = psi
    metrics["squeeze_pct"] = expansion              # the value the Meter tile will display
    metrics["squeeze_expansion_pct"] = expansion    # extra alias for anyone else

    # If liquidity/volatility missing, keep previous behaviour (or defaults)
    if not isinstance(metrics.get("liquidity_psi"), (int, float)):
        # some older sources:
        g = src.get("global") or {}
        liq = g.get("liquidity_pct")
        metrics["liquidity_psi"] = float(liq) if isinstance(liq, (int, float)) else 70.0

    if not isinstance(metrics.get("volatility_pct"), (int, float)):
        g = src.get("global") or {}
        vol = g.get("volatility_pct")
        metrics["volatility_pct"] = float(vol) if isinstance(vol, (int, float)) else 0.20

    # 3) intraday block & engineLights (pass-through)
    intraday = src.get("intraday") or {}
    intraday.setdefault("overall10m", {"state": "neutral", "score": 50})

    engine = src.get("engineLights") or {}

    return {
        "version": src.get("version") or "r-intraday-v1",
        "updated_at": now_phx_iso(),
        "updated_at_utc": now_utc_iso(),
        "mode": "intraday",
        "metrics": metrics,
        "intraday": intraday,
        "engineLights": engine,
        "sectorCards": sector_cards,
        "meta": {"last_full_run_utc": now_utc_iso()},
    }


# ---------------- Main ----------------


def main():
    ap = argparse.ArgumentParser(description="Compose dashboard payloads.")
    ap.add_argument(
        "--mode",
        choices=["intraday", "hourly", "eod"],
        required=True,
        help="Which pipeline we are composing for.",
    )
    ap.add_argument("--source", required=True, help="Path to source JSON from builder.")
    ap.add_argument("--out", required=True, help="Output path for composed payload.")
    args = ap.parse_args()

    src = load_json(args.source)
    if not src:
        print(f"[error] invalid or missing source: {args.source}", file=sys.stderr)
        sys.exit(1)

    if args.mode == "intraday":
        out = compose_intraday(src)
    else:
        # For hourly/EOD we only refresh timestamps & mode
        out = dict(src)
        out["updated_at"] = now_phx_iso()
        out["updated_at_utc"] = now_utc_iso()
        out["mode"] = args.mode

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[ok] wrote {args.out}")
    try:
        m = out.get("metrics") or {}
        print(
            "[metrics] breadth_10m:",
            m.get("breadth_10m_pct"),
            "momentum_10m:",
            m.get("momentum_10m_pct"),
            "squeeze_psi_10m:",
            m.get("squeeze_psi_10m_pct"),
            "squeeze_pct(expansion):",
            m.get("squeeze_pct"),
        )
    except Exception:
        pass


if __name__ == "__main__":
    main()
