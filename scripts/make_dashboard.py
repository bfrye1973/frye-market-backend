#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_dashboard.py — compose dashboard payloads (intraday/hourly/eod)
- Always stamps updated_at (AZ) + updated_at_utc (UTC)
- Ensures 11 canonical sectorCards
- Normalizes intraday metric names
"""

from __future__ import annotations
import json, sys, os, argparse
from typing import Any, Dict, List
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PHX = ZoneInfo("America/Phoenix")
UTC = timezone.utc

def now_phx() -> str:
    return datetime.now(PHX).replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")

def now_utc() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00","Z")

ORDER = [
    "Information Technology","Materials","Health Care","Communication Services",
    "Real Estate","Energy","Consumer Staples","Consumer Discretionary",
    "Financials","Utilities","Industrials"
]

def ensure_cards(source: Dict[str,Any]) -> List[Dict[str,Any]]:
    if isinstance(source.get("sectorCards"), list) and source["sectorCards"]:
        cards = source["sectorCards"]
    else:
        cards = []
        groups = source.get("groups") or {}
        for name in ORDER:
            g = groups.get(name) or {}
            nh = int(g.get("nh",0)); nl=int(g.get("nl",0)); up=int(g.get("u",0)); dn=int(g.get("d",0))
            b  = 0.0 if nh+nl==0 else round(100.0*nh/(nh+nl),2)
            m  = 0.0 if up+dn==0 else round(100.0*up/(up+dn),2)
            cards.append({"sector":name,"breadth_pct":b,"momentum_pct":m,"nh":nh,"nl":nl,"up":up,"down":dn})
    # canonicalize length
    have = {c["sector"] for c in cards}
    for name in ORDER:
        if name not in have:
            cards.append({"sector":name,"breadth_pct":0.0,"momentum_pct":0.0,"nh":0,"nl":0,"up":0,"down":0})
    # keep order
    key = {n:i for i,n in enumerate(ORDER)}
    cards.sort(key=lambda c:key.get(c["sector"], 999))
    return cards

def compose_intraday(src: Dict[str,Any]) -> Dict[str,Any]:
    cards = ensure_cards(src)
    m_in  = dict(src.get("metrics") or {})
    out   = dict(src)

    def coalesce(*vals):
        for v in vals:
            if isinstance(v,(int,float)) and v==v: return float(v)
        return None

    breadth  = coalesce(m_in.get("breadth_10m_pct"), m_in.get("breadth_pct"))
    if breadth is None:
        breadth = sum(c["breadth_pct"] for c in cards)/len(cards) if cards else 50.0
    momentum = coalesce(m_in.get("momentum_10m_pct"), m_in.get("momentum_pct"), 50.0)
    psi      = coalesce(m_in.get("squeeze_psi_10m_pct"), 50.0)
    liq      = coalesce(m_in.get("liquidity_psi"), 70.0)
    vol      = coalesce(m_in.get("volatility_pct"), 0.20)
    ema_sign = int(m_in.get("ema_sign") or 0)
    ema_gap  = coalesce(m_in.get("ema_gap_pct"), 0.0)

    m_out = dict(m_in)
    m_out["breadth_10m_pct"]       = round(breadth, 2)
    m_out["momentum_10m_pct"]      = round(momentum, 2)
    m_out["squeeze_psi_10m_pct"]   = round(psi, 2)
    m_out["squeeze_expansion_pct"] = round(100.0-psi, 2)
    m_out["squeeze_pct"]           = m_out["squeeze_expansion_pct"]  # tile uses expansion
    m_out["liquidity_psi"]         = round(liq, 2)
    m_out["volatility_pct"]        = round(vol, 3)
    m_out["ema_sign"]              = ema_sign
    m_out["ema_gap_pct"]           = round(ema_gap, 2)

    out["metrics"] = m_out
    out["sectorCards"] = cards
    out["updated_at"] = now_phx()
    out["updated_at_utc"] = now_utc()
    out["mode"] = "intraday"
    return out

def compose_hourly(src: Dict[str,Any]) -> Dict[str,Any]:
    out = dict(src)
    out["updated_at"] = now_phx()
    out["updated_at_utc"] = now_utc()
    out["mode"] = "hourly"
    return out

def compose_eod(src: Dict[str,Any]) -> Dict[str,Any]:
    out = dict(src)
    out["updated_at"] = now_phx()
    out["updated_at_utc"] = now_utc()
    out["mode"] = "eod"
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["intraday","hourly","eod"], required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    try:
        src = json.load(open(args.source,"r",encoding="utf-8"))
    except Exception as e:
        print("[error] read source:", e); sys.exit(1)

    if args.mode == "intraday":
        out = compose_intraday(src)
    elif args.mode == "hourly":
        out = compose_hourly(src)
    else:
        out = compose_eod(src)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(out, open(args.out,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    print("[ok] wrote", args.out, "mode:", args.mode)

if __name__ == "__main__":
    main()
