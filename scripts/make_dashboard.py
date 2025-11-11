#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_dashboard.py — compose dashboard payloads (intraday / hourly / eod)

Enhancements:
1) 10-minute sectorCards: build from groups (nh/nl/u/d) if needed.
2) Compute Sector Direction (rising%) from sectorCards (fallback to ETF alignment).
3) Compute Risk-On % from sectorCards (offense > 50 + defense < 50).
4) Normalize/compute squeeze (PSI → expansion%) and export both tightness & expansion.
5) Compute Overall(10m) as weighted composite (EMA, Momentum, Breadth, Expansion, Liquidity, Risk-On).
6) Arizona (America/Phoenix) timestamps + UTC mirror.

Inputs:  --source  data/outlook_source.json
Outputs: --out     data/outlook_intraday.json (when --mode intraday)
"""

from __future__ import annotations
import json, sys, os, argparse
from typing import Any, Dict, List, Optional
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

OFFENSIVE = {"information technology","communication services","consumer discretionary"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

def norm(s:str)->str:
    return (s or "").strip().lower()

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else round(100.0 * float(a) / float(b), 2)

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def load_json(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def build_sector_cards_from_groups(groups: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build 11 normalized sector cards from a groups {sector: {nh,nl,u,d}} source."""
    bucket: Dict[str, Dict[str, Any]] = {}
    for raw, g in (groups or {}).items():
        k = ALIAS.get(norm(raw), norm(raw))
        if not k:
            continue
        nh = int((g or {}).get("nh", 0)); nl = int((g or {}).get("nl", 0))
        up = int((g or {}).get("u", 0));  dn = int((g or {}).get("d", 0))
        b = pct(nh, nh + nl); m = pct(up, up + dn)
        bucket[k] = {
            "sector": k.title(),
            "breadth_pct": b,
            "momentum_pct": m,
            "nh": nh, "nl": nl, "up": up, "down": dn,
        }

    rows: List[Dict[str, Any]] = []
    for name in ORDER:
        rows.append(
            bucket.get(name, {
                "sector": name.title(), "breadth_pct": 0.0, "momentum_pct": 0.0,
                "nh":0,"nl":0,"up":0,"down":0
            })
        )
    return rows

def coalesce(*vals):
    for v in vals:
        if isinstance(v, (int, float)) and v == v:  # not NaN
            return float(v)
        if v is not None and isinstance(v, (int, float)):
            return float(v)
    return None

def composite_avg(cards: List[Dict[str, Any]], key: str) -> float:
    xs = [coalesce(c.get(key)) for c in cards if isinstance(c.get(key), (int, float))]
    xs = [x for x in xs if x is not None]
    return round(sum(xs)/len(xs), 2) if xs else 0.0

def compute_sector_rising_pct(cards: List[Dict[str, Any]], etf_align: Optional[float]) -> float:
    """Return % of sectors with breadth_pct > 50; fallback to ETF alignment; else 50."""
    if cards:
        valid = [c for c in cards if isinstance(c.get("breadth_pct"), (int, float))]
        if valid:
            rising = sum(1 for c in valid if c.get("breadth_pct", 0) > 50.0)
            return pct(rising, len(valid))
    if etf_align is not None:
        return float(etf_align)
    return 50.0

def compute_risk_on_pct(cards: List[Dict[str, Any]]) -> float:
    """Compute offense>50 + defense<50 as % of considered sectors."""
    if not cards:
        return 50.0
    by = {norm(c.get("sector", "")): c for c in cards}
    off, den = 0, 0
    for s in OFFENSIVE:
        c = by.get(s)
        if c and isinstance(c.get("breadth_pct"), (int, float)):
            den += 1
            if c["breadth_pct"] > 50.0:
                off += 1
    for s in DEFENSIVE:
        c = by.get(s)
        if c and isinstance(c.get("breadth_pct"), (int, float)):
            den += 1
            if c["breadth_pct"] < 50.0:
                off += 1
    return pct(off, den) if den > 0 else 50.0

def compute_ema_score(ema_sign: float, ema_gap_pct: float) -> float:
    """
    Convert EMA posture to a 0..100 score:
    - ema_sign = +1 bull, -1 bear, 0 neutral
    - scaled by |ema_gap| / 0.60 (capped at 1)
    """
    mag = clamp(abs(ema_gap_pct) / 0.60, 0.0, 1.0)
    return clamp(50.0 + 50.0 * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0) * mag, 0.0, 100.0)

def compose_intraday(src: Dict[str, Any]) -> Dict[str, Any]:
    # 1) Sector cards (always 11 rows, build from groups if missing)
    cards_src = src.get("sectorCards")
    if isinstance(cards_src, list) and cards_src:
        sector_cards = cards_src
    else:
        sector_cards = build_sector_cards_from_groups(src.get("groups") or {})

    # 2) Metrics — normalize and compute missing
    m = dict(src.get("metrics") or {})
    g = src.get("global") or {}

    breadth_10m = coalesce(
        m.get("breadth_10m_pct"),
        composite_avg(sector_cards, "breadth_pct")
    )
    momentum_10m = coalesce(
        m.get("momentum_10m_pct"),
        composite_avg(sector_cards, "momentum_pct")
    )

    # Squeeze: prefer expansion%; compute from PSI if needed
    psi_10m = coalesce(
        m.get("squeeze_psi_10m_pct"),
        m.get("squeeze_psi_10m"),
        m.get("squeeze_psi")  # optional legacy
    )
    expansion_10m = coalesce(
        m.get("squeeze_expansion_pct"),
        (100.0 - psi_10m) if psi_10m is not None else None,
        m.get("squeeze_pct")  # last-resort fallback
    )
    if expansion_10m is None:
        expansion_10m = 50.0  # neutral

    # Liquidity & Volatility (ensure present)
    liquidity_psi = coalesce(m.get("liquidity_psi"), g.get("liquidity_pct"), 70.0)
    volatility_pct = coalesce(m.get("volatility_pct"), m.get("volatility_10m_pct"), 0.20)

    # EMA posture (sign + gap pct)
    ema_sign = int(m.get("ema_sign") or 0)
    ema_gap_pct = float(m.get("ema_gap_pct") or 0.0)
    ema_score = compute_ema_score(ema_sign, ema_gap_pct)

    # 3) Risk-On and Sector Direction (rising%)
    align_fast = coalesce(m.get("breadth_align_fast_pct"), m.get("breadth_align_10m_pct"))
    rising_pct = compute_sector_rising_pct(sector_cards, align_fast)

    risk_on_pct = compute_risk_on_pct(sector_cards)

    # 4) Composite Overall(10m) with weights
    # Normalize liquidity to 0..100 for scoring (PSI typically 0..120)
    liquidity_pct = clamp((liquidity_psi / 120.0) * 100.0, 0.0, 100.0)
    mom_pct = clamp(float(momentum_10m or 50.0), 0.0, 100.0)
    br_pct  = clamp(float(breadth_10m or 50.0), 0.0, 100.0)
    exp_pct = clamp(float(expansion_10m or 50.0), 0.0, 100.0)
    risk_pct = clamp(float(risk_on_pct or 50.0), 0.0, 100.0)

    score = int(round(
        0.40 * ema_score +
        0.25 * mom_pct +
        0.10 * br_pct +
        0.10 * exp_pct +
        0.10 * liquidity_pct +
        0.05 * risk_pct
    ))

    state = "neutral"
    if score >= 60 and ema_sign > 0:
        state = "bull"
    elif score <= 40 and ema_sign < 0:
        state = "bear"

    # 5) Prepare metrics out (preserve + normalize names)
    out_metrics = dict(m)
    out_metrics["breadth_10m_pct"]       = breadth_10m
    out_metrics["momentum_10m_pct"]      = mom_pct
    out_metrics["liquidity_psi"]         = liquidity_psi
    out_metrics["volatility_pct"]        = volatility_pct
    out_metrics["squeeze_psi_10m_pct"]   = psi_10m if psi_10m is not None else out_metrics.get("squeeze_psi_10m_pct")
    out_metrics["squeeze_expansion_pct"] = exp_pct
    out_metrics["squeeze_pct"]           = exp_pct  # tile reads expansion now

    # 6) Intraday object
    intraday = dict(src.get("intraday") or {})
    intraday["sectorDirection10m"] = {"risingPct": rising_pct}
    intraday["riskOn10m"]          = {"riskOnPct": risk_on_pct}
    intraday["overall10m"] = {
        "state": state,
        "score": score,
        "components": {
            "ema10":    int(round(0.40 * ema_score)),
            "momentum": int(round(0.25 * mom_pct)),
            "breadth":  int(round(0.10 * br_pct)),
            "squeeze":  int(round(0.10 * exp_pct)),
            "liquidity":int(round(0.10 * liquidity_pct)),
            "riskOn":   int(round(0.05 * risk_pct)),
        }
    }

    # 7) Engine lights passthrough
    engine = src.get("engineLights") or {}

    # 8) Final output
    return {
        "version": src.get("version") or "r-intraday-v2",
        "updated_at": now_phx_iso(),
        "updated_at_utc": now_utc_iso(),
        "timestamp": now_utc_iso(),
        "mode": "intraday",
        "metrics": out_metrics,
        "intraday": intraday,
        "engineLights": engine,
        "sectorCards": sector_cards,
        "meta": {"last_full_run_utc": now_utc_iso()},
    }

def compose_passthrough(src: Dict[str, Any], mode: str) -> Dict[str, Any]:
    """For hourly/eod: pass through source, just stamp timestamps."""
    out = dict(src)
    out["updated_at"] = now_phx_iso()
    out["updated_at_utc"] = now_utc_iso()
    out["mode"] = mode
    return out

def main():
    ap = argparse.ArgumentParser(description="Compose dashboard payloads.")
    ap.add_argument("--mode", choices=["intraday","hourly","eod"], required=True)
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    src = load_json(args.source)
    if not src:
        print(f"[error] invalid or missing source: {args.source}", file=sys.stderr)
        sys.exit(1)

    if args.mode == "intraday":
        out = compose_intraday(src)
    else:
        out = compose_passthrough(src, args.mode)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    print(f"[ok] wrote {args.out}")
    try:
        m = out.get("metrics", {})
        print("[metrics] breadth_10m:", m.get("breadth_10m_pct"),
              "momentum_10m:", m.get("momentum_10m_pct"),
              "squeeze_expansion_pct:", m.get("squeeze_expansion_pct"),
              "liquidity_psi:", m.get("liquidity_psi"))
        print("[intraday] sectorDirection10m.risingPct:", out.get("intraday",{}).get("sectorDirection10m",{}).get("risingPct"))
        print("[intraday] riskOn10m.riskOnPct:", out.get("intraday",{}).get("riskOn10m",{}).get("riskOnPct"))
        print("[intraday] overall10m:", out.get("intraday",{}).get("overall10m"))
    except Exception as e:
        print("[debug error]", e, file=sys.stderr)

if __name__ == "__main__":
    main()
