#!/usr/bin/env python3
"""
make_intraday_fast.py - sandbox-only, fast test generator.
Emits a minimal outlook_intraday.json + heartbeat for sandbox.
"""

import argparse, json, os, sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

AZ = ZoneInfo("America/Phoenix")

def az_iso():
    return datetime.now(AZ).replace(microsecond=0).isoformat()

def utc_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--heartbeat", required=True)
    ap.add_argument("--version", default="sandbox-10m")
    args = ap.parse_args()

    updated_az = az_iso()
    updated_utc = utc_iso()

    payload = {
        "version": args.version,
        "updated_at": updated_az,
        "updated_at_utc": updated_utc,
        "metrics": {
            "breadth_pct": 60.0,
            "momentum_pct": 62.0,
            "squeeze_intraday_pct": 20.0,
            "volatility_pct": 15.0,
            "liquidity_psi": 105.0
        },
        "sectorCards": [
            {
                "sector": "Information Technology",
                "outlook": "Bullish",
                "breadth_pct": 58.0,
                "momentum_pct": 63.0,
                "nh": 200, "nl": 80, "up": 250, "down": 220,
                "spark": []
            }
        ],
        "engineLights": {
            "updatedAt": updated_az,
            "mode": "intraday",
            "live": True,
            "signals": { "sigBreakout": {"active": True, "severity": "info"} }
        },
        "intraday": {
            "sectorDirection10m": {"risingCount": 7, "risingPct": 65.0, "updatedAt": updated_az},
            "riskOn10m": {"riskOnPct": 61.0, "updatedAt": updated_az}
        }
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    os.makedirs(os.path.dirname(args.heartbeat), exist_ok=True)
    with open(args.heartbeat, "w", encoding="utf-8") as f:
        f.write(updated_az + "\n")

    print(f"Wrote {args.out} and {args.heartbeat} ({args.version})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
