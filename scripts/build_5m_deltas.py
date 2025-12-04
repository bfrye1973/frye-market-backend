#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_5m_deltas.py
- Fetches /live/intraday
- Builds 5m "netTilt" per sector from breadth + momentum
- Writes data/pills.json for /live/pills to consume via data-live-5min-deltas branch
"""

import os
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def fetch_json(url: str) -> dict:
    """Fetch JSON from a URL with basic no-cache headers."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "build_5m_deltas/1.0",
            "Cache-Control": "no-store",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status} from {url}")
        return json.loads(resp.read().decode("utf-8"))


def build_pills(live: dict) -> dict:
    """
    Build pills.json structure for /live/pills from /live/intraday.

    Output shape matches what live.js expects for the 5m branch:

    {
      "version": "5m-deltas-r12.8",
      "deltasUpdatedAt": "...",
      "deltas": {
        "sectors": {
          "Information Technology": { "netTilt": number },
          ...
        }
      }
    }

    For now we use a simple "netTilt" = average of breadth_pct and momentum_pct,
    centered around 0.
    """

    ts = (
        live.get("sectorsUpdatedAt")
        or live.get("updated_at_utc")
        or live.get("updated_at")
        or datetime.now(timezone.utc).isoformat()
    )

    sectors = live.get("sectorCards") or []
    out_sectors = {}

    for c in sectors:
        name = str(c.get("sector") or "Unknown")
        try:
            b = float(c.get("breadth_pct") or 50.0)
        except Exception:
            b = 50.0
        try:
            m = float(c.get("momentum_pct") or 50.0)
        except Exception:
            m = 50.0

        # Placeholder netTilt = average(breadth, momentum) - 50
        avg = (b + m) / 2.0
        net_tilt = avg - 50.0

        out_sectors[name] = {"netTilt": round(net_tilt, 2)}

    pills = {
        "version": "5m-deltas-r12.8",
        "deltasUpdatedAt": ts,
        "deltas": {
            "sectors": out_sectors,
        },
    }

    return pills


def main():
    live_url = os.environ.get("LIVE_URL")
    if not live_url:
        raise RuntimeError("LIVE_URL environment variable is not set")

    print(f"[build_5m_deltas] Fetching live intraday from {live_url!r}")
    live = fetch_json(live_url)

    pills = build_pills(live)

    out_path = Path("data") / "pills.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(pills, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    sectors_count = len(pills.get("deltas", {}).get("sectors", {}))
    print(
        f"[build_5m_deltas] Wrote {out_path} with {sectors_count} sectors at {pills['deltasUpdatedAt']}"
    )


if __name__ == "__main__":
    main()
