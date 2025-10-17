#!/usr/bin/env python3
"""
repair_breadth_momentum_from_cards.py  —  SAFE POST-PROCESS

Goal
- Breadth and Momentum in metrics are stuck. This script fixes them by
  averaging the per-sector values already present in sectorCards and
  writing those averages into metrics.breadth_pct and metrics.momentum_pct.

What it does
- Reads data/outlook_intraday.json
- Computes:
    breadth_from_cards  = average of sectorCards[].breadth_pct
    momentum_from_cards = average of sectorCards[].momentum_pct
- If those numbers exist, it sets:
    metrics.breadth_pct  = breadth_from_cards
    metrics.momentum_pct = momentum_from_cards
- Writes back to the same file. No other fields are changed.
"""

import json, sys, argparse, os

def avg(nums):
    nums = [float(x) for x in nums if x is not None]
    return (sum(nums) / len(nums)) if nums else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    with open(args.src, "r", encoding="utf-8") as f:
        j = json.load(f)

    cards = j.get("sectorCards") or []
    b_vals = [c.get("breadth_pct") for c in cards]
    m_vals = [c.get("momentum_pct") for c in cards]

    b_avg = avg(b_vals)
    m_avg = avg(m_vals)

    if b_avg is not None or m_avg is not None:
        j.setdefault("metrics", {})
        if b_avg is not None:
            j["metrics"]["breadth_pct"] = round(b_avg, 2)
        if m_avg is not None:
            j["metrics"]["momentum_pct"] = round(m_avg, 2)

    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, indent=2)

    print("[repair-breadth-momentum] breadth_from_cards=",
          b_avg, " momentum_from_cards=", m_avg)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)
