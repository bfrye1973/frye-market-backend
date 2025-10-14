#!/usr/bin/env python3
# Ferrari Dashboard — make_dashboard.py (R12-EMA-CROSS)
# 10-minute canonical composer with:
# - reactive breadth/momentum (short half-life)
# - scoring weights: EMA backbone 40 + momentum 25 + breadth 10 + squeeze 10 + liquidity 10 + riskOn 5
# - SPY 10m EMA10/EMA20 crossover + ema10 distance (%)
# - engine lights (10m) + force-on safety
# - no schema changes; writes data/outlook_intraday.json

from __future__ import annotations
import os, json, math, time, urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List

# ---------- paths ----------
SRC_PATH   = os.path.join("data", "outlook_source.json")
OUT_PATH   = os.path.join("data", "outlook_intraday.json")
STATE_PATH = os.path.join("data", "nowcast_state.json")

# ---------- env (Polygon only for SPY 10m) ----------
POLY_KEY  = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API") or ""
POLY_BASE = "https://api.polygon.io"

# (optional) nowcast url for 5m visual nudge; safe if unreachable
SANDBOX_URL = os.environ.get(
    "SANDBOX_URL",
    "https://raw.githubusercontent.com/bfrye1973/frye-market-backend/data-live-10min-sandbox/data/outlook_intraday.json"
)

# sector buckets
OFFENSIVE = {"Information Technology","Communication Services","Consumer Discretionary"}
DEFENSIVE = {"Consumer Staples","Utilities","Health Care","Real Estate"}

# ======================================================================================
# utils
# ======================================================================================

def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x

def pct(a: float, b: float) -> float:
    if b == 0: return 0.0
    return 100.0 * (a - b) / b

def ema_hl(prev: float|None, x: float, hl_bars: float = 2.0) -> float:
    """EMA by half-life (bars)."""
    if prev is None or not math.isfinite(prev): return float(x)
    alpha = 1.0 - math.pow(0.5, 1.0 / max(hl_bars, 0.5))
    return float(prev + alpha * (x - prev))

def load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f: return json.load(f)

def save_json(path: str, obj: Dict[str, Any]):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, indent=2)

def load_state() -> Dict[str, Any]:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f: return json.load(f)
    except Exception:
        return {"lights": {}}

def save_state(st: Dict[str, Any]):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f: json.dump(st, f, ensure_ascii=False, indent=2)

def now_iso() -> str:
    try:
        from zoneinfo import ZoneInfo
        PHX = ZoneInfo("America/Phoenix")
        return datetime.now(PHX).replace(microsecond=0).isoformat()
    except Exception:
        return datetime.now().replace(microsecond=0).isoformat()

# ---------- sandbox 5m fetch (optional nudge for dials) ----------
def try_fetch_sandbox():
    try:
        u = SANDBOX_URL + ("&t=" if "?" in SANDBOX_URL else "?t=") + str(int(time.time()))
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"Cache-Control":"no-store"}), timeout=6)
        j = json.loads(r.read().decode("utf-8"))
        dm = (j.get("deltas") or {}).get("market", {})
        dB5 = float(dm.get("dBreadthPct", 0.0))
        dM5 = float(dm.get("dMomentumPct", 0.0))
        ts  = j.get("deltasUpdatedAt")
        fresh = True
        if ts:
            dt = datetime.fromisoformat(ts.replace("Z","+00:00"))
            fresh = (datetime.utcnow() - dt.replace(tzinfo=None)) < timedelta(minutes=7)
        return (dB5, dM5, fresh)
    except Exception:
        return (0.0, 0.0, False)

# ---------- Polygon helpers: SPY 10m closes/TR ----------
def poly_json(url: str, params: Dict[str, Any]|None = None) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    from urllib.parse import urlencode
    full = f"{url}?{urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent":"ferrari-dashboard/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_spy_10m_last_n(n: int = 60) -> List[Dict[str, float]]:
    if not POLY_KEY: return []
    end = datetime.utcnow().date()
    start = end - timedelta(days=3)
    url = f"{POLY_BASE}/v2/aggs/ticker/SPY/range/10/minute/{start}/{end}"
    try:
        js = poly_json(url, {"adjusted":"true","sort":"desc","limit":n})
        res = list(reversed(js.get("results", []) or []))
        out=[]
        for r in res[-n:]:
            out.append({"c": float(r["c"]), "h": float(r["h"]), "l": float(r["l"]), "v": float(r.get("v",0.0))})
        return out
    except Exception:
        return []

def tr(h, l, c_prev): return max(h-l, abs(h-c_prev), abs(l-c_prev))

def ema_seq(vals: List[float], hl: float) -> List[float]:
    y=None; out=[]
    for v in vals:
        y = v if y is None else ema_hl(y, v, hl_bars=hl)
        out.append(y)
    return out

# ---------- engine-light util ----------
def set_light(lights: dict, name: str, active: bool, severity: str, reason: str, now_iso_str: str, st: dict):
    pool = lights.setdefault("signals", {})
    prev = st.setdefault("lights", {}).get(name, {"active": False, "lastChanged": now_iso_str})
    if active != prev["active"]:
        prev["lastChanged"] = now_iso_str
    prev["active"]   = bool(active)
    prev["severity"] = severity
    prev["reason"]   = reason
    pool[name]       = prev
    st["lights"][name] = prev

# ======================================================================================
# composer
# ======================================================================================

def compose_intraday() -> Dict[str, Any]:
    src = load_json(SRC_PATH)

    updated_at     = src.get("updated_at") or now_iso()
    updated_at_utc = src.get("updated_at_utc") or datetime.utcnow().replace(microsecond=0).isoformat()+"Z"
    groups = src.get("groups") or {}
    global_fields = src.get("global") or {}

    # ---- sector cards + market totals ----
    NH_sum = NL_sum = UP_sum = DN_sum = 0
    sector_cards: List[Dict[str, Any]] = []
    for sector, g in groups.items():
        nh = int(g.get("nh",0)); nl = int(g.get("nl",0)); up = int(g.get("u",0)); dn = int(g.get("d",0))
        NH_sum += nh; NL_sum += nl; UP_sum += up; DN_sum += dn
        b = 100.0 * nh / max(1, nh + nl)
        m = 100.0 * up / max(1, up + dn)
        sector_cards.append({
            "sector": sector,
            "outlook": "Bullish" if b >= 60 else ("Bearish" if b < 45 else "Neutral"),
            "breadth_pct": round(b,1),
            "momentum_pct": round(m,1),
            "nh": nh, "nl": nl, "up": up, "down": dn,
            "spark": []
        })

    # ---- tick values (market) ----
    breadth_t  = 100.0 * NH_sum / max(1, NH_sum + NL_sum)
    momentum_t = 100.0 * UP_sum / max(1, UP_sum + DN_sum)

    st = load_state()
    breadth_fast  = ema_hl(st.get("breadth_fast"),  breadth_t,  hl_bars=2.0)
    momentum_fast = ema_hl(st.get("momentum_fast"), momentum_t, hl_bars=2.0)

    rising = sum(1 for c in sector_cards if c["breadth_pct"] > 50.0)
    risingPct_t    = 100.0 * rising / 11.0
    risingPct_fast = ema_hl(st.get("risingPct_fast"), risingPct_t, hl_bars=1.5)

    off_up = sum(1 for c in sector_cards if c["sector"] in OFFENSIVE and c["breadth_pct"] > 50)
    def_dn = sum(1 for c in sector_cards if c["sector"] in DEFENSIVE and c["breadth_pct"] < 50)
    riskOn_t    = 100.0 * (off_up + def_dn) / max(1, len(OFFENSIVE)+len(DEFENSIVE))
    riskOn_fast = ema_hl(st.get("riskOn_fast"), riskOn_t, hl_bars=2.0)

    # ---- 5m blend for visual dials (optional) ----
    dB5, dM5, fresh5 = try_fetch_sandbox()
    BLEND = 0.15 if fresh5 else 0.0
    breadth_pub  = round(breadth_fast  + BLEND * dB5, 1)
    momentum_pub = round(momentum_fast + BLEND * dM5, 1)

    # ---- squeeze / vol / liq from source (daily context) ----
    squeeze_intraday_pct = float(global_fields.get("squeeze_pressure_pct", 50.0))
    volatility_pct       = int(global_fields.get("volatility_pct", 50))
    liquidity_psi        = int(global_fields.get("liquidity_pct", 100))

    # ---- SPY 10m EMA10/EMA20 + ATR for scoring & cross/ dist ----
    spy_10m = fetch_spy_10m_last_n(60)
    cl = [b["c"] for b in spy_10m][-60:] if spy_10m else []
    ema10_now = ema20_now = ema10_prev = ema20_prev = 0.0
    c_now = 0.0
    atr_fast_10m = 0.0
    ema_cross = "none"
    ema10_dist_pct = 0.0

    if cl:
        # EMA10/EMA20 (simple loop)
        def ema_seq_period(vals, n):
            a = 2.0 / (n + 1.0)
            e = None; out=[]
            for v in vals:
                e = v if e is None else (e + a*(v - e))
                out.append(e)
            return out

        ema10  = ema_seq_period(cl, 10)
        ema20  = ema_seq_period(cl, 20)
        ema10_now, ema20_now = ema10[-1], ema20[-1]
        ema10_prev, ema20_prev = (ema10[-2], ema20[-2]) if len(ema10)>1 else (ema10_now, ema20_now)

        # ATR(10m) reactive for distance in ATR units
        trs=[]
        seq = spy_10m[-len(cl):]
        for i,b in enumerate(seq):
            trs.append((b["h"]-b["l"]) if i==0 else tr(b["h"],b["l"],seq[i-1]["c"]))
        atr_fast_10m = ema_seq(trs, hl=3.0)[-1]

        c_now = cl[-1]
        # cross event
        if ema10_prev < ema20_prev and ema10_now > ema20_now:
            ema_cross = "bull"
        elif ema10_prev > ema20_prev and ema10_now < ema20_now:
            ema_cross = "bear"
        else:
            ema_cross = "none"

        # distance from ema10 (signed %)
        if ema10_now != 0:
            ema10_dist_pct = round(100.0 * (c_now - ema10_now) / ema10_now, 2)

    # ---- write base metrics (add cross + dist) ----
    metrics: Dict[str, Any] = {
        "breadth_pct": breadth_pub,
        "momentum_pct": momentum_pub,
        "squeeze_intraday_pct": round(squeeze_intraday_pct, 1),
        "volatility_pct": int(volatility_pct),
        "liquidity_psi": int(liquidity_psi),
        "ema_cross": ema_cross,
        "ema10_dist_pct": ema10_dist_pct
    }

    # ============ OVERALL scoring (weights you approved) ============
    # A) EMA backbone (40 pts): cross bias ±20 + ATR-normalized distance ±20 (curved)
    if atr_fast_10m and ema10_now:
        dist_abs_atr = abs((c_now - ema10_now) / atr_fast_10m)
    else:
        dist_abs_atr = 0.0
    k = 0.8
    dist_pts   = 20.0 * (1.0 - math.exp(-k * dist_abs_atr))
    dist_signed= (1 if c_now >= ema10_now else -1) * dist_pts
    cross_bias = 20.0 * (1 if c_now >= ema10_now else -1)
    EMA_comp   = clamp(cross_bias + dist_signed, -40.0, 40.0)

    # B) Momentum (25) = ΔBreadth + ΔMomentum
    dB = breadth_fast  - st.get("breadth_fast_prev", breadth_fast)
    dM = momentum_fast - st.get("momentum_fast_prev", momentum_fast)
    accel = dB + dM
    Mom_comp = clamp(accel, -25.0, 25.0)

    # C) Breadth (10)
    Breadth_comp = clamp((breadth_fast - 50.0) * 0.2, -10.0, 10.0)

    # D) Squeeze (10) (inverted tightness)
    squeeze_rel = 50.0 - (squeeze_intraday_pct - 50.0)  # higher = looser
    Squeeze_comp = clamp(squeeze_rel * 0.2, -10.0, 10.0)

    # E) Liquidity (10)
    Flow = liquidity_psi - 100.0
    Liq_comp = clamp(Flow * 0.25, -10.0, 10.0)

    # F) Risk-On (5)
    Risk_comp = clamp((riskOn_fast - 50.0) * 0.1, -5.0, 5.0)

    Score = clamp(EMA_comp + Mom_comp + Breadth_comp + Squeeze_comp + Liq_comp + Risk_comp, -100.0, 100.0)

    # ---- state + confidence (hysteresis) ----
    prev_state = st.get("overall10m_state", "neutral")
    enter_bull, exit_bull = +10, +2
    enter_bear, exit_bear = -10, -2
    if prev_state == "bull":
        state = "bull" if Score >= exit_bull else ("bear" if Score <= enter_bear else "neutral" if Score < enter_bull else "bull")
    elif prev_state == "bear":
        state = "bear" if Score <= exit_bear else ("bull" if Score >= enter_bull else "neutral" if Score > enter_bear else "bear")
    else:
        state = "bull" if Score >= enter_bull else ("bear" if Score <= enter_bear else "neutral")

    agree = 0
    agree += 1 if (math.copysign(1, EMA_comp) == math.copysign(1, Mom_comp)) else 0
    agree += 1 if (math.copysign(1, EMA_comp) == math.copysign(1, Breadth_comp)) else 0
    agree += 1 if (math.copysign(1, EMA_comp) == math.copysign(1, Risk_comp)) else 0
    Confidence = clamp((abs(Score)/100.0) * (0.4 + 0.2*agree), 0.0, 1.0)

    # ---- payload (unchanged keys) ----
    payload: Dict[str, Any] = {
        "updated_at": updated_at,
        "updated_at_utc": updated_at_utc,
        "metrics": metrics,
        "sectorCards": sector_cards,
        "sectorsUpdatedAt": updated_at,
        "intraday": {
            "sectorDirection10m": {
                "risingCount": int(round(risingPct_fast/100.0*11.0)),
                "risingPct": round(risingPct_fast, 1),
                "updatedAt": updated_at
            },
            "riskOn10m": {
                "riskOnPct": round(riskOn_fast, 1),
                "updatedAt": updated_at
            },
            "overall10m": {
                "score": int(round(Score)),
                "state": state,
                "confidence": round(Confidence, 2),
                "components": {
                    "ema10":  int(round(EMA_comp)),
                    "momentum": int(round(Mom_comp)),
                    "breadth": int(round(Breadth_comp)),
                    "squeeze": int(round(Squeeze_comp)),
                    "liquidity": int(round(Liq_comp)),
                    "riskOn": int(round(Risk_comp)),
                },
                "reason": f"EMA10 {'↑' if c_now>=ema10_now else '↓'} | ema10_dist {metrics['ema10_dist_pct']:.2f}% | ΔB {dB:+.1f} ΔM {dM:+.1f} | ROn {riskOn_fast:.0f}% | Thrust {risingPct_fast:.0f}%",
                "updatedAt": updated_at
            }
        }
    }

    # ---- Engine Lights (10m) ----
    lights = {"updatedAt": updated_at, "mode": "intraday", "live": True, "signals": {}}
    print(f"[lights] score={Score:.1f} state={state} EMA={EMA_comp:.1f} Mom={Mom_comp:.1f} Br={Breadth_comp:.1f} Sq={Squeeze_comp:.1f} Lq={Liq_comp:.1f} Rk={Risk_comp:.1f} cross={metrics['ema_cross']} dist%={metrics['ema10_dist_pct']}")

    set_light(lights, "sigOverallBull", state == "bull" and Score >= 10, "info",
              f"Overall10m bull, score {int(round(Score))}", updated_at, st)
    set_light(lights, "sigOverallBear", state == "bear" and Score <= -10, "warn",
              f"Overall10m bear, score {int(round(Score))}", updated_at, st)

    # pulse crosses
    set_light(lights, "sigEMA10BullCross", (metrics["ema_cross"] == "bull"), "info", "SPY 10m EMA10 crossed above EMA20", updated_at, st)
    set_light(lights, "sigEMA10BearCross", (metrics["ema_cross"] == "bear"), "warn", "SPY 10m EMA10 crossed below EMA20", updated_at, st)

    # acceleration / risk / thrust
    set_light(lights, "sigAccelUp",   accel >= +3.0, "info",  f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}", updated_at, st)
    set_light(lights, "sigAccelDown", accel <= -3.0, "warn", f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}", updated_at, st)
    set_light(lights, "sigRiskOn",  riskOn_fast >= 57.0, "info",  f"Risk-On {riskOn_fast:.0f}%", updated_at, st)
    set_light(lights, "sigRiskOff", riskOn_fast <= 43.0, "warn", f"Risk-On {riskOn_fast:.0f}%", updated_at, st)
    set_light(lights, "sigSectorThrust", risingPct_fast >= 57.0, "info",
              f"{int(round(risingPct_fast/100*11))}/11 rising", updated_at, st)
    set_light(lights, "sigSectorWeak",   risingPct_fast <= 43.0, "warn",
              f"{int(round(risingPct_fast/100*11))}/11 rising", updated_at, st)

    # force-on safety if tape is obviously ripping/fading
    dist_abs_atr = abs((c_now - ema10_now) / atr_fast_10m) if (atr_fast_10m and ema10_now) else 0.0
    force_bull = ((c_now >= ema10_now and dist_abs_atr <= 0.9 and accel >= +3.0) or
                  (riskOn_fast >= 62.0 and risingPct_fast >= 60.0))
    force_bear = ((c_now <  ema10_now and dist_abs_atr <= 0.9 and accel <= -3.0) or
                  (riskOn_fast <= 38.0 and risingPct_fast <= 40.0))
    if force_bull:
        set_light(lights, "sigOverallBull", True, "info",
                  f"FORCE bull: distATR {dist_abs_atr:.2f}, accel {accel:+.1f}, ROn {riskOn_fast:.0f}%, Thrust {risingPct_fast:.0f}%", updated_at, st)
    if force_bear:
        set_light(lights, "sigOverallBear", True, "warn",
                  f"FORCE bear: distATR {dist_abs_atr:.2f}, accel {accel:+.1f}, ROn {riskOn_fast:.0f}%, Thrust {risingPct_fast:.0f}%", updated_at, st)

    payload["engineLights"] = lights

    # persist state for next bar
    st["breadth_fast"]       = breadth_fast
    st["momentum_fast"]      = momentum_fast
    st["breadth_fast_prev"]  = breadth_fast
    st["momentum_fast_prev"] = momentum_fast
    st["risingPct_fast"]     = risingPct_fast
    st["riskOn_fast"]        = riskOn_fast
    st["overall10m_state"]   = state
    save_state(st)

    return payload


def main():
    payload = compose_intraday()
    save_json(OUT_PATH, payload)
    print(f"Wrote {OUT_PATH} | cards={len(payload.get('sectorCards',[]))} | Overall10m={payload['intraday']['overall10m']['state']} {payload['intraday']['overall10m']['score']}")

if __name__ == "__main__":
    main()
