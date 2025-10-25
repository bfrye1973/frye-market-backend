#!/usr/bin/env python3
"""
finalize_hourly_v1.py — v1-hourly finalizer (last writer wins)

- Enforce & clamp v1-hourly fields:
    breadth_1h_pct, momentum_combo_1h_pct, squeeze_1h_pct,
    liquidity_1h, volatility_1h_pct, volatility_1h_scaled
- Mirror v1-hourly -> legacy compat (only if an old widget needs it):
    breadth_pct <- breadth_1h_pct
    momentum_pct <- momentum_combo_1h_pct
- Keep sectorCards untouched; pass-through meta.
- Print a one-line snapshot for QA.
"""

import json, sys

def clamp(x, lo, hi): return max(lo, min(hi, x))
def as_num(x):
    try:
        v=float(x)
        if v!=v: return None
        return v
    except: return None

def main():
    if len(sys.argv) < 3:
        print("usage: finalize_hourly_v1.py --in IN --out OUT", file=sys.stderr)
        sys.exit(2)
    args = sys.argv[1:]
    p_in  = args[args.index("--in")+1]
    p_out = args[args.index("--out")+1]

    with open(p_in,"r",encoding="utf-8") as f:
        j=json.load(f)

    m=j.get("metrics") or {}
    h=j.get("hourly") or {}
    meta=j.get("meta") or {}

    # Enforce & clamp v1-hourly
    b = as_num(m.get("breadth_1h_pct"))
    mc= as_num(m.get("momentum_combo_1h_pct"))
    sq= as_num(m.get("squeeze_1h_pct"))
    lq= as_num(m.get("liquidity_1h"))
    vr= as_num(m.get("volatility_1h_pct"))
    vs= as_num(m.get("volatility_1h_scaled"))

    if b is not None:  m["breadth_1h_pct"] = round(clamp(b,0.0,100.0),2)
    if mc is not None: m["momentum_combo_1h_pct"] = round(clamp(mc,0.0,100.0),2)
    if sq is not None: m["squeeze_1h_pct"] = round(clamp(sq,0.0,100.0),2)
    if lq is not None: m["liquidity_1h"] = round(clamp(lq,0.0,200.0),2)
    if vr is not None: m["volatility_1h_pct"] = round(clamp(vr,0.0,100.0),3)
    if vs is not None: m["volatility_1h_scaled"] = round(clamp(vs,0.0,1000.0),2)

    # Mirrors (compat only)
    if m.get("breadth_1h_pct") is not None:
        m["breadth_pct"] = m["breadth_1h_pct"]
    if m.get("momentum_combo_1h_pct") is not None:
        m["momentum_pct"] = m["momentum_combo_1h_pct"]

    j["metrics"]=m; j["hourly"]=h; j["meta"]=meta

    with open(p_out,"w",encoding="utf-8") as f:
        json.dump(j,f,ensure_ascii=False,separators=(",",":"))

    print("[finalize:1h] breadth_1h_pct=", m.get("breadth_1h_pct"),
          " momentum_combo_1h_pct=", m.get("momentum_combo_1h_pct"),
          " squeeze_1h_pct=", m.get("squeeze_1h_pct"),
          " liquidity_1h=", m.get("liquidity_1h"),
          " vol_1h_scaled=", m.get("volatility_1h_scaled"))

if __name__ == "__main__":
    main()
