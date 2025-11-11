#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — build_outlook_source_from_polygon.py (normalized R11.1)

Goals:
- Build outlook source for intraday/hourly/eod.
- Normalize intraday metric keys for the new dashboard schema:
  * breadth_10m_pct       (0..100)
  * momentum_10m_pct      (0..100)
  * squeeze_psi_10m_pct   (0..100 tightness)
  * squeeze_expansion_pct (0..100 computed as 100-psi)
  * squeeze_pct           (== expansion, for tile)
  * liquidity_psi         (0..120)
  * volatility_pct        (0..100)
  * ema_sign              (+1/-1/0)
  * ema_gap_pct           (percent delta between EMA10 and EMA20)
  * breadth_align_fast_pct (from ETF alignment if available)

Also stamps:
- updated_at  (America/Phoenix)
- updated_at_utc (UTC)
- mode ("intraday" / "hourly" / "eod")

Sector cards:
- Always return 11 canonical sectors; if no "sectorCards" present in source,
  derive from "groups" (nh/nl/u/d) -> {breadth_pct, momentum_pct}.
"""

from __future__ import annotations
import argparse, json, os, math, time
from datetime import datetime, timezone, date
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

PHX = ZoneInfo("America/Phoenix")
UTC = timezone.utc

def now_phx_iso() -> str:
    return datetime.now(PHX).replace(microsecond=0).isoformat(sep=' ')

def now_utc_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace('+00:00','Z')

ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

ALIAS = {
    "healthcare":"health care","health-care":"health care",
    "info tech":"information technology","technology":"information technology","tech":"information technology",
    "communications":"communication services","comm":"communication services","telecom":"communication services",
    "staples":"consumer staples","consumer staples":"consumer staples",
    "discretionary":"consumer discretionary","consumer discretionary":"consumer discretionary",
    "finance":"financials","industrials":"industrials","industry":"industrials","reit":"real estate","reits":"real estate",
}

def norm(s:str) -> str:
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

def build_sector_cards_from_groups(groups: Dict[str, Any]) -> List[Dict[str, Any]]:
    by: Dict[str, Dict[str, Any]] = {}
    for raw, g in (groups or {}).items():
        k = ALIAS.get(norm(raw), norm(raw))
        if not k:
            continue
        nh = int((g or {}).get("nh", 0)); nl = int((g or {}).get("nl", 0))
        up = int((g or {}).get("u", 0));  dn = int((g or {}).get("d", 0))
        b  = pct(nh, nh + nl)
        m  = pct(up, up + dn)
        by[k] = {"sector": k.title(), "breadth_pct": b, "momentum_pct": m, "nh": nh, "nl": nl, "up": up, "down": dn}

    cards = []
    for key in ORDER:
        cards.append(
            by.get(key, {
                "sector": key.title(),
                "breadth_pct": 0.0, "momentum_pct": 0.0,
                "nh":0,"nl":0,"up":0,"down":0
            })
        )
    return cards

def normalize_intraday(source: Dict[str, Any]) -> Dict[str, Any]:
    # 1) Sector cards (make sure we have 11 canonical entries)
    if isinstance(source.get("sectorCards"), list) and source["sectorCards"]:
        cards = source["sectorCards"]
    else:
        cards = build_sector_cards_from_groups(source.get("groups") or {})

    # 2) Gather metrics from source, normalize names.
    s_metrics = dict(source.get("metrics") or {})

    # Standardized field names for 10m
    breadth_10m   = coalesce(
        s_metrics.get("breadth_10m_pct"),
        s_metrics.get("breadth_pct"),   # legacy
        # optional derived fallback from cards:
        pct(sum(1 for c in cards if c.get("breadth_pct",0) > 0), len(cards)) if cards else None
    )

    momentum_10m  = coalesce(
        s_metrics.get("momentum_10m_pct"),
        s_metrics.get("momentum_pct")   # legacy
    )

    # We prefer expansion% for squeeze (green=expanded).
    # If you only have PSI/tightness, invert:
    psi_10m = coalesce(
        s_metrics.get("squeeze_psi_10m_pct"),
        s_metrics.get("squeeze_psi_10m"),
        s_metrics.get("squeeze_pct"),   # if currently tightness
        s_metrics.get("lux10m_squeezePct")  # if using a Lux field
    )
    expansion_10m = coalesce(s_metrics.get("squeeze_expansion_pct"),
                             (100.0 - psi_10m) if psi_10m is not None else None)

    liquidity_psi = coalesce(s_metrics.get("liquidity_psi"), s_metrics.get("liquidity_10m"), 70.0)
    volatility_pct= coalesce(s_metrics.get("volatility_pct"), s_metrics.get("volatility_10m_pct"), 0.20)

    ema_sign      = int(s_metrics.get("ema_sign") or 0)
    ema_gap_pct   = coalesce(s_metrics.get("ema_gap_pct"), 0.0)
    align_fast    = coalesce(s_metrics.get("breadth_align_fast_pct"), s_metrics.get("breadth_align_ih_pct"))

    # Build final metrics block
    metrics_out = dict(s_metrics)
    if breadth_10m is not None:
        metrics_out["breadth_10m_pct"] = float(round(breadth_10m,2))
    if momentum_10m is not None:
        metrics_out["momentum_10m_pct"] = float(round(momentum_10m,2))
    if psi_10m is not None:
        metrics_out["squeeze_psi_10m_pct"] = float(round(psi_10m,2))
        if expansion_10m is None:
            expansion_10m = 100.0 - psi_10m
    if expansion_10m is not None:
        metrics_out["squeeze_expansion_pct"] = float(round(expansion_10m,2))
        metrics_out["squeeze_pct"] = metrics_out["squeeze_expansion_pct"]  # for tile
    if liquidity_psi is not None:
        metrics_out["liquidity_psi"] = float(round(liquidity_psi,2))
    if volatility_pct is not None:
        metrics_out["volatility_pct"] = float(round(volatility_pct,3))
    metrics_out["ema_sign"] = ema_sign
    metrics_out["ema_gap_pct"] = float(ema_gap_pct or 0.0)
    if align_fast is not None:
        metrics_out["breadth_align_fast_pct"] = float(round(align_fast, 2))

    # Optionally add simple derived sectorDirection10m/riskOn10m here,
    # but the final computation happens in the dashboard layer too.

    return {
        "version": source.get("version","r-intraday-v1"),
        "updated_at": now_phx_iso(),
        "updated_at_utc": now_utc_iso(),
        "mode": "intraday",
        "metrics": metrics_out,
        "intraday": source.get("intraday") or {},
        "sectorCards": cards,
        "meta": {"last_full_run_utc": now_utc_iso()}
    }

def normalize_hourly(source: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(source)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = "hourly"
    # Optional: Add squeeze_1h_pct = 100 - squeeze_psi_1h if only PSI is present
    m = out.get("metrics") or {}
    psi = coalesce(m.get("squeeze_psi_1h"), m.get("squeeze_psi"))
    if psi is not None:
        exp = 100.0 - psi
        m["squeeze_1h_pct"] = float(round(exp, 2))
        m["squeeze_expansion_1h_pct"] = float(round(exp, 2))
    out["metrics"] = m
    return out

def normalize_eod(source: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(source)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = "eod"
    return out

def main():
    ap = argparse.ArgumentParser(description="Build normalized outlook source for dashboard feeds.")
    ap.add_argument("--mode", choices=["intraday","hourly","eod"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--source", required=True)
    args = ap.parse_args()

    src = {}
    try:
        with open(args.source, "r", encoding="utf-8") as f:
            src = json.load(f)
    except Exception as e:
        print("[error] failed to read source:", e, flush=True)
        raise SystemExit(1)

    if args.mode == "intraday":
        out = normalize_intraday(src)
    elif args.mode == "hourly":
        out = normalize_hourly(src)
    else:
        out = normalize_eod(src)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    # Friendly logs for QA
    try:
        print("[ok] wrote:", args.out, "mode:", args.mode)
        if args.mode == "intraday":
            m = out.get("metrics", {})
            print("breadth_10m_pct:", m.get("breadth_10m_pct"), 
                  "momentum_10m_pct:", m.get("momentum_10m_pct"),
                  "squeeze_psi_10m_pct:", m.get("squeeze_psi_10m_pct"),
                  "squeeze_expansion_pct:", m.get("squeeze_expansion_pct"),
                  "breadth_align_fast_pct:", m.get("breadth_align_fast_pct"))
    except Exception:
        pass

if __name__ == "__main__":
    main()
