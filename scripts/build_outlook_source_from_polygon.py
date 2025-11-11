#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (backward-compatible, normalized)

Option A: Safest now — DO NOT CHANGE WORKFLOWS.
- Accepts --mode {intraday,hourly,eod} and maps 'intraday10' to 'intraday'
- --source is OPTIONAL (if not supplied, builds a safe fallback source)
- Normalizes metrics for 10m so make_dashboard + UI get the keys they expect
- Emits canonical sectorCards (11 rows) and groups with zeros if none provided
- Stamps updated_at (America/Phoenix) and updated_at_utc (UTC)

Works with your existing workflows immediately.
"""

from __future__ import annotations
import argparse, json, os, sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

PHX = ZoneInfo("America/Phoenix")
UTC = timezone.utc

ORDER = [
    "information technology", "materials", "health care", "communication services",
    "real estate", "energy", "consumer staples", "consumer discretionary",
    "financials", "utilities", "industrials"
]

ALIAS = {
    "healthcare": "health care", "health-care": "health care",
    "info tech": "information technology", "technology": "information technology",
    "tech": "information technology",
    "communications": "communication services", "comm services": "communication services", "telecom": "communication services",
    "staples": "consumer staples", "consumer staples": "consumer staples",
    "discretionary": "consumer discretionary", "consumer discretionary": "consumer discretionary",
    "finance": "financials", "industrials": "industrials", "industry": "industrials",
    "reit": "real estate", "reits": "real estate"
}

def now_phx_iso() -> str:
    return datetime.now(PHX).replace(microsecond=0).isoformat(sep=' ')

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace('+00:00','Z')

def norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else round(100.0 * float(a) / float(b), 2)

def coalesce(*vals):
    for v in vals:
        if isinstance(v, (int, float)) and v == v:
            return float(v)
        if v is not None and isinstance(v, (int, float)):
            return float(v)
    return None

def build_safe_groups() -> Dict[str, Dict[str, float]]:
    """Return canonical sectors with zeroed counts so downstream steps never break."""
    g = {}
    for k in ORDER:
        g[k] = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    return g

def build_cards_from_groups(groups: Dict[str, Dict[str, float]]) -> List[Dict[str, Any]]:
    by = {}
    for raw, g in (groups or {}).items():
        k = ALIAS.get(norm(raw), norm(raw))
        if not k:
            continue
        nh = float((g or {}).get("nh", 0)); nl = float((g or {}).get("nl", 0))
        up = float((g or {}).get("u", 0));  dn = float((g or {}).get("d", 0))
        b = pct(nh, nh + nl)
        m = pct(up, up + dn)
        by[k] = {
            "sector": k.title(),
            "breadth_pct": b, "momentum_pct": m,
            "nh": int(nh), "nl": int(nl), "up": int(up), "down": int(dn)
        }
    out = []
    for k in ORDER:
        out.append(by.get(k, {
            "sector": k.title(), "breadth_pct": 0.0, "momentum_pct": 0.0,
            "nh": 0, "nl": 0, "up": 0, "down": 0
        }))
    return out

def build_source_via_polygon(mode: str) -> Dict[str, Any]:
    """
    Legacy fallback path — if --source isn't supplied, we return a safe skeleton.
    This prevents workflow crashes without forcing you to pass --source.
    """
    print(f"[warn] No --source provided. Building safe fallback source for mode: {mode}", flush=True)
    return {
        "metrics": {},
        "groups": build_safe_groups(),
        "sectorCards": []  # downstream normalization can re-render final cards from groups
    }

def load_source(path: Optional[str]) -> Dict[str, Any]:
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print("[error] failed to read --source:", e, flush=True)
        return {}

def normalize_intraday(source: Dict[str, Any]) -> Dict[str, Any]:
    m = dict(source.get("metrics") or {})
    groups = source.get("groups") or {}
    cards  = source.get("sectorCards") or build_cards_from_groups(groups)

    # derive/normalize expected metrics (10m naming)
    breadth_10m = coalesce(m.get("breadth_10m_pct"), m.get("breadth_pct"))
    if breadth_10m is None and cards:
        breadth_10m = sum(c.get("breadth_pct", 0.0) for c in cards) / max(1, len(cards))
    if breadth_10m is None:
        breadth_10m = 50.0

    momentum_10m = coalesce(m.get("momentum_10m_pct"), m.get("momentum_ih_pct"), m.get("momentum_pct"), 50.0)

    psi = coalesce(m.get("squeeze_psi_10m_pct"), m.get("squeeze_ih_pct"), m.get("squeeze_psi"))
    expansion = coalesce(m.get("squeeze_expansion_pct"), (100.0 - psi) if psi is not None else None)
    if psi is None:
        psi = 50.0
    if expansion is None:
        expansion = 100.0 - psi

    liq = coalesce(m.get("liquidity_psi"), m.get("liquidity_ih"), 70.0)
    vol = coalesce(m.get("volatility_pct"), m.get("volatility_ih_pct"), 0.20)

    ema_sign = int(m.get("ema_sign") or 0)
    ema_gap  = coalesce(m.get("ema_gap_pct"), m.get("ema_10m_pct"), 0.0)
    align_fast = coalesce(m.get("breadth_align_fast_pct"), m.get("breadth_ih_pct"))

    metrics_out = dict(m)
    metrics_out["breadth_10m_pct"]        = round(float(breadth_10m), 2)
    metrics_out["momentum_10m_pct"]       = round(float(momentum_10m), 2)
    metrics_out["squeeze_psi_10m_pct"]    = round(float(psi), 2)
    metrics_out["squeeze_expansion_pct"]  = round(float(expansion), 2)
    metrics_out["squeeze_pct"]            = metrics_out["squeeze_expansion_pct"]
    metrics_out["liquidity_psi"]          = round(float(liq), 2)
    metrics_out["volatility_pct"]         = round(float(vol), 3)
    metrics_out["ema_sign"]               = ema_sign
    metrics_out["ema_gap_pct"]            = round(float(ema_gap), 2)
    if align_fast is not None:
        metrics_out["breadth_align_fast_pct"] = round(float(align_fast), 2)

    # preserve any intraday block (we do not recompute overall10m here)
    intraday = source.get("intraday") or {}

    return {
        "version": source.get("version", "r:intraday-v1"),
        "updated_at": now_phx_iso(),
        "updated_at_utc": now_utc_iso(),
        "mode": "intraday",
        "metrics": metrics_out,
        "intraday": intraday,
        "sectorCards": cards,
        "groups": groups or build_safe_groups(),
        "meta": {"last_full_run_utc": now_utc_iso()}
    }

def normalize_hourly(source: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(source)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = "hourly"
    # If PSI present (tightness), output also squeeze_1h_pct as expansion
    m = out.get("metrics") or {}
    psi = coalesce(m.get("squeeze_psi_1h"), m.get("squeeze_1h_pct"))
    if psi is not None:
        m["squeeze_1h_pct"] = round(float(100.0 - psi), 2)  # expansion
    out["metrics"] = m
    if "groups" not in out:
        out["groups"] = build_safe_groups()
    if "sectorCards" not in out:
        out["sectorCards"] = []
    return out

def normalize_eod(source: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(source)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = "eod"
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=["intraday", "hourly", "eod", "intraday10"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--source", required=False, help="Optional path to incoming source; if omitted, we build fallback.")
    args = ap.parse_args()

    mode = "intraday" if args.mode == "intraday10" else args.mode

    # Load or fallback
    src = load_source(args.source)
    if not src:
        src = build_source_via_polygon(mode)

    # Normalize by mode
    if mode == "intraday":
        out = normalize_intraday(src)
    elif mode == "hourly":
        out = normalize_hourly(src)
    else:
        out = normalize_eod(src)

    # Ensure write
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    try:
        print("[ok] wrote:", args.out, "mode:", mode)
        if mode == "intraday":
            m = out.get("metrics", {})
            print("breadth_10m_pct:", m.get("breadth_10m_pct"),
                  "momentum_10m_pct:", m.get("momentum_10m_pct"),
                  "squeeze_psi_10m_pct:", m.get("squeeze_psi_10m_pct"),
                  "squeeze_expansion_pct:", m.get("squeeze_expansion_pct"))
    except Exception:
        pass

if __name__ == "__main__":
    main()
