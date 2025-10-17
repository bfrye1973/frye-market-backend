#!/usr/bin/env python3
"""
Ferrari Dashboard — alias_intraday_metrics.py (ADD-ON, SAFE)

Purpose
- Post-process the intraday payload to add legacy-compatible metric aliases
  without changing any formulas or schema.

What it does
- metrics.squeeze_intraday_pct := metrics.squeeze_pct (fallback 50.0 if missing)
- metrics.liquidity_psi        := metrics.liquidity_pct (fallback 50.0 if missing)
- Ensures intraday.overall10m exists minimally {state, score, components}
  (does NOT override existing values)

Usage
  python -u scripts/alias_intraday_metrics.py \
    --in  data/outlook_intraday.json \
    --out data/outlook_intraday.json
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone


def iso_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def as_num(x, default) -> float:
    """Return float(x) or default (also guards NaN)."""
    try:
        v = float(x)
        if v != v:  # NaN
            return float(default)
        return v
    except Exception:
        return float(default)


def main():
    ap = argparse.ArgumentParser(description="Add intraday metric aliases safely.")
    ap.add_argument("--in", dest="src", required=True, help="Path to intraday JSON (input)")
    ap.add_argument("--out", dest="dst", required=True, help="Path to write output (can be same as --in)")
    args = ap.parse_args()

    # Load
    with open(args.src, "r", encoding="utf-8") as f:
        data = json.load(f)

    metrics = data.get("metrics") or {}
    intraday = data.get("intraday") or {}

    # Existing values (do NOT change your formulas)
    squeeze_pct = as_num(metrics.get("squeeze_pct"), 50.0)
    liquidity_pct = as_num(metrics.get("liquidity_pct"), 50.0)

    # Write aliases (idempotent, safe)
    metrics["squeeze_intraday_pct"] = as_num(
        metrics.get("squeeze_intraday_pct", squeeze_pct), squeeze_pct
    )
    metrics["liquidity_psi"] = as_num(
        metrics.get("liquidity_psi", liquidity_pct), liquidity_pct
    )

    # Reassure overall light exists (do not override if present)
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

    # Save
    data["metrics"] = metrics
    data["intraday"] = intraday
    meta = data.get("meta") or {}
    meta["aliased_at_utc"] = iso_utc()
    data["meta"] = meta

    os.makedirs(os.path.dirname(args.dst), exist_ok=True)
    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(
        "[alias] squeeze_intraday_pct=",
        metrics["squeeze_intraday_pct"],
        " liquidity_psi=",
        metrics["liquidity_psi"],
    )
    print("         overall10m:", data["intraday"]["overall10m"])


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)
