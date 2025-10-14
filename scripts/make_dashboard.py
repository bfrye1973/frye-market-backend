#!/usr/bin/env python3
# Ferrari Dashboard — make_dashboard.py (R12: scoring weights + EMA10 backbone + 5m blend + lights)

from __future__ import annotations
import os, json, math, time, urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List

# ---- paths ----
SRC_PATH   = os.path.join("data", "outlook_source.json")
OUT_PATH   = os.path.join("data", "outlook_intraday.json")
STATE_PATH = os.path.join("data", "nowcast_state.json")

# ---- env (Polygon only for SPY 10m EMA/ATR) ----
POLY_KEY  = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API") or ""
POLY_BASE = "https://api.polygon.io"

# ---- optional sandbox for 5m blend (visual nudge) ----
SANDBOX_URL = os.environ.get(
    "SANDBOX_URL",
    "https://raw.githubusercontent.com/bfrye1973/frye-market-backend/data-live-10min-sandbox/data/outlook_intraday.json"
)

# Sector buckets
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
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path: str, obj: Dict[str, Any]):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

def load_state() -> Dict[str, Any]:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"lights": {}}

def save_state(st: Dict[str, Any]):
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)

def now_iso() -> str:
    try:
        from zoneinfo import ZoneInfo
        PHX = ZoneInfo("America/Phoenix")
        return datetime.now(PHX).replace(microsecond=0).isoformat()
    except Exception:
        return datetime.now().replace(microsecond=0).isoformat()

# --------------------------------------------------------------------------------------
# sandbox fetch for 5m blend (visual nudge on dials)
# --------------------------------------------------------------------------------------
def try_fetch_sandbox():
    """Returns (dB5, dM5, fresh:bool). Safe to fail."""
    try:
        u = SANDBOX_URL + ("&t=" if "?" in SANDBOX_URL else "?t=") + str(int(time.time()))
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"Cache-Control":"no-store"}), timeout=6)
        j = json.loads(r.read().decode("utf-8"))
        d = (j.get("deltas") or {}).get("market", {})
        dB5 = float(d.get("dBreadthPct", 0.0))
        dM5 = float(d.get("dMomentumPct", 0.0))
        ts  = j.get("deltasUpdatedAt")
        fresh = True
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z","+00:00"))
                fresh = (datetime.utcnow() - dt.replace(tzinfo=None)) < timedelta(minutes=7)
            except Exception:
                fresh = True
        return (dB5, dM5, fresh)
    except Exception:
        return (0.0, 0.0, False)

# --------------------------------------------------------------------------------------
# SPY 10m EMA/ATR (for EMA backbone)
# --------------------------------------------------------------------------------------
def poly_json(url: str, params: Dict[str, Any]|None = None) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    from urllib.parse import urlencode
    full = f"{url}?{urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent":"ferrari-dashboard/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_spy_10m_last_n(n: int = 60) -> List[Dict[str, float]]:
    if not POLY_KEY:
        return []
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

# --------------------------------------------------------------------------------------
# engine light util
# --------------------------------------------------------------------------------------
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

    # Build sector cards + market totals
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

    # Instant tick values (market)
    breadth_t  = 100.0 * NH_sum / max(1, NH_sum + NL_sum)
    momentum_t = 100.0 * UP_sum / max(1, UP_sum + DN_sum)

    st = load_state()
    breadth_fast  = ema_hl(st.get("breadth_fast"),  breadth_t,  hl_bars=2.0)
    momentum_fast = ema_hl(st.get("momentum_fast"), momentum_t, hl_bars=2.0)

    # Sector Direction (bar-on-bar)
    rising = sum(1 for c in sector_cards if c["breadth_pct"] > 50.0)
    risingPct_t    = 100.0 * rising / 11.0
    risingPct_fast = ema_hl(st.get("risingPct_fast"), risingPct_t, hl_bars=1.5)

    # Risk-On (bar-on-bar)
    off_up = sum(1 for c in sector_cards if c["sector"] in OFFENSIVE and c["breadth_pct"] > 50)
    def_dn = sum(1 for c in sector_cards if c["sector"] in DEFENSIVE and c["breadth_pct"] < 50)
    riskOn_t    = 100.0 * (off_up + def_dn) / max(1, len(OFFENSIVE)+len(DEFENSIVE))
    riskOn_fast = ema_hl(st.get("riskOn_fast"), riskOn_t, hl_bars=2.0)

    # Squeeze/Vol/Liq from builder (daily context).
    squeeze_intraday_pct = float(global_fields.get("squeeze_pressure_pct", 50.0))
    volatility_pct       = int(global_fields.get("volatility_pct", 50))
    liquidity_psi        = int(global_fields.get("liquidity_pct", 100))

    # --- 5m blend so dials nudge mid-interval (only when sandbox is fresh) ---
    dB5, dM5, fresh5 = try_fetch_sandbox()
    BLEND = 0.15 if fresh5 else 0.0     # 15% nudge from 5m deltas
    breadth_pub  = round(breadth_fast  + BLEND * dB5, 1)
    momentum_pub = round(momentum_fast + BLEND * dM5, 1)

    # --- SPY 10m EMA/ATR for EMA backbone ---
    spy_10m = fetch_spy_10m_last_n(60)
    cl = [b["c"] for b in spy_10m][-60:] if spy_10m else []
    if cl:
        # EMA10
        ema10=[]; y=None; a=2.0/(10.0+1.0)
        for c in cl:
            y = c if y is None else (y + a*(c - y))
            ema10.append(y)
        # ATR10m (reactive)
        trs=[]
        for i,b in enumerate(spy_10m[-len(cl):]):
            if i==0: trs.append(b["h"]-b["l"])
            else: trs.append(tr(b["h"], b["l"], spy_10m[-len(cl):][i-1]["c"]))
        atr_fast_10m = ema_seq(trs, hl=3.0)[-1]

        c_now, e_now = cl[-1], ema10[-1]
        c_prev, e_prev = (cl[-2], ema10[-2]) if len(cl)>1 else (c_now, e_now)
    else:
        c_now=c_prev=e_now=e_prev=atr_fast_10m=0.0

    side_now  = 1 if c_now >= e_now else -1
    side_prev = 1 if c_prev >= e_prev else -1
    just_crossed = (side_now != side_prev)

    # EMA distance normalized by ATR (points feel)
    if atr_fast_10m and e_now:
        dist_abs_atr = abs((c_now - e_now) / atr_fast_10m)      # in ATR units
    else:
        dist_abs_atr = 0.0
    # Curved distance points: small ext add fast, large plateau
    k = 0.8
    dist_pts = 20.0 * (1.0 - math.exp(-k * dist_abs_atr))       # 0..20
    dist_signed = (1 if c_now >= e_now else -1) * dist_pts

    # ---- Component scoring (your weights) ----
    # A) EMA backbone (40)
    cross_bias = 20.0 * (1 if c_now >= e_now else -1)           # ±20
    EMA_comp = clamp(cross_bias + dist_signed, -40.0, 40.0)

    # B) Momentum (25) = acceleration
    dB = breadth_fast  - st.get("breadth_fast_prev", breadth_fast)
    dM = momentum_fast - st.get("momentum_fast_prev", momentum_fast)
    accel = dB + dM
    Mom_comp = clamp(accel, -25.0, 25.0)

    # C) Breadth (10)
    Breadth_comp = clamp((breadth_fast - 50.0) * 0.2, -10.0, 10.0)

    # D) Squeeze (10) - inverted tightness
    squeeze_rel = 50.0 - (squeeze_intraday_pct - 50.0)          # higher = looser
    Squeeze_comp = clamp(squeeze_rel * 0.2, -10.0, 10.0)

    # E) Liquidity (10)
    Flow = liquidity_psi - 100.0
    Liq_comp = clamp(Flow * 0.25, -10.0, 10.0)

    # F) Risk-On (5)
    Risk_comp = clamp((riskOn_fast - 50.0) * 0.1, -5.0, 5.0)

    Score = clamp(EMA_comp + Mom_comp + Breadth_comp + Squeeze_comp + Liq_comp + Risk_comp, -100.0, 100.0)

    # State hysteresis
    prev_state = st.get("overall10m_state", "neutral")
    enter_bull, exit_bull = +10, +2
    enter_bear, exit_bear = -10, -2
    if prev_state == "bull":
        state = "bull" if Score >= exit_bull else ("bear" if Score <= enter_bear else "neutral" if Score < enter_bull else "bull")
    elif prev_state == "bear":
        state = "bear" if Score <= exit_bear else ("bull" if Score >= enter_bull else "neutral" if Score > enter_bear else "bear")
    else:
        state = "bull" if Score >= enter_bull else ("bear" if Score <= enter_bear else "neutral")

    # Confidence: magnitude + agreement with EMA
    agree = 0
    agree += 1 if (math.copysign(1, EMA_comp) == math.copysign(1, Mom_comp)) else 0
    agree += 1 if (math.copysign(1, EMA_comp) == math.copysign(1, Breadth_comp)) else 0
    agree += 1 if (math.copysign(1, EMA_comp) == math.copysign(1, Risk_comp)) else 0
    Confidence = clamp((abs(Score)/100.0) * (0.4 + 0.2*agree), 0.0, 1.0)

    # --------- payload (unchanged keys) ----------
    payload: Dict[str, Any] = {
        "updated_at": updated_at,
        "updated_at_utc": updated_at_utc,
        "metrics": {
            "breadth_pct": breadth_pub,        # blended when 5m fresh
            "momentum_pct": momentum_pub,      # blended when 5m fresh
            "squeeze_intraday_pct": round(float(squeeze_intraday_pct), 1),
            "volatility_pct": int(volatility_pct),
            "liquidity_psi": int(liquidity_psi)
        },
        # --- EMA 10/20 crossover + EMA10 distance for SPY (added by Brian) ---
try:
    spy_10m = fetch_spy_10m_last_n(60)
    closes = [b["c"] for b in spy_10m][-60:]
    if len(closes) > 25:
        # simple EMA loop (no numpy needed)
        def ema(vals, n):
            a = 2.0 / (n + 1)
            e = None
            out = []
            for v in vals:
                e = v if e is None else (e + a * (v - e))
                out.append(e)
            return out

        ema10 = ema(closes, 10)
        ema20 = ema(closes, 20)
        ema10_now, ema20_now = ema10[-1], ema20[-1]
        ema10_prev, ema20_prev = ema10[-2], ema20[-2]

        if ema10_prev < ema20_prev and ema10_now > ema20_now:
            ema_cross = "bull"
        elif ema10_prev > ema20_prev and ema10_now < ema20_now:
            ema_cross = "bear"
        else:
            ema_cross = "none"

        close_now = closes[-1]
        ema10_dist_pct = round(100 * (close_now - ema10_now) / ema10_now, 2)
    else:
        ema_cross = "none"
        ema10_dist_pct = 0.0
except Exception as e:
    ema_cross = "none"
    ema10_dist_pct = 0.0

metrics["ema_cross"] = ema_cross
metrics["ema10_dist_pct"] = ema10_dist_pct

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
                "reason": f"EMA10 {'↑' if c_now>=e_now else '↓'} | distATR {dist_abs_atr:.2f} | ΔB {dB:+.1f} ΔM {dM:+.1f} | ROn {riskOn_fast:.0f}% | Thrust {risingPct_fast:.0f}%",
                "updatedAt": updated_at
            }
        }
    }

    # -------- Engine Lights (fast + force-on) --------
    lights = {"updatedAt": updated_at, "mode": "intraday", "live": True, "signals": {}}
    print(f"[lights] score={Score:.1f} state={state} EMA={EMA_comp:.1f} Mom={Mom_comp:.1f} Br={Breadth_comp:.1f} Sq={Squeeze_comp:.1f} Lq={Liq_comp:.1f} Rk={Risk_comp:.1f}")

    # Primary
    set_light(lights, "sigOverallBull", state == "bull" and Score >= 10, "info",
              f"Overall10m bull, score {int(round(Score))}", updated_at, st)
    set_light(lights, "sigOverallBear", state == "bear" and Score <= -10, "warn",
              f"Overall10m bear, score {int(round(Score))}", updated_at, st)

    # Force-on safety (obvious conditions)
    force_bull = ((c_now >= e_now and dist_abs_atr <= 0.9 and accel >= +3.0) or
                  (riskOn_fast >= 62.0 and risingPct_fast >= 60.0))
    force_bear = ((c_now <  e_now and dist_abs_atr <= 0.9 and accel <= -3.0) or
                  (riskOn_fast <= 38.0 and risingPct_fast <= 40.0))
    if force_bull:
        set_light(lights, "sigOverallBull", True, "info",
                  f"FORCE bull: EMA10 distATR {dist_abs_atr:.2f}, accel {accel:+.1f}, ROn {riskOn_fast:.0f}%, Thrust {risingPct_fast:.0f}%", updated_at, st)
    if force_bear:
        set_light(lights, "sigOverallBear", True, "warn",
                  f"FORCE bear: EMA10 distATR {dist_abs_atr:.2f}, accel {accel:+.1f}, ROn {riskOn_fast:.0f}%, Thrust {risingPct_fast:.0f}%", updated_at, st)

    # EMA crosses (pulse one bar)
    set_light(lights, "sigEMA10BullCross", bool(just_crossed and c_now >= e_now), "info",
              "SPY 10m crossed ▲ EMA10", updated_at, st)
    set_light(lights, "sigEMA10BearCross", bool(just_crossed and c_now <  e_now), "warn",
              "SPY 10m crossed ▼ EMA10", updated_at, st)

    # Acceleration, Risk, Thrust (quicker edges)
    set_light(lights, "sigAccelUp",   accel >= +3.0, "info",  f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}", updated_at, st)
    set_light(lights, "sigAccelDown", accel <= -3.0, "warn", f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}", updated_at, st)
    set_light(lights, "sigRiskOn",  riskOn_fast >= 57.0, "info",  f"Risk-On {riskOn_fast:.0f}%", updated_at, st)
    set_light(lights, "sigRiskOff", riskOn_fast <= 43.0, "warn", f"Risk-On {riskOn_fast:.0f}%", updated_at, st)
    set_light(lights, "sigSectorThrust", risingPct_fast >= 57.0, "info",
              f"{int(round(risingPct_fast/100*11))}/11 rising", updated_at, st)
    set_light(lights, "sigSectorWeak",   risingPct_fast <= 43.0, "warn",
              f"{int(round(risingPct_fast/100*11))}/11 rising", updated_at, st)

    payload["engineLights"] = lights

    # Persist state
    st["breadth_fast"]         = breadth_fast
    st["momentum_fast"]        = momentum_fast
    st["breadth_fast_prev"]    = breadth_fast
    st["momentum_fast_prev"]   = momentum_fast
    st["risingPct_fast"]       = risingPct_fast
    st["riskOn_fast"]          = riskOn_fast
    st["overall10m_state"]     = state
    save_state(st)

    return payload


def main():
    payload = compose_intraday()
    save_json(OUT_PATH, payload)
    print(f"Wrote {OUT_PATH} | cards={len(payload.get('sectorCards',[]))} | Overall10m={payload['intraday']['overall10m']['state']} "
          f"{payload['intraday']['overall10m']['score']}")

if __name__ == "__main__":
    main()
