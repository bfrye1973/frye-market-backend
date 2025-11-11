#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (backward-compatible, normalized)

- Accepts --mode {intraday,hourly,eod,intraday10}  (maps 'intraday10' → 'intraday')
- --source is OPTIONAL (if omitted, builds a safe fallback)
- NEW: accepts --sectors-dir (optional). If provided and no --source, we will
  read CSVs under that directory and create canonical 11 sector 'groups' with zeroed counts
  so downstream make_dashboard can render sectorCards reliably.
- Normalizes metrics for 10m so make_dashboard + UI get the keys they expect
  (breadth_10m_pct, momentum_10m_pct, squeeze_psi_10m_pct, squeeze_expansion_pct, etc.)
- Always stamps updated_at (America/Phoenix) and updated_at_utc (UTC)

This is Option A (safest): it works with your current workflows immediately.
"""

from __future__ import annotations
import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

PHX = ZoneInfo("America/Phoenix")
UTC = timezone.utc

ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials"
]
ALIAS = {
    "healthcare":"health care","health-care":"health care",
    "info tech":"information technology","technology":"information technology","tech":"information technology",
    "communications":"communication services","comm":"communication services","telecom":"communication services",
    "staples":"consumer staples","consumer staples":"consumer staples",
    "discretionary":"consumer discretionary","consumer discretionary":"consumer discretionary",
    "finance":"financials","industrials":"industrials","industry":"industrials",
    "reit":"real estate","reits":"real estate",
}

def now_phx_iso() -> str:
    # Arizona local time, zero microseconds, "YYYY-MM-DD HH:MM:SS" format
    return datetime.now(PHX).replace(minute=datetime.now(PHX).minute, second=datetime.now(PHX).second, microsecond=0).strftime("%Y-%m-%d %H:%M:%S")
  
def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00","Z")

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

def safe_groups() -> Dict[str, Dict[str, int]]:
    """Return canonical sector keys with zeroed counts so downstream never breaks."""
    g: Dict[str, Dict[str,int]] = {}
    for k in ORDER:
        g[k] = {"nh": 0, "nl": 0, "u": 0, "d": 0}
    return g

def groups_from_sectors_dir(dir_path: str) -> Dict[str, Dict[str, int]]:
    """
    Read CSVs under dir_path (e.g., data/sectors/*.csv) and create zeroed groups
    keyed by canonical sector names. This is *not* fetching market data — it's just
    building the 11 buckets so make_dashboard can render cards.
    """
    groups = safe_groups()
    if not dir_path:
        return groups
    try:
        for entry in os.listdir(dir_path):
            if not entry.lower().endswith(".csv"): 
                continue
            sector_raw = os.path.splitext(entry)[0]
            key = ALIAS.get(norm(sector_raw), norm(sector_raw))
            if key and key in groups:
                # We could parse symbols to count membership; leave counts zero for now
                # and let the upstream aggregator or future enhancement fill counts.
                # But we ensure the bucket exists.
                _ = groups[key]  # touch
        return groups
    except Exception as e:
        print(f"[warn] could not read sectors dir '{dir_path}': {e}", flush=True)
        return groups

def load_source(path: Optional[str]) -> Dict[str, Any]:
    """Try to load a provided source file; if missing/invalid, return empty dict."""
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
    cards  = source.get("sectorCards") or []

    if not cards:
        # Build cards from groups if provided (zeroed buckets still render)
        if not groups:
            groups = safe_groups()
        cards = []
        for raw, g in groups.items():
            k = ALIAS.get(norm(raw), norm(raw))
            if not k: 
                continue
            nh = float(g.get("nh", 0)); nl = float(g.get("nl", 0))
            up = float(g.get("u", 0));  dn = float(g.get("d", 0))
            cards.append({
                "sector": k.title(),
                "breadth_pct": pct(nh, nh+nl),
                "momentum_pct": pct(up, up+dn),
                "nh": int(nh), "nl": int(nl), "up": int(up), "down": int(dn),
            })
        # Ensure we have 11 rows
        if len(cards) != len(ORDER):
            have = {norm(c["sector"]) for c in cards}
            for k in ORDER:
                if k not in have:
                    cards.append({"sector": k.title(),"breadth_pct":0.0,"momentum_pct":0.0,"nh":0,"nl":0,"up":0,"down":0})

    # Derive normalized 10m metrics with safe fallbacks
    breadth_10m  = coalesce(m.get("breadth_10m_pct"), m.get("breadth_pct"))
    if breadth_10m is None:
        # compute from cards if any; else default 50
        total_n = sum(c.get("nh",0)+c.get("nl",0) for c in cards)
        if total_n > 0:
            wins = sum(1 for c in cards if c.get("nh",0) > 0)
            breadth_10m = pct(wins, len(cards))
        else:
            breadth_10m = 50.0

    momentum_10m = coalesce(m.get("momentum_10m_pct"), m.get("momentum_ih_pct"), m.get("momentum_pct"), 50.0)
    psi          = coalesce(m.get("squeeze_psi_10m_pct"), m.get("squeeze_ih_pct"), m.get("squeeze_psi"), 50.0)
    expansion    = coalesce(m.get("squeeze_expansion_pct"), 100.0 - psi)
    liq          = coalesce(m.get("liquidity_psi"), m.get("liquidity_ih"), 70.0)
    vol          = coalesce(m.get("volatility_pct"), m.get("volatility_ih_pct"), 0.20)
    ema_sign     = int(m.get("ema_sign") or 0)
    ema_gap      = coalesce(m.get("ema_gap_pct"), m.get("ema_10m_pct"), 0.0)
    align_fast   = coalesce(m.get("breadth_align_fast_pct"), m.get("breadth_ih_pct"))

    m_out = dict(m)
    m_out["breadth_10m_pct"]       = float(round(breadth_10m, 2))
    m_out["momentum_10m_pct"]      = float(round(momentum_10m, 2))
    m_out["squeeze_psi_10m_pct"]   = float(round(psi, 2))
    m_out["squeeze_expansion_pct"] = float(round(expansion, 2))
    m_out["squeeze_pct"]           = m_out["squeeze_expansion"] if "squeeze_expansion" in m_out else m_out["squeeze_expansion_pct"]
    m_out["liquidity_psi"]         = float(round(liq, 2))
    m_out["volatility_pct"]        = float(round(vol, 3))
    m_out["ema_sign"]              = ema_sign
    m_out["ema_gap_pct"]           = float(round(ema_gap, 2))
    if align_fast is not None:
        m_out["breadth_10m_pct"] = float(round(breadth_10m, 2))
        m_out["breadth_ih_pct"]  = float(round(align_fast, 2))

    intraday = source.get("intraday") or {}

    return {
        "version": source.get("version","r:intraday-v1"),
        "updated_at": now_phx_iso(),
        "updated_at_utc": now_utc_iso(),
        "mode": "intraday",
        "metrics": m_out,
        "intraday": intraday,
        "sectorCards": cards,
        "groups": groups or safe_groups(),
        "meta": {"last_full_run_utc": now_utc_iso()},
    }

def normalize_hourly(source: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(source)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = "hourly"
    m = out.get("metrics") or {}
    psi = coalesce(m.get("squeeze_psi_1h"), m.get("squeeze_1h_pct"))
    if psi is not None:
        m["skey"] = "squeeze"  # leave a hint
        m["squeeze_1h_pct"] = float(round(100.0 - psi, 2))
    out["metrics"] = m
    if "groups" not in out: out["groups"] = safe_groups()
    if "sectorCards" not in out: out["sectorCards"] = []
    return out

def normalize_eod(source: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(source)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = "eod"
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=["intraday","hourly","eod","intraday10"])
    ap.add_argument("--out", required=True, help="Output path for normalized *source* JSON")
    ap.add_argument("--source", required=False, help="Optional path to incoming source JSON (already aggregated)")
    # NEW: accept and tolerate old flag used by workflows
    ap.add_argument("--sectors-dir", required=False, help="(Optional) path to sectors CSV folder; used only if no --source")
    args = ap.parse_args()

    mode = "intraday" if args.mode == "intraday10" else args.mode

    # Load provided source if present; otherwise build safe fallback (with canonical groups if we can)
    src = load_source(args.source)
    if not src:
        # Build a safe scaffold so downstream never crashes
        groups = groups_from_sectors_dir(args.sectors_dir) if args.sectors_dir else safe_groups()
        src = {"metrics": {}, "groups": groups, "sectorCards": []}
        print(f"[warn] No --source provided; using fallback groups from {args.sectors_dir or 'default'}")

    # Normalize by requested mode
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
                  "squeeze_psi_10m_pct:", m.get("squeeze_10m_pct") or m.get("squeeze_psi_10m_pct"),
                  "squeeze_expansion_pct:", m.get("squeeze_expansion_pct"))
    except Exception:
        pass

if __name__ == "__main__":
    main()
