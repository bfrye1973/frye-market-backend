#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lightweight validator for sector 10m artifact.
Non-blocking: prints WARN/PASS to console for dev review.
"""
import json, os, sys

ROOT = os.path.dirname(__file__)
CFG  = os.path.join(ROOT, "config.json")
OUT  = os.path.join(ROOT, "out", "outlook_sector_10m.json")

ORDER = [
    "Information Technology","Materials","Health Care","Communication Services",
    "Real Estate","Energy","Consumer Staples","Consumer Discretionary",
    "Financials","Utilities","Industrials"
]

def is_num(x):
    try: float(x); return True
    except Exception: return False

def main():
    ok = True
    if not os.path.exists(CFG):
        print("[warn] missing config.json"); return 0
    cfg = json.load(open(CFG,"r",encoding="utf-8"))
    print("[info] config version:", cfg.get("version"))

    if not os.path.exists(OUT):
        print("[warn] output not found:", OUT); return 0
    data = json.load(open(OUT,"r",encoding="utf-8"))
    cards = data.get("sectorCards") or []
    if len(cards) != 11:
        print("[warn] sectorCards length != 11:", len(cards)); ok=False

    got = {c.get("sector") for c in cards if isinstance(c,dict)}
    for name in ORDER:
        if name not in got:
            print("[warn] missing sector:", name); ok=False

    # numeric checks
    for c in cards:
        b = c.get("breadth_pct"); m = c.get("momentum_pct")
        if not (is_num(b) and is_num(m)):
            print("[warn] non-numeric breadth/momentum for", c.get("sector")); ok=False
        for k in ("nh","nl","up","down"):
            if not isinstance(c.get(k), int):
                print(f"[warn] {c.get('sector')} {k} not int"); ok=False
        # derived fields
        if "tilt" not in c or "outlook" not in c or "grade" not in c:
            print("[warn] missing derived fields for", c.get("sector")); ok=False

    print("[result]","PASS" if ok else "WARN")
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
