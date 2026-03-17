#!/usr/bin/env python3
"""
Ferrari Dashboard — alias_intraday_metrics.py (SAFE mirrors)

Purpose
- Post-process the intraday payload to add legacy-compatible metric aliases
  WITHOUT changing v1 formulas or schema.

Mirrors (v1 → legacy)
- squeeze_intraday_pct := squeeze_pct
- liquidity_pct        := liquidity_psi
- breadth_pct          := breadth_10m_pct        (compat only)
- momentum_pct         := momentum_combo_pct or momentum_10m_pct (compat only)

Also ensures intraday.overall10m exists minimally if missing (does not override).
"""

import argparse, json, os, sys
from datetime import datetime, timezone

def iso_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def as_num(x, default) -> float:
    try:
        v = float(x)
        if v != v:  # NaN
            return float(default)
        return v
    except Exception:
        return float(default)

def main():
    ap = argparse.ArgumentParser(description="Add legacy metric aliases (read-only).")
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    with open(args.src, "r", encoding="utf-8") as f:
        data = json.load(f)

    metrics  = data.get("metrics")  or {}
    intraday = data.get("intraday") or {}

    # v1 sources
    squeeze_v1   = metrics.get("squeeze_pct")
    liq_psi_v1   = metrics.get("liquidity_psi")
    breadth_v1   = metrics.get("breadth_10m_pct")
    mom_combo_v1 = metrics.get("momentum_combo_pct")
    mom_10m_legacy = metrics.get("momentum_10m_pct")

    # Mirrors (v1 -> legacy), do NOT overwrite v1
    if squeeze_v1 is not None:
        metrics["squeeze_intraday_pct"] = as_num(metrics.get("squeeze_intraday_pct", squeeze_v1), squeeze_v1)

    if liq_psi_v1 is not None:
        metrics["liquidity_pct"] = as_num(metrics.get("liquidity_pct", liq_psi_v1), liq_psi_v1)

    if breadth_v1 is not None:
        metrics["breadth_pct"] = as_num(metrics.get("breadth_pct", breadth_v1), breadth_v1)

    if mom_combo_v1 is not None:
        metrics["momentum_pct"] = as_num(metrics.get("momentum_pct", mom_combo_v1), mom_combo_v1)
    elif mom_10m_legacy is not None:
        metrics["momentum_pct"] = as_num(metrics.get("momentum_pct", mom_10m_legacy), mom_10m_legacy)

    # Ensure overall block exists (do not override)
    overall = intraday.get("overall10m")
    if not isinstance(overall, dict):
        overall = {"state": "neutral", "score": 50, "components": {}}
        intraday["overall10m"] = overall
    else:
        overall.setdefault("state", "neutral")
        try:
            overall["score"] = int(round(float(overall.get("score", 50))))
        except Exception:
            overall["score"] = 50
        overall.setdefault("components", {})

    data["metrics"] = metrics
    data["intraday"] = intraday
    meta = data.get("meta") or {}
    meta["aliased_at_utc"] = iso_utc()
    data["meta"] = meta

    os.makedirs(os.path.dirname(args.dst), exist_ok=True)
    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",",":"))

    print("[alias] mirrors set:",
          "squeeze_intraday_pct <- squeeze_pct;",
          "liquidity_pct <- liquidity_psi;",
          "breadth_pct <- breadth_10m_pct;",
          "momentum_pct <- momentum_combo_pct|momentum_10m_pct")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)
