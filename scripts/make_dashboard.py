#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_dashboard.py — compose dashboard payloads (intraday / hourly / eod)

Fixes:
1) 10-minute sectorCards update even if source only has `groups` (nh/nl/u/d).
2) Timestamps shown in Arizona local time (America/Phoenix) with `updated_at_utc` kept.

Inputs:  --source  data/outlook_source.json
Outputs: --out     data/outlook_intraday.json (when --mode intraday)
"""

from __future__ import annotations
import json, sys, os, argparse
from typing import Any, Dict, List
from datetime import datetime, timezone
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
    "staples":"consumer staples","discretionary":"consumer discretionary",
    "finance":"financials","industry":"industrials","reit":"real estate","reits":"real estate",
}
def norm(s:str)->str: return (s or "").strip().lower()
def pct(a: float, b: float) -> float: return 0.0 if b==0 else round(100.0*float(a)/float(b), 2)

def build_sector_cards_from_groups(groups: Dict[str, Any]) -> List[Dict[str, Any]]:
    bucket: Dict[str, Dict[str, Any]] = {}
    for raw, g in (groups or {}).items():
        k = ALIAS.get(norm(raw), norm(raw))
        if not k: continue
        nh = int((g or {}).get("nh", 0)); nl = int((g or {}).get("nl", 0))
        up = int((g or {}).get("u", 0));  dn = int((g or {}).get("d", 0))
        b = pct(nh, nh+nl); m = pct(up, up+dn)
        bucket[k] = {"sector": k.title(), "breadth_pct": b, "momentum_pct": m,
                     "nh": nh, "nl": nl, "up": up, "down": dn}
    rows = [ bucket.get(name, {"sector": name.title(), "breadth_pct": 0.0,
                               "momentum_pct": 0.0, "nh":0,"nl":0,"up":0,"down":0})
             for name in ORDER ]
    return rows

def composite_average(cards: List[Dict[str, Any]], key: str) -> float:
    vals = [float(c.get(key, 0.0)) for c in cards if isinstance(c.get(key), (int,float))]
    return round(sum(vals)/len(vals), 2) if vals else 0.0

def load_json(path: str) -> Dict[str, Any]:
    try: return json.load(open(path,"r",encoding="utf-8"))
    except Exception: return {}

def compose_intraday(src: Dict[str, Any]) -> Dict[str, Any]:
    # 1) sectorCards
    if isinstance(src.get("sectorCards"), list) and src["sectorCards"]:
        sector_cards = src["sectorCards"]
    else:
        sector_cards = build_sector_cards_from_groups(src.get("groups") or {})

    # 2) metrics
    metrics = src.get("metrics") or {}
    breadth_10m = metrics.get("breadth_10m_pct")
    momentum_10m = metrics.get("momentum_10m_pct")
    if not isinstance(breadth_10m,(int,float)) or not isinstance(momentum_10m,(int,float)):
        breadth_10m  = composite_average(sector_cards,"breadth_pct")
        momentum_10m = composite_average(sector_cards,"momentum_pct")

    g = src.get("global") or {}
    squeeze_pct = metrics.get("squeeze_10m_pct") or metrics.get("squeeze_pct")
    if not isinstance(squeeze_pct,(int,float)):
        squeeze_pct = float(g.get("daily_squeeze_pct") or g.get("squeeze_pressure_pct") or 50.0)
    liquidity_psi = metrics.get("liquidity_psi")
    if not isinstance(liquidity_psi,(int,float)):
        liquidity_psi = float(g.get("liquidity_pct") or 70.0)
    volatility_pct = metrics.get("volatility_10m_pct") or metrics.get("volatility_pct")
    if not isinstance(volatility_pct,(int,float)):
        volatility_pct = float(g.get("volatility_pct") or 0.20)

    out_metrics = dict(metrics)
    out_metrics.update({
        "breadth_10m_pct": float(round(breadth_10m,2)),
        "momentum_10m_pct": float(round(momentum_10m,2)),
        "squeeze_pct": float(round(squeeze_pct,2)),
        "liquidity_psi": float(round(liquidity_psi,2)),
        "volatility_pct": float(round(volatility_pct,3)),
    })

    intraday = src.get("intraday") or {}
    intraday.setdefault("overall10m", {"state":"neutral","score":50})

    engine = src.get("engineLights") or {}

    return {
        "version": src.get("version") or "r-intraday-v1",
        "updated_at": now_phx_iso(),      # Arizona local time
        "updated_at_utc": now_utc_iso(),  # UTC
        "mode": "intraday",
        "metrics": out_metrics,
        "intraday": intraday,
        "engineLights": engine,
        "sectorCards": sector_cards,
        "meta": {"last_full_run_utc": now_utc_iso()},
    }

def main():
    ap = argparse.ArgumentParser(description="Compose dashboard payloads.")
    ap.add_argument("--mode", choices=["intraday","hourly","eod"], required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src = load_json(args.source)
    if not src:
        print(f"[error] invalid or missing source: {args.source}", file=sys.stderr); sys.exit(1)

    if args.mode == "intraday":
        out = compose_intraday(src)
    else:
        out = dict(src)
        out["updated_at"] = now_phx_iso()
        out["updated_at_utc"] = now_utc_iso()
        out["mode"] = args.mode

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(out, open(args.out,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    print(f"[ok] wrote {args.out}")
    try:
        cards = out.get("sectorCards") or []
        if cards: print("[cards] sample:", cards[:2])
        m = out.get("metrics") or {}
        print("[metrics] breadth_10m:", m.get("breadth_10m_pct"),
              "momentum_10m:", m.get("momentum_10m_pct"),
              "squeeze_pct:", m.get("squeeze_pct"))
    except Exception:
        pass

if __name__ == "__main__":
    main()
