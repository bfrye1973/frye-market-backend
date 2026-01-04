#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
compute_trend_4h.py — 4H post-processor (color + mirrors only)

Reads:  data/outlook_4h.json
Writes: data/outlook_4h.json (adds strategy.trend4h + engineLights mirrors + lastChanged preservation)
"""

import json, datetime

PATH = "data/outlook_4h.json"

def utc_now(): 
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def load_json(p):
    try: 
        return json.load(open(p,"r",encoding="utf-8"))
    except Exception: 
        return {}

def save_json(p,obj): 
    json.dump(obj, open(p,"w",encoding="utf-8"), ensure_ascii=False, separators=(",",":"))

def color_from_score(score):
    try:
        s=float(score)
    except Exception:
        return "red"
    if s >= 60.0: return "green"
    if s >= 49.0: return "yellow"
    return "red"

def carry_last_changed(prev, new_state, stamp):
    prev_state = (prev or {}).get("state")
    last = (prev or {}).get("lastChanged") or stamp
    if prev_state != new_state:
        last = stamp
    return last

def main():
    j = load_json(PATH)
    if not j:
        print("[4h] missing outlook_4h.json"); return

    now = utc_now()
    m = j.get("metrics") or {}
    fh = j.get("fourHour") or {}
    overall = (fh.get("overall4h") or {})

    state = overall.get("state") or "neutral"
    score = overall.get("score")
    trend_color = color_from_score(score)

    last_changed = carry_last_changed(overall, state, now)
    overall["lastChanged"] = last_changed
    fh["overall4h"] = overall
    j["fourHour"] = fh

    j.setdefault("strategy", {})
    j["strategy"]["trend4h"] = {
        "state": trend_color,
        "reason": f"4H {state.upper()} {float(score):.0f}" if isinstance(score,(int,float)) else f"4H {state.upper()}",
        "updatedAt": now
    }

    j.setdefault("engineLights", {})
    j["engineLights"].setdefault("4h", {})
    j["engineLights"]["4h"].update({
        "state": state,
        "score": score,
        "components": overall.get("components") or {},
        "lastChanged": last_changed
    })

    save_json(PATH, j)
    print("[4h] post-process ok |", j["strategy"]["trend4h"])

if __name__ == "__main__":
    main()
