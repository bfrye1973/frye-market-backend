#!/usr/bin/env python3
# Ferrari Dashboard — make_dashboard.py (R11: reactive + 5m blend + engine lights)

from __future__ import annotations
import os, json, math, time, urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List

# ---- paths ----
SRC_PATH   = os.path.join("data", "outlook_source.json")
OUT_PATH   = os.path.join("data", "outlook_intraday.json")
STATE_PATH = os.path.join("data", "nowcast_state.json")

# ---- env (Polygon only for SPY 10m EMA) ----
POLY_KEY  = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API") or ""
POLY_BASE = "https://api.polygon.io"

# ---- optional sandbox for 5m blend ----
SANDBOX_URL = os.environ.get(
    "SANDBOX_URL",
    "https://raw.githubusercontent.com/bfrye1973/frye-market-backend/data-live-10min-sandbox/data/outlook_intraday.json"
)

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
# sandbox fetch for 5m blend
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
                # naive parse (no external libs)
                dt = datetime.fromisoformat(ts.replace("Z","+00:00"))
                fresh = (datetime.utcnow() - dt.replace(tzinfo=None)) < timedelta(minutes=7)
            except Exception:
                fresh = True
        return (dB5, dM5, fresh)
    except Exception:
        return (0.0, 0.0, False)

# --------------------------------------------------------------------------------------
# SPY 10m EMA
# --------------------------------------------------------------------------------------
def poly_json(url: str, params: Dict[str, Any]|None = None) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    from urllib.parse import urlencode
    full = f"{url}?{urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent":"ferrari-dashboard/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_spy_10m_last_n(n: int = 50) -> List[Dict[str, float]]:
    """Return up to n SPY 10-minute bars (c, h, l, v). If Polygon unavailable, return []."""
    if not POLY_KEY:
        return []
    end = datetime.utcnow().date()
    start = end - timedelta(days=2)
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

    # --- 5m blend so dials nudge mid-interval (only when sandbox is fresh) ---
    dB5, dM5, fresh5 = try_fetch_sandbox()
    BLEND = 0.15 if fresh5 else 0.0     # 15% nudge from 5m deltas
    breadth_pub  = round(breadth_fast  + BLEND * dB5, 1)
    momentum_pub = round(momentum_fast + BLEND * dM5, 1)

    # Squeeze/Vol/Liq from builder (daily context). If you later compute 10m versions, drop them here.
    squeeze_intraday_pct = float(global_fields.get("squeeze_pressure_pct", 50.0))
    volatility_pct       = int(global_fields.get("volatility_pct", 50))
    liquidity_psi        = int(global_fields.get("liquidity_pct", 100))

    # --- SPY 10m EMA10 for Overall ---
    spy_10m = fetch_spy_10m_last_n(50)
    cl = [b["c"] for b in spy_10m][-50:] if spy_10m else []
    if cl:
        ema10=[]; y=None; a=2.0/(10.0+1.0)
        for c in cl:
            y = c if y is None else (y + a*(c - y))
            ema10.append(y)
        c_now, e_now = cl[-1], ema10[-1]
        c_prev, e_prev = (cl[-2], ema10[-2]) if len(cl)>1 else (c_now, e_now)
    else:
        c_now=c_prev=e_now=e_prev=0.0

    side_now  = 1 if c_now >= e_now else -1
    side_prev = 1 if c_prev >= e_prev else -1
    just_crossed = (side_now != side_prev)
    dist = abs(pct(c_now, e_now)) if e_now else 0.0
    dist_weight = clamp(1.0 - (dist / 1.5), 0.0, 1.0)

    # --- Overall components (more sensitive) ---
    accel_component = clamp((breadth_fast - st.get("breadth_fast_prev", breadth_fast)) +
                            (momentum_fast - st.get("momentum_fast_prev", momentum_fast)),
                            -30.0, 30.0)
    ema_component = 30.0 * (1 if side_now > 0 else -1)
    if just_crossed:
        ema_component += 15.0 * (1 if side_now > 0 else -1)
    ema_component *= dist_weight
    risk_component = clamp((riskOn_fast - 50.0) * 0.6, -24.0, 24.0)
    sect_component = clamp((risingPct_fast - 50.0) * 0.6, -24.0, 24.0)

    score = clamp(ema_component + accel_component + risk_component + sect_component, -100.0, 100.0)

    agree = 0
    agree += 1 if (ema_component * accel_component) > 0 else 0
    agree += 1 if (ema_component * risk_component)  > 0 else 0
    agree += 1 if (ema_component * sect_component)  > 0 else 0
    confidence = clamp((abs(score)/100.0) * (0.4 + 0.2*agree), 0.0, 1.0)

    # softer hysteresis
    prev_state = st.get("overall10m_state", "neutral")
    enter_bull, exit_bull = +10, +2
    enter_bear, exit_bear = -10, -2
    if prev_state == "bull":
        state = "bull" if score >= exit_bull else ("bear" if score <= enter_bear else "neutral" if score < enter_bull else "bull")
    elif prev_state == "bear":
        state = "bear" if score <= exit_bear else ("bull" if score >= enter_bull else "neutral" if score > enter_bear else "bear")
    else:
        state = "bull" if score >= enter_bull else ("bear" if score <= enter_bear else "neutral")

    reason = []
    if cl:
        reason.append("EMA10 " + ("↑" if side_now>0 else "↓") + (" (cross)" if just_crossed else ""))
    dB = breadth_fast  - st.get("breadth_fast_prev", breadth_fast)
    dM = momentum_fast - st.get("momentum_fast_prev", momentum_fast)
    reason.append(f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}")
    reason.append(f"Risk-On {riskOn_fast:.0f}%")

    # ---------------- payload ----------------
    payload: Dict[str, Any] = {
        "updated_at": updated_at,
        "updated_at_utc": updated_at_utc,
        "metrics": {
            "breadth_pct": breadth_pub,        # <<< blended (reacts mid-interval)
            "momentum_pct": momentum_pub,      # <<< blended
            "squeeze_intraday_pct": round(squeeze_intraday_pct, 1),
            "volatility_pct": int(volatility_pct),
            "liquidity_psi": int(liquidity_psi)
        },
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
                "score": int(round(score)),
                "state": state,
                "confidence": round(confidence, 2),
                "components": {
                    "ema10":  int(round(ema_component)),
                    "accel":  int(round(accel_component)),
                    "riskOn": int(round(risk_component)),
                    "sectors":int(round(sect_component)),
                },
                "reason": "; ".join(reason),
                "updatedAt": updated_at
            }
        }
    }

    # -------- Engine Lights (quicker thresholds) --------
    lights = {"updatedAt": updated_at, "mode": "intraday", "live": True, "signals": {}}
    set_light(lights, "sigOverallBull", state == "bull" and score >= 10, "info",
              f"Overall10m bull, score {int(round(score))}", updated_at, st)
    set_light(lights, "sigOverallBear", state == "bear" and score <= -10, "warn",
              f"Overall10m bear, score {int(round(score))}", updated_at, st)
    set_light(lights, "sigEMA10BullCross", bool(just_crossed and c_now >= e_now), "info",
              "SPY 10m crossed ▲ EMA10", updated_at, st)
    set_light(lights, "sigEMA10BearCross", bool(just_crossed and c_now <  e_now), "warn",
              "SPY 10m crossed ▼ EMA10", updated_at, st)
    accel_raw = dB + dM
    set_light(lights, "sigAccelUp",   accel_raw >= +4.0, "info",
              f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}", updated_at, st)
    set_light(lights, "sigAccelDown", accel_raw <= -4.0, "warn",
              f"ΔBreadth {dB:+.1f}, ΔMomentum {dM:+.1f}", updated_at, st)
    set_light(lights, "sigRiskOn",  riskOn_fast >= 58.0, "info",
              f"Risk-On {riskOn_fast:.0f}%", updated_at, st)
    set_light(lights, "sigRiskOff", riskOn_fast <= 42.0, "warn",
              f"Risk-On {riskOn_fast:.0f}%", updated_at, st)
    set_light(lights, "sigSectorThrust", risingPct_fast >= 58.0, "info",
              f"{int(round(risingPct_fast/100*11))}/11 rising", updated_at, st)
    set_light(lights, "sigSectorWeak",   risingPct_fast <= 42.0, "warn",
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
