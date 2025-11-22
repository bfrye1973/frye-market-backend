#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_5m_deltas.py
- Fetches /live/intraday
- Builds 5m "netTilt" per sector from breadth + momentum
- Writes data/pills.json for /live/pills to consume via data-live-5min-deltas branch
"""

import json
import os
import sys
import urllib.request
from datetime import datetime

LIVE_URL = os.environ.get("LIVE_URL") or "https://frye-market-backend-1.onrender.com/live/intraday"
OUT_PATH = "data/pills.json"


def fetch_json(url: str, timeout: int = 25) -> dict:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "build_5m_deltas/1.0", "Cache-Control": "no-store"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    try:
        live = fetch_json(LIVE_URL)
    except Exception as e:
        print("[5m] ERROR fetching LIVE_URL:", e, file=sys.stderr)
        sys.exit(1)

    cards = live.get("sectorCards") or []
    sectors = {}
    for c in cards:
        sec = c.get("sector")
        if not sec:
            continue
        try:
            breadth = float(c.get("breadth_pct") or 0.0)
            momentum = float(c.get("momentum_pct") or 0.0)
        except Exception:
            breadth = 0.0
            momentum = 0.0
        # Simple netTilt = avg(breadth, momentum)
        net_tilt = (breadth + momentum) / 2.0
        sectors[sec] = {"netTilt": round(net_tilt, 2)}

    ts = (
        live.get("sectorsUpdatedAt")
        or live.get("updated_at")
        or live.get("updated_at_utc")
        or datetime.utcnow().isoformat() + "Z"
    )

    out = {
        "version": "5m-deltas-r12.8",
        "deltasUpdatedAt": ts,
        "deltas": {"sectors": sectors},
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"[5m] wrote {OUT_PATH} with {len(sectors)} sectors at {ts}", flush=True)


if __name__ == "__main__":
    main()
