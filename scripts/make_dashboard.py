#!/usr/bin/env python3
# Ferrari Dashboard — make_dashboard.py (R10)
# Canonical 10-minute payload composer (no schema changes).
# - Reads data/outlook_source.json (built by build_outlook_source_from_polygon.py)
# - Builds sectorCards + metrics + intraday blocks
# - Adds "intraday.overall10m" (EMA10-based composite)    <<< NEW
#
# NOTE: This script does NOT change routes, files or workflows.
# It writes data/outlook_intraday.json with the same keys the FE already uses.

from __future__ import annotations
import os, json, math, time, urllib.request
from datetime import datetime, timedelta, timezone, date
from typing import Any, Dict, List

# ---- paths ----
SRC_PATH = os.path.join("data", "outlook_source.json")
OUT_PATH = os.path.join("data", "outlook_intraday.json")
STATE_PATH = os.path.join("data", "nowcast_state.json")

# ---- env (Polygon for SPY 10m only) ----
POLY_KEY  = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API") or ""
POLY_BASE = "https://api.polygon.io"

# ======================================================================================
# utils
# ======================================================================================

def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x

def pct(a: float, b: float) -> float:
    if b == 0: return 0.0
    return 100.0 * (a - b) / b

def ema_hl(prev: float|None, x: float, hl_bars: float = 2.0) -> float:
    """EMA by half-life in bars."""
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
        return {}

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

# ======================================================================================
# SPY 10-minute fetch (small, fast, only used for EMA10 cross)
# ======================================================================================

def poly_json(url: str, params: Dict[str, Any]|None = None) -> Dict[str, Any]:
    if params is None: params = {}
    if POLY_KEY: params["apiKey"] = POLY_KEY
    from urllib.parse import urlencode
    full = f"{url}?{urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent":"ferrari-dashboard/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_spy_10m_last_n(n: int = 50) -> List[Dict[str, float]]:
    """Return up to n SPY 10-minute bars (c, h, l, v). If Polygon unavailable, return empty list."""
    if not POLY_KEY:
        return []
    end = datetime.utcnow().date()
    start = end - timedelta(days=2)  # 2 days is enough to get 50x 10m bars
    url = f"{POLY_BASE}/v2/aggs/ticker/SPY/range/10/minute/{start}/{end}"
    try:
        js = poly_json(url, {"adjusted": "true", "sort": "desc", "limit": n})
        results = js.get("results", []) or []
        results = list(reversed(results))
        out=[]
        for r in results[-n:]:
            out.append({"c": float(r["c"]), "h": float(r["h"]), "l": float(r["l"]), "v": float(r.get("v",0.0))})
        return out
    except Exception:
        return []

# ======================================================================================
# composer
# ======================================================================================

OFFENSIVE = {"Information Technology","Communication Services","Consumer Discretionary"}
DEFENSIVE = {"Consumer Staples","Utilities","Health Care","Real Estate"}

def compose_intraday() -> Dict[str, Any]:
    src = load_json(SRC_PATH)

    # Timestamps from source (already set in builder)
    updated_at     = src.get("updated_at") or now_iso()
    updated_at_utc = src.get("updated_at_utc") or datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    groups = src.get("groups") or {}
    global_fields = src.get("global") or {}

    # Build sector cards & instant breadth/momentum per sector
    sector_cards: List[Dict[str, Any]] = []
    NH_sum = NL_sum = UP_sum = DN_sum = 0

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

    # Instant market breadth/momentum for this tick
    breadth_t  = 100.0 * NH_sum / max(1, NH_sum + NL_sum)
    momentum_t = 100.0 * UP_sum / max(1, UP_sum + DN_sum)

    # Reactive smoothing with short half-lives (stateful)
    st = load_state()
    breadth_fast  = ema_hl(st.get("breadth_fast"),  breadth_t,  hl_bars=2.0)
    momentum_fast = ema_hl(st.get("momentum_fast"), momentum_t, hl_bars=2.0)

    # Sector Direction bar-on-bar
    rising = 0
    for c in sector_cards:
        if c["breadth_pct"] > 50.0: rising += 1
    risingPct_t   = 100.0 * rising / 11.0
    risingPct_fast= ema_hl(st.get("risingPct_fast"), risingPct_t, hl_bars=1.5)

    # Risk-On bar-on-bar (offensives above 50, defensives below 50)
    off_up = sum(1 for c in sector_cards if c["sector"] in OFFENSIVE and c["breadth_pct"] > 50)
    def_dn = sum(1 for c in sector_cards if c["sector"] in DEFENSIVE and c["breadth_pct"] < 50)
    buckets = len(OFFENSIVE) + len(DEFENSIVE)
    riskOn_t = 100.0 * (off_up + def_dn) / max(1, buckets)
    riskOn_fast = ema_hl(st.get("riskOn_fast"), riskOn_t, hl_bars=2.0)

    # Squeeze/Vol/Liquidity from builder global fields (already computed daily context)
    # If you prefer, you can replace these with faster 10m-derived versions later.
    squeeze_intraday_pct = float(global_fields.get("squeeze_pressure_pct", 50))
    volatility_pct       = int(global_fields.get("volatility_pct", 50))
    liquidity_psi        = int(global_fields.get("liquidity_pct", 100))

    # ========== SPY 10m EMA10 (for Overall Market base) ==========
    spy_10m = fetch_spy_10m_last_n(50)
    cl = [b["c"] for b in spy_10m][-50:] if spy_10m else []
    ema10 = []
    if cl:
        y=None; a = 2.0/(10.0+1.0)
        for c in cl:
            y = c if y is None else (y + a*(c - y))
            ema10.append(y)
        c_now, e_now = cl[-1], ema10[-1]
        c_prev, e_prev = (cl[-2], ema10[-2]) if len(cl)>1 else (c_now, e_now)
    else:
        # fallback: treat as neutral if we couldn't fetch intraday bars
        c_now=c_prev=e_now=e_prev=0.0

    side_now  = 1 if (c_now >= e_now) else -1
    side_prev = 1 if (c_prev >= e_prev) else -1
    just_crossed = (side_now != side_prev)
    dist = abs(pct(c_now, e_now)) if e_now else 0.0
    dist_weight = clamp(1.0 - (dist / 1.5), 0.0, 1.0)

    # Components
    accel_component = clamp((breadth_fast - st.get("breadth_fast_prev", breadth_fast)) +
                            (momentum_fast - st.get("momentum_fast_prev", momentum_fast)),
                            -25.0, 25.0)
    ema_component = 25.0 * (1 if side_now > 0 else -1)
    if just_crossed:
        ema_component += 10.0 * (1 if side_now > 0 else -1)
    ema_component *= dist_weight
    risk_component = clamp((riskOn_fast - 50.0) * 0.4, -20.0, 20.0)
    sect_component = clamp((risingPct_fast - 50.0) * 0.4, -20.0, 20.0)

    score = clamp(ema_component + accel_component + risk_component + sect_component, -100.0, 100.0)

    agree = 0
    agree += 1 if (ema_component * accel_component) > 0 else 0
    agree += 1 if (ema_component * risk_component)  > 0 else 0
    agree += 1 if (ema_component * sect_component)  > 0 else 0
    confidence = clamp((abs(score)/100.0) * (0.4 + 0.2*agree), 0.0, 1.0)

    prev_state = st.get("overall10m_state", "neutral")
    enter_bull, exit_bull = +15, +5
    enter_bear, exit_bear = -15, -5
    if prev_state == "bull":
        state = "bull" if score >= exit_bull else ("bear" if score <= enter_bear else "neutral" if score < enter_bull else "bull")
    elif prev_state == "bear":
        state = "bear" if score <= exit_bear else ("bull" if score >= enter_bull else "neutral" if score > enter_bear else "bear")
    else:
        state = "bull" if score >= enter_bull else ("bear" if score <= enter_bear else "neutral")

    reason = []
    if cl:
        reason.append("EMA10 " + ("↑" if side_now>0 else "↓") + (" (cross)" if just_crossed else ""))
    reason.append(f"ΔBreadth {(breadth_fast - st.get('breadth_fast_prev', breadth_fast)):+.1f}, "
                  f"ΔMomentum {(momentum_fast - st.get('momentum_fast_prev', momentum_fast)):+.1f}")
    reason.append(f"Risk-On {riskOn_fast:.0f}%")

    # Build payload (unchanged keys)
    payload: Dict[str, Any] = {
        "updated_at": updated_at,
        "updated_at_utc": updated_at_utc,
        "metrics": {
            "breadth_pct": round(breadth_fast, 1),
            "momentum_pct": round(momentum_fast, 1),
            "squeeze_intraday_pct": round(float(squeeze_intraday_pct), 1),
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

    # Persist state for next tick
    st["breadth_fast"] = breadth_fast
    st["momentum_fast"] = momentum_fast
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
    print(f"Wrote {OUT_PATH} with {len(payload.get('sectorCards',[]))} sector cards.")
    print(f"Overall10m: state={payload['intraday']['overall10m']['state']} "
          f"score={payload['intraday']['overall10m']['score']}")

if __name__ == "__main__":
    main()
