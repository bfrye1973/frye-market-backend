#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Index Sectors — 10m formulas (config-driven, no backend/workflow edits)
Reads the live feed, applies config rules, writes a local artifact for QA:

  ./out/outlook_sector_10m.json

Then the UI can replicate the same logic live from /live/intraday using config.json.
"""

import json, os, sys, time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

ROOT = os.path.dirname(__file__)
CFG  = os.path.join(ROOT, "config.json")
OUT_DIR  = os.path.join(ROOT, "out")
OUT_PATH = os.path.join(OUT_DIR, "outlook_sector_10m.json")

ORDER = [
    "Information Technology","Materials","Health Care","Communication Services",
    "Real Estate","Energy","Consumer Staples","Consumer Discretionary",
    "Financials","Utilities","Industrials"
]

def clamp01(x: float) -> float:
    return max(0.0, min(100.0, float(x)))

def http_json(url: str, tries: int = 3, timeout: int = 15) -> dict:
    last = None
    for i in range(tries):
        try:
            ts = int(time.time()*1000)
            req = Request(f"{url}?t={ts}", headers={"User-Agent":"index-sectors-formulas/1.0"})
            with urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except (URLError, HTTPError) as e:
            last = e
            time.sleep(0.3 * (i+1))
    raise last or RuntimeError("http_json failed")

def safe_tilt(expr: str, breadth: float, momentum: float) -> float:
    """Evaluate tiltExpr safely with only breadth/momentum available."""
    try:
        env = {"breadth": float(breadth), "momentum": float(momentum)}
        val = eval(expr, {"__builtins__": {}}, env)
        return float(val)
    except Exception:
        return (breadth + momentum) / 2.0

def parse_rule_list(rule_expr: str):
    """
    Parse simple 'breadth>=55 && momentum>=55' style expressions into callables.
    Returns a list of (field, op, thr) tuples combined with AND logic.
    """
    tests = []
    parts = [p.strip() for p in rule_expr.replace("||", "&&").split("&&") if p.strip()]
    for p in parts:
        for op in (">=", "<=", ">", "<"):
            if op in p:
                left, thr = [x.strip() for x in p.split(op, 1)]
                if left not in ("breadth", "momentum"):
                    continue
                try:
                    thr_val = float(thr)
                except ValueError:
                    continue
                tests.append((left, op, thr_val))
                break
    return tests

def eval_outlook(breadth: float, momentum: float, up_rule: str, down_rule: str) -> str:
    def run(rule):
        for left, op, thr in parse_rule_list(rule):
            val = breadth if left == "breadth" else momentum
            if   op == ">=" and not (val >= thr): return False
            elif op == "<=" and not (val <= thr): return False
            elif op == ">"  and not (val >  thr): return False
            elif op == "<"  and not (val <  thr): return False
        return True
    if run(up_rule):   return "bullish"
    if run(down_rule): return "bearish"
    return "neutral"

def grade_token(thr_cfg: dict, value: float) -> str:
    value = float(value)
    def test(expr: str) -> bool:
        e = expr.strip()
        if e.startswith(">="): return value >= float(e[2:])
        if e.startswith("<="): return value <= float(e[2:])
        if e.startswith(">"):  return value >  float(e[1:])
        if e.startswith("<"):  return value <  float(e[1:])
        return False
    if test(thr_cfg.get("ok","")):    return "ok"
    if test(thr_cfg.get("warn","")):  return "warn"
    return "danger"

def main():
    cfg = json.load(open(CFG,"r",encoding="utf-8"))
    feed_url = cfg["bindings"]["feed"]
    fields   = cfg["bindings"]["fields"]
    aliases  = cfg["rules"]["aliases"]
    tiltExpr = cfg["rules"].get("tiltExpr", "(breadth + momentum)/2")
    thr_cfg  = cfg["rules"]["gradeThresholds"]["default"]
    out_up   = cfg["rules"]["outlook"]["bullish"]
    out_dn   = cfg["rules"]["outlook"]["bearish"]

    print("[info] reading feed:", feed_url)
    feed = http_json(feed_url)

    cards = feed.get("sectorCards") or []
    # Build a dict by canonical sector name (use aliases if needed)
    by = {}
    for c in cards:
        if not isinstance(c, dict): continue
        name = c.get("sector")
        if not isinstance(name, str): continue
        # Normalize via alias map (keys are canonical already, but this guards drift)
        canon = aliases.get(name, name)
        by[canon] = c

    norm = []
    for name in ORDER:
        c = by.get(name, {})
        breadth  = clamp01(c.get(fields["breadth"],  0.0))
        momentum = clamp01(c.get(fields["momentum"], 0.0))
        nh = int(c.get(fields["nh"],   0)); nl = int(c.get(fields["nl"], 0))
        up = int(c.get(fields["up"],   0)); dn = int(c.get(fields["down"], 0))

        tilt = clamp01(safe_tilt(tiltExpr, breadth, momentum))
        outlook = eval_outlook(breadth, momentum, out_up, out_dn)
        grade   = grade_token(thr_cfg, tilt)

        norm.append({
            "sector": name,
            "breadth_pct": breadth,
            "momentum_pct": momentum,
            "nh": nh, "nl": nl, "up": up, "down": dn,
            "tilt": tilt,
            "outlook": outlook,
            "grade": grade
        })

    os.makedirs(OUT_DIR, exist_ok=True)
    out = {
        "version": cfg.get("version","r11.2-sectors-10m"),
        "updated_at": feed.get("updated_at"),
        "updated_at_utc": feed.get("updated_at_utc"),
        "sectorCards": norm,
        "meta": {
            "feed_ts": feed.get("updated_at_utc"),
            "palette": cfg.get("ui",{}).get("paletteTokens", {})
        }
    }
    json.dump(out, open(OUT_PATH,"w",encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"[ok] wrote {OUT_PATH}  sectors={len(norm)}")

if __name__ == "__main__":
    sys.exit(main() or 0)
