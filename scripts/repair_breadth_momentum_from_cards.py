#!/usr/bin/env python3
"""
repair_breadth_momentum_from_cards.py — SAFE POST-PROCESS

Fix: Breadth & Momentum in metrics are stale.
Action: Average the values already present in sectorCards and write them into
        metrics.breadth_pct and metrics.momentum_pct.

Usage:
  python -u scripts/repair_breadth_momentum_from_cards.py \
    --in  data/outlook_intraday.json \
    --out data/outlook_intraday.json
"""
import json, sys, argparse

def avg(vals):
    xs = [float(v) for v in vals if v is not None]
    return (sum(xs) / len(xs)) if xs else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    with open(args.src, "r", encoding="utf-8") as f:
        j = json.load(f)

    cards = j.get("sectorCards") or []
    b_avg = avg([c.get("breadth_pct")  for c in cards])
    m_avg = avg([c.get("momentum_pct") for c in cards])

    j.setdefault("metrics", {})
    if b_avg is not None:
        j["metrics"]["breadth_pct"] = round(b_avg, 2)
    if m_avg is not None:
        j["metrics"]["momentum_pct"] = round(m_avg, 2)

    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, indent=2)

    print("[repair-breadth-momentum] breadth_from_cards=", b_avg,
          " momentum_from_cards=", m_avg)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)
