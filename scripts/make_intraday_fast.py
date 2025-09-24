#!/usr/bin/env python3
"""
make_intraday_deltas.py

Reads the current live intraday JSON (built from full universe) from MIRROR_URL,
compares it to the previous sandbox JSON (if available), and writes a new payload
to the sandbox branch with a 'deltas' block:

- deltas.market: dBreadthPct, dMomentumPct, netTilt, riskOnPct
- deltas.sectors[<sector>]: dBreadthPct, dMomentumPct, netTilt

Notes:
- We compute market totals by summing NH/NL/UP/DOWN across sectorCards.
- If previous is missing, deltas are 0.0.
- We leave index-level deltas for a later step unless your source JSON contains
  explicit index breakdowns; this version focuses on market + sector deltas.
"""

import argparse
import json
import math
import os
import sys
import urllib.request
from urllib.error import URLError, HTTPError
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

AZ = ZoneInfo("America/Phoenix")


def az_iso() -> str:
    return datetime.now(AZ).replace(microsecond=0).isoformat()


def fetch_json(url: str):
    if not url:
        return None
    try:
        req = urllib.request.Request(
            url,
            headers={"Cache-Control": "no-store", "User-Agent": "sandbox-deltas/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status != 200:
                return None
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
        return None


def load_json_file(path: str):
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def safe_pct(num: float, den: float) -> float:
    return 0.0 if den == 0 else 100.0 * num / den


def summarize(cards):
    """Sum NH, NL, UP, DOWN over sectorCards."""
    totals = {"nh": 0, "nl": 0, "up": 0, "down": 0}
    for c in cards or []:
        totals["nh"] += int(c.get("nh", 0))
        totals["nl"] += int(c.get("nl", 0))
        totals["up"] += int(c.get("up", 0))
        totals["down"] += int(c.get("down", 0))
    breadth = safe_pct(totals["nh"], totals["nh"] + totals["nl"])
    momentum = safe_pct(totals["up"], totals["up"] + totals["down"])
    return totals, breadth, momentum


def sector_map(cards):
    """Map sector -> (nh,nl,up,down,breadthPct,momentumPct) from cards."""
    m = {}
    for c in cards or []:
        nh = int(c.get("nh", 0))
        nl = int(c.get("nl", 0))
        up = int(c.get("up", 0))
        down = int(c.get("down", 0))
        b = safe_pct(nh, nh + nl)
        mo = safe_pct(up, up + down)
        m[str(c.get("sector", "Unknown"))] = (nh, nl, up, down, b, mo)
    return m


def compute_deltas(curr_json, prev_json):
    # Market totals
    curr_tot, curr_b, curr_m = summarize(curr_json.get("sectorCards"))
    prev_tot, prev_b, prev_m = summarize(prev_json.get("sectorCards")) if prev_json else ({"nh":0,"nl":0,"up":0,"down":0}, 0.0, 0.0)

    d_market = {
        "dBreadthPct": round(curr_b - prev_b, 2),
        "dMomentumPct": round(curr_m - prev_m, 2),
        "netTilt": round(((curr_b - prev_b) + (curr_m - prev_m)) / 2.0, 2),
        # simple risk-on proxy from current (not delta): blend breadth & momentum
        "riskOnPct": round((curr_b + curr_m) / 2.0, 2),
    }

    # Sector deltas
    curr_map = sector_map(curr_json.get("sectorCards"))
    prev_map = sector_map(prev_json.get("sectorCards")) if prev_json else {}
    d_sectors = {}
    for name, (_, _, _, _, b_now, m_now) in curr_map.items():
        b_prev = prev_map.get(name, (0, 0, 0, 0, 0.0, 0.0))[4]
        m_prev = prev_map.get(name, (0, 0, 0, 0, 0.0, 0.0))[5]
        dB = round(b_now - b_prev, 2)
        dM = round(m_now - m_prev, 2)
        d_sectors[name] = {
            "dBreadthPct": dB,
            "dMomentumPct": dM,
            "netTilt": round((dB + dM) / 2.0, 2)
        }

    return {
        "market": d_market,
        "sectors": d_sectors
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mirror-url", required=True, help="Live intraday JSON (read-only)")
    ap.add_argument("--prev", default="", help="Path to previous sandbox JSON (optional)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--heartbeat", required=True)
    args = ap.parse_args()

    current = fetch_json(args.mirror_url)
    if not current or not isinstance(current, dict):
        print("ERROR: could not fetch current live intraday JSON", file=sys.stderr)
        return 2

    previous = load_json_file(args.prev)

    # Compute deltas and inject
    current = dict(current)  # shallow copy to avoid mutating original structure
    current["version"] = "sandbox-10m-deltas"
    current.setdefault("meta", {})
    current["meta"]["source"] = "mirror"
    current["meta"]["sandbox"] = True

    deltas = compute_deltas(current, previous)
    current["deltas"] = deltas
    current["deltasUpdatedAt"] = az_iso()

    # Write outputs
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(current, f, ensure_ascii=False, indent=2)

    os.makedirs(os.path.dirname(args.heartbeat), exist_ok=True)
    with open(args.heartbeat, "w", encoding="utf-8") as f:
        f.write(az_iso() + "\n")

    print(f"Wrote {args.out} and {args.heartbeat} (version={current['version']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
