#!/usr/bin/env python3
"""
make_dashboard.py — carry real sector counts into outlook.json

- Reads data/outlook_source.json
- Writes data/outlook.json with:
  * gauges: rpm/speed/fuel/water/oil (oil.psi for liquidity)
  * outlook.sectors: { nh, nl, up, down, netNH, netUD, spark }
  * sectorCards: built from sectors (kept at top-level + nested for compatibility)
"""

from __future__ import annotations
import argparse, json, os
from datetime import datetime, timezone
from typing import Any, Dict

SCHEMA_VERSION = "r1.2"
VERSION_TAG    = "1.2-hourly"

PREFERRED_ORDER = [
    "information technology","materials","healthcare",
    "communication services","real estate","energy",
    "consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

# ----------------- helpers -----------------

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def jread(p: str) -> Dict[str, Any]:
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def jwrite(p: str, obj: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), indent=None)
        f.write("\n")

def norm(s: str) -> str:
    return (s or "").strip().lower()

def title_case(x: str) -> str:
    return " ".join(w.capitalize() for w in (x or "").split())

def canonical_sector(name: str) -> str:
    n = norm(name)
    if n in ("tech", "information technology"):
        return "information technology"
    return n

def num(v, default=0):
    try:
        if v is None: return default
        if isinstance(v, (int, float)): return int(v)
        s = str(v).strip()
        if s == "": return default
        return int(float(s))
    except:
        return default

# ----------------- sector extraction -----------------

def sectors_from_source(src: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return dict keyed by canonical sector names with:
      { nh, nl, up, down, netNH, netUD, spark }
    Accepts any of:
      - src["outlook"]["sectors"] (preferred)
      - src["sectors"]
      - src["groups"] (with nh/nl/u/d)
    """
    raw = None
    if isinstance(src.get("outlook"), dict) and isinstance(src["outlook"].get("sectors"), dict):
        raw = src["outlook"]["sectors"]
    elif isinstance(src.get("sectors"), dict):
        raw = src["sectors"]
    elif isinstance(src.get("groups"), dict):
        raw = src["groups"]

    out: Dict[str, Any] = {}
    if isinstance(raw, dict):
        for name, vals in raw.items():
            key = canonical_sector(name)
            nh   = num(vals.get("nh", vals.get("nH", 0)))
            nl   = num(vals.get("nl", vals.get("nL", 0)))
            up   = num(vals.get("u",  vals.get("up", 0)))
            down = num(vals.get("d",  vals.get("down", 0)))
            spark = vals.get("spark", [])
            if not isinstance(spark, list):
                spark = []
            out[key] = {
                "nh": nh,
                "nl": nl,
                "up": up,
                "down": down,
                "netNH": nh - nl,
                "netUD": up - down,
                "spark": spark,
            }

    # Ensure all 11 sectors exist (fill neutrals)
    for k in PREFERRED_ORDER:
        if k not in out:
            out[k] = {"nh":0,"nl":0,"up":0,"down":0,"netNH":0,"netUD":0,"spark":[]}

    return out

# ----------------- gauges passthrough/mapping -----------------

def build_gauges(src: Dict[str, Any]) -> Dict[str, Any]:
    """
    Map common fields to gauges:
      - rpm.pct   ← breadthIdx (fallback 50)
      - speed.pct ← momentumIdx (fallback 50)
      - fuel.pct  ← global.squeeze_pressure_pct (fallback 50); state "firingUp" if ≥70
      - water.pct ← global.volatility_pct (fallback 50)
      - oil.psi   ← global.liquidity_pct (so Liquidity pill/row shows)
    """
    g = src.get("global", {}) or {}
    breadth   = src.get("breadthIdx", 50)
    momentum  = src.get("momentumIdx", 50)
    squeeze   = g.get("squeeze_pressure_pct", 50)
    vol_pct   = g.get("volatility_pct", 50)
    liq_pct   = g.get("liquidity_pct", 100)  # treat as PSI-style value for UI

    gauges = {
        "rpm":   {"pct": float(breadth),  "label":"Breadth"},
        "speed": {"pct": float(momentum), "label":"Momentum"},
        "fuel":  {
            "pct": float(squeeze),
            "state": "firingUp" if float(squeeze) >= 70 else "idle",
            "label":"Squeeze"
        },
        "water": {"pct": float(vol_pct), "label":"Volatility"},
        # IMPORTANT: use psi so your Liquidity gauge/row renders
        "oil":   {"psi": float(liq_pct), "label":"Liquidity"},
    }
    return gauges

# ----------------- cards -----------------

def cards_from_sectors(sectors: Dict[str, Any]) -> list[Dict[str, Any]]:
    cards = []
    for key in PREFERRED_ORDER:
        vals = sectors.get(key, {})
        net = num(vals.get("netNH", 0))
        outlook = "Neutral"
        if net > 0: outlook = "Bullish"
        if net < 0: outlook = "Bearish"
        spark = vals.get("spark", [])
        if not isinstance(spark, list): spark = []
        cards.append({
            "sector": title_case(key),
            "outlook": outlook,
            "spark": spark
        })
    return cards

# ----------------- main build -----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--mode",   default="intraday", choices=["intraday","daily","eod"])
    args = ap.parse_args()

    src = jread(args.source)
    ts  = now_iso()

    sectors = sectors_from_source(src)
    gauges  = build_gauges(src)
    cards   = cards_from_sectors(sectors)

    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts,
        "ts": ts,
        "version": VERSION_TAG,
        "pipeline": args.mode,
        "gauges": gauges,
        # keep top-level sectorCards (legacy UI)
        "sectorCards": cards,
        # new UI expects outlook.sectors; routes.js will normalize to 11 cards anyway
        "outlook": {
            "sectors": sectors,
            "sectorCards": cards
        },
        "signals": {}  # your routes.js currently adds stubs; leave empty here
    }

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | cards={len(cards)}")

if __name__ == "__main__":
    main()
