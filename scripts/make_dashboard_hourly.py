#!/usr/bin/env python3
import argparse, json, os, sys
from datetime import datetime, timezone

UTC = timezone.utc
def iso(dt): return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

def safe_read(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def latest_t(bars):
    return max((b["t"] for b in bars), default=None)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--dest", required=True)
    ap.add_argument("--heartbeat", required=True)
    ap.add_argument("--log", default="/tmp/hourly_build.log")
    args = ap.parse_args()

    src = safe_read(args.source)
    if not src:
        print("Hourly maker: missing source", file=sys.stderr); sys.exit(2)

    spy = (src.get("bars", {}) or {}).get("SPY", [])
    qqq = (src.get("bars", {}) or {}).get("QQQ", [])
    seed = src.get("metrics_seed", {}) or {}

    # Compose EXACT fields the frontend expects on /live/hourly
    payload = {
        "updated_at": src.get("updated_at") or iso(datetime.now(tz=UTC)),
        "metrics": {
            "breadth_pct": float(seed.get("breadth_pct", 50.0)),
            "momentum_pct": float(seed.get("momentum_pct", 50.0)),
            "squeeze_pct": float(seed.get("squeeze_pct", 50.0)),
            "liquidity_pct": float(seed.get("liquidity_pct", 50.0)),
        },
        # Optional: hourly confirmations for pills (can be derived client-side too)
        "hourly": {
            "spy": {"last_ts": latest_t(spy), "bars": len(spy)},
            "qqq": {"last_ts": latest_t(qqq), "bars": len(qqq)},
        },
        # Keep future room for “sectorCards” if you populate them later
        "sectorCards": src.get("sectorCards") or []
    }

    os.makedirs(os.path.dirname(args.dest), exist_ok=True)
    with open(args.dest, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    # Heartbeat for monitors
    with open(args.heartbeat, "w", encoding="utf-8") as hb:
        hb.write(iso(datetime.now(tz=UTC)) + "\n")

    with open(args.log, "a", encoding="utf-8") as lf:
        lf.write(f"[{iso(datetime.now(tz=UTC))}] make_dashboard_hourly OK breadth={payload['metrics']['breadth_pct']} momentum={payload['metrics']['momentum_pct']}\n")

if __name__ == "__main__":
    main()
