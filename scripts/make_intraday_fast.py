#!/usr/bin/env python3
"""
make_intraday_fast.py - sandbox-only, sub-second runtime.

- Emits a payload matching the intraday schema your UI expects.
- Writes to paths provided via --out/--heartbeat (the workflow points to a temp dir).
- Adds "version" so you can spot 'sandbox-10m' in logs.
"""

import argparse
import json
import os
import random
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

AZ = ZoneInfo("America/Phoenix")


def az_iso() -> str:
    return datetime.now(AZ).replace(microsecond=0).isoformat()


def utc_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def rnd(base: float, lo: float = -6, hi: float = 6,
        lo_lim: float = 0, hi_lim: float = 100, nd: int = 2) -> float:
    return round(clamp(base + random.uniform(lo, hi), lo_lim, hi_lim), nd)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--heartbeat", required=True)
    ap.add_argument("--version", default="sandbox-10m")
    args = ap.parse_args()

    # Deterministic per 5-minute bucket so values wiggle each tick
    seed = int(datetime.now(timezone.utc).timestamp() // 300)
    random.seed(seed)

    # Lightweight plausible ranges
    breadth = rnd(58, lo=-10, hi=10)
    momentum = rnd(60, lo=-12, hi=12)
    squeeze_intraday = rnd(22, lo=-8, hi=8)     # lower=better (inverted dial)
    volatility_pct = rnd(14, lo=-6, hi=6)       # lower=better (inverted dial)
    liquidity_psi = round(clamp(102 + random.uniform(-15, 12), 0, 120), 1)

    sector_names = ["Information Technology", "Health Care", "Financials"]
    sectorCards = []
    for name in sector_names:
        b = rnd(breadth, lo=-6, hi=6)
        m = rnd(momentum, lo=-6, hi=6)
        nh = int(210 + random.uniform(-70, 70))
        nl = int(90 + random.uniform(-45, 45))
        up = int(270 + random.uniform(-90, 90))
        down = int(230 + random.uniform(-90, 90))
        outlook = "Bullish" if (b + m) / 2 >= 50 else "Neutral"
        sectorCards.append({
            "sector": name,
            "outlook": outlook,
            "breadth_pct": b,
            "momentum_pct": m,
            "nh": nh,
            "nl": nl,
            "up": up,
            "down": down,
            "spark": []
        })

    updated_az = az_iso()
    updated_utc = utc_iso()

    payload = {
        "version": args.version,
        "updated_at": updated_az,
        "updated_at_utc": updated_utc,
        "metrics": {
            "breadth_pct": breadth,
            "momentum_pct": momentum,
            "squeeze_intraday_pct": squeeze_intraday,
            "volatility_pct": volatility_pct,
            "liquidity_psi": liquidity_psi
        },
        "summary": {
            "breadth_pct": breadth,
            "momentum_pct": momentum
        },
        "sectorCards": sectorCards,
        "sectorsUpdatedAt": updated_az,
        "engineLights": {
            "updatedAt": updated_az,
            "mode": "intraday",
            "live": True,
            "signals": {
                "sigBreakout": {"active": momentum > 55, "severity": "info"},
                "sigCompression": {"active": squeeze_intraday > 70, "severity": "warn"}
            }
        },
        "intraday": {
            "sectorDirection10m": {
                "risingCount": 7,
                "risingPct": round(clamp(48 + random.uniform(-18, 25), 0, 100), 1),
                "updatedAt": updated_az
            },
            "riskOn10m": {
                "riskOnPct": round(clamp((breadth + momentum) / 2, 0, 100), 1),
                "updatedAt": updated_az
            }
        }
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    os.makedirs(os.path.dirname(args.heartbeat), exist_ok=True)
    with open(args.heartbeat, "w", encoding="utf-8") as f:
        f.write(updated_az + "\n")

    print(f"Wrote {args.out} and {args.heartbeat} ({args.version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
