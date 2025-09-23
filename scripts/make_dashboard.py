#!/usr/bin/env python3
"""
make_dashboard.py (R2.1)

- Reads:  data/outlook_source.json (from R8 builder)
- Writes: data/outlook_intraday.json (intraday),
          data/outlook_hourly.json   (hourly),
          data/outlook.json          (daily/eod)

Confirmed rules:
- Breadth  = NH / (NH + NL)    (0..100)
- Momentum = 3U / (3U + 3D)    (0..100)
- summary.breadth_pct + summary.momentum_pct exposed
- sectorCards include per-sector breadth_pct (NH/NL) and momentum_pct (3U/3D)
- Risk-On (10m) computed from sector tilt with robust canonicalization
- Engine Lights: rules added (Breakout, Compression, Expansion, Distribution, Low Liquidity, Volatility High, Turbo, Overheat)
"""

from __future__ import annotations
import argparse, json, os, math
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
import urllib.request
from zoneinfo import ZoneInfo  # stdlib (Python 3.9+)
# ----- timezone helpers (Arizona) -----
PHX_TZ = ZoneInfo("America/Phoenix")

def now_utc_iso() -> str:
    """UTC ISO (machine time)"""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    """Arizona ISO (display time)"""
    return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()


SCHEMA_VERSION = "r1.2"
VERSION_TAG    = "1.2-hourly"

# Preferred sector order (canonical, lower-case)
PREFERRED_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

# Tilt sets (canonical, lower-case)
OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care"}

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")

# ---------------- utils ----------------
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
    """Map common display names to our canonical keys."""
    n = norm(name)
    # full dictionary mapping for safety
    MAP = {
        "tech": "information technology",
        "information technology": "information technology",
        "infotech": "information technology",
        "it": "information technology",

        "healthcare": "health care",
        "health care": "health care",

        "communication services": "communication services",
        "communications": "communication services",
        "comm services": "communication services",
        "telecom": "communication services",

        "consumer discretionary": "consumer discretionary",
        "discretionary": "consumer discretionary",

        "consumer staples": "consumer staples",
        "staples": "consumer staples",

        "utilities": "utilities",
        "utility": "utilities",

        "industrials": "industrials",
        "industrial": "industrials",

        "materials": "materials",
        "material": "materials",

        "energy": "energy",

        "financials": "financials",
        "financial": "financials",

        "real estate": "real estate",
        "reits": "real estate",
    }
    return MAP.get(n, n)

def num(v, default=0.0):
    try:
        if v is None: return default
        if isinstance(v,(int,float)): return float(v)
        s=str(v).strip()
        return default if s=="" else float(s)
    except:
        return default

def pick(d: Dict[str,Any], *keys, default=None):
    for k in keys:
        if isinstance(d, dict) and d.get(k) is not None:
            return d[k]
    return default

def ratio_pct(pos, neg):
    s = float(pos) + float(neg)
    return 50.0 if s <= 0 else round(100.0 * (float(pos) / s), 2)

# ---------------- sectors from source ----------------
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
            spark = (vals or {}).get("spark", []);  spark = spark if isinstance(spark, list) else []
            out[key] = {
                "nh":nh,"nl":nl,"up":up,"down":dn,
                "netNH":nh-nl,"netUD":up-dn,"spark":spark
            }

    # Ensure all preferred sectors exist, even if zeros
    for k in PREFERRED_ORDER:
        out.setdefault(k, {"nh":0,"nl":0,"up":0,"down":0,"netNH":0,"netUD":0,"spark":[]})
    return out

# ---------------- gauges & summary ----------------
def build_gauges_and_odometers(src: Dict[str, Any], sectors: Dict[str, Any], mode: str) -> Dict[str, Any]:
    g = src.get("global", {}) or {}

    fuel      = num(pick(g,"squeeze_pressure_pct","squeezePressurePct", default=50))  # intraday compression
    vol_pct   = num(pick(g,"volatility_pct","volatilityPct", default=50))
    liq_psi   = num(pick(g,"liquidity_pct","liquidityPct", default=70))
    daily_sq  = pick(g,"daily_squeeze_pct","squeeze_daily_pct","squeezeDailyPct", default=None)

    # Totals across sectors
    tot_nh = sum(int(num(v.get("nh", 0)))   for v in sectors.values())
    tot_nl = sum(int(num(v.get("nl", 0)))   for v in sectors.values())
    tot_u  = sum(int(num(v.get("up", 0)))   for v in sectors.values())
    tot_d  = sum(int(num(v.get("down", 0))) for v in sectors.values())

    # Your spec (Row 1): Breadth = NH/NL, Momentum = 3U/3D
    breadth_pct  = ratio_pct(tot_nh, tot_nl)
    momentum_pct = ratio_pct(tot_u,  tot_d)

    gauges = {
        "rpm":   {"pct": float(breadth_pct),  "label":"Breadth"},   # NH/NL
        "speed": {"pct": float(momentum_pct), "label":"Momentum"},  # 3U/3D
        "fuel":  {"pct": float(fuel), "state": ("firingUp" if float(fuel) >= 70 else "idle"), "label":"Squeeze"},
        "water": {"pct": float(vol_pct), "label":"Volatility"},
        "oil":   {"psi": float(liq_psi), "label":"Liquidity"},
    }
    if mode in ("daily","eod") and daily_sq is not None:
        gauges["squeezeDaily"] = {"pct": float(num(daily_sq, None))}

    summary = {
        "breadth_pct":  float(breadth_pct),   # NH/NL
        "momentum_pct": float(momentum_pct),  # 3U/3D
    }

    odometers = {"squeezeCompressionPct": float(fuel)}
    return {"gauges": gauges, "odometers": odometers, "summary": summary}

# ---------------- cards ----------------
def cards_from_sectors(sectors: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    for key in PREFERRED_ORDER:
        vals = sectors.get(key, {})
        nh = int(num(vals.get("nh", 0))); nl = int(num(vals.get("nl", 0)))
        u  = int(num(vals.get("up", 0)));  d  = int(num(vals.get("down", 0)))

        breadth_pct  = ratio_pct(nh, nl)  # NH/NL
        momentum_pct = ratio_pct(u,  d)   # 3U/3D

        # Outlook remains netNH based
        netNH = nh - nl
        outlook = "Neutral"
        if netNH > 0: outlook = "Bullish"
        if netNH < 0: outlook = "Bearish"

        spark = vals.get("spark", []); spark = spark if isinstance(spark, list) else []

        cards.append({
            "sector":        title_case(key),
            "outlook":       outlook,
            "breadth_pct":   breadth_pct,
            "momentum_pct":  momentum_pct,
            "nh": nh, "nl": nl, "up": u, "down": d,
            "spark":         spark
        })
    return cards

# ---------------- engine lights defaults + rules ----------------
def default_signals() -> Dict[str, Any]:
    keys = ["sigBreakout","sigDistribution","sigCompression","sigExpansion",
            "sigOverheat","sigTurbo","sigDivergence","sigLowLiquidity","sigVolatilityHigh"]
    return { k: {"active": False, "severity": "info"} for k in keys }

def apply_engine_lights(signals: Dict[str, Any], summary: Dict[str, Any], gauges: Dict[str, Any]) -> Dict[str, Any]:
    b = float(num(summary.get("breadth_pct", 50)))
    m = float(num(summary.get("momentum_pct", 50)))
    squeeze = float(num(gauges.get("fuel", {}).get("pct", 50)))          # 0..100 (higher = tighter)
    vol     = float(num(gauges.get("water", {}).get("pct", 50)))         # 0..100
    liq     = float(num(gauges.get("oil",   {}).get("psi", 70)))         # ~0..120

    # Simple, transparent rules
    # Breakout: broad confirmation
    if (b >= 55.0 and m >= 55.0 and squeeze <= 60.0):
        signals["sigBreakout"]["active"] = True

    # Distribution: broad weakness
    if (b <= 45.0 and m <= 45.0):
        signals["sigDistribution"]["active"] = True

    # Compression: coil
    if (squeeze >= 70.0):
        signals["sigCompression"]["active"] = True

    # Expansion: release + thrust
    if (squeeze <= 30.0 and m >= 55.0):
        signals["sigExpansion"]["active"] = True

    # Volatility High / Low Liquidity
    if (vol >= 70.0):
        signals["sigVolatilityHigh"]["active"] = True
    if (liq <= 45.0):
        signals["sigLowLiquidity"]["active"] = True

    # Turbo: very strong thrust + expansion
    if (m >= 70.0 and b >= 60.0 and squeeze <= 30.0):
        signals["sigTurbo"]["active"] = True

    # Overheat: thrust with very high volatility
    if (m >= 60.0 and vol >= 80.0):
        signals["sigOverheat"]["active"] = True

    return signals

# ---------------- Daily Trend (swing) ----------------
def http_get_json(url: str) -> Dict[str,Any]:
    req = urllib.request.Request(url, headers={})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_spy_daily(limit: int = 120) -> List[float]:
    if not POLYGON_API_KEY:
        return []
    end = datetime.utcnow().date()
    start = end - timedelta(days=limit*2)
    url = (f"https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/"
           f"{start.isoformat()}/{end.isoformat()}?adjusted=true&sort=asc&limit=5000&apiKey={POLYGON_API_KEY}")
    try:
        data = http_get_json(url)
        res = data.get("results") or []
        closes = [float(r.get("c", 0.0)) for r in res if r.get("c") is not None]
        return closes[-limit:] if len(closes) > limit else closes
    except Exception:
        return []

def ema(series: List[float], length: int) -> List[float]:
    if not series: return []
    k = 2.0 / (length + 1.0)
    out = [series[0]]
    for v in series[1:]:
        out.append(out[-1] + k * (v - out[-1]))
    return out

def lux_trend_daily(sectors: Dict[str, Any], gauges: Dict[str, Any], ts: str) -> Dict[str, Any]:
    breadth  = float(num(gauges.get("rpm",   {}).get("pct", 50)))   # NH/NL %
    momentum = float(num(gauges.get("speed", {}).get("pct", 50)))   # 3U/3D %
    daily_sq = gauges.get("squeezeDaily", {}).get("pct")
    S = float(num(daily_sq, 50.0)) / 100.0

    adr_momo = 50.0  # neutral placeholder (optional future wiring)

    ema_pos_score = 50.0
    closes = fetch_polygon_spy_daily(limit=120)
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

    base = (0.35 * breadth) + (0.35 * momentum) + (0.20 * ema_pos_score) + (0.10 * adr_momo)
    trendScore = (1.0 - 0.5 * S) * base + (0.5 * S) * 50.0
    state = "up" if trendScore > 55 else ("down" if trendScore < 45 else "flat")

    pos_sectors = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k, {}).get("netNH", 0))) > 0)
    participation_pct = (pos_sectors / float(len(PREFERRED_ORDER))) * 100.0

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
        "rotation":         { "riskOnPct": 50.0 },  # optional daily tilt later
        "updatedAt":        ts,
        "mode":             "daily",
        "live":             False
    }

# ---------------- main ----------------
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

    # ---------- Intraday-only: sector direction + risk-on tilt ----------
    intraday_block=None
    if args.mode == "intraday":
        rising = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k,{}).get("netNH",0)))>0)
        rising_pct = (rising/float(len(PREFERRED_ORDER)))*100.0

        # robust tilt (uses canonical keys)
        off_pos = sum(1 for s in OFFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
        def_pos = sum(1 for s in DEFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
        denom = off_pos + def_pos
        risk_on_10m = (off_pos/denom)*100.0 if denom>0 else 50.0

        intraday_block = {
            "sectorDirection10m": {"risingCount": int(rising), "risingPct": round(rising_pct,1), "updatedAt": ts},
            "riskOn10m": {"riskOnPct": round(risk_on_10m,1), "updatedAt": ts}
        }

    # ---------- Engine Lights ----------
    upstream_signals={}
    if isinstance(src.get("signals"), dict): upstream_signals=src["signals"]
    elif isinstance(src.get("engineLights"), dict) and isinstance(src["engineLights"].get("signals"), dict):
        upstream_signals=src["engineLights"]["signals"]

    signals=default_signals()
    for k,v in (upstream_signals or {}).items():
        if isinstance(v, dict):
            signals[k] = {**signals.get(k, {"active":False,"severity":"info"}), **v}

    # Apply data-driven rules
    signals = apply_engine_lights(signals, gz_od["summary"], gz_od["gauges"])

    # ---------- Output assembly ----------
    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts, "ts": ts, "version": VERSION_TAG,
        "pipeline": args.mode if args.mode!="eod" else "daily",
        **gz_od,
        "sectorsUpdatedAt": ts,                           # helpful for UI timestamps
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
    print(f"[summary] breadth={out['summary']['breadth_pct']:.1f} momentum={out['summary']['momentum_pct']:.1f}")

if __name__ == "__main__":
    main()
