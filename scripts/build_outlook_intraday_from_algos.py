#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — Intraday (10m) Builder using algos/index-sectors/10m

This script:
  1. Loads the last intraday payload published by /live/hourly (optional)
  2. Loads the 10-minute formulas config from .github/algos/index-sectors/10m
  3. Requests the latest 10-minute sectorCards from the backend or GitHub
  4. Runs your formulas → tilt, outlook, grade
  5. Writes a full outlook_intraday.json for data-live-10min

This restores /live/intraday so hourly and the dashboard can work.
"""

from __future__ import annotations
import json, os, sys, urllib.request

ROOT = ".github/algos/index-sectors/10m"

CONFIG_PATH = os.path.join(ROOT, "config.json")
FORMULAS_PATH = os.path.join(ROOT, "formulas.py")
VALIDATOR_PATH = os.path.join(ROOT, "validator.py")

# Live hourly (fallback) and GitHub source for sectorCards
BACKEND_HOURLY = (
    "https://frye-market-backend-1.onrender.com/live/hourly"
)

GITHUB_INTRADAY_RAW = (
    "https://raw.githubusercontent.com/bfrye1973/frye-market-backend/"
    "data-live-hourly/data/outlook_hourly.json"
)

def log(x):
    print(f"[10m-builder] {x}", flush=True)

def fetch_json(url, timeout=20):
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "FerrariDashboard/10m-builder", "Cache-Control":"no-store"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        log(f"fetch fail: {e}")
        return None

def load_formulas():
    import importlib.util
    spec = importlib.util.spec_from_file_location("formulas", FORMULAS_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def load_validator():
    import importlib.util
    spec = importlib.util.spec_from_file_location("validator", VALIDATOR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def main():
    out_path = "data/outlook_intraday.json"

    # 1) Load formulas + validator
    if not os.path.exists(CONFIG_PATH):
        log("Missing config.json")
        sys.exit(1)

    formulas = load_formulas()
    validator = load_validator()
    cfg = json.load(open(CONFIG_PATH, "r", encoding="utf-8"))

    # 2) Try to fetch sectorCards (use hourly fallback for now)
    hourly = fetch_json(BACKEND_HOURLY) or fetch_json(GITHUB_INTRADAY_RAW)

    if not hourly:
        log("No hourly fallback — using empty structure")
        hourly_cards = []
    else:
        hourly_cards = hourly.get("sectorCards") or []

    if not hourly_cards:
        log("SectorCards empty — using neutral")
        # Build 11 neutral sectors
        hourly_cards = [
            {
                "sector": name,
                "breadth_pct":0.0,
                "momentum_pct":0.0,
                "nh":0,"nl":0,"up":0,"down":0
            }
            for name in cfg.get("order") or []
        ]

    # 3) Apply formulas
    try:
        output = formulas.compute_sectorcards(hourly_cards, cfg)
        output = validator.validate_output(output)
    except Exception as e:
        log(f"formula error: {e}")
        sys.exit(1)

    # 4) Write final intraday payload
    final = {
        "version":"10m-algo-v1",
        "mode":"intraday",
        "sectorCards": output["sectorCards"],
        "metrics": output.get("metrics") or {},
        "meta": {
            "algo": True,
            "source": "algo-index-sectors-10m"
        }
    }

    os.makedirs("data", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, separators=(",",":"))

    log(f"Wrote → {out_path}")
    return 0

if __name__ == "__main__":
    sys.exit(main() or 0)
