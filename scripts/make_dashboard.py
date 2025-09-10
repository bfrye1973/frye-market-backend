#!/usr/bin/env python3
"""
make_dashboard.py — baseline (yesterday-style)
- Reads data/outlook_source.json
- Writes data/outlook.json with gauges + top-level sectorCards
- Prefers source['outlook']['sectors'] if present (11)
- Falls back to source['groups'] mapping (nh/nl/u/d)
"""

import argparse, json, os
from datetime import datetime, timezone

SCHEMA_VERSION = "r1.2"

def jread(p):
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def jwrite(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

def title_case(x: str) -> str:
    return " ".join(w.capitalize() for w in (x or "").split())

def build_cards_from_sectors_obj(obj):
    cards = []
    if isinstance(obj, dict):
        for name, vals in obj.items():
            spark = vals.get("spark", [])
            cards.append({
                "sector": title_case(name),
                "outlook": vals.get("outlook", "Neutral"),
                "spark": spark if isinstance(spark, list) else []
            })
    return cards

def build_cards_from_groups(groups):
    cards = []
    if isinstance(groups, dict):
        for name, cnt in groups.items():
            nh = int(cnt.get("nh", 0)); nl = int(cnt.get("nl", 0))
            u  = int(cnt.get("u", 0));  d  = int(cnt.get("d", 0))
            net = nh - nl
            outlook = "Neutral"
            if net > 0: outlook = "Bullish"
            if net < 0: outlook = "Bearish"
            cards.append({
                "sector": title_case(name),
                "outlook": outlook,
                "spark": cnt.get("spark", [])
            })
    return cards

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--mode",   default="intraday", choices=["intraday","eod"])
    args = ap.parse_args()

    src = jread(args.source)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    # Gauges – keep minimal pass-through (yesterday behavior)
    g = src.get("global", {}) or {}
    gauges = {
        "rpm":   {"pct": float(src.get("breadthIdx", 50)), "label":"Breadth"},
        "speed": {"pct": float(src.get("momentumIdx", 50)),"label":"Momentum"},
        "fuel":  {"pct": float(g.get("squeeze_pressure_pct", 50)),"state": str(g.get("squeeze_state", "neutral")),"label":"Squeeze"},
        "water": {"pct": float(g.get("volatility_pct", 50)), "label":"Volatility"},
        "oil":   {"pct": float(g.get("liquidity_pct", 100)),"label":"Liquidity"}
    }

    # Prefer source.outlook.sectors → sectorCards, else fallback to groups
    sector_cards = []
    outlook_obj = src.get("outlook", {}) if isinstance(src.get("outlook"), dict) else {}
    sectors_obj = outlook_obj.get("sectors") if isinstance(outlook_obj.get("sectors"), dict) else None
    if sectors_obj:
        sector_cards = build_cards_from_sectors_obj(sectors_obj)
    elif isinstance(src.get("groups"), dict):
        sector_cards = build_cards_from_groups(src["groups"])

    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": now,
        "ts": now,
        "version": "1.2-hourly",
        "pipeline": args.mode,
        "gauges": gauges,
        "sectorCards": sector_cards,   # top-level (as your UI relied on before)
        "outlook": {                   # pass-through for new UI if needed
            "sectors": sectors_obj or {},
            "sectorCards": sector_cards
        },
        "signals": {}
    }

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectorCards={len(sector_cards)}")

if __name__ == "__main__":
    main()
