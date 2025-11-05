#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard.py (Intraday 10m • Engine Lights + Market Meter aligned)

- Keeps Fast-Pill/Engine-Lights from your teammate
- Restores Market-Meter JSON keys so 10m lights show properly
- Adds FAST breadth from sector ETFs (EMA10>EMA20 + bar-up)
- Provides liquidity_psi and volatility_pct for liquidity/volatility tiles
- NEW: 10m Overall uses a composite score (EMA/Momentum/Breadth/Expansion/Liquidity/RiskOn) with 60/40 thresholds
- NEW: Risk-On 10m falls back to neutral 50 when sector cards are not available
"""

from __future__ import annotations
import argparse
import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

VERSION_TAG = "r12.8-fast-pills-mmfix-etfbreadth-composite10m"
PHX_TZ = "America/Phoenix"

POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

# Fast-pill EMA/SMI settings
EMA_FAST_SHORT = 8
EMA_FAST_LONG  = 18
ACCEL_10M_ON   = 2.5
EARLY_GAP_PCT  = 0.05
EARLY_VOL_MIN  = 0.8
SQUEEZE_TIGHT  = 80.0
SQUEEZE_EXP    = 60.0

# Market-scoring weights (mirrors 1h/EOD ratios)
W_EMA  = 0.40
W_MOM  = 0.25
W_BR   = 0.10
W_SQ   = 0.10
W_LIQ  = 0.10
W_RISK = 0.05

OFFENSIVE = {"information technology", "consumer discretionary", "communication services", "industrials"}
DEFENSIVE = {"consumer staples", "utilities", "health care", "real estate"}

# Sector ETF universe (for FAST breadth)
SECTOR_ETFS = ["XLK", "XLY", "XLC", "XLP", "XLU", "XLV", "XLRE", "XLE", "XLF", "XLB", "XLI"]


# ----------------------- utils -----------------------
def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)


def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "make-dashboard/10m/1.0", "Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_polygon_10m(key: str, sym: str, lookback_days: int = 5) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_10M_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url)
    except Exception:
        return []
    rows = js.get("results") or []
    out: List[dict] = []
    for r in rows:
        try:
            t = int(r["t"]) // 1000
            out.append(
                {
                    "time": t,
                    "open": float(r.get("o", 0.0)),
                    "high": float(r.get("h", 0.0)),
                    "low": float(r.get("l", 0.0)),
                    "close": float(r.get("c", 0.0)),
                    "volume": float(r.get("v", 0.0)),
                }
            )
        except Exception:
            continue
    # drop in-flight 10m bar
    if out:
        BUCKET = 600
        now = int(time.time())
        cur = (now // BUCKET) * BUCKET
        if (out[-1]["time"] // BUCKET) * BUCKET == cur:
            out = out[:-1]
    return out


def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    e: Optional[float] = None
    out: List[float] = []
    for v in vals:
        e = v if e is None else e + k * (v - e)
        out.append(e)
    return out


def ema_last(vals: List[float], span: int) -> Optional[float]:
    k = 2.0 / (span + 1.0)
    e: Optional[float] = None
    for v in vals:
        e = v if e is None else e + k * (v - e)
    return e


def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]


def lux_psi_from_closes(C: List[float], conv: int = 50, length: int = 20) -> float:
    n = len(C)
    if n < max(length + 2, 5):
        return 50.0
    maxv = minv = C[0]
    max_arr = [0.0] * n
    min_arr = [0.0] * n
    for i, v in enumerate(C):
        maxv = max(v, maxv - (maxv - v) / float(conv))
        minv = min(v, minv + (v - minv) / float(conv))
        max_arr[i] = maxv
        min_arr[i] = minv
    diff = []
    for i in range(n):
        span = max(max_arr[i] - min_arr[i], 1e-12)
        diff.append(math.log(span))
    w = length
    xs = list(range(n - w, n))
    ys = diff[-w:]
    mx = sum(xs) / w
    my = sum(ys) / w
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    deny = math.sqrt(sum((y - my) ** 2 for y in ys))
    corr = (num / (denx * deny)) if (denx > 0 and deny > 0) else 0.0
    return -50.0 * corr + 50.0


def smi_kd_series(H: List[float], L: List[float], C: List[float], k_len: int = 12, d_len: int = 7, ema_len: int = 5):
    n = len(C)
    if n < max(k_len, d_len) + 6:
        return [], []
    HH = [max(H[max(0, i - (k_len - 1)) : i + 1]) for i in range(n)]
    LL = [min(L[max(0, i - (k_len - 1)) : i + 1]) for i in range(n)]
    mid = [(HH[i] + LL[i]) / 2.0 for i in range(n)]
    rng = [(HH[i] - LL[i]) for i in range(n)]
    m = [C[i] - mid[i] for i in range(n)]
    m1 = ema_series(m, k_len)
    m2 = ema_series(m1, ema_len)
    r1 = ema_series(rng, k_len)
    r2 = ema_series(r1, ema_len)
    K = []
    for i in range(n):
        denom = (r2[i] or 0.0) / 2.0
        v = 0.0 if denom == 0 else 100.0 * (m2[i] / denom)
        if not (v == v):
            v = 0.0
        K.append(max(-100.0, min(100.0, v)))
    D = ema_series(K, d_len)
    return K, D


# -------- FAST breadth from sector ETFs (EMA10>20 + bar-up) --------
def fetch_etf_bars_10m(key: str, syms: List[str], lookback_days: int = 3) -> Dict[str, List[dict]]:
    out = {}
    for s in syms:
        try:
            rows = fetch_polygon_10m(key, s, lookback_days)
            if rows:
                out[s] = rows
        except Exception:
            pass
    return out


def fast_breadth_from_etfs(etf_bars: Dict[str, List[dict]]) -> Tuple[float, float, float]:
    syms = [s for s in etf_bars if len(etf_bars[s]) >= 2]
    if not syms:
        return 50.0, 50.0, 50.0
    aligned = barup = 0
    total = len(syms)
    for s in syms:
        bars = etf_bars[s]
        C = [b["close"] for b in bars]
        O = [b["open"] for b in bars]
        e10 = ema_series(C, 10)
        e20 = ema_series(C, 20)
        if e10[-1] > e20[-1]:
            aligned += 1
        if C[-1] > O[-1]:
            barup += 1
    a = round(100.0 * aligned / total, 2)
    b = round(100.0 * barup / total, 2)
    breadth = round(clamp(0.60 * a + 0.40 * b, 0.0, 100.0), 2)
    return a, b, breadth


# ----------------------- builder -----------------------
def build_intraday(source_js=None, prev_out=None):
    # sector cards (for rising% & riskon proxy)
    cards = (source_js or {}).get("sectorCards") or []
    NH = NL = UP = DN = 0.0
    rising_count = total_cards = 0
    for c in cards:
        NH += float(c.get("nh", 0))
        NL += float(c.get("nl", 0))
        UP += float(c.get("up", 0))
        DN += float(c.get("down", 0))
        bp = c.get("breadth_pct")
        if isinstance(bp, (int, float)):
            total_cards += 1
            if bp > 50.0:
                rising_count += 1

    breadth_slow  = round(pct(NH, NH + NL), 2) if (NH + NL) > 0 else 50.0
    momentum_slow = round(pct(UP, UP + DN), 2) if (UP + DN) > 0 else 50.0
    rising_pct    = round(pct(rising_count, total_cards), 2) if total_cards > 0 else 50.0

    # bars
    key = os.getenv("POLYGON_API_KEY") or ""
    bars_10m = fetch_polygon_10m(key, "SPY", 5) if key else []
    H = [b["high"] for b in bars_10m]
    L = [b["low"]  for b in bars_10m]
    C = [b["close"] for b in bars_10m]
    V = [b["volume"] for b in bars_10m]

    # EMA posture
    ema8 = ema_series(C, EMA_FAST_SHORT)
    ema18 = ema_series(C, EMA_FAST_LONG)
    ema_sign = 1 if (ema8 and ema18 and ema8[-1] > ema18[-1]) else (-1 if (ema8 and ema18 and ema8[-1] < ema18[-1]) else 0)
    ema_gap_pct = 0.0 if not ema18 else (100.0 * (ema8[-1] - ema18[-1]) / ema18[-1])

    # PSI tightness + Δ
    psi_10m   = lux_psi_from_closes(C) if C else 50.0      # tightness (high=bad)
    psi_prev  = lux_psi_from_closes(C[:-1]) if len(C) > 1 else psi_10m
    d_psi     = round(psi_10m - psi_prev, 2)

    # Momentum combo (EMA slope + SMI diff)
    K, D = smi_kd_series(H, L, C)
    smi_diff = (K[-1] - D[-1]) if (K and D) else 0.0
    ema_slope_score = clamp(50.0 + 50.0 * clamp(ema_gap_pct / 0.60, -1.0, 1.0), 0.0, 100.0)  # 0.60% = full credit
    momentum_combo_10m = round(clamp(0.7 * ema_slope_score + 0.3 * (50.0 + 0.5 * smi_diff), 0.0, 100.0), 2)
    momentum_10m = momentum_combo_10m

    # Liquidity & Volatility (for tiles)
    vol3  = ema_last(V, 3)  or 0.0
    vol12 = ema_last(V, 12) or 1.0
    liquidity_psi  = clamp(100.0 * (vol3 / vol12), 0.0, 200.0)
    trs  = tr_series(H, L, C)
    atr  = ema_last(trs, 3) or 0.0
    volatility_pct = max(0.0, 100.0 * atr / C[-1]) if C else 0.0

    # RiskOn proxy using sector cards; neutral if no usable cards
    by = {(c.get("sector") or "").strip().lower(): c for c in cards}
    off_pos = def_pos = 0
    for s in OFFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)) and bp > 50.0:
            off_pos += 1
    for s in DEFENSIVE:
        bp = by.get(s, {}).get("breadth_pct")
        if isinstance(bp, (int, float)) and bp < 50.0:
            def_pos += 1
    cons = off_pos + def_pos
    risk_on_10m = round(100.0 * off_pos / float(cons), 2) if cons > 0 else 50.0

    # --- FAST breadth from sector ETFs (A=EMA10>20, B=bar-up)
    align_pct = barup_pct = None
    breadth_fast = None
    if key:
        etf_bars = fetch_etf_bars_10m(key, SECTOR_ETFS, lookback_days=3)
        a, b, bf = fast_breadth_from_etfs(etf_bars)
        align_pct, barup_pct, breadth_fast = a, b, bf

    # Final breadth_10m
    if breadth_fast is not None:
        breadth_10m = breadth_fast
    else:
        # fallback proxy if ETF data missing
        breadth_10m = round(
            clamp(0.60 * breadth_slow + 0.40 * (50.0 + 50.0 * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0) * min(1.0, abs(ema_gap_pct) / 0.5)), 0.0, 100.0),
            2
        )

    # accel vs previous run
    pm   = (prev_out or {}).get("metrics") or {}
    prev_b10 = pm.get("breadth_10m_pct", breadth_10m)
    prev_m10 = pm.get("momentum_10m_pct", momentum_10m)
    dB = round(breadth_10m - (prev_b10 or 0.0), 2)
    dM = round(momentum_10m - (prev_m10 or 0.0), 2)
    accel = round(dB + dM, 2)

    # ---- METRICS for Market Meter (UI expects these) ----
    metrics = {
        "breadth_10m_pct":        breadth_10m,
        "momentum_10m_pct":       momentum_10m,
        "momentum_combo_10m_pct": momentum_combo_10m,
        "squeeze_psi_10m_pct":    round(psi_10m,  2),   # PSI tightness
        "squeeze_pct":            round(psi_10m,  2),   # alias for tile (tightness)
        "squeeze_expansion_pct":  round(100.0-psi_10m,2),
        "liquidity_psi":          round(liquidity_psi,2),
        "volatility_pct":         round(volatility_pct,3),
        "ema_sign":               ema_sign,
        "ema_gap_pct":            round(ema_gap_pct,3),
        "breadth_slow_pct":       breadth_slow,
        "momentum_slow_pct":      momentum_slow,
        # optional QA
        "breadth_align_fast_pct": align_pct,
        "breadth_barup_fast_pct": barup_pct,
    }

    # ---------- 10m composite overall (align with 1h/EOD) ----------
    expansion_10m = 100.0 - psi_10m                      # higher = better
    liq10_pct     = min(liquidity_psi, 120.0) * (100.0 / 120.0)

    ema_posture_10m = 50.0 + 50.0 * clamp(ema_gap_pct / 0.60, -1.0, 1.0)  # 0..100
    # keep signed EMA component for the detail breakdown
    ema_component = int(round(40.0 * clamp(abs(ema_gap_pct)/0.60, 0.0, 1.0) * (1 if ema_sign>0 else -1 if ema_sign<0 else 0)))

    part_ema  = ema_posture_10m
    part_mom  = momentum_10m
    part_br   = breadth_10m
    part_sq   = expansion_10m
    part_liq  = liq10_pct
    part_risk = risk_on_10m

    overall10m_score = (
        W_EMA  * part_ema +
        W_MOM  * part_mom +
        W_BR   * part_br  +
        W_SQ   * part_sq  +
        W_LIQ  * part_liq +
        W_RISK * part_risk
    )
    overall10m_score = float(clamp(overall10m_score, 0.0, 100.0))
    overall10m_state = "bull" if overall10m_score >= 60.0 else ("bear" if overall10m_score <= 40.0 else "neutral")

    # ---- INTRADAY nesting expected by UI ----
    intraday = {
        "sectorDirection10m": {"risingPct": rising_pct},
        "riskOn10m":          {"riskOnPct": risk_on_10m},
        "overall10m": {
            "state": overall10m_state,
            "score": int(round(overall10m_score)),
            "components": {
                "ema10":    ema_component,
                "momentum": int(round(25.0 * (part_mom  - 50.0) / 50.0)),
                "breadth":  int(round(10.0 * (part_br   - 50.0) / 50.0)),
                "squeeze":  int(round(10.0 * (part_sq   - 50.0) / 50.0)),
                "liquidity":int(round(10.0 * (part_liq  - 50.0) / 50.0)),
                "riskOn":   int(round( 5.0 * (part_risk - 50.0) / 50.0)),
            }
        }
    }

    # ---- Engine Lights (kept) ----
    lights: Dict[str, Dict[str, Any]] = {}
    def put(n: str, a: bool, s: str, r: str):
        lights[n] = {
            "active": bool(a),
            "severity": s,
            "reason": r,
            "lastChanged": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
        }

    put("sigAccelUp",   accel >= ACCEL_10M_ON,  "info",  f"ΔB {dB:+.2f} + ΔM {dM:+.2f} = {accel:+.2f}")
    put("sigAccelDown", accel <= -ACCEL_10M_ON, "warn",  f"ΔB {dB:+.2f} + ΔM {dM:+.2f} = {accel:+.2f}")
    if psi_10m >= SQUEEZE_TIGHT:
        put("sigCompression", True, "warn", f"PSI {psi_10m:.1f}")
    elif (psi_10m <= SQUEEZE_EXP) or ((psi_10m - psi_prev) <= -3.0):
        put("sigExpansion", True, "info", f"PSI {psi_10m:.1f} Δ{d_psi:+.2f}")

    out = {
        "version": VERSION_TAG,
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": now_utc_iso(),
        "metrics": metrics,
        "intraday": intraday,
        "engineLights": {
            "updatedAt": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
            "mode": "intraday",
            "live": True,
            "signals": lights
        },
        "sectorCards": cards
    }
    return out


# ----------------------- CLI -----------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")
    ap.add_argument("--source", default="", help="optional source json (sectorCards)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    prev = None
    if os.path.exists(args.out):
        try:
            prev = json.load(open(args.out, "r", encoding="utf-8"))
        except Exception:
            prev = None

    src = None
    if args.source and os.path.exists(args.source):
        try:
            src = json.load(open(args.source, "r", encoding="utf-8"))
        except Exception:
            src = None

    out = build_intraday(src, prev)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(
        "[ok] wrote", args.out,
        "| version=", out.get("version"),
        "| 10m breadth=", out["metrics"].get("breadth_10m_pct"),
        "| 10m momentum=", out["metrics"].get("momentum_10m_pct"),
        "| 10m overall=", out["intraday"]["overall10m"]["score"]
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(1)
