#!/usr/bin/env python3
"""
make_dashboard.py — build outlook.json for the dashboard

- Reads:  data/outlook_source.json
- Writes: data/outlook.json

Emits:
  gauges: rpm (Breadth), speed (Momentum), fuel (Intraday Squeeze), water (Vol), oil (Liq)
          squeezeDaily.pct ONLY in daily/eod mode (Lux PSI or fallback)
  odometers: squeezeCompressionPct (intraday = fuel)
  outlook.sectors + sectorCards
  summary: breadthIdx, momentumIdx
  engineLights: updatedAt, mode, live, signals (defaults; upstream can override)
  intraday.sectorDirection10m: risingCount, risingPct, updatedAt  (intraday)
  intraday.riskOn10m: riskOnPct, updatedAt                        (intraday)
  trendDaily: trend/participation/squeezeDaily/volatilityRegime/liquidityRegime/rotation, updatedAt (daily/eod)
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

# ---------------- HTTP util (Polygon) ----------------
def http_get_json(url: str) -> Dict[str,Any]:
    req = urllib.request.Request(url, headers={})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_spy_daily(limit: int = 120) -> List[float]:
    """Fetch SPY daily closes from Polygon. Returns closes in ascending date order."""
    if not POLYGON_API_KEY:
        return []
    end = datetime.utcnow().date()
    start = end - timedelta(days=limit*2)  # buffer for non-trading days
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/"
        f"{start.isoformat()}/{end.isoformat()}?adjusted=true&sort=asc&limit=5000&apiKey={POLYGON_API_KEY}"
    )
    try:
        data = http_get_json(url)
        res = data.get("results") or []
        closes = [float(r.get("c", 0.0)) for r in res if r.get("c") is not None]
        return closes[-limit:] if len(closes) > limit else closes
    except Exception:
        return []

# ---------------- Lux Squeeze PSI (daily) ----------------
def lux_squeeze_psi(closes: List[float], conv: int = 50, length: int = 20) -> float | None:
    """
    Python port of LuxAlgo Squeeze Index:
      max = max(prev_max - (prev_max - src)/conv, src)
      min = min(prev_min + (src - prev_min)/conv, src)
      diff = log(max - min)
      psi = -50 * corr(diff, bar_index, length) + 50
    """
    if not closes or len(closes) < length + 2:
        return None

    mx = None
    mn = None
    diffs: List[float] = []
    for src in closes:
        src = float(src)
        mx = src if mx is None else max(mx - (mx - src) / conv, src)
        mn = src if mn is None else min(mn + (src - mn) / conv, src)
        span = max(mx - mn, 1e-9)
        diffs.append(math.log(span))

    def pearson_corr(a: List[float], b: List[float]) -> float:
        n = len(a)
        if n <= 1: return 0.0
        ma = sum(a)/n
        mb = sum(b)/n
        cov = sum((x-ma)*(y-mb) for x,y in zip(a,b))
        va  = sum((x-ma)*(x-ma) for x in a)
        vb  = sum((y-mb)*(y-mb) for y in b)
        if va <= 0 or vb <= 0: return 0.0
        return cov / math.sqrt(va*vb)

    bar_idx = list(range(len(diffs)))
    corr_vals: List[float] = []
    L = length
    for i in range(L-1, len(diffs)):
        window_diff = diffs[i-L+1:i+1]
        window_idx  = bar_idx[i-L+1:i+1]
        corr_vals.append(pearson_corr(window_diff, window_idx))

    if not corr_vals: return None
    corr_last = corr_vals[-1]
    psi = -50.0 * corr_last + 50.0
    return float(psi)

# ---------------- sectors from source ----------------
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

# -------- gauges / squeeze (intraday) --------
def pick(d: Dict[str, Any], *keys, default=None):
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return default

def build_gauges_and_odometers(src: Dict[str, Any], sectors: Dict[str, Any], mode: str) -> Dict[str, Any]:
    g = src.get("global", {}) or {}

    fuel      = num(pick(g, "squeeze_pressure_pct", "squeezePressurePct", default=50))
    # NOTE: we do NOT bond daily squeeze to intraday mode; only add squeezeDaily in daily/eod below
    daily_sq_raw  = pick(g, "daily_squeeze_pct", "squeeze_daily_pct", "squeezeDailyPct", default=None)
    vol_pct   = num(pick(g, "volatility_pct", "volatilityPct", default=50))
    liq_pct   = num(pick(g, "liquidity_pct", "liquidityPct", default=70))

    tot_nh = sum(int(num(v.get("nh",0)))   for v in sectors.values())
    tot_nl = sum(int(num(v.get("nl",0)))   for v in sectors.values())
    tot_up = sum(int(num(v.get("up",0)))   for v in sectors.values())
    tot_dn = sum(int(num(v.get("down",0))) for v in sectors.values())

    def ratio_idx(pos, neg):
        s = float(pos) + float(neg)
        return 50.0 if s <= 0 else 50.0 + 50.0 * ((float(pos) - float(neg)) / s)

    breadthIdx  = ratio_idx(tot_up, tot_dn)
    momentumIdx = ratio_idx(tot_nh, tot_nl)

    gauges = {
        "rpm":   {"pct": float(breadthIdx),  "label":"Breadth"},
        "speed": {"pct": float(momentumIdx), "label":"Momentum"},
        "fuel":  {"pct": float(fuel), "state": ("firingUp" if float(fuel) >= 70 else "idle"), "label":"Squeeze"},
        "water": {"pct": float(vol_pct), "label":"Volatility"},
        "oil":   {"psi": float(liq_pct), "label":"Liquidity"},
    }
    # only attach squeezeDaily here IF NOT INTRADAY; we will set it in trendDaily (daily Lux)
    if mode in ("daily","eod") and daily_sq_raw is not None:
        gauges["squeezeDaily"] = {"pct": float(num(daily_sq_raw, None))}

    odometers = {"squeezeCompressionPct": float(fuel)}  # intraday compression
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
def build_trend_daily_with_lux(src: Dict[str, Any], sectors: Dict[str, Any], gauges: Dict[str, Any], ts: str) -> Dict[str, Any]:
    # Participation proxy: % sectors with netNH > 0
    pos_sectors = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k, {}).get("netNH", 0))) > 0)
    participation_pct = (pos_sectors / float(len(PREFERRED_ORDER))) * 100.0

    # Lux PSI from SPY daily
    psi = None
    closes = fetch_polygon_spy_daily(limit=120) if POLYGON_API_KEY else []
    if closes:
        psi = lux_squeeze_psi(closes, conv=50, length=20)

    # Fallback to source global daily squeeze if Lux failed
    if psi is None:
        src_g = src.get("global") or {}
        psi = float(num(src_g.get("daily_squeeze_pct", None), None)) if src_g else None

    # Vol/Liq bands
    vol_pct = float(num(gauges.get("water", {}).get("pct", 0)))
    vol_band = "calm" if vol_pct < 30 else ("elevated" if vol_pct <= 60 else "high")

    liq_psi = float(num(gauges.get("oil", {}).get("psi", 0)))
    liq_band = "good" if liq_psi >= 60 else ("normal" if liq_psi >= 50 else ("light" if liq_psi >= 40 else "thin"))

    # Trend proxy from breadth & momentum
    b = float(num(gauges.get("rpm", {}).get("pct", 50)))
    m = float(num(gauges.get("speed", {}).get("pct", 50)))
    trend_score = 0.5 * b + 0.5 * m
    trend_state = "up" if trend_score > 55 else ("down" if trend_score < 45 else "flat")

    # Rotation: % offensive outperforming defensives (proxy: netNH>0)
    off_pos = sum(1 for s in OFFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
    def_pos = sum(1 for s in DEFENSIVE if int(num(sectors.get(s, {}).get("netNH", 0))) > 0)
    denom = off_pos + def_pos
    risk_on_pct = (off_pos / denom) * 100.0 if denom > 0 else 50.0

    return {
        "trend":            { "emaSlope": round(trend_score - 50, 1), "state": trend_state },
        "participation":    { "pctAboveMA": round(participation_pct, 1) },
        "squeezeDaily":     { "pct": (round(float(psi), 2) if psi is not None else None) },
        "volatilityRegime": { "atrPct": round(vol_pct, 1), "band": vol_band },
        "liquidityRegime":  { "psi": round(liq_psi, 1), "band": liq_band },
        "rotation":         { "riskOnPct": round(risk_on_pct, 1) },
        "updatedAt":        ts,
        "mode":             "daily",
        "live":             False
    }

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
        rising_count = sum(1 for k in PREFERRED_ORDER if int(num(sectors.get(k, {}).get("netNH", 0))) > 0)
        total_sectors = len(PREFERRED_ORDER)
        rising_pct = (rising_count / total_sectors) * 100.0

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

    # Engine Lights
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
        "outlook": { "sectors": sectors, "sectorCards": cards },
        "engineLights": { "updatedAt": ts, "mode": args.mode, "live": (args.mode == "intraday"), "signals": signals }
    }

    if intraday_block:
        out["intraday"] = intraday_block

    if args.mode in ("daily", "eod"):
        # Attach daily Lux squeeze & other daily trend data
        td = build_trend_daily_with_lux(src, sectors, gz_od["gauges"], ts)
        out["trendDaily"] = td
        # ALSO set gauges.squeezeDaily to Lux (or fallback) so FE can read if needed
        squeeze_val = td.get("squeezeDaily", {}).get("pct", None)
        if squeeze_val is not None:
            out["gauges"]["squeezeDaily"] = {"pct": squeeze_val}

    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | cards={len(cards)} | mode={args.mode}")
    print(f"[summary] breadthIdx={out['summary']['breadthIdx']:.1f} momentumIdx={out['summary']['momentumIdx']:.1f}")

if __name__ == "__main__":
    main()
