#!/usr/bin/env python3
"""
make_dashboard.py (R1.5)

- Reads:  data/outlook_source.json (from R7 builder)
- Writes: data/outlook_intraday.json (intraday mode), data/outlook_hourly.json (hourly), data/outlook.json (daily/eod)

Adds:
- summary.adrMomentumIdx (global ADR momentum % from source)
- gauges.speedAdr (optional ADR momentum gauge) when available
"""
from __future__ import annotations
import argparse, json, os, math
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
import urllib.request

SCHEMA_VERSION = "r1.2"
VERSION_TAG    = "1.2-hourly"

PREFERRED_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

OFFENSIVE = {"information technology","consumer discretionary","communication services"}
DEFENSIVE = {"consumer staples","utilities","health care"}

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")

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

def norm(s: str) -> str: return (s or "").strip().lower()
def title_case(x: str) -> str: return " ".join(w.capitalize() for w in (x or "").split())

def canonical_sector(name: str) -> str:
    n = norm(name)
    if n in ("tech","information technology"): return "information technology"
    if n in ("healthcare",): return "health care"
    return n

def num(v, default=0.0):
    try:
        if v is None: return default
        if isinstance(v,(int,float)): return float(v)
        s=str(v).strip();  return default if s=="" else float(s)
    except: return default

def pick(d: Dict[str,Any], *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return default

# ---------- sectors ----------
def sectors_from_source(src: Dict[str, Any]) -> Dict[str, Any]:
    raw=None
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
            nh=int(num((vals or {}).get("nh",0))); nl=int(num((vals or {}).get("nl",0)))
            up=int(num((vals or {}).get("u",0)));  dn=int(num((vals or {}).get("d",0)))
            adrUp=int(num((vals or {}).get("adrUp",0))); adrDown=int(num((vals or {}).get("adrDown",0)))
            spark = (vals or {}).get("spark", []);  spark = spark if isinstance(spark, list) else []
            out[key] = {
                "nh":nh,"nl":nl,"up":up,"down":dn,"adrUp":adrUp,"adrDown":adrDown,
                "netNH":nh-nl,"netUD":up-dn,"spark":spark
            }
    for k in PREFERRED_ORDER:
        out.setdefault(k, {"nh":0,"nl":0,"up":0,"down":0,"adrUp":0,"adrDown":0,"netNH":0,"netUD":0,"spark":[]})
    return out

# ---------- gauges & odometers ----------
def build_gauges_and_odometers(src: Dict[str, Any], sectors: Dict[str, Any], mode: str) -> Dict[str, Any]:
    g = src.get("global", {}) or {}
    fuel    = num(pick(g,"squeeze_pressure_pct","squeezePressurePct", default=50))
    vol_pct = num(pick(g,"volatility_pct","volatilityPct", default=50))
    liq_pct = num(pick(g,"liquidity_pct","liquidityPct", default=70))
    daily_sq = pick(g,"daily_squeeze_pct","squeeze_daily_pct","squeezeDailyPct", default=None)
    adr_momo = pick(g,"adr_momentum_pct","adrMomentumPct", default=None)

    tot_nh=sum(int(num(v.get("nh",0))) for v in sectors.values())
    tot_nl=sum(int(num(v.get("nl",0))) for v in sectors.values())
    tot_up=sum(int(num(v.get("up",0))) for v in sectors.values())
    tot_dn=sum(int(num(v.get("down",0))) for v in sectors.values())

    def ratio_idx(pos,neg):
        s=float(pos)+float(neg)
        return 50.0 if s<=0 else 50.0 + 50.0*((float(pos)-float(neg))/s)

    breadthIdx  = ratio_idx(tot_up, tot_dn)    # (Adv vs Dec) — classic “breadth”
    momentumIdx = ratio_idx(tot_nh, tot_nl)    # (NH vs NL)   — classic “momentum”

    gauges = {
        "rpm":   {"pct": float(breadthIdx),  "label":"Breadth"},
        "speed": {"pct": float(momentumIdx), "label":"Momentum"},
        "fuel":  {"pct": float(fuel), "state": ("firingUp" if float(fuel)>=70 else "idle"), "label":"Squeeze"},
        "water": {"pct": float(vol_pct), "label":"Volatility"},
        "oil":   {"psi": float(liq_pct), "label":"Liquidity"},
    }
    # ADR momentum gauge (optional, FE can ignore if unused)
    if adr_momo is not None:
        gauges["speedAdr"] = {"pct": float(num(adr_momo, 50.0)), "label":"ADR Momentum"}

    if mode in ("daily","eod") and daily_sq is not None:
        gauges["squeezeDaily"] = {"pct": float(num(daily_sq, None))}

    odometers = {"squeezeCompressionPct": float(fuel)}
    summary = {"breadthIdx": float(breadthIdx), "momentumIdx": float(momentumIdx)}
    if adr_momo is not None:
        summary["adrMomentumIdx"] = float(num(adr_momo, 50.0))
    return {"gauges": gauges, "odometers": odometers, "summary": summary}

# ---------- cards ----------
def cards_from_sectors(sectors: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards=[]
    for key in PREFERRED_ORDER:
        vals=sectors.get(key, {})
        net=int(num(vals.get("netNH",0)))
        outlook="Neutral"
        if net>0: outlook="Bullish"
        if net<0: outlook="Bearish"
        spark = vals.get("spark", []); spark = spark if isinstance(spark,list) else []
        cards.append({"sector": title_case(key), "outlook": outlook, "spark": spark})
    return cards

# ---------- engine lights defaults ----------
def default_signals() -> Dict[str, Any]:
    keys=["sigBreakout","sigDistribution","sigCompression","sigExpansion","sigOverheat",
          "sigTurbo","sigDivergence","sigLowLiquidity","sigVolatilityHigh"]
    return {k: {"active": False, "severity": "info"} for k in keys}

# ---------- daily trend block (unchanged semantics; uses gauges that may include squeezeDaily) ----------
def lux_trend_daily(sectors: Dict[str, Any], gauges: Dict[str, Any], ts: str) -> Dict[str, Any]:
    """
    Daily Trend (swing): blends Breadth, Momentum, EMA alignment (SPY), ADR momentum (if present),
    and damps by Daily Squeeze (Lux PSI).
    """
    # Inputs from current gauges
    breadth  = float(num(gauges.get("rpm",   {}).get("pct", 50)))   # Adv/Dec %
    momentum = float(num(gauges.get("speed", {}).get("pct", 50)))   # NH/NL %
    daily_sq = gauges.get("squeezeDaily", {}).get("pct")            # Lux PSI daily (0..100) or None
    S = float(num(daily_sq, 50.0)) / 100.0

    # Optional ADR momentum if present (else neutral)
    adr_momo = gauges.get("speedAdr", {}).get("pct")
    adr_momo = float(num(adr_momo, 50.0))

    # EMA 10/20 position on SPY daily (requires POLYGON_API_KEY; else neutral 50)
    ema_pos_score = 50.0
    closes = fetch_polygon_spy_daily(limit=120) if 'fetch_polygon_spy_daily' in globals() else []
    if closes and len(closes) >= 21:
        ema10 = ema(closes, 10)[-1]
        ema20 = ema(closes, 20)[-1]
        c = float(closes[-1])
        above10 = c > ema10
        above20 = c > ema20
        if above10 and above20:
            ema_pos_score = 100.0
        elif above10 and not above20:
            ema_pos_score = 65.0
        elif (not above10) and above20:
            ema_pos_score = 35.0
        else:
            ema_pos_score = 0.0

    # Base score (0..100)
    base = (
        0.35 * breadth +
        0.35 * momentum +
        0.20 * ema_pos_score +
        0.10 * adr_momo
    )

    # Squeeze damping: high compression pulls toward neutral
    trendScore = (1.0 - 0.5 * S) * base + (0.5 * S) * 50.0

    # State thresholds
    state = "up" if trendScore > 55 else ("down" if trendScore < 45 else "flat")

    # Participation proxy: % sectors with netNH > 0
    pos_sectors = sum(
        1 for k in PREFERRED_ORDER
        if int(num(sectors.get(k, {}).get("netNH", 0))) > 0
    )
    participation_pct = (pos_sectors / float(len(PREFERRED_ORDER))) * 100.0

    # Vol/Liq from existing gauges
    vol_pct = float(num(gauges.get("water", {}).get("pct", 0)))
    vol_band = "calm" if vol_pct < 30 else ("elevated" if vol_pct <= 60 else "high")
    liq_psi = float(num(gauges.get("oil",   {}).get("psi", 0)))
    liq_band = "good" if liq_psi >= 60 else ("normal" if liq_psi >= 50 else ("light" if liq_psi >= 40 else "thin"))

    return {
        "trend":            { "emaSlope": round(trendScore - 50.0, 1), "state": state },
        "participation":    { "pctAboveMA": round(participation_pct, 1) },
        "squeezeDaily":     { "pct": (round(float(num(daily_sq, None)), 2) if daily_sq is not None else None) },
        "volatilityRegime": { "atrPct": round(vol_pct, 1), "band": vol_band },
        "liquidityRegime":  { "psi": round(liq_psi, 1), "band": liq_band },
        "rotation":         { "riskOnPct": 50.0 },
        "updatedAt":        ts,
        "mode":             "daily",
        "live":             False
    }


# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="data/outlook_source.json")
    ap.add_argument("--out",    default="data/outlook.json")
    ap.add_argument("--mode",   default="intraday", choices=["intraday","daily","eod","hourly"])
    args = ap.parse_args()

    src = jread(args.source); ts=now_iso()
    sectors = sectors_from_source(src)
    gz_od   = build_gauges_and_odometers(src, sectors, args.mode if args.mode!="eod" else "daily")
    cards   = cards_from_sectors(sectors)

    intraday_block=None
    if args.mode == "intraday":
        rising = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k,{}).get("netNH",0)))>0)
        rising_pct = (rising/float(len(PREFERRED_ORDER)))*100.0
        off_pos = sum(1 for s in OFFENSIVE if int(num(sectors.get(s,{}).get("netNH",0)))>0)
        def_pos = sum(1 for s in DEFENSIVE if int(num(sectors.get(s,{}).get("netNH",0)))>0)
        denom=off_pos+def_pos
        risk_on_10m=(off_pos/denom)*100.0 if denom>0 else 50.0
        intraday_block = {
            "sectorDirection10m": {"risingCount": int(rising), "risingPct": round(rising_pct,1), "updatedAt": ts},
            "riskOn10m": {"riskOnPct": round(risk_on_10m,1), "updatedAt": ts}
        }

    upstream_signals={}
    if isinstance(src.get("signals"), dict): upstream_signals=src["signals"]
    elif isinstance(src.get("engineLights"), dict) and isinstance(src["engineLights"].get("signals"), dict):
        upstream_signals=src["engineLights"]["signals"]

    signals=default_signals()
    for k,v in (upstream_signals or {}).items():
        if isinstance(v, dict):
            signals[k] = {**signals.get(k, {"active":False,"severity":"info"}), **v}

    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts, "ts": ts, "version": VERSION_TAG,
        "pipeline": args.mode if args.mode!="eod" else "daily",
        **gz_od,
        "sectorCards": cards,
        "outlook": {"sectors": sectors, "sectorCards": cards},
        "engineLights": {"updatedAt": ts, "mode": (args.mode if args.mode!="eod" else "daily"), "live": (args.mode=="intraday"), "signals": signals}
    }
    if intraday_block: out["intraday"]=intraday_block

    if args.mode in ("daily","eod","hourly"):
        td = lux_trend_daily(sectors, gz_od["gauges"], ts)
        out["trendDaily"]=td
        if td.get("squeezeDaily", {}).get("pct") is not None:
            out["gauges"]["squeezeDaily"]={"pct": td["squeezeDaily"]["pct"]}

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | mode={args.mode}")
    print(f"[summary] breadth={out['summary']['breadthIdx']:.1f} momentum={out['summary']['momentumIdx']:.1f} adr={out['summary'].get('adrMomentumIdx','-')}")
if __name__ == "__main__":
    main()
