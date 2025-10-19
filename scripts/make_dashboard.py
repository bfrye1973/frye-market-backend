#!/usr/bin/env python3
"""
Ferrari Dashboard — make_dashboard.py (10m + Engine Lights, R11 clean)

What this builds (intraday only):
- metrics:
    breadth_pct, momentum_pct      ← from sectorCards counts (ΣNH/(NH+NL), ΣUp/(Up+Down))
    squeeze_pct (0..100)           ← SPY 10m BB/KC over last ~6 bars (clamped)
    liquidity_pct (0..200)         ← 100 * EMA(vol,3)/EMA(vol,12), floor 0
    volatility_pct (small %)       ← 100 * EMA(TR,3)/close (last closed 10m bar)
    volatility_scaled              ← volatility_pct * 6.25 (display only)
    ema_cross, ema10_dist_pct, ema_sign
- intraday:
    overall10m { state, score, components, just_crossed }
    sectorDirection10m.risingPct   ← % sectors breadth>50
    riskOn10m.riskOnPct            ← (#offensive>50 + #defensive<50)/considered * 100
- engineLights.signals             ← R11 lights (overall, EMA crosses, accel, risk, thrust)

Safe behavior:
- If Polygon key is missing or bars are short, we still publish (fill what we can).
- Hourly URL is used only as a fallback to get sectorCards if source isn’t provided.
"""

from __future__ import annotations

import argparse, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

# ---------------------------- Config ----------------------------
HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"
POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)
SYMS = ["SPY", "QQQ"]

# Overall weights
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60  # % distance to reach full ±40pts

OFFENSIVE = {"information technology", "consumer discretionary", "communication services"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

# ------------------------- Utils -------------------------
def now_iso_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out = []
    e = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out

def ema_last(vals: List[float], span: int) -> Optional[float]:
    k = 2.0 / (span + 1.0)
    e = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
    return e

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    trs = []
    for i in range(1, len(C)):
        trs.append(max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])))
    return trs

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "make-dashboard/1.0", "Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_10m(key: str, sym: str, lookback_days: int = 4) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_10M_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url)
    except Exception:
        return []

    rows = js.get("results") or []
    bars = []
    for r in rows:
        try:
            t = int(r["t"]) // 1000
            bars.append(
                {
                    "time": t,
                    "open": float(r["o"]),
                    "high": float(r["h"]),
                    "low": float(r["l"]),
                    "close": float(r["c"]),
                    "volume": float(r.get("v", 0.0)),
                }
            )
        except Exception:
            continue

    # drop in-flight 10m bar
    BUCKET = 600
    if bars:
        now = int(time.time())
        curr_bucket = (now // BUCKET) * BUCKET
        if (bars[-1]["time"] // BUCKET) * BUCKET == curr_bucket:
            bars = bars[:-1]
    return bars

def jread(path: str) -> Optional[dict]:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

# ------------------------- Sector counts → metrics -------------------------
def summarize_sector_cards_count_metrics(cards: List[dict]) -> Tuple[float, float, float, float]:
    # Breadth/Momentum from counts (ΣNH/(NH+NL), ΣUp/(Up+Down))
    NH = NL = UP = DN = 0.0
    for c in cards or []:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0))
    breadth = pct(NH, NH + NL)
    momentum = pct(UP, UP + DN)

    # Rising% = % sectors breadth>50
    good = total = 0
    for c in cards or []:
        bp = c.get("breadth_pct")
        if isinstance(bp, (int, float)):
            total += 1
            if bp > 50.0:
                good += 1
    rising = pct(good, total)

    # Risk-On% = offensive>50 + defensive<50
    by = {(c.get("sector") or "").strip().lower(): c for c in cards or []}
    score = considered = 0
    for s in OFFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            considered += 1
            if bp > 50.0:
                score += 1
    for s in DEFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)):
            considered += 1
            if bp < 50.0:
                score += 1
    risk_on = pct(score, considered)
    return (round(breadth, 2), round(momentum, 2), round(rising, 2), round(risk_on, 2))

# ------------------------- Bars → intraday metrics -------------------------
def squeeze_pct_10m(H: List[float], L: List[float], C: List[float], lookback: int = 6) -> Optional[float]:
    n = lookback
    if min(len(H), len(L), len(C)) < n:
        return None
    cn = C[-n:]; hn = H[-n:]; ln = L[-n:]
    mean = sum(cn) / n
    sd = (sum((x - mean) ** 2 for x in cn) / n) ** 0.5
    bb_w = (mean + 2 * sd) - (mean - 2 * sd)
    prevs = cn[:-1] + [cn[-1]]
    trs6 = [max(h - l, abs(h - p), abs(l - p)) for h, l, p in zip(hn, ln, prevs)]
    kc_w = 2.0 * (sum(trs6) / len(trs6)) if trs6 else 0.0
    if kc_w <= 0.0:
        return None
    return clamp(100.0 * (bb_w / kc_w), 0.0, 100.0)

def liquidity_pct_10m(V: List[float]) -> Optional[float]:
    if not V:
        return None
    v3 = ema_last(V, 3)
    v12 = ema_last(V, 12)
    if not v12 or v12 <= 0:
        return 0.0
    return clamp(100.0 * (v3 / v12), 0.0, 200.0)

def volatility_pct_10m(H: List[float], L: List[float], C: List[float]) -> Optional[float]:
    if not C:
        return None
    if len(C) >= 2:
        trs = tr_series(H, L, C)
        atr = ema_last(trs, 3) if trs else None
        if atr and C[-1] > 0:
            return max(0.0, 100.0 * atr / C[-1])
    else:
        tr = max(H[-1] - L[-1], abs(H[-1] - C[-1]), abs(L[-1] - C[-1]))
        if C[-1] > 0:
            return max(0.0, 100.0 * tr / C[-1])
    return None

def volatility_scaled(vol_pct: Optional[float]) -> float:
    return 0.0 if vol_pct is None else round(vol_pct * 6.25, 2)

# ------------------------- Overall score -------------------------
def lin_points(percent: float, weight: int) -> int:
    # 50% → 0 ; 100% → +weight ; 0% → -weight
    return int(round(weight * ((float(percent) - 50.0) / 50.0)))

def compute_overall10m(
    ema_sign: int,
    ema10_dist_pct: float,
    momentum_pct: float,
    breadth_pct: float,
    squeeze_pct: float,
    liquidity_pct: float,
    riskon_pct: float,
) -> Tuple[str, int, Dict[str, int]]:
    # EMA contribution (±40) using FULL_EMA_DIST window
    dist_unit = clamp(ema10_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = round(abs(dist_unit) * W_EMA) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)

    momentum_pts = lin_points(momentum_pct, W_MOM)
    breadth_pts  = lin_points(breadth_pct,  W_BR)
    squeeze_pts  = lin_points(squeeze_pct,  W_SQ)
    liq_pts      = lin_points(min(100.0, clamp(liquidity_pct, 0.0, 120.0)), W_LIQ)
    riskon_pts   = lin_points(riskon_pct,   W_RISK)

    total = ema_pts + momentum_pts + breadth_pts + squeeze_pts + liq_pts + riskon_pts
    score = int(clamp(50 + total, 0, 100))  # center at 50

    if ema_sign > 0 and score >= 60:
        state = "bull"
    elif ema_sign < 0 and score < 60:
        state = "bear"
    else:
        state = "neutral"

    components = {
        "ema10": ema_pts,
        "momentum": momentum_pts,
        "breadth": breadth_pts,
        "squeeze": squeeze_pts,
        "liquidity": liq_pts,
        "riskOn": riskon_pts,
    }
    return state, score, components

# ------------------------- Engine Lights -------------------------
def build_engine_lights_signals(curr: dict, prev: Optional[dict], ts_local: str) -> dict:
    m  = curr.get("metrics", {})
    it = curr.get("intraday", {})
    ov = it.get("overall10m", {}) if isinstance(it, dict) else {}

    pm = (prev or {}).get("metrics", {}) if isinstance(prev, dict) else {}
    db = (m.get("breadth_pct") or 0) - (pm.get("breadth_pct") or 0)
    dm = (m.get("momentum_pct") or 0) - (pm.get("momentum_pct") or 0)
    accel = (db or 0) + (dm or 0)

    risk_fast   = float(it.get("riskOn10m", {}).get("riskOnPct", 50.0))
    rising_fast = float(it.get("sectorDirection10m", {}).get("risingPct", 0.0))

    ACCEL_INFO = 4.0
    RISK_INFO  = 58.0
    RISK_WARN  = 42.0
    THRUST_ON  = 58.0
    THRUST_OFF = 42.0

    sig = {}
    state = str(ov.get("state") or "neutral").lower()
    score = int(ov.get("score") or 0)

    sig["sigOverallBull"] = {"active": state == "bull" and score >= 10, "severity": "info",
                             "reason": f"state={state} score={score}",
                             "lastChanged": ts_local if state == "bull" and score >= 10 else None}
    sig["sigOverallBear"] = {"active": state == "bear" and score <= -10, "severity": "warn",
                             "reason": f"state={state} score={score}",
                             "lastChanged": ts_local if state == "bear" and score <= -10 else None}

    ema_cross = str(m.get("ema_cross") or "none")
    just_crossed = bool(ov.get("just_crossed"))
    bull_cross = just_crossed and ema_cross == "bull"
    bear_cross = just_crossed and ema_cross == "bear"
    sig["sigEMA10BullCross"] = {"active": bull_cross, "severity": "info",
                                "reason": f"ema_cross={ema_cross}", "lastChanged": ts_local if bull_cross else None}
    sig["sigEMA10BearCross"] = {"active": bear_cross, "severity": "warn",
                                "reason": f"ema_cross={ema_cross}", "lastChanged": ts_local if bear_cross else None}

    sig["sigAccelUp"]   = {"active": accel >=  ACCEL_INFO, "severity": "info",
                           "reason": f"Δb+Δm={accel:.1f}", "lastChanged": ts_local if accel >=  ACCEL_INFO else None}
    sig["sigAccelDown"] = {"active": accel <= -ACCEL_INFO, "severity": "warn",
                           "reason": f"Δb+Δm={accel:.1f}", "lastChanged": ts_local if accel <= -ACCEL_INFO else None}

    sig["sigRiskOn"]  = {"active": risk_fast >= RISK_INFO, "severity": "info",
                         "reason": f"riskOn={risk_fast:.1f}", "lastChanged": ts_local if risk_fast >= RISK_INFO else None}
    sig["sigRiskOff"] = {"active": risk_fast <= RISK_WARN, "severity": "warn",
                         "reason": f"riskOn={risk_fast:.1f}", "lastChanged": ts_local if risk_fast <= RISK_WARN else None}

    sig["sigSectorThrust"] = {"active": rising_fast >= THRUST_ON,  "severity": "info",
                              "reason": f"rising%={rising_fast:.1f}", "lastChanged": ts_local if rising_fast >= THRUST_ON else None}
    sig["sigSectorWeak"]   = {"active": rising_fast <= THRUST_OFF, "severity": "warn",
                              "reason": f"rising%={rising_fast:.1f}", "lastChanged": ts_local if rising_fast <= THRUST_OFF else None}
    return sig

# ------------------------- Core builder -------------------------
def build_intraday(source_js: Optional[dict] = None, hourly_url: str = HOURLY_URL_DEFAULT) -> dict:
    # 1) sectorCards (from source or hourly fallback)
    sector_cards: List[dict] = []
    if isinstance(source_js, dict):
        sector_cards = source_js.get("sectorCards") or source_js.get("outlook", {}).get("sectorCards") or []
    if not sector_cards:
        try:
            hourly = fetch_json(hourly_url)
            sector_cards = hourly.get("sectorCards") or hourly.get("sectors") or []
        except Exception:
            sector_cards = []

    breadth_pct, momentum_pct, rising_pct, risk_on_pct = summarize_sector_cards_count_metrics(sector_cards)

    # 2) SPY 10m bars → squeeze/liquidity/volatility + EMA/cross
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    spy_bars = fetch_polygon_10m(key, "SPY") if key else []
    H = [b["high"] for b in spy_bars]
    L = [b["low"]  for b in spy_bars]
    C = [b["close"] for b in spy_bars]
    V = [b["volume"] for b in spy_bars]

    # squeeze/liquidity/volatility (safe if missing bars)
    sq = squeeze_pct_10m(H, L, C) if spy_bars else None
    liq = liquidity_pct_10m(V) if spy_bars else None
    vol = volatility_pct_10m(H, L, C) if spy_bars else None
    vol_scaled = volatility_scaled(vol)

    # EMA math (prefer last closed bar)
    ema_cross = "none"; just_crossed = False; ema_sign = 0; ema10_dist = 0.0
    if len(C) >= 2:
        e10 = ema_series(C, 10)
        e20 = ema_series(C, 20)
        e10_prev, e20_prev = e10[-2], e20[-2]
        e10_now,  e20_now  = e10[-1], e20[-1]
        close_now          = C[-1]
        if e10_prev < e20_prev and e10_now > e20_now:
            ema_cross, just_crossed = "bull", True
        elif e10_prev > e20_prev and e10_now < e20_now:
            ema_cross, just_crossed = "bear", True
        ema_sign = 1 if e10_now > e20_now else (-1 if e10_now < e20_now else 0)
        ema10_dist = 0.0 if e10_now == 0 else 100.0 * (close_now - e10_now) / e10_now

    # 3) Overall score/state (only if we have the ingredients; else neutral)
    state, score, components = compute_overall10m(
        ema_sign=ema_sign,
        ema10_dist_pct=ema10_dist,
        momentum_pct=momentum_pct or 50.0,
        breadth_pct=breadth_pct or 50.0,
        squeeze_pct=(sq if sq is not None else 50.0),
        liquidity_pct=(liq if liq is not None else 50.0),
        riskon_pct=(risk_on_pct or 50.0),
    )

    # 4) Pack metrics
    metrics = {
        "breadth_pct": breadth_pct,
        "momentum_pct": momentum_pct,
        "ema_cross": ema_cross,
        "ema10_dist_pct": round(ema10_dist, 2),
        "ema_sign": int(ema_sign),
        "squeeze_pct": round((sq if sq is not None else 50.0), 2),
        "liquidity_pct": round((liq if liq is not None else 50.0), 2),
        "volatility_pct": round((vol if vol is not None else 0.0), 3),
        "volatility_scaled": vol_scaled,
    }

    # 5) Intraday block
    intraday = (source_js or {}).get("intraday", {}) or {}
    intraday.setdefault("sectorDirection10m", {})
    intraday["sectorDirection10m"]["risingPct"] = rising_pct
    intraday.setdefault("riskOn10m", {})
    intraday["riskOn10m"]["riskOnPct"] = risk_on_pct
    intraday["overall10m"] = {
        "state": state,
        "score": score,
        "components": components,
        "just_crossed": just_crossed,
    }

    out = {
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S"),
        "updated_at_utc": now_iso_utc(),
        "timestamp": now_iso_utc(),
        "metrics": metrics,
        "intraday": intraday,
        "sectorCards": sector_cards,
    }
    return out

# ------------------------------ CLI -------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")
    ap.add_argument("--source", help="optional source json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--hourly_url", default=os.environ.get("HOURLY_URL", HOURLY_URL_DEFAULT))
    args = ap.parse_args()

    if (args.mode or "intraday").lower() != "intraday":
        print("[warn] only 'intraday' supported; continuing", file=sys.stderr)

    prev_out = jread(args.out)

    source_js = None
    if args.source and os.path.isfile(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                source_js = json.load(f)
        except Exception:
            source_js = None

    out = build_intraday(source_js=source_js, hourly_url=args.hourly_url)

    # Engine lights (safe)
    ts_local = out.get("updated_at") or datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S")
    try:
        signals = build_engine_lights_signals(curr=out, prev=prev_out, ts_local=ts_local)
        out["engineLights"] = {"updatedAt": ts_local, "mode": "intraday", "live": True, "signals": signals}
    except Exception as e:
        print("[warn] engineLights build failed:", e, file=sys.stderr)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("[ok] wrote", args.out)
    ov = out["intraday"]["overall10m"]
    print("overall10m.state=", ov["state"], "score=", ov["score"],
          "ema_sign=", out["metrics"]["ema_sign"], "ema10_dist_pct=", out["metrics"]["ema10_dist_pct"])

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", str(e), file=sys.stderr)
        sys.exit(1)
