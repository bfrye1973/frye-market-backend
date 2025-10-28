#!/usr/bin/env python3
"""
Normalize outlook.sectors -> outlook.sectorCards (always 11).
Usage:
  python scripts/normalize_sectors.py --in data/outlook.json --out data/outlook.json
"""

import argparse, json, sys
from datetime import datetime

PREFERRED_ORDER = [
    "tech","materials","healthcare","communication services","real estate",
    "energy","consumer staples","consumer discretionary","financials","utilities","industrials",
]

def norm(s: str) -> str:
    return (s or "").strip().lower()

def order_key(sector: str) -> int:
    n = norm(sector)
    return PREFERRED_ORDER.index(n) if n in PREFERRED_ORDER else 999

def classify_outlook(netNH: float) -> str:
    # Simple, readable rule: >0 bullish, <0 bearish, else neutral.
    if netNH > 0:
        return "Bullish"
    if netNH < 0:
        return "Bearish"
    return "Neutral"

def title_case(name: str) -> str:
    return " ".join(w.capitalize() for w in (name or "").split())

def build_sector_cards(d: dict) -> list:
    outlook = d.get("outlook", {})
    sectors = outlook.get("sectors", {})

    cards = []
    if isinstance(sectors, dict) and sectors:
        for name, vals in sectors.items():
            nh    = float(vals.get("nh", 0))
            nl    = float(vals.get("nl", 0))
            netNH = float(vals.get("netNH", nh - nl))  # fallback to nh - nl
            netUD = float(vals.get("netUD", 0))
            spark = vals.get("spark", [])

            cards.append({
                "sector":  title_case(name),
                "outlook": classify_outlook(netNH),
                "spark":   spark if isinstance(spark, list) else [],
                "nh":      nh,
                "nl":      nl,
                "netNH":   netNH,
                "netUD":   netUD
            })

    # Sort consistently for stable UI
    cards.sort(key=lambda c: order_key(c.get("sector", "")))

    # If none built, seed minimally to avoid frontend blanks
    if not cards:
        cards = [
            {"sector": "Technology", "outlook": "Neutral", "spark": []},
            {"sector": "Energy",     "outlook": "Neutral", "spark": []},
            {"sector": "Financials", "outlook": "Neutral", "spark": []},
        ]
    return cards

def normalize_sector_cards(d: dict) -> dict:
    d.setdefault("outlook", {})
    cards = build_sector_cards(d)
    d["outlook"]["sectorCards"] = cards
    return d

def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="infile",  required=True, help="Input JSON (e.g. data/outlook.json)")
    ap.add_argument("--out", dest="outfile", required=True, help="Output JSON (e.g. data/outlook.json)")
    args = ap.parse_args()

    try:
        data = load_json(args.infile)
    except Exception as e:
        print(f"❌ Failed to read {args.infile}: {e}", file=sys.stderr)
        sys.exit(1)

    data = normalize_sector_cards(data)
    data.setdefault("meta", {})["normalized_at"] = datetime.utcnow().isoformat() + "Z"

    try:
        save_json(args.outfile, data)
        print(f"✅ Wrote normalized sectorCards -> {args.outfile} ({len(data['outlook']['sectorCards'])} cards)")
    except Exception as e:
        print(f"❌ Failed to write {args.outfile}: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
