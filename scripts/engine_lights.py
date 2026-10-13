# scripts/engine_lights.py
# Engine Lights (Scalper-Sensitive) — Early vs Confirmed + stateful lastChanged
# Safe to import from make_dashboard.py

from __future__ import annotations
import json, os, time
from dataclasses import dataclass
from typing import Dict, Any, Optional

STATE_PATH = os.getenv("ENGINE_LIGHTS_STATE_PATH", "data/engine_lights_state.json")
STRICT = os.getenv("ENGINE_LIGHTS_STRICT", "true").lower() == "true"
# Smaller cooldown for scalping; you can tweak by env if you want
COOLDOWN_SECONDS = int(os.getenv("ENGINE_LIGHTS_COOLDOWN", "600"))  # 10 minutes

ALL_KEYS = [
    "sigBreakout","sigDistribution","sigCompression","sigExpansion",
    "sigOverheat","sigTurbo","sigDivergence","sigLowLiquidity","sigVolatilityHigh"
]

@dataclass
class Metrics:
    breadth_pct: Optional[float] = None       # 0..100
    momentum_pct: Optional[float] = None      # 0..100
    squeeze_pct: Optional[float] = None       # 0..100 (intraday squeeze pressure)
    liquidity_psi: Optional[float] = None     # 0..100
    volatility_pct: Optional[float] = None    # 0..100
    # deltas for "slope"
    prev_momentum_pct: Optional[float] = None
    prev_squeeze_pct: Optional[float] = None

@dataclass
class TickerAlignment:
    # From your Index Scalper; "long"|"short"|"none"
    direction: str = "none"
    # VIX inverse confirm (True when VIX < EMA10)
    vix_below_ema10: bool = False
    # Streak bars (debounced) from your scalper
    streak_bars: int = 0

def _load_state() -> Dict[str, Any]:
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"signals": {k: {"active": False, "lastChanged": None} for k in ALL_KEYS}}

def _save_state(state: Dict[str, Any]) -> None:
    try:
        os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
    except Exception:
        pass

def _now_iso(ts_az_iso: Optional[str], utc_fallback: Optional[float]) -> str:
    # Prefer AZ iso passed from caller; otherwise best-effort UTC epoch -> ISO
    if ts_az_iso:
        return ts_az_iso
    if utc_fallback is None:
        utc_fallback = time.time()
    # Keep it simple: RFC3339-ish without TZ suffix here
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(utc_fallback))

def _severity(level: str) -> str:
    # canonicalize
    if level in ("info","warn","danger"):
        return level
    return "info"

def _mk(active: bool, severity: str, reason: str, last_changed: Optional[str]) -> Dict[str, Any]:
    return {
        "active": bool(active),
        "severity": _severity(severity),
        "reason": reason,
        "lastChanged": last_changed,
    }

def compute_engine_lights_signals_scalper(
    *,
    metrics: Metrics,
    align: TickerAlignment,
    ts_az_iso: Optional[str] = None,
    utc_epoch: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Sensitive (scalper) version:
    - Emits all 9 signals every tick.
    - Early 'warn' triggers sooner; Confirmed upgrades to 'info' (green) or 'danger'.
    - Uses Index Scalper alignment + VIX confirm gates.
    - Persists lastChanged per signal.
    """

    # Load last state for lastChanged + cooldown (optional)
    state = _load_state()
    last = state.get("signals", {})

    # Unpack metrics
    b = metrics.breadth_pct
    m = metrics.momentum_pct
    q = metrics.squeeze_pct
    lq = metrics.liquidity_psi
    vol = metrics.volatility_pct
    m_prev = metrics.prev_momentum_pct
    q_prev = metrics.prev_squeeze_pct

    m_slope_up   = (m is not None and m_prev is not None and m > m_prev)
    q_falling    = (q is not None and q_prev is not None and q < q_prev)

    now_iso = _now_iso(ts_az_iso, utc_epoch)

    sig: Dict[str, Dict[str, Any]] = {}

    # ------------------ Compression / Expansion ------------------
    if q is not None and q >= 65:
        sev = "danger" if q >= 85 else "warn"
        sig["sigCompression"] = _mk(True, sev, f"q={q:.1f}", None)
    else:
        sig["sigCompression"] = _mk(False, "info", "", None)

    if q is not None and q < 55 and q_falling:
        # Early expansion (warn)
        expansion_early = True
        # Confirmed: <45 and alignment present + VIX confirm
        expansion_conf = (q < 45) and (align.direction in ("long","short")) and align.vix_below_ema10
        sev = "info" if expansion_conf else "warn"
        active = expansion_early  # stays on in early/confirmed
        sig["sigExpansion"] = _mk(active, sev, f"q={q:.1f}, falling={q_falling}, align={align.direction}, vixOK={align.vix_below_ema10}", None)
    else:
        sig["sigExpansion"] = _mk(False, "info", "", None)

    # ------------------ Breakout / Distribution ------------------
    if b is not None and q is not None:
        breakout_early = (b > 55) and (q < 75) and (align.direction == "long") and (align.streak_bars >= 1)
        breakout_conf  = breakout_early and (align.vix_below_ema10 or (m is not None and m >= 58)) and (align.streak_bars >= 2)
        if breakout_early:
            sev = "info" if breakout_conf else "warn"
            sig["sigBreakout"] = _mk(True, sev, f"b={b:.1f}, q={q:.1f}, align={align.direction}, vixOK={align.vix_below_ema10}, m={m}", None)
        else:
            sig["sigBreakout"] = _mk(False, "info", "", None)

        if b < 45:
            sev = "danger" if b < 30 else "info"
            sig["sigDistribution"] = _mk(True, sev, f"b={b:.1f}", None)
        else:
            sig["sigDistribution"] = _mk(False, "info", "", None)
    else:
        sig["sigBreakout"]    = _mk(False, "info", "", None)
        sig["sigDistribution"]= _mk(False, "info", "", None)

    # ------------------ Overheat / Turbo ------------------
    if m is not None and m > 80:
        sev = "danger" if m >= 92 else "warn"
        sig["sigOverheat"] = _mk(True, sev, f"m={m:.1f}", None)
        turbo = (m >= 88) and (q is not None and q < 75) and (align.direction == "long")
        sig["sigTurbo"] = _mk(turbo, "info", f"m={m:.1f}, q={q}, align={align.direction}", None)
    else:
        sig["sigOverheat"] = _mk(False, "info", "", None)
        sig["sigTurbo"]    = _mk(False, "info", "", None)

    # ------------------ Divergence ------------------
    if (m is not None and m > 68) and (b is not None and b < 52):
        sig["sigDivergence"] = _mk(True, "warn", f"m={m:.1f}, b={b:.1f}", None)
    else:
        sig["sigDivergence"] = _mk(False, "info", "", None)

    # ------------------ Liquidity / Volatility ------------------
    if lq is not None and lq < 45:
        sev = "danger" if lq < 30 else "warn"
        sig["sigLowLiquidity"] = _mk(True, sev, f"psi={lq:.1f}", None)
    else:
        sig["sigLowLiquidity"] = _mk(False, "info", "", None)

    if vol is not None and vol > 65:
        sev = "danger" if vol >= 85 else "warn"
        sig["sigVolatilityHigh"] = _mk(True, sev, f"vol={vol:.1f}", None)
    else:
        sig["sigVolatilityHigh"] = _mk(False, "info", "", None)

    # ------------------ Ensure all 9 keys exist ------------------
    for k in ALL_KEYS:
        sig.setdefault(k, _mk(False, "info", "", None))

    # ------------------ lastChanged (stateful) ------------------
    # We stamp lastChanged when active state flips
    for k in ALL_KEYS:
        prev_active = bool(last.get(k, {}).get("active", False))
        now_active  = bool(sig[k]["active"])
        prev_ts     = last.get(k, {}).get("lastChanged")
        if now_active != prev_active:
            sig[k]["lastChanged"] = now_iso
        else:
            sig[k]["lastChanged"] = prev_ts

    # Save new state snapshot
    state["signals"] = {k: {"active": sig[k]["active"], "lastChanged": sig[k]["lastChanged"]} for k in ALL_KEYS}
    _save_state(state)

    return sig

# Convenience: single entry that returns the engineLights section
def build_engine_lights_section(
    *,
    metrics: Metrics,
    align: TickerAlignment,
    ts_az_iso: Optional[str],
    mode: str = "intraday",
    live: bool = True,
    utc_epoch: Optional[float] = None,
) -> Dict[str, Any]:
    signals = compute_engine_lights_signals_scalper(metrics=metrics, align=align, ts_az_iso=ts_az_iso, utc_epoch=utc_epoch)
    return {
        "updatedAt": ts_az_iso,
        "live": bool(live),
        "mode": mode,
        "signals": signals
    }
