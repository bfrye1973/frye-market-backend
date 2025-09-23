#!/usr/bin/env python3
"""
make_dashboard.py (R3 — Scalper-Sensitive Engine Lights)

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
- Engine Lights (SCALPER MODE):
    - 9 fixed keys always emitted
    - Early vs Confirmed ladders (warn → info/danger)
    - lastChanged persisted between runs (data/engine_lights_state.json)
    - Optional gates from Index Scalper (alignment + VIX confirm)
- Output timestamps:
    updated_at       -> America/Phoenix (display)
    updated_at_utc   -> UTC (logs/replay)
    ts               -> legacy UTC key (kept for compatibility)
"""

from __future__ import annotations
import argparse, json, os, math
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import urllib.request
from zoneinfo import ZoneInfo  # stdlib (Python 3.9+)

# ====== CONFIG ======
SCHEMA_VERSION = "r1.3"
VERSION_TAG    = "1.3-intraday-scalper"

PHX_TZ = ZoneInfo("America/Phoenix")
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY", "")

# Engine Lights state (lastChanged)
ENGINE_LIGHTS_STATE_PATH = os.getenv("ENGINE_LIGHTS_STATE_PATH", "data/engine_lights_state.json")
ENGINE_LIGHTS_STRICT     = os.getenv("ENGINE_LIGHTS_STRICT", "true").lower() == "true"

# Preferred sector order (canonical, lower-case)
PREFERRED_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]

# Tilt sets (canonical, lower-case)
OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care"}

# ---------------- timezone helpers ----------------
def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def now_phx_iso() -> str:
    return datetime.now(PHX_TZ).replace(microsecond=0).isoformat()

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

    for k in PREFERRED_ORDER:
        out.setdefault(k, {"nh":0,"nl":0,"up":0,"down":0,"netNH":0,"netUD":0,"spark":[]})
    return out

# ---------------- metrics + summary ----------------
def build_metrics_summary(src: Dict[str, Any], sectors: Dict[str, Any], mode: str) -> Dict[str, Any]:
    g = src.get("global", {}) or {}

    squeeze_intraday = num(pick(g,"squeeze_pressure_pct","squeezePressurePct", default=50))
    volatility_pct   = num(pick(g,"volatility_pct","volatilityPct", default=50))
    liquidity_psi    = num(pick(g,"liquidity_pct","liquidityPct", default=70))
    squeeze_daily    = pick(g,"daily_squeeze_pct","squeeze_daily_pct","squeezeDailyPct", default=None)

    tot_nh = sum(int(num(v.get("nh", 0)))   for v in sectors.values())
    tot_nl = sum(int(num(v.get("nl", 0)))   for v in sectors.values())
    tot_u  = sum(int(num(v.get("up", 0)))   for v in sectors.values())
    tot_d  = sum(int(num(v.get("down", 0))) for v in sectors.values())

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

        breadth_pct  = ratio_pct(nh, nl)
        momentum_pct = ratio_pct(u,  d)

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

# ================== Engine Lights (Scalper) ==================
ALL_LIGHT_KEYS = [
    "sigBreakout","sigDistribution","sigCompression","sigExpansion",
    "sigOverheat","sigTurbo","sigDivergence","sigLowLiquidity","sigVolatilityHigh"
]

def _el_load_state(path: str) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"signals": {k: {"active": False, "lastChanged": None} for k in ALL_LIGHT_KEYS}}

def _el_save_state(path: str, state: Dict[str, Any]) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(state, f)
    except Exception:
        pass

def _mk_sig(active: bool, severity: str, reason: str, last_changed: Optional[str]) -> Dict[str, Any]:
    sev = severity if severity in ("info","warn","danger") else "info"
    return {"active": bool(active), "severity": sev, "reason": reason, "lastChanged": last_changed}

def compute_engine_lights_scalper(
    *,
    summary: Dict[str, Any],
    metrics: Dict[str, Any],
    prev_metrics: Optional[Dict[str, Any]],
    index_scalper_direction: str = "none",   # "long"|"short"|"none"
    index_scalper_streak: int = 0,
    vix_below_ema10: bool = False,
    ts_local_iso: str,
    strict: bool = True
) -> Dict[str, Any]:
    """
    Sensitive (scalper) lights:
      - Early (warn) triggers quickly; Confirmed upgrades to info/danger.
      - Always emit all 9 keys.
      - Persist lastChanged across runs.
    """
    # Load state for lastChanged
    st = _el_load_state(ENGINE_LIGHTS_STATE_PATH)
    last = st.get("signals", {})

    b  = float(num(summary.get("breadth_pct", 50)))
    m  = float(num(summary.get("momentum_pct", 50)))
    q  = float(num(metrics.get("squeeze_intraday_pct", 50)))
    lq = float(num(metrics.get("liquidity_psi", 70)))
    vol= float(num(metrics.get("volatility_pct", 50)))

    m_prev = None if not prev_metrics else float(num(prev_metrics.get("momentum_pct", None), None))
    q_prev = None if not prev_metrics else float(num(prev_metrics.get("squeeze_intraday_pct", None), None))
    m_up   = (m_prev is not None and m > m_prev)
    q_fall = (q_prev is not None and q < q_prev)

    align = index_scalper_direction or "none"
    streak= int(index_scalper_streak or 0)
    vixOK = bool(vix_below_ema10)

    sig: Dict[str, Dict[str, Any]] = {}

    # ---- Compression ----
    if q >= 65:
        sev = "danger" if q >= 85 else "warn"
        sig["sigCompression"] = _mk_sig(True, sev, f"q={q:.1f}", None)
    else:
        sig["sigCompression"] = _mk_sig(False, "info", "", None)

    # ---- Expansion (needs squeeze relief) ----
    if q < 55 and q_fall:
        early = True
        confirmed = (q < 45) and (align in ("long","short")) and vixOK
        sev = "info" if confirmed else "warn"
        sig["sigExpansion"] = _mk_sig(early, sev, f"q={q:.1f} falling={q_fall} align={align} vix={vixOK}", None)
    else:
        sig["sigExpansion"] = _mk_sig(False, "info", "", None)

    # ---- Breakout / Distribution ----
    breakout_early = (b > 55) and (q < 75) and (align == "long") and (streak >= 1)
    breakout_conf  = breakout_early and (vixOK or m >= 58) and (streak >= 2)
    if breakout_early:
        sig["sigBreakout"] = _mk_sig(True, "info" if breakout_conf else "warn",
                                     f"b={b:.1f} q={q:.1f} align={align} vix={vixOK} m={m:.1f}", None)
    else:
        sig["sigBreakout"] = _mk_sig(False, "info", "", None)

    if b < 45:
        sig["sigDistribution"] = _mk_sig(True, "danger" if b < 30 else "info", f"b={b:.1f}", None)
    else:
        sig["sigDistribution"] = _mk_sig(False, "info", "", None)

    # ---- Overheat / Turbo ----
    if m > 80:
        sig["sigOverheat"] = _mk_sig(True, "danger" if m >= 92 else "warn", f"m={m:.1f}", None)
        turbo = (m >= 88) and (q < 75) and (align == "long")
        sig["sigTurbo"] = _mk_sig(turbo, "info", f"m={m:.1f} q={q:.1f} align={align}", None)
    else:
        sig["sigOverheat"] = _mk_sig(False, "info", "", None)
        sig["sigTurbo"]    = _mk_sig(False, "info", "", None)

    # ---- Divergence ----
    if (m > 68) and (b < 52):
        sig["sigDivergence"] = _mk_sig(True, "warn", f"m={m:.1f} b={b:.1f}", None)
    else:
        sig["sigDivergence"] = _mk_sig(False, "info", "", None)

    # ---- Liquidity / Volatility ----
    if lq < 45:
        sig["sigLowLiquidity"] = _mk_sig(True, "danger" if lq < 30 else "warn", f"psi={lq:.1f}", None)
    else:
        sig["sigLowLiquidity"] = _mk_sig(False, "info", "", None)

    if vol > 65:
        sig["sigVolatilityHigh"] = _mk_sig(True, "danger" if vol >= 85 else "warn", f"vol={vol:.1f}", None)
    else:
        sig["sigVolatilityHigh"] = _mk_sig(False, "info", "", None)

    # Ensure all 9 keys exist
    for k in ALL_LIGHT_KEYS:
        sig.setdefault(k, _mk_sig(False, "info", "", None))

    # lastChanged stamping
    for k in ALL_LIGHT_KEYS:
        prev_active = bool(last.get(k, {}).get("active", False))
        now_active  = bool(sig[k]["active"])
        prev_ts     = last.get(k, {}).get("lastChanged")
        sig[k]["lastChanged"] = ts_local_iso if (now_active != prev_active) else prev_ts

    # Persist snapshot
    st["signals"] = {k: {"active": sig[k]["active"], "lastChanged": sig[k]["lastChanged"]} for k in ALL_LIGHT_KEYS}
    _el_save_state(ENGINE_LIGHTS_STATE_PATH, st)

    return sig

# ---------------- polygon helpers (daily) ----------------
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
    breadth  = float(num(metrics.get("breadth_pct", 50)))
    momentum = float(num(metrics.get("momentum_pct", 50)))
    daily_sq = float(num(metrics.get("squeeze_daily_pct", 50)))
    S = daily_sq / 100.0

    adr_momo = 50.0

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
        "rotation":         { "riskOnPct": 50.0 },
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

    # Build analytics + legacy mirror
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

    # ---------- SCALPER ENGINE LIGHTS ----------
    # Read previous OUT to get slope inputs (momentum/squeeze deltas)
    prev_out = jread(args.out)
    prev_metrics = prev_out.get("metrics") if isinstance(prev_out, dict) else None

    # Optional Index Scalper meta if builder placed it in the source (use your real keys if present)
    scalper = src.get("index_scalper") or src.get("scalper") or {}
    index_scalper_direction = (scalper.get("direction") or "none").lower()
    index_scalper_streak    = int(num(scalper.get("streak"), 0))
    vix_below_ema10         = bool(scalper.get("vix_below_ema10", False))

    # Build scalper-sensitive signals (always 9 keys)
    signals = compute_engine_lights_scalper(
        summary = ms_od["summary"],
        metrics = ms_od["metrics"],
        prev_metrics = prev_metrics,
        index_scalper_direction = index_scalper_direction,
        index_scalper_streak    = index_scalper_streak,
        vix_below_ema10         = vix_below_ema10,
        ts_local_iso = ts_local,
        strict = ENGINE_LIGHTS_STRICT
    )

    # Compose output
    out = {
        "schema_version": SCHEMA_VERSION,
        "updated_at": ts_local,
        "updated_at_utc": ts_utc,
        "ts": ts_utc,
        "version": VERSION_TAG,
        "pipeline": normalized_mode,

        "metrics": ms_od["metrics"],
        "summary": ms_od["summary"],
        "odometers": ms_od["odometers"],
        "gauges": ms_od["gauges"],

        "sectorsUpdatedAt": ts_local,
        "sectorCards": cards,
        "outlook": {"sectors": sectors, "sectorCards": cards},

        "engineLights": {
            "updatedAt": ts_local,
            "mode": normalized_mode,
            "live": (args.mode=="intraday"),
            "signals": signals
        }
    }

    if intraday_block:
        out["intraday"] = intraday_block

    if args.mode in ("daily","eod","hourly"):
        td = lux_trend_daily(sectors, ms_od["metrics"], ts_local)
        out["trendDaily"]=td
        if "squeeze_daily_pct" in ms_od["metrics"]:
            out["gauges"]["squeezeDaily"] = {"pct": ms_od["metrics"]["squeeze_daily_pct"]}

    # Write
    jwrite(args.out, out)
    print(f"Wrote {args.out} | sectors={len(sectors)} | mode={args.mode}")
    print(f"[summary] breadth={out['summary']['breadth_pct']:.1f} momentum={out['summary']['momentum_pct']:.1f}")
    print(f"[engine] lights keys={list(out['engineLights']['signals'].keys())}")

if __name__ == "__main__":
    main()
