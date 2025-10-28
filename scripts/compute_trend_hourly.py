#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compute strategy.trend1h for /live/hourly (Lux-style)
Colors: green (bull), red (bear), yellow (compression/chop)
Inputs expected in data/outlook_hourly.json:
  metrics.squeeze_1h_pct (0..100, 80+ = tight)
  metrics.momentum_combo_1h_pct (0..100)
  hourly.overall1h.state ("bull"|"bear"|"neutral")
  hourly.overall1h.score (0..100)  [used in reason text]
Optional helpers (if present): hourly.riskOn1h.riskOnPct
"""

import json, sys, datetime

IN  = "data/outlook_hourly.json"
OUT = IN

def now_iso():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def pick(d, *path):
    for k in path:
        if not isinstance(d, dict): return None
        d = d.get(k)
    return d

def main():
    try:
        j = json.load(open(IN, "r", encoding="utf-8"))
    except Exception as e:
        print("[trend1h] cannot read", IN, e, file=sys.stderr)
        sys.exit(0)

    m   = j.get("metrics") or {}
    hv  = j.get("hourly")  or {}
    ov  = hv.get("overall1h") or {}

    psi     = m.get("squeeze_1h_pct")                 # expansion% style; treat >=80 as tight/compression
    combo   = m.get("momentum_combo_1h_pct")          # blended EMA/SMI
    state0  = (ov.get("state") or "").lower()         # bull|bear|neutral
    score   = ov.get("score")
    riskon  = pick(hv, "riskOn1h", "riskOnPct")

    # 1) Compression wins
    if isinstance(psi, (int,float)) and psi >= 80.0:
        state, reason = ("yellow", f"Compression (1h PSI≥80, psi={psi:.0f}%)")
    else:
        # 2) Direction + momentum
        if state0 == "bull" and (not isinstance(combo,(int,float)) or combo >= 50.0):
            state, reason = ("green", f"Overall1h bull (score {score})" if score is not None else "Overall1h bull")
        elif state0 == "bear" and (not isinstance(combo,(int,float)) or combo < 50.0):
            state, reason = ("red", f"Overall1h bear (score {score})" if score is not None else "Overall1h bear")
        else:
            state, reason = ("yellow", "Neutral/transition")

    j.setdefault("strategy", {})
    j["strategy"]["trend1h"] = {
        "state": state,
        "reason": reason if reason else "",
        "updatedAt": j.get("updated_at_utc") or j.get("updated_at") or now_iso()
    }

    json.dump(j, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",",":"))
    print("[trend1h]", j["strategy"]["trend1h"])

if __name__ == "__main__":
    main()
