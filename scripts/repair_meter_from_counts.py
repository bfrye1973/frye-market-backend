#!/usr/bin/env python3
"""
repair_meter_from_counts.py — count-based meter repair (10m)

Recompute the 4 meter inputs from sectorCards *counts*, matching QA:
/qa/meter:
- Breadth%  = ΣNH / (ΣNH + ΣNL)
- Momentum% = ΣUp / (ΣUp + ΣDown)
- Rising%   = % of sectors with breadth_pct > 50
- Risk-On%  = (offensive breadth>50 + defensive breadth<50) / total considered * 100

Writes back:
- metrics.breadth_pct
- metrics.momentum_pct
- intraday.sectorDirection10m.risingPct
- intraday.riskOn10m.riskOnPct
"""

import json, sys, argparse

OFFENSIVE = {"information technology", "consumer discretionary", "communication services"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}


def safe_sum(vals):
    return float(sum(x for x in vals if isinstance(x, (int, float))))


def pct(num, den):
    den = float(den)
    if den <= 0:
        return None
    return 100.0 * float(num) / den


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    with open(args.src, "r", encoding="utf-8") as f:
        j = json.load(f)

    cards = j.get("sectorCards") or []

    # 1) Breadth & Momentum from counts
    nh = safe_sum(c.get("nh") for c in cards)
    nl = safe_sum(c.get("nl") for c in cards)
    up = safe_sum(c.get("up") for c in cards)
    dn = safe_sum(c.get("down") for c in cards)

    breadth = pct(nh, nh + nl)
    momentum = pct(up, up + dn)

    # 2) Rising% = % sectors with breadth_pct > 50
    rising = None
    if cards:
        good = total = 0
        for c in cards:
            bp = c.get("breadth_pct")
            if isinstance(bp, (int, float)):
                total += 1
                if bp > 50.0:
                    good += 1
        if total > 0:
            rising = 100.0 * good / total

    # 3) Risk-On% = offensive (>50) + defensive (<50)
    risk_on = None
    if cards:
        by = {(c.get("sector") or "").strip().lower(): c for c in cards}
        score = total = 0
        for s in OFFENSIVE:
            bp = by.get(s, {}).get("breadth_pct")
            if isinstance(bp, (int, float)):
                total += 1
                if bp > 50.0:
                    score += 1
        for s in DEFENSIVE:
            bp = by.get(s, {}).get("breadth_pct")
            if isinstance(bp, (int, float)):
                total += 1
                if bp < 50.0:
                    score += 1
        if total > 0:
            risk_on = 100.0 * score / total

    # Write back
    j.setdefault("metrics", {})
    if breadth is not None:
        j["metrics"]["breadth_pct"] = round(breadth, 2)
    if momentum is not None:
        j["metrics"]["momentum_pct"] = round(momentum, 2)

    j.setdefault("intraday", {})
    j["intraday"].setdefault("sectorDirection10m", {})
    if rising is not None:
        j["intraday"]["sectorDirection10m"]["risingPct"] = round(rising, 2)

    j["intraday"].setdefault("riskOn10m", {})
    if risk_on is not None:
        j["intraday"]["riskOn10m"]["riskOnPct"] = round(risk_on, 2)

    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, indent=2)

    print(
        "[repair-meter] breadth=",
        j["metrics"].get("breadth_pct"),
        " momentum=",
        j["metrics"].get("momentum_pct"),
        " rising%=",
        j["intraday"]["sectorDirection10m"].get("risingPct"),
        " riskOn%=",
        j["intraday"]["riskOn10m"].get("riskOnPct"),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)
