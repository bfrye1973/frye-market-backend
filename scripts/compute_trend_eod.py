#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — compute_trend_eod.py (R12.9 — Mirror/Color Only)

This script no longer computes EOD scoring.
Single source of truth is make_eod.py -> daily.overallEOD.

Responsibilities:
- Add/refresh strategy.trendDaily (green/yellow/red) based on daily.overallEOD.score
- Preserve daily.overallEOD.lastChanged when state doesn't change
- Mirror key EOD gate fields into engineLights.metrics for UI convenience
"""

from __future__ import annotations
import json, sys
from datetime import datetime, timezone

EOD_PATH = "data/outlook.json"

def now_utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def load_json(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_json(path: str, obj: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))

def color_from_score(score: float) -> str:
    # green >=60, yellow 49..59, red <=48
    try:
        s = float(score)
    except Exception:
        return "red"
    if s >= 60.0:
        return "green"
    if s >= 49.0:
        return "yellow"
    return "red"

def main():
    j = load_json(EOD_PATH)
    if not j:
        print(f"[eod] missing {EOD_PATH}", file=sys.stderr)
        return 2

    now = now_utc_iso()
    daily = j.get("daily") or {}
    overall = (daily.get("overallEOD") or {})
    state = overall.get("state") or daily.get("state") or "neutral"
    score = overall.get("score") if overall.get("score") is not None else daily.get("score")

    # lastChanged preservation
    prev_last = overall.get("lastChanged") or now
    prev_state = overall.get("state")
    if prev_state == state and prev_last:
        last_changed = prev_last
    else:
        last_changed = now

    overall["state"] = state
    overall["score"] = score
    overall["lastChanged"] = last_changed
    daily["overallEOD"] = overall

    # strategy.trendDaily (color capsule)
    trend_color = color_from_score(score if score is not None else 0.0)
    reason = f"EOD {state.upper()} {float(score):.0f}" if isinstance(score,(int,float)) else f"EOD {state.upper()}"
    j.setdefault("strategy", {})
    j["strategy"]["trendDaily"] = {
        "state": trend_color,
        "reason": reason,
        "updatedAt": now
    }

    # Mirror important gate fields
    gate = daily.get("tradeGate") or {}
    j.setdefault("engineLights", {})
    j["engineLights"].setdefault("metrics", {})
    j["engineLights"]["metrics"].update({
        "eod_state": state,
        "eod_score": score,
        "eod_lastChanged": last_changed,
        "eod_allowEntries": gate.get("allowEntries"),
        "eod_allowExits": gate.get("allowExits"),
        "eod_aPlusOnly": gate.get("aPlusOnly"),
        "eod_danger": gate.get("danger"),
        "eod_psi": gate.get("psi"),
        "eod_gateMode": gate.get("mode"),
    })

    # Ensure squeeze gate light exists (already created by make_eod.py)
    if "eodSqueezeGate" not in (j.get("engineLights") or {}):
        # fallback create if missing
        psi = gate.get("psi") or (daily.get("squeezePsi") or 50.0)
        j["engineLights"]["eodSqueezeGate"] = {
            "state": daily.get("squeezeColor") or "blue",
            "active": True,
            "psi": psi,
            "regime": daily.get("squeezeRegime") or "minor",
            "allowEntries": gate.get("allowEntries", True),
            "allowExits": gate.get("allowExits", True),
            "mode": gate.get("mode", "NORMAL"),
            "lastChanged": now,
        }

    j["daily"] = daily
    save_json(EOD_PATH, j)
    print("[eod] mirrors written | trendDaily =", trend_color, "| state =", state, "| score =", score)
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception as e:
        print("[eod-error]", e, file=sys.stderr)
        sys.exit(2)
