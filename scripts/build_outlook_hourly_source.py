#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_hourly_source.py (v2)

Goal:
  Provide a minimal, reliable source file for the hourly workflow:
  data/outlook_source.json

Strategy:
  - Read the latest 10-minute intraday payload from the LIVE backend
    (/live/intraday), or from an override URL if INTRADAY_SOURCE_URL is set.
  - Extract / normalize sectorCards (11 canonical sectors).
  - Write them into outlook_source.json so the existing hourly workflow
    (normalize step + make_dashboard_hourly.py) can do its job.
"""

from __future__ import annotations
import argparse
import json
import os
import sys
import urllib.request
from typing import Any, Dict, List

# Primary intraday source: LIVE backend, not GitHub raw
DEFAULT_INTRADAY_URL = (
    os.environ.get("INTRADAY_SOURCE_URL")
    or "https://frye-market-backend-1.onrender.com/live/intraday"
)

# Canonical sector order (title-case)
ORDER = [
    "Information Technology","Materials","Health Care","Communication Services",
    "Real Estate","Energy","Consumer Staples","Consumer Discretionary",
    "Financials","Utilities","Industrials",
]

ALIAS = {
    "healthcare": "Health Care",
    "health-care": "Health Care",
    "info tech": "Information Technology",
    "technology": "Information Technology",
    "tech": "Information Technology",
    "communications": "Communication Services",
    "communication": "Communication Services",
    "comm services": "Communication Services",
    "comm": "Communication Services",
    "telecom": "Communication Services",
    "staples": "Consumer Staples",
    "discretionary": "Consumer Discretionary",
    "finance": "Financials",
    "industry": "Industrials",
    "reit": "Real Estate",
    "reits": "Real Estate",
}


def log(msg: str) -> None:
    print(f"[hourly-src] {msg}", flush=True)


def fetch_json(url: str, timeout: int = 20) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ferrari-dashboard/hourly-source/1.0",
            "Cache-Control": "no-store",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read().decode("utf-8")
    return json.loads(data)


def norm_name(name: str) -> str:
    return (name or "").strip().lower()


def canonical_sector_cards(src: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Take intraday payload and return 11 sectorCards in canonical ORDER.

    Accepts:
      - src["sectorCards"] (already normalized), or
      - src["outlook"]["sectors"] style maps (nh/nl/up/down)
    """
    cards: List[Dict[str, Any]] = []

    # Case 1: already has sectorCards list with sector / breadth_pct / momentum_pct
    raw_cards = src.get("sectorCards")
    if isinstance(raw_cards, list) and raw_cards:
        by: Dict[str, Dict[str, Any]] = {}
        for c in raw_cards:
            if not isinstance(c, dict):
                continue
            s = c.get("sector") or ""
            key = ALIAS.get(norm_name(s), (s or "").title())
            by[key] = {
                "sector": key,
                "breadth_pct": float(c.get("breadth_pct", 0.0) or 0.0),
                "momentum_pct": float(c.get("momentum_pct", 0.0) or 0.0),
                "nh": int(c.get("nh", 0) or 0),
                "nl": int(c.get("nl", 0) or 0),
                "up": int(c.get("up", 0) or 0),
                "down": int(c.get("down", 0) or 0),
            }

        for name in ORDER:
            cards.append(
                by.get(
                    name,
                    {
                        "sector": name,
                        "breadth_pct": 0.0,
                        "momentum_pct": 0.0,
                        "nh": 0,
                        "nl": 0,
                        "up": 0,
                        "down": 0,
                    },
                )
            )
        return cards

    # Case 2: derive from outlook.sectors map (nh/nl/u/d)
    outlook = src.get("outlook") or {}
    sectors = outlook.get("sectors") or {}
    if isinstance(sectors, dict) and sectors:
        bucket: Dict[str, Dict[str, Any]] = {}
        for raw_name, g in sectors.items():
            if not isinstance(g, dict):
                continue
            key = ALIAS.get(norm_name(raw_name), (raw_name or "").title())
            nh = int(g.get("nh", 0) or 0)
            nl = int(g.get("nl", 0) or 0)
            up = int(g.get("up", 0) or 0)
            dn = int(g.get("down", 0) or 0)
            denom_b = nh + nl
            denom_m = up + dn
            breadth = 0.0 if denom_b <= 0 else round(100.0 * nh / denom_b, 2)
            momentum = 0.0 if denom_m <= 0 else round(100.0 * up / denom_m, 2)
            bucket[key] = {
                "sector": key,
                "breadth_pct": breadth,
                "momentum_pct": momentum,
                "nh": nh,
                "nl": nl,
                "up": up,
                "down": dn,
            }

        for name in ORDER:
            cards.append(
                bucket.get(
                    name,
                    {
                        "sector": name,
                        "breadth_pct": 0.0,
                        "momentum_pct": 0.0,
                        "nh": 0,
                        "nl": 0,
                        "up": 0,
                        "down": 0,
                    },
                )
            )
        return cards

    # Fallback: all zeros, but correct structure
    log("no sectorCards/outlook.sectors in intraday payload; using neutral cards")
    for name in ORDER:
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
    return cards


def main() -> int:
    ap = argparse.ArgumentParser(description="Build hourly outlook_source.json from intraday payload.")
    ap.add_argument("--out", required=True, help="Output path (e.g. data/outlook_source.json)")
    ap.add_argument(
        "--intraday_url",
        default=DEFAULT_INTRADAY_URL,
        help="Intraday JSON URL (defaults to LIVE /live/intraday)",
    )
    args = ap.parse_args()

    url = args.intraday_url
    log(f"fetching intraday source from {url}")
    try:
        intraday = fetch_json(url)
    except Exception as e:
        log(f"ERROR fetching intraday payload: {e!r}")
        cards: List[Dict[str, Any]] = []
    else:
        cards = canonical_sector_cards(intraday)
        log(f"got {len(cards)} sectorCards from intraday")

    if not cards:
        cards = canonical_sector_cards({})

    out_obj: Dict[str, Any] = {
        "mode": "hourly",
        "source": "intraday-10m",
        "sectorCards": cards,
        "meta": {
            "hourly_intraday": True,
            "intraday_source_url": url,
        },
    }

    out_path = args.out
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))

    log(f"wrote hourly source → {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
