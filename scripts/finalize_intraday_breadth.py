#!/usr/bin/env python3
"""
finalize_intraday_breadth.py — v1 finalizer (last writer wins)

- Enforce v1 fields (never overwritten by repairs/alias):
    breadth_10m_pct, momentum_combo_pct, squeeze_pct, liquidity_psi,
    volatility_pct, volatility_scaled
- Mirror v1 -> legacy compat (read-only legacy):
    breadth_pct, momentum_pct, squeeze_intraday_pct, liquidity_pct
- If breadth components exist but breadth_10m_pct missing, recompute 60/40 using *_fast.
- Clamp ranges (0..100) and PSI (0..200).
- Add meta flags (no heavy logic): cards_fresh, smi1h_fresh, after_hours (if present).

Usage:
  python -u scripts/finalize_intraday_breadth.py --in data/outlook_intraday.json --out data/outlook_intraday.json
"""

import json, sys

def clamp(x, lo, hi): return max(lo, min(hi, x))

def as_num(x):
    try:
        v = float(x)
        if v != v: return None
        return v
    except Exception:
        return None

def main():
    if len(sys.argv) < 3:
        print("usage: finalize_intraday_breadth.py --in IN --out OUT", file=sys.stderr)
        sys.exit(2)
    args = sys.argv[1:]
    p_in  = args[args.index("--in")+1]
    p_out = args[args.index("--out")+1]

    with open(p_in, "r", encoding="utf-8") as f:
        j = json.load(f)

    m  = j.get("metrics")  or {}
    it = j.get("intraday") or {}
    meta = j.get("meta")   or {}

    # ---- Enforce v1 breadth ----
    b_v1 = as_num(m.get("breadth_10m_pct"))
    a_fast = as_num(m.get("breadth_align_pct_fast"))
    b_fast = as_num(m.get("breadth_bar_pct_fast"))
    a_raw  = as_num(m.get("breadth_align_pct"))
    b_raw  = as_num(m.get("breadth_bar_pct"))

    if b_v1 is None:
        a_val = a_fast if a_fast is not None else a_raw
        b_val = b_fast if b_fast is not None else b_raw
        if a_val is not None or b_val is not None:
            if a_val is None: a_val = 0.0
            if b_val is None: b_val = 0.0
            b_v1 = round(clamp(0.60 * float(a_val) + 0.40 * float(b_val), 0.0, 100.0), 2)

    # ---- Enforce v1 momentum combo ----
    mom_combo = as_num(m.get("momentum_combo_pct"))
    # Legacy sector momentum kept as-is: momentum_10m_pct

    # ---- Enforce v1 squeeze (compression) ----
    sq = as_num(m.get("squeeze_pct"))
    # squeeze_expansion_pct kept for debug/overall scoring upstream

    # ---- Enforce v1 liquidity & volatility ----
    liq_psi = as_num(m.get("liquidity_psi"))
    vol_raw = as_num(m.get("volatility_pct"))
    vol_scl = as_num(m.get("volatility_scaled"))

    # Clamp & write back v1 (if present)
    if b_v1 is not None:       m["breadth_10m_pct"] = round(clamp(b_v1, 0.0, 100.0), 2)
    if mom_combo is not None:  m["momentum_combo_pct"] = round(clamp(mom_combo, 0.0, 100.0), 2)
    if sq is not None:         m["squeeze_pct"] = round(clamp(sq, 0.0, 100.0), 2)
    if liq_psi is not None:    m["liquidity_psi"] = round(clamp(liq_psi, 0.0, 200.0), 2)
    if vol_raw is not None:    m["volatility_pct"] = round(clamp(vol_raw, 0.0, 100.0), 3)
    if vol_scl is not None:    m["volatility_scaled"] = round(clamp(vol_scl, 0.0, 1000.0), 2)

    # ---- Mirrors v1 -> legacy (compat only; do NOT override v1) ----
    if m.get("breadth_10m_pct") is not None:
        m["breadth_pct"] = m["breadth_10m_pct"]

    if m.get("momentum_combo_pct") is not None:
        m["momentum_pct"] = m["momentum_combo_pct"]
    elif m.get("momentum_10m_pct") is not None:
        m["momentum_pct"] = m["momentum_10m_pct"]

    if m.get("squeeze_pct") is not None:
        m["squeeze_intraday_pct"] = m["squeeze_pct"]

    if m.get("liquidity_psi") is not None:
        m["liquidity_pct"] = m["liquidity_psi"]

    # Pass meta through (if builder set them), don't manufacture here
    j["metrics"] = m
    j["intraday"] = it
    j["meta"] = meta

    with open(p_out, "w", encoding="utf-8") as f:
        json.dump(j, f, ensure_ascii=False, separators=(",",":"))

    print("[finalize:v1] breadth_10m_pct=", m.get("breadth_10m_pct"),
          " momentum_combo_pct=", m.get("momentum_combo_pct"),
          " squeeze_pct=", m.get("squeeze_pct"),
          " liquidity_psi=", m.get("liquidity_psi"),
          " vol_scaled=", m.get("volatility_scaled"))

if __name__ == "__main__":
    main()
