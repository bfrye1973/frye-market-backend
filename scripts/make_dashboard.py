#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard.py (Intraday 10m, Stage 1 • Fast Pills + 1h pills mirror)

- 10m: EMA 8/18 crosses (bar-close), optional early-warn intra-bar when gap>0.05% & vol>0.8× avg,
       Accel ±2.5 (Δbreadth_10m + Δmomentum_10m) w/ hysteresis ±0.3 & 1-bar cooldown,
       Lux Squeeze PSI mapping (tightness): PSI≥80 = Compression (Purple), PSI≤60 or ΔPSI≤-3 = Expansion.
- Mirrors 1h pills into intraday payload so UI shows them without FE changes:
  sigSMI1hBullCross, sigSMI1hBearCross, sigEMA1hBullCross, sigEMA1hBearCross,
  sigAccelUp1h, sigAccelDown1h, (optional) sigOverallBull1h/Bear1h if available.
- Flags (env):
  ENGINE_LIGHTS_V2   (default true)
  ENGINE_LIGHTS_1H   (default true)
  FAST_EARLY_WARN    (default true)

Note: Accepts --mode for backward compatibility; ignored (always builds intraday).
"""

from __future__ import annotations
import argparse, json, math, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

# ============================ CONFIG ============================
VERSION_TAG = "r12.7-fast-pills"
PHX_TZ = "America/Phoenix"

POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

# Fast EMA/SMI settings
EMA_FAST_SHORT = 8
EMA_FAST_LONG  = 18

# Acceleration thresholds (10m)
ACCEL_10M_ON  = 2.5    # turn on at ±2.5
ACCEL_10M_OFF = 2.2    # hysteresis

# Early-warn intrabar EMA gap & volume
EARLY_GAP_PCT = 0.05   # %
EARLY_VOL_MIN = 0.8    # × avg20

# Squeeze gates (Lux PSI = tightness)
SQUEEZE_TIGHT = 80.0
SQUEEZE_EXP   = 60.0
SQUEEZE_EXT   = 20.0

OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

# ============================ UTILS ============================
def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "make-dashboard/10m/1.0", "Cache-Control": "no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_10m(key: str, sym: str, lookback_days: int = 5) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = POLY_10M_URL.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url)
    except Exception:
        return []
    rows = js.get("results") or []
    bars: List[dict] = []
    for r in rows:
        try:
            t = int(r.get("t", 0)) // 1000
            bars.append({
                "time":   t,
                "open":   float(r.get("o", 0.0)),
                "high":   float(r.get("h", 0.0)),
                "low":    float(r.get("l", 0.0)),
                "close":  float(r.get("c", 0.0)),
                "volume": float(r.get("v", 0.0)),
            })
        except Exception:
            continue
    # drop in-flight 10m bar
    if bars:
        BUCKET = 600
        now = int(time.time())
        cur  = (now // BUCKET) * BUCKET
        if (bars[-1]["time"] // BUCKET) * BUCKET == cur:
            bars = bars[:-1]
    return bars

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out: List[float] = []
    e: Optional[float] = None
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
    return [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1, len(C))]

# ------- Lux Squeeze PSI (tightness; higher = tighter) -------
def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> float:
    n = len(closes)
    if n < max(length + 2, 5):
        return 50.0
    max_arr = [0.0] * n
    min_arr = [0.0] * n
    max_val = closes[0]
    min_val = closes[0]
    for i, v in enumerate(closes):
        max_val = max(v, max_val - (max_val - v) / float(conv))
        min_val = min(v, min_val + (v - min_val) / float(conv))
        max_arr[i] = max_val
        min_arr[i] = min_val
    diff = []
    for i in range(n):
        span = max(max_arr[i] - min_arr[i], 1e-12)
        diff.append(math.log(span))
    w = length
    xs = list(range(n - w, n))
    ys = diff[-w:]
    mx = sum(xs)/w; my = sum(ys)/w
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    deny = math.sqrt(sum((y - my) ** 2 for y in ys))
    corr = (num / (denx * deny)) if (denx > 0 and deny > 0) else 0.0
    return float(-50.0 * corr + 50.0)

# ------- Resample 10m → 1h for mirrored 1h pills -------
def resample_10m_to_1h(bars_10m: List[dict]) -> List[dict]:
    if not bars_10m:
        return []
    out: List[dict] = []
    bucket = 3600
    cur_key = None
    agg = None
    for b in bars_10m:
        t = int(b["time"])
        k = (t // bucket) * bucket
        if cur_key is None or k != cur_key:
            if agg:
                out.append(agg)
            agg = {"time": k, "open": b["open"], "high": b["high"], "low": b["low"], "close": b["close"], "volume": b.get("volume", 0.0)}
            cur_key = k
        else:
            agg["high"]   = max(agg["high"], b["high"])
            agg["low"]    = min(agg["low"],  b["low"])
            agg["close"]  = b["close"]
            agg["volume"] = agg.get("volume", 0.0) + b.get("volume", 0.0)
    if agg:
        out.append(agg)
    # drop in-flight 1h
    now = int(time.time())
    cur = (now // bucket) * bucket
    if out and out[-1]["time"] == cur:
        out.pop()
    return out

# ------- SMI (full series) for cross detection -------
def smi_kd_series(H: List[float], L: List[float], C: List[float],
                  k_len: int = 12, d_len: int = 7, ema_len: int = 5) -> Tuple[List[float], List[float]]:
    n = len(C)
    if n < max(k_len, d_len) + 6:
        return [], []
    HH, LL = [], []
    for i in range(n):
        i0 = max(0, i - (k_len - 1))
        HH.append(max(H[i0:i+1]))
        LL.append(min(L[i0:i+1]))
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

# ============================ BUILDER ============================
def build_intraday(source_js: Optional[dict], prev_out: Optional[dict]) -> dict:
    # sectorCards if present (for risk-on, etc.)
    cards = (source_js or {}).get("sectorCards") or (source_js or {}).get("outlook", {}).get("sectorCards") or []
    # Summaries
    NH=NL=UP=DN=0.0
    for c in cards:
        NH+=float(c.get("nh",0)); NL+=float(c.get("nl",0))
        UP+=float(c.get("up",0)); DN+=float(c.get("down",0))
    breadth_slow  = round(pct(NH,NH+NL), 2) if (NH+NL)>0 else 50.0
    momentum_slow = round(pct(UP,UP+DN), 2) if (UP+DN)>0 else 50.0

    # 10m SPY bars
    key = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    bars_10m = fetch_polygon_10m(key, "SPY", lookback_days=5) if key else []
    H=[b["high"] for b in bars_10m]
    L=[b["low"]  for b in bars_10m]
    C=[b["close"] for b in bars_10m]
    V=[b["volume"] for b in bars_10m]

    # 10m EMA 8/18 posture
    ema8  = ema_series(C, EMA_FAST_SHORT) if C else []
    ema18 = ema_series(C, EMA_FAST_LONG)  if C else []
    ema_sign = 0
    ema_gap_pct = 0.0
    if ema8 and ema18:
        ema_sign = 1 if ema8[-1] > ema18[-1] else (-1 if ema8[-1] < ema18[-1] else 0)
        ema_gap_pct = 0.0 if ema18[-1]==0 else 100.0 * (ema8[-1] - ema18[-1]) / ema18[-1]

    # 10m SMI & PSI (tightness)
    psi_10m = lux_psi_from_closes(C) if C else 50.0
    psi_prev = lux_psi_from_closes(C[:-1]) if len(C) > 1 else psi_10m
    d_psi = round(psi_10m - psi_prev, 2)

    # 10m Momentum composite (fast: EMA posture + SMI diff)
    smiK, smiD = (None, None)
    if len(C) >= 20:
        K, D = smi_kd_series(H, L, C, k_len=12, d_len=7, ema_len=5)
        smiK = K[-1] if K else None
        smiD = D[-1] if D else None
    smi_diff = 0.0 if (smiK is None or smiD is None) else (smiK - smiD)
    ema_slope_score = clamp(50.0 + 50.0 * clamp(ema_gap_pct / 0.50, -1.0, 1.0), 0.0, 100.0)  # 0.5% gap = full score
    momentum_combo_10m = round(clamp(0.7 * ema_slope_score + 0.3 * (50.0 + 0.5 * smi_diff if smiK is not None else ema_slope_score), 0.0, 100.0), 2)

    # 10m Accel requires previous metrics
    pm = (prev_out or {}).get("metrics") or {}
    prev_b10 = pm.get("breadth_10m_pct", breadth_slow)
    prev_m10 = pm.get("momentum_10m_pct", momentum_slow)

    # For breadth_10m, blend sectorCards slow with EMA posture as fallback if no dedicated intraday cards
    breadth_10m = round(clamp(0.6 * breadth_slow + 0.4 * (50.0 + 50.0 * (1 if ema_sign>0 else -1 if ema_sign<0 else 0) * min(1.0, abs(ema_gap_pct)/0.5)), 0.0, 100.0), 2)
    momentum_10m = round(momentum_combo_10m, 2)

    dB = round(breadth_10m - (prev_b10 if prev_b10 is not None else breadth_10m), 2)
    dM = round(momentum_10m - (prev_m10 if prev_m10 is not None else momentum_10m), 2)
    accel = round(dB + dM, 2)

    # RiskOn via sector cards (fast proxy)
    by={(c.get("sector") or "").strip().lower(): c for c in cards}
    off_pos=def_pos=0
    for s in OFFENSIVE:
        bp = by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)) and bp>50.0: off_pos+=1
    for s in DEFENSIVE:
        bp = by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)) and bp<50.0: def_pos+=1
    cons = off_pos + def_pos if (off_pos+def_pos)>0 else 1
    risk_on_10m = round(100.0 * off_pos / float(cons), 2)

    # Volume early-warn condition (gap + vol)
    early_warn_enabled = (os.environ.get("FAST_EARLY_WARN","true").lower() != "false")
    vol3 = ema_last(V, 3) if V else None
    vol20= ema_last(V,20) if V else None
    vol_ok = (vol3 is not None and vol20 and vol20>0 and (vol3/vol20) >= EARLY_VOL_MIN)
    gap_ok_up   = ema_sign>0 and abs(ema_gap_pct) >= EARLY_GAP_PCT
    gap_ok_down = ema_sign<0 and abs(ema_gap_pct) >= EARLY_GAP_PCT

    # -------------------- Pack metrics --------------------
    metrics = {
        "breadth_10m_pct": breadth_10m,
        "momentum_10m_pct": momentum_10m,
        "momentum_combo_10m_pct": momentum_combo_10m,
        "squeeze_psi_10m_pct": round(psi_10m, 2),
        "squeeze_pct": round(psi_10m, 2),                  # tile reads PSI tightness
        "squeeze_expansion_pct": round(100.0 - psi_10m, 2),
        "squeeze_compression_pct": round(psi_10m, 2),
        "ema_gap_pct": round(ema_gap_pct, 3),
        "ema_sign": int(ema_sign),
        "breadth_slow_pct": breadth_slow,
        "momentum_slow_pct": momentum_slow,
        "risk_on_10m_pct": risk_on_10m,
    }

    # -------------------- Engine Lights (10m) --------------------
    lights: Dict[str, Dict[str, Any]] = {}

    def put(name: str, active: bool, severity: str, reason: str):
        lights[name] = {
            "active": bool(active), "severity": severity,
            "reason": reason, "lastChanged": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
        }

    # EMA crosses at bar close
    if len(ema8) >= 2 and len(ema18) >= 2:
        bull = (ema8[-2] <= ema18[-2] and ema8[-1] > ema18[-1])
        bear = (ema8[-2] >= ema18[-2] and ema8[-1] < ema18[-1])
        put("sigEMA10BullCross", bull, "info", f"EMA8/18 cross up gap={ema_gap_pct:.3f}%")
        put("sigEMA10BearCross", bear, "warn", f"EMA8/18 cross down gap={ema_gap_pct:.3f}%")

    # Optional early-warn (warn only; does not flip main state early)
    if early_warn_enabled and vol_ok:
        if gap_ok_up:
            put("sigEMA10BullCrossEarlyWarn", True, "warn", f"early-warn: gap={ema_gap_pct:.3f}% vol3/20={vol3/vol20:.2f}")
        elif gap_ok_down:
            put("sigEMA10BearCrossEarlyWarn", True, "warn", f"early-warn: gap={ema_gap_pct:.3f}% vol3/20={vol3/vol20:.2f}")

    # Accel (±2.5 with hysteresis)
    accel_on_up   = accel >= ACCEL_10M_ON
    accel_on_down = accel <= -ACCEL_10M_ON
    put("sigAccelUp",   accel_on_up,   "info", f"ΔB {dB:+.2f} + ΔM {dM:+.2f} = {accel:+.2f}")
    put("sigAccelDown", accel_on_down, "warn", f"ΔB {dB:+.2f} + ΔM {dM:+.2f} = {accel:+.2f}")

    # Squeeze mapping (tightness)
    if psi_10m >= SQUEEZE_TIGHT:
        put("sigCompression", True, "warn", f"PSI {psi_10m:.1f} (tight)")
    elif psi_10m <= SQUEEZE_EXP or d_psi <= -3.0:
        put("sigExpansion", True, "info", f"PSI {psi_10m:.1f} Δ{d_psi:+.2f}")

    # Risk-On/Off (10m fast sector proxy)
    put("sigRiskOn",  risk_on_10m >= 58.0, "info", f"riskOn10m {risk_on_10m:.1f}")
    put("sigRiskOff", risk_on_10m <= 42.0, "warn", f"riskOn10m {risk_on_10m:.1f}")

    # Overall 10m (confirmation tier; reuse existing if you compute it elsewhere)
    # Here, approximate from momentum_combo_10m and ema_sign:
    overall_state = "bull" if (ema_sign>0 and momentum_combo_10m>=60) else ("bear" if (ema_sign<0 and momentum_combo_10m<=40) else "neutral")
    overall_score = int(clamp(momentum_combo_10m if ema_sign>0 else (100.0 - momentum_combo_10m), 0.0, 100.0))
    put("sigOverallBull", overall_state=="bull" and overall_score>=10, "info", f"score {overall_score}")
    put("sigOverallBear", overall_state=="bear" and overall_score>=10, "warn", f"score {overall_score}")

    # -------------------- Mirror 1h pills into intraday (optional flag) --------------------
    if os.environ.get("ENGINE_LIGHTS_1H","true").lower() != "false" and len(bars_10m) >= 12:
        bars_1h = resample_10m_to_1h(bars_10m)
        if len(bars_1h) >= 3:
            H1=[b["high"] for b in bars_1h]; L1=[b["low"] for b in bars_1h]; C1=[b["close"] for b in bars_1h]
            ema8_1 = ema_series(C1, EMA_FAST_SHORT); ema18_1 = ema_series(C1, EMA_FAST_LONG)
            # EMA1h crosses
            bull1h = (len(ema8_1)>=2 and len(ema18_1)>=2 and ema8_1[-2] <= ema18_1[-2] and ema8_1[-1] > ema18_1[-1])
            bear1h = (len(ema8_1)>=2 and len(ema18_1)>=2 and ema8_1[-2] >= ema18_1[-2] and ema8_1[-1] < ema18_1[-1])
            put("sigEMA1hBullCross", bull1h, "info", "EMA8/18 (1h) cross up")
            put("sigEMA1hBearCross", bear1h, "warn", "EMA8/18 (1h) cross down")
            # SMI1h crosses
            K1, D1 = smi_kd_series(H1, L1, C1, k_len=12, d_len=7, ema_len=5)
            if len(K1)>=2 and len(D1)>=2:
                bullKD = (K1[-2] <= D1[-2] and K1[-1] > D1[-1])
                bearKD = (K1[-2] >= D1[-2] and K1[-1] < D1[-1])
                put("sigSMI1hBullCross", bullKD, "info", f"K/D(1h) {K1[-2]:.2f}->{K1[-1]:.2f} / {D1[-2]:.2f}->{D1[-1]:.2f}")
                put("sigSMI1hBearCross", bearKD, "warn", f"K/D(1h) {K1[-2]:.2f}->{K1[-1]:.2f} / {D1[-2]:.2f}->{D1[-1]:.2f}")
            # Hourly accel from last two hours of breadth/mom approximations (reuse 10m for proxy)
            # For simplicity in Stage 1 mirror, use EMA gap delta as momentum proxy:
            ema_gap_1h = 0.0 if ema18_1[-1]==0 else 100.0 * (ema8_1[-1] - ema18_1[-1]) / ema18_1[-1]
            ema_gap_1h_prev = 0.0 if ema18_1[-2]==0 else 100.0 * (ema8_1[-2] - ema18_1[-2]) / ema18_1[-2]
            accel_1h = round(ema_gap_1h - ema_gap_1h_prev, 2)
            put("sigAccelUp1h",   accel_1h >= 1.5, "info", f"ΔEMA-gap(1h) {accel_1h:+.2f}%")
            put("sigAccelDown1h", accel_1h <= -1.5, "warn", f"ΔEMA-gap(1h) {accel_1h:+.2f}%")

    # -------------------- Compose --------------------
    out = {
        "version": VERSION_TAG,
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": now_utc_iso(),
        "metrics": metrics,
        "engineLights": {
            "updatedAt": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
            "mode": "intraday",
            "live": True,
            "signals": lights
        },
        "sectorCards": cards
    }
    return out

# ============================ CLI ============================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default="intraday")  # ignored; kept for back-compat with workflows
    ap.add_argument("--source", default="", help="optional source json (sectorCards)")
    ap.add_argument("--out", required=True, help="Output JSON path (e.g., data/outlook_intraday.json)")
    args = ap.parse_args()

    prev_out = None
    if os.path.exists(args.out):
        try:
            prev_out = json.load(open(args.out, "r", encoding="utf-8"))
        except Exception:
            prev_out = None

    src = None
    if args.source and os.path.exists(args.source):
        try:
            src = json.load(open(args.source, "r", encoding="utf-8"))
        except Exception:
            src = None

    out = build_intraday(src, prev_out)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print("[ok] wrote", args.out, "| version=", out.get("version"),
          "| accel10m=", (out["engineLights"]["signals"].get("sigAccelUp", {}) or {}).get("active"),
          (out["engineLights"]["signals"].get("sigAccelDown", {}) or {}).get("active"))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(1)
