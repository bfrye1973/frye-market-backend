#!/usr/bin/env python3
"""
make_dashboard.py (R2.1)

- Reads:  data/outlook_source.json (from R8 builder)
- Writes: data/outlook_intraday.json (intraday),
          data/outlook_hourly.json   (hourly),
          data/outlook.json          (daily/eod)

Confirmed rules / design:
- Breadth  = NH / (NH + NL)        (0..100)
- Momentum = 3U / (3U + 3D)        (0..100)
- summary.breadth_pct + summary.momentum_pct exposed (for spreadsheet compare)
- sectorCards include per-sector breadth_pct (NH/NL) and momentum_pct (3U/3D)
- Risk-On (10m) computed from sector tilt with robust canonicalization
- Engine Lights: rules added (Breakout, Compression, Expansion, Distribution, Low Liquidity, Volatility High, Turbo, Overheat)
- Output timestamps:
    updated_at       -> America/Phoenix (display)
    updated_at_utc   -> UTC (logs/replay)
    ts               -> legacy UTC key (kept for compatibility)
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
    """Map common display names to our canonical keys (lower-case)."""
    n = norm(name)
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

# ---------------- metrics + summary (no gauge lingo) ----------------
def build_metrics_summary(src: Dict[str, Any], sectors: Dict[str, Any], mode: str) -> Dict[str, Any]:
    g = src.get("global", {}) or {}

    # Core inputs
    squeeze_intraday = num(pick(g,"squeeze_pressure_pct","squeezePressurePct", default=50))  # 0..100 (higher = tighter)
    volatility_pct   = num(pick(g,"volatility_pct","volatilityPct", default=50))
    liquidity_psi    = num(pick(g,"liquidity_pct","liquidityPct", default=70))
    squeeze_daily    = pick(g,"daily_squeeze_pct","squeeze_daily_pct","squeezeDailyPct", default=None)

    # Totals across sectors
    tot_nh = sum(int(num(v.get("nh", 0)))   for v in sectors.values())
    tot_nl = sum(int(num(v.get("nl", 0)))   for v in sectors.values())
    tot_u  = sum(int(num(v.get("up", 0)))   for v in sectors.values())
    tot_d  = sum(int(num(v.get("down", 0))) for v in sectors.values())

    # Your spec: Breadth = NH/NL, Momentum = 3U/3D
    breadth_pct  = ratio_pct(tot_nh, tot_nl)
    momentum_pct = ratio_pct(tot_u,  tot_d)

    metrics = {
        "breadth_pct":            float(breadth_pct),
        "momentum_pct":           float(momentum_pct),
        "squeeze_intraday_pct":   float(squeeze_intraday),
        "volatility_pct":         float(volatility_pct),
        "liquidity_psi":          float(liquidity_psi),
    }
    if mode in ("daily","eod") and squeeze_daily is not None:
        metrics["squeeze_daily_pct"] = float(num(squeeze_daily, None))

    summary = {
        "breadth_pct":  float(breadth_pct),
        "momentum_pct": float(momentum_pct),
    }

    # Temporary mirror to keep current UI working (remove in a later release)
    gauges = {
        "rpm":   {"pct": metrics["breadth_pct"],            "label":"Breadth"},
        "speed": {"pct": metrics["momentum_pct"],           "label":"Momentum"},
        "fuel":  {"pct": metrics["squeeze_intraday_pct"],   "label":"Squeeze"},
        "water": {"pct": metrics["volatility_pct"],         "label":"Volatility"},
        "oil":   {"psi": metrics["liquidity_psi"],          "label":"Liquidity"},
    }
    if "squeeze_daily_pct" in metrics:
        gauges["squeezeDaily"] = {"pct": metrics["squeeze_daily_pct"]}

    odometers = {"squeezeCompressionPct": metrics["squeeze_intraday_pct"]}
    return {"metrics": metrics, "gauges": gauges, "summary": summary, "odometers": odometers}

# ---------------- cards ----------------
def cards_from_sectors(sectors: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards: List[Dict[str, Any]] = []
    for key in PREFERRED_ORDER:
        vals = sectors.get(key, {})
        nh = int(num(vals.get("nh", 0))); nl = int(num(vals.get("nl", 0)))
        u  = int(num(vals.get("up", 0)));  d  = int(num(vals.get("down", 0)))

        breadth_pct  = ratio_pct(nh, nl)  # NH/NL
        momentum_pct = ratio_pct(u,  d)   # 3U/3D

        # Outlook remains netNH-based
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

# ---------------- engine lights ----------------
def default_signals() -> Dict[str, Any]:
    keys = ["sigBreakout","sigDistribution","sigCompression","sigExpansion",
            "sigOverheat","sigTurbo","sigDivergence","sigLowLiquidity","sigVolatilityHigh"]
    return { k: {"active": False, "severity": "info"} for k in keys }

def apply_engine_lights(signals: Dict[str, Any], summary: Dict[str, Any], metrics: Dict[str, Any]) -> Dict[str, Any]:
    b   = float(num(summary.get("breadth_pct", 50)))
    m   = float(num(summary.get("momentum_pct", 50)))
    sq  = float(num(metrics.get("squeeze_intraday_pct", 50)))
    vol = float(num(metrics.get("volatility_pct", 50)))
    liq = float(num(metrics.get("liquidity_psi", 70)))

    # Gates tuned to be responsive but not noisy
    if (b >= 53.0 and m >= 53.0 and sq <= 60.0):
        signals["sigBreakout"]["active"] = True
    if (b <= 45.0 and m <= 45.0):
        signals["sigDistribution"]["active"] = True
    if (sq >= 70.0):
        signals["sigCompression"]["active"] = True
    if (sq <= 30.0 and m >= 52.0):
        signals["sigExpansion"]["active"] = True
    if (vol >= 70.0):
        signals["sigVolatilityHigh"]["active"] = True
    if (liq <= 45.0):
        signals["sigLowLiquidity"]["active"] = True
    if (m >= 70.0 and b >= 60.0 and sq <= 30.0):
        signals["sigTurbo"]["active"] = True
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

def lux_trend_daily(sectors: Dict[str, Any], metrics: Dict[str, Any], ts_local: str) -> Dict[str, Any]:
    breadth  = float(num(metrics.get("breadth_pct", 50)))     # NH/NL %
    momentum = float(num(metrics.get("momentum_pct", 50)))    # 3U/3D %
    daily_sq = float(num(metrics.get("squeeze_daily_pct", 50)))
    S = daily_sq / 100.0

    # Placeholder ADR momentum (optional future wiring)
    adr_momo = 50.0

    # EMA 10/20 position on SPY daily (requires POLYGON_API_KEY; else neutral)
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

    # Participation proxy: % sectors with netNH > 0
    pos_sectors = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k, {}).get("netNH", 0))) > 0)
    participation_pct = (pos_sectors / float(len(PREFERRED_ORDER))) * 100.0

    vol_pct = float(num(metrics.get("volatility_pct", 0)))
    vol_band = "calm" if vol_pct < 30 else ("elevated" if vol_pct <= 60 else "high")
    liq_psi = float(num(metrics.get("liquidity_psi", 0)))
    liq_band = "good" if liq_psi >= 60 else ("normal" if liq_psi >= 50 else ("light" if liq_psi >= 40 else "thin"))

    return {
        "trend":            { "emaSlope": round(trendScore - 50.0, 1), "state": state },
        "participation":    { "pctAboveMA": round(participation_pct, 1) },
        "squeezeDaily":     { "pct": round(daily_sq, 2) },
        "volatilityRegime": { "atrPct": round(vol_pct, 1), "band": vol_band },
        "liquidityRegime":  { "psi": round(liq_psi, 1), "band": liq_band },
        "rotation":         { "riskOnPct": 50.0 },  # optional daily tilt later
        "updatedAt":        ts_local,
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

    src = jread(args.source)

    # Build sector map
    sectors = sectors_from_source(src)

    # Build analytics (metrics/summary) + legacy gauges mirror
    # (mode value normalized: 'daily' for eod to keep daily_squeeze wiring consistent)
    normalized_mode = args.mode if args.mode != "eod" else "daily"
    ms_od = build_metrics_summary(src, sectors, normalized_mode)

    # Cards
    cards = cards_from_sectors(sectors)

    # Timestamps
    ts_utc   = now_utc_iso()
    ts_local = now_phx_iso()

    # Intraday-only extras
    intraday_block=None
    if args.mode == "intraday":
        rising = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k,{}).get("netNH",0)))>0)
        rising_pct = (rising/float(len(PREFERRED_ORDER)))*100.0
        off_pos = sum(1 for s in OFFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
        def_pos = sum(1 for s in DEFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
        denom = off_pos + def_pos
        risk_on_10m = (off_pos/denom)*100.0 if denom>0 else 50.0
        intraday_block = {
            "sectorDirection10m": {"risingCount": int(rising), "risingPct": round(rising_pct,1), "updatedAt": ts_local},
            "riskOn10m":          {"riskOnPct": round(risk_on_10m,1), "updatedAt": ts_local}
        }

    # Engine Lights: merge upstream (if any) then apply rules
    upstream_signals={}
    if isinstance(src.get("signals"), dict): upstream_signals=src["signals"]
    elif isinstance(src.get("engineLights"), dict) and isinstance(src["engineLights"].get("signals"), dict):
        upstream_signals=src["engineLights"]["signals"]

    signals=default_signals()
    for k,v in (upstream_signals or {}).items():
        if isinstance(v, dict):
            signals[k] = {**signals.get(k, {"active":False,"severity":"info"}), **v}
    signals = apply_engine_lights(signals, ms_od["summary"], ms_od["metrics"])

    # Compose output
    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts_local,        # AZ display
        "updated_at_utc": ts_utc,      # UTC machine
        "ts": ts_utc,                  # legacy UTC key
        "version": VERSION_TAG,
        "pipeline": normalized_mode,

        # New analytics (preferred binding)
        "metrics": ms_od["metrics"],
        "summary": ms_od["summary"],
        "odometers": ms_od["odometers"],

        # Temporary mirror to keep current UI until you rebind to metrics/*
        "gauges": ms_od["gauges"],

        "sectorsUpdatedAt": ts_local,  # use this for the Index Sectors timestamp
        "sectorCards": cards,
        "outlook": {"sectors": sectors, "sectorCards": cards},

        "engineLights": {
            "updatedAt": ts_local, "mode": normalized_mode,
            "live": (args.mode=="intraday"),
            "signals": signals
        }
    }

    if intraday_block:
        out["intraday"] = intraday_block

    # Daily/EOD: build daily trend using metrics (not gauges)
    if args.mode in ("daily","eod","hourly"):
        td = lux_trend_daily(sectors, ms_od["metrics"], ts_local)
        out["trendDaily"]=td
        if "squeeze_daily_pct" in ms_od["metrics"]:
            out["gauges"]["squeezeDaily"] = {"pct": ms_od["metrics"]["squeeze_daily_pct"]}

    # Write
    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | mode={args.mode}")
    print(f"[summary] breadth={out['summary']['breadth_pct']:.1f} momentum={out['summary']['momentum_pct']:.1f}")

if __name__ == "__main__":
    main()
