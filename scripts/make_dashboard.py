#!/usr/bin/env python3
"""
make_dashboard.py — carry real sector counts + Daily/Intraday Squeeze into outlook.json
Adds Breadth/Momentum indexes computed from sector totals.

- Reads data/outlook_source.json
- Writes data/outlook.json with:
  * gauges:
      - rpm.pct  (Breadth 0..100)
      - speed.pct (Momentum 0..100)
      - fuel.pct (Intraday squeeze/pressure)
      - squeezeDaily.pct (Daily squeeze)
      - water.pct (Volatility)
      - oil.psi (Liquidity PSI)
  * odometers: squeezeCompressionPct (intraday = fuel)
  * outlook.sectors: { nh, nl, up, down, netNH, netUD, spark }
  * sectorCards (top-level + nested)
  * summary: { breadthIdx, momentumIdx }
"""

from __future__ import annotations
import argparse, json, os
from datetime import datetime, timezone
from typing import Any, Dict, List

SCHEMA_VERSION = "r1.2"
VERSION_TAG    = "1.2-hourly"

PREFERRED_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def jread(p: str) -> Dict[str, Any]:
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}

def jwrite(p: str, obj: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        # compact, single-line JSON (router/UI don’t need pretty)
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), indent=None)
        f.write("\n")

def norm(s: str) -> str:
    return (s or "").strip().lower()

def title_case(x: str) -> str:
    return " ".join(w.capitalize() for w in (x or "").split())

def canonical_sector(name: str) -> str:
    n = norm(name)
    if n in ("tech", "information technology"): return "information technology"
    if n in ("healthcare",): return "health care"
    return n

def num(v, default=0.0):
    try:
        if v is None: return default
        if isinstance(v, (int, float)): return float(v)
        s = str(v).strip()
        if s == "": return default
        return float(s)
    except:
        return default

# -------- sectors --------

def sectors_from_source(src: Dict[str, Any]) -> Dict[str, Any]:
    # accept any of: outlook.sectors, sectors, groups
    raw = None
    if isinstance(src.get("outlook"), dict) and isinstance(src["outlook"].get("sectors"), dict):
        raw = src["outlook"]["sectors"]
    elif isinstance(src.get("sectors"), dict):
        raw = src["sectors"]
    elif isinstance(src.get("groups"), dict):
        raw = src["groups"]

    out: Dict[str, Any] = {}
    if isinstance(raw, dict):
        for name, vals in raw.items():
            key = canonical_sector(name)
            nh   = int(num((vals or {}).get("nh", (vals or {}).get("nH", 0))))
            nl   = int(num((vals or {}).get("nl", (vals or {}).get("nL", 0))))
            up   = int(num((vals or {}).get("u",  (vals or {}).get("up", 0))))
            down = int(num((vals or {}).get("d",  (vals or {}).get("down", 0))))
            spark = (vals or {}).get("spark", [])
            if not isinstance(spark, list): spark = []
            out[key] = {
                "nh": nh, "nl": nl, "up": up, "down": down,
                "netNH": nh - nl, "netUD": up - down, "spark": spark
            }

    # normalize to 11 canonical sectors
    for k in PREFERRED_ORDER:
        if k not in out:
            out[k] = {"nh":0,"nl":0,"up":0,"down":0,"netNH":0,"netUD":0,"spark":[]}
    return out

# -------- gauges / squeeze --------

def pick(d: Dict[str, Any], *keys, default=None):
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return default

def build_gauges_and_odometers(src: Dict[str, Any], sectors: Dict[str, Any], mode: str) -> Dict[str, Any]:
    g = src.get("global", {}) or {}

    # Read BOTH snake_case and camelCase keys (builder variants)
    fuel      = num(pick(g, "squeeze_pressure_pct", "squeezePressurePct", default=50))
    daily_sq  = pick(g, "daily_squeeze_pct", "squeeze_daily_pct", "squeezeDailyPct", default=None)
    if daily_sq is not None:
        daily_sq = num(daily_sq, None)
    vol_pct   = num(pick(g, "volatility_pct", "volatilityPct", default=50))
    liq_pct   = num(pick(g, "liquidity_pct", "liquidityPct", default=70))

    # ---- Breadth/Momentum from sector totals ----
    tot_nh = sum(int(num(v.get("nh",0)))   for v in sectors.values())
    tot_nl = sum(int(num(v.get("nl",0)))   for v in sectors.values())
    tot_up = sum(int(num(v.get("up",0)))   for v in sectors.values())
    tot_dn = sum(int(num(v.get("down",0))) for v in sectors.values())

    def ratio_idx(pos, neg):
        s = float(pos) + float(neg)
        return 50.0 if s <= 0 else 50.0 + 50.0 * ((float(pos) - float(neg)) / s)

    breadthIdx  = ratio_idx(tot_up, tot_dn)   # breadth as Up/(Up+Down)
    momentumIdx = ratio_idx(tot_nh, tot_nl)   # momentum as NH/(NH+NL)

    gauges = {
        "rpm":   {"pct": float(breadthIdx),  "label":"Breadth"},
        "speed": {"pct": float(momentumIdx), "label":"Momentum"},
        "fuel":  {"pct": float(fuel), "state": ("firingUp" if float(fuel) >= 70 else "idle"), "label":"Squeeze"},
        "water": {"pct": float(vol_pct), "label":"Volatility"},
        "oil":   {"psi": float(liq_pct), "label":"Liquidity"},
    }
    if daily_sq is not None:
        gauges["squeezeDaily"] = {"pct": float(daily_sq)}

    odometers = {"squeezeCompressionPct": float(fuel)}  # intraday

    summary = {"breadthIdx": float(breadthIdx), "momentumIdx": float(momentumIdx)}
    return {"gauges": gauges, "odometers": odometers, "summary": summary}

# -------- cards --------

def cards_from_sectors(sectors: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    for key in PREFERRED_ORDER:
        vals = sectors.get(key, {})
        net = int(num(vals.get("netNH", 0)))
        outlook = "Neutral"
        if net > 0: outlook = "Bullish"
        if net < 0: outlook = "Bearish"
        spark = vals.get("spark", [])
        if not isinstance(spark, list): spark = []
        cards.append({
            "sector": title_case(key),
            "outlook": outlook,
            "spark": spark
        })
    return cards

# -------- main --------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--mode",   default="intraday", choices=["intraday","daily","eod"])
    args = ap.parse_args()

    src = jread(args.source)
    ts  = now_iso()  # always fresh

    sectors = sectors_from_source(src)
    gz_od   = build_gauges_and_odometers(src, sectors, args.mode)
    cards   = cards_from_sectors(sectors)

    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts,
        "ts": ts,
        "version": VERSION_TAG,
        "pipeline": args.mode,
        **gz_od,                      # gauges + odometers + summary
        "sectorCards": cards,         # legacy
        "outlook": {
            "sectors": sectors,
            "sectorCards": cards
        },
        "signals": {}                 # router computes real signals
    }

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | cards={len(cards)}")
    print(f"[summary] breadthIdx={out['summary']['breadthIdx']:.1f} momentumIdx={out['summary']['momentumIdx']:.1f}")

if __name__ == "__main__":
    main()
