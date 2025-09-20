#!/usr/bin/env python3
"""
make_dashboard.py — carry real sector counts + Daily/Intraday Squeeze into outlook.json
Adds Breadth/Momentum indexes computed from sector totals.

- Reads  data/outlook_source.json
- Writes data/outlook.json with:
  * gauges:
      - rpm.pct            (Breadth 0..100)
      - speed.pct          (Momentum 0..100)
      - fuel.pct           (Intraday squeeze/pressure)
      - squeezeDaily.pct   (Daily squeeze)
      - water.pct          (Volatility)
      - oil.psi            (Liquidity PSI)
  * odometers: squeezeCompressionPct (intraday = fuel)
  * outlook.sectors: { nh, nl, up, down, netNH, netUD, spark }
  * sectorCards (top-level + nested)
  * summary: { breadthIdx, momentumIdx }
  * engineLights: { updatedAt, mode, live, signals{...} }
  * intraday.sectorDirection10m: { risingCount, risingPct, updatedAt }       (intraday)
  * intraday.riskOn10m:         { riskOnPct, updatedAt }                      (intraday)
  * trendDaily: {..., updatedAt, mode, live:false }                            (daily/eod)
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

OFFENSIVE = {"information technology","consumer discretionary","communication services"}
DEFENSIVE = {"consumer staples","utilities","health care"}

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

    fuel      = num(pick(g, "squeeze_pressure_pct", "squeezePressurePct", default=50))
    daily_sq  = pick(g, "daily_squeeze_pct", "squeeze_daily_pct", "squeezeDailyPct", default=None)
    if daily_sq is not None:
        daily_sq = num(daily_sq, None)
    vol_pct   = num(pick(g, "volatility_pct", "volatilityPct", default=50))
    liq_pct   = num(pick(g, "liquidity_pct", "liquidityPct", default=70))

    tot_nh = sum(int(num(v.get("nh",0)))   for v in sectors.values())
    tot_nl = sum(int(num(v.get("nl",0)))   for v in sectors.values())
    tot_up = sum(int(num(v.get("up",0)))   for v in sectors.values())
    tot_dn = sum(int(num(v.get("down",0))) for v in sectors.values())

    def ratio_idx(pos, neg):
        s = float(pos) + float(neg)
        return 50.0 if s <= 0 else 50.0 + 50.0 * ((float(pos) - float(neg)) / s)

    breadthIdx  = ratio_idx(tot_up, tot_dn)   # % advancers (Breadth)
    momentumIdx = ratio_idx(tot_nh, tot_nl)   # % new highs (Momentum)

    gauges = {
        "rpm":   {"pct": float(breadthIdx),  "label":"Breadth"},
        "speed": {"pct": float(momentumIdx), "label":"Momentum"},
        "fuel":  {"pct": float(fuel), "state": ("firingUp" if float(fuel) >= 70 else "idle"), "label":"Squeeze"},
        "water": {"pct": float(vol_pct), "label":"Volatility"},
        "oil":   {"psi": float(liq_pct), "label":"Liquidity"},
    }
    if daily_sq is not None:
        gauges["squeezeDaily"] = {"pct": float(daily_sq)}

    odometers = {"squeezeCompressionPct": float(fuel)}
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

# -------- engine lights defaults --------
def default_signals() -> Dict[str, Any]:
    keys = [
        "sigBreakout", "sigDistribution", "sigCompression", "sigExpansion",
        "sigOverheat", "sigTurbo", "sigDivergence", "sigLowLiquidity", "sigVolatilityHigh"
    ]
    return { k: {"active": False, "severity": "info"} for k in keys }

# -------- trendDaily (daily/eod) --------
def build_trend_daily(src: Dict[str, Any], sectors: Dict[str, Any], gauges: Dict[str, Any], ts: str) -> Dict[str, Any]:
    # Participation: % sectors with netNH > 0 (proxy)
    pos_sectors = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k, {}).get("netNH", 0))) > 0)
    participation_pct = (pos_sectors / float(len(PREFERRED_ORDER))) * 100.0

    # Trend proxy from breadth & momentum (no price series here)
    b = float(num(gauges.get("rpm", {}).get("pct", 50)))
    m = float(num(gauges.get("speed", {}).get("pct", 50)))
    trend_score = 0.5 * b + 0.5 * m
    if trend_score > 55: trend_state = "up"
    elif trend_score < 45: trend_state = "down"
    else: trend_state = "flat"

    sdy = gauges.get("squeezeDaily", {})
    sdy_pct = float(num(sdy.get("pct", None), None)) if sdy else None

    vol_pct = float(num(gauges.get("water", {}).get("pct", 0)))
    if vol_pct < 30: vol_band = "calm"
    elif vol_pct <= 60: vol_band = "elevated"
    else: vol_band = "high"

    liq_psi = float(num(gauges.get("oil", {}).get("psi", 0)))
    if liq_psi >= 60: liq_band = "good"
    elif liq_psi >= 50: liq_band = "normal"
    elif liq_psi >= 40: liq_band = "light"
    else: liq_band = "thin"

    # Rotation: % of offensive outperforming defensives (proxy: netNH>0)
    off_pos = sum(1 for s in OFFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
    def_pos = sum(1 for s in DEFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
    denom = off_pos + def_pos
    risk_on_pct = (off_pos / denom) * 100.0 if denom > 0 else 50.0

    td = {
        "trend":            { "emaSlope": round(trend_score - 50, 1), "state": trend_state },
        "participation":    { "pctAboveMA": round(participation_pct, 1) },
        "squeezeDaily":     { "pct": round(sdy_pct, 2) if sdy_pct is not None else None },
        "volatilityRegime": { "atrPct": round(vol_pct, 1), "band": vol_band },
        "liquidityRegime":  { "psi": round(liq_psi, 1), "band": liq_band },
        "rotation":         { "riskOnPct": round(risk_on_pct, 1) },
        "updatedAt":        ts,
        "mode":             "daily",
        "live":             False
    }
    return td

# -------- main --------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--mode",   default="intraday", choices=["intraday","daily","eod"])
    args = ap.parse_args()

    src = jread(args.source)
    ts  = now_iso()

    sectors = sectors_from_source(src)
    gz_od   = build_gauges_and_odometers(src, sectors, args.mode)
    cards   = cards_from_sectors(sectors)

    # --- Sector Direction (10m) + RiskOn10m (intraday only) ---
    intraday_block = None
    if args.mode == "intraday":
        rising_count = 0
        total_sectors = len(PREFERRED_ORDER)
        for k in PREFERRED_ORDER:
            vals = sectors.get(k, {})
            net_nh = int(num(vals.get("netNH", 0)))
            if net_nh > 0:
                rising_count += 1
        rising_pct = (rising_count / total_sectors) * 100.0

        # Risk-On 10m (proxy): % of OFFENSIVE sectors with netNH > 0 vs OFFENSIVE+DEFENSIVE
        off_pos = sum(1 for s in OFFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
        def_pos = sum(1 for s in DEFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
        denom = off_pos + def_pos
        risk_on_10m = (off_pos / denom) * 100.0 if denom > 0 else 50.0

        intraday_block = {
            "sectorDirection10m": {
                "risingCount": int(rising_count),
                "risingPct": round(rising_pct, 1),
                "updatedAt": ts
            },
            "riskOn10m": {
                "riskOnPct": round(risk_on_10m, 1),
                "updatedAt": ts
            }
        }

    # Engine Lights: defaults + upstream overrides
    upstream_signals = {}
    if isinstance(src.get("signals"), dict):
        upstream_signals = src["signals"]
    elif isinstance(src.get("engineLights"), dict) and isinstance(src["engineLights"].get("signals"), dict):
        upstream_signals = src["engineLights"]["signals"]

    signals = default_signals()
    for k, v in (upstream_signals or {}).items():
        if isinstance(v, dict):
            signals[k] = {**signals.get(k, {"active": False, "severity": "info"}), **v}

    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts,
        "ts": ts,
        "version": VERSION_TAG,
        "pipeline": args.mode,
        **gz_od,
        "sectorCards": cards,
        "outlook": {
            "sectors": sectors,
            "sectorCards": cards
        },
        "engineLights": {
            "updatedAt": ts,
            "mode": args.mode,
            "live": (args.mode == "intraday"),
            "signals": signals
        }
    }

    if intraday_block:
        out["intraday"] = intraday_block

    if args.mode in ("daily", "eod"):
        out["trendDaily"] = build_trend_daily(src, sectors, gz_od["gauges"], ts)

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | cards={len(cards)} | mode={args.mode}")
    print(f"[summary] breadthIdx={out['summary']['breadthIdx']:.1f} momentumIdx={out['summary']['momentumIdx']:.1f}")

if __name__ == "__main__":
    main()
