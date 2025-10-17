#!/usr/bin/env python3
"""
Ferrari Dashboard — alias_intraday_metrics.py (ADD-ON, SAFE)

Purpose:
- Post-process the intraday payload to add legacy-compatible metric aliases
  without changing your existing formulas or schema.

Actions:
- metrics.squeeze_intraday_pct := metrics.squeeze_pct (fallback 50.0 if missing)
- metrics.liquidity_psi        := metrics.liquidity_pct (fallback 50.0 if missing)
- Ensure intraday.overall10m exists with {state, score} (do NOT override if present)

Usage:
  python -u scripts/alias_intraday_metrics.py \
    --in  data/outlook_intraday.json \
    --out data/outlook_intraday.json
"""

import argparse, json, os, sys
from datetime import datetime, timezone

def iso_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def load_json(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(p, obj):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def as_num(x, default):
    try:
        v = float(x)
        if v != v:  # NaN check
            return float(default)
        return v
    except Exception:
        return float(default)

def main():
    ap = argparse.ArgumentParser(description="Add intraday metric aliases safely.")
    ap.add_argument("--in", dest="src", required=True, help="Path to intraday JSON (input)")
    ap.add_argument("--out", dest="dst", required=True, help="Path to write output (can be same as --in)")
    args = ap.parse_args()

    data = load_json(args.src)

    # ensure nodes
    metrics  = data.get("metrics") or {}
    intraday = data.get("intraday") or {}

    # read existing fields (do NOT change your formulas)
    squeeze_pct   = as_num(metrics.get("squeeze_pct"),   50.0)
    liquidity_pct = as_num(metrics.get("liquidity_pct"), 50.0)

    # write aliases (idempotent, safe)
    metrics["squeeze_intraday_pct"] = as_num(metrics.get("squeeze_intraday_pct", squeeze_pct), squeeze_pct)
    metrics["liquidity_psi"]        = as_num(metrics.get("liquidity_psi",        liquidity_pct), liquidity_pct)

    # reassure overall light exists (do not override if present)
    overall = intraday.get("overall10m")
    if not isinstance(overall, dict):
        overall = {"state": "neutral", "score": 50, "components": {}}
        intraday["overall10m"] = overall
    else:
        # fill minimal fields if missing; never clobber provided values
        overall.setdefault("state", "neutral")
        try:
            overall["score"] = int(round(float(overall.get("score", 50))))
        except Exception:
            overall["score"] = 50
        overall.setdefault("components", {})

    # write back nodes
    data["metrics"]  = metrics
    data["intraday"] = intraday

    # optional: stamp a tiny note for debugging (non-breaking)
    meta = data.get("meta") or {}
    meta["aliased_at_utc"] = iso_utc()
    data["meta"] = meta

    save_json(args.dst, data)
    print("[OK] intraday aliases ensured:",
          f"squeeze_intraday_pct={metrics['squeeze_intraday_pct']},",
          f"liquidity_psi={metrics['liquidity_psi']}")
    print("     overall10m:", data["intraday"]["overall10m"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", repr(e), file=sys.stderr)
        sys.exit(2)
#!/usr/bin/env python3
"""
alias_intraday_metrics.py — SAFE ADD-ON (no math changes)

Adds legacy aliases so older tiles never show “—”:
- metrics.squeeze_intraday_pct := metrics.squeeze_pct
- metrics.liquidity_psi        := metrics.liquidity_pct

Also ensures intraday.overall10m exists minimally.
"""

import argparse, json, os, sys
from datetime import datetime, timezone

def iso_utc():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def as_num(x, default):
    try:
        v = float(x)
        if v != v:  # NaN
            return float(default)
        return v
    except Exception:
        return float(default)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    with open(args.src, "r", encoding="utf-8") as f:
        data = json.load(f)

    metrics  = data.get("metrics") or {}
    intraday = data.get("intraday") or {}

    # existing values (don’t change the math you already computed)
    squeeze_pct   = as_num(metrics.get("squeeze_pct"),   50.0)
    liquidity_pct = as_num(metrics.get("liquidity_pct"), 50.0)

    # write aliases if missing
    metrics["squeeze_intraday_pct"] = as_num(metrics.get("squeeze_intraday_pct", squeeze_pct), squeeze_pct)
    metrics["liquidity_psi"]        = as_num(metrics.get("liquidity_psi",        liquidity_pct), liquidity_pct)

    # ensure overall light node exists (don’t override if present)
    overall = intraday.get("overall10m")
    if not isinstance(overall, dict):
        intraday["overall10m"] = {"state": "neutral", "score": 50, "components": {}}
    else:
        overall.setdefault("state", "neutral")
        try:
            overall["score"] = int(round(float(overall.get("score", 50))))
        except Exception:
            overall["score"] = 50
        overall.setdefault("components", {})

    data["metrics"]  = metrics
    data["intraday"] = intraday
    meta = data.get("meta") or {}
    meta["aliased_at_utc"] = iso_utc()
    data["meta"] = meta

    with open(args.dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("[alias] squeeze_intraday_pct=", metrics["squeeze_intraday_pct"],
          " liquidity_psi=", metrics["liquidity_psi"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("ERROR:", e, file=sys.stderr)
        sys.exit(2)


