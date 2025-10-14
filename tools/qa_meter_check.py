#!/usr/bin/env python3
"""
QA Meter Check — verifies Market Meter math vs current JSON and shows expected lights.

Checks:
- Breadth%  = 100 * ΣNH / (ΣNH+ΣNL)
- Momentum% = 100 * ΣUp / (ΣUp+ΣDown)
- SectorDirection10m = % sectors with breadth > 50
- Risk-On tilt = 100 * (off_up + def_down) / (len(OFF)+len(DEF))
- (optional) EMA10/20 cross + EMA10 distance if POLYGON_API_KEY is present

Usage:
  python tools/qa_meter_check.py
Env overrides:
  LIVE_URL, SANDBOX_URL, POLYGON_API_KEY
"""

import os, sys, json, math, time, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

# ---------- Config ----------
LIVE_URL    = os.environ.get("LIVE_URL",    "https://frye-market-backend-1.onrender.com/live/intraday")
SANDBOX_URL = os.environ.get("SANDBOX_URL", "https://raw.githubusercontent.com/bfrye1973/frye-market-backend/data-live-10min-sandbox/data/outlook_intraday.json")
POLY_KEY    = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API")

# Tolerances for % comparisons
TOL = {
    "breadth_pct": 0.25,   # +/- 0.25%
    "momentum_pct": 0.25,
    "risingPct":   0.5,    # +/- 0.5%
    "riskOnPct":   0.5
}

OFFENSIVE = {"Information Technology", "Communication Services", "Consumer Discretionary"}
DEFENSIVE = {"Consumer Staples", "Utilities", "Health Care", "Real Estate"}

def get_json(url: str):
    u = url + ("&t=" if "?" in url else "?t=") + str(int(time.time()))
    req = urllib.request.Request(u, headers={"Cache-Control": "no-store", "User-Agent": "qa-meter-check/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))

def pct(num, den):
    return 0.0 if den == 0 else 100.0 * num / den

def recompute_from_cards(cards):
    nh = nl = up = dn = 0
    rising = 0
    off_up = 0
    def_dn = 0
    for c in cards or []:
        nh += int(c.get("nh", 0)); nl += int(c.get("nl", 0))
        up += int(c.get("up", 0)); dn += int(c.get("down", 0))
        b  = pct(int(c.get("nh",0)), int(c.get("nh",0)) + int(c.get("nl",0)))
        if b > 50.0:
            rising += 1
        sec = c.get("sector","")
        if sec in OFFENSIVE and b > 50.0:
            off_up += 1
        if sec in DEFENSIVE and b < 50.0:
            def_dn += 1
    breadth = pct(nh, nh+nl)
    momentum = pct(up, up+dn)
    risingPct = pct(rising, 11.0)  # 11 GICS
    riskOn = pct(off_up + def_dn, len(OFFENSIVE) + len(DEFENSIVE))
    return {
        "ΣNH": nh, "ΣNL": nl, "ΣUP": up, "ΣDOWN": dn,
        "breadth_pct": breadth,
        "momentum_pct": momentum,
        "risingPct": risingPct,
        "riskOnPct": riskOn
    }

def near(a, b, tol):
    return abs((a or 0) - (b or 0)) <= tol

# Optional EMA10/20/ATR check via Polygon
def fetch_spy_10m_last_n(n=60):
    if not POLY_KEY:
        return []
    base = "https://api.polygon.io/v2/aggs/ticker/SPY/range/10/minute"
    end = datetime.utcnow().date()
    start = end - timedelta(days=3)
    from urllib.parse import urlencode
    url = f"{base}/{start}/{end}?{urlencode({'adjusted':'true','sort':'desc','limit':n,'apiKey':POLY_KEY})}"
    req = urllib.request.Request(url, headers={"User-Agent": "qa-meter-check/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        js = json.loads(resp.read().decode("utf-8"))
    res = list(reversed(js.get("results", []) or []))
    out=[]
    for r in res[-n:]:
        out.append({"c": float(r["c"]), "h": float(r["h"]), "l": float(r["l"])})
    return out

def ema_seq(vals, n):
    a = 2.0/(n+1.0)
    e = None; out=[]
    for v in vals:
        e = v if e is None else (e + a*(v - e))
        out.append(e)
    return out

def true_range(h,l,c_prev):
    return max(h-l, abs(h-c_prev), abs(l-c_prev))

def recompute_ema_cross_and_dist():
    try:
        bars = fetch_spy_10m_last_n(60)
        if not bars or len(bars) < 25:
            return {"present": False}
        closes = [b["c"] for b in bars]
        ema10 = ema_seq(closes, 10)
        ema20 = ema_seq(closes, 20)
        c_now = closes[-1]; c_prev = closes[-2]
        e10_now, e20_now = ema10[-1], ema20[-1]
        e10_prev, e20_prev = ema10[-2], ema20[-2]
        if e10_prev < e20_prev and e10_now > e20_now:
            cross = "bull"
        elif e10_prev > e20_prev and e10_now < e20_now:
            cross = "bear"
        else:
            cross = "none"
        dist_pct = 0.0 if e10_now == 0 else 100.0 * (c_now - e10_now) / e10_now

        # reactive ATR (hl=3) if you want to eyeball extension in ATR units
        trs=[]
        for i,b in enumerate(bars):
            trs.append((b["h"]-b["l"]) if i==0 else true_range(b["h"], b["l"], bars[i-1]["c"]))
        import math
        def ema_hl_seq(vals, hl):
            y=None; out=[]
            for v in vals:
                a = 1.0 - math.pow(0.5, 1.0/max(hl,0.5))
                y = v if y is None else (y + a*(v - y))
                out.append(y)
            return out
        atr10m = ema_hl_seq(trs, hl=3.0)[-1]
        dist_atr = 0.0 if atr10m == 0 else (c_now - e10_now)/atr10m

        return {
            "present": True,
            "ema_cross_calc": cross,
            "ema10_dist_pct_calc": dist_pct,
            "ema10_dist_atr_calc": dist_atr
        }
    except Exception:
        return {"present": False}

def main():
    print("=== QA Meter Check ===")
    live = get_json(LIVE_URL)
    cards = live.get("sectorCards") or []
    m_live = live.get("metrics") or {}
    intraday = live.get("intraday") or {}
    dir10 = (intraday.get("sectorDirection10m") or {})
    risk10 = (intraday.get("riskOn10m") or {})

    # recompute from cards
    comp = recompute_from_cards(cards)

    # Compare metrics
    def show_check(name, live_val, calc_val, tol):
        ok = near(live_val, calc_val, tol)
        status = "PASS" if ok else "FAIL"
        print(f"{name:16s} live={live_val:7.2f}  calc={calc_val:7.2f}  Δ={live_val - calc_val:+6.2f}  [{status}]")
        return ok

    print("\n-- Recomputed from sectorCards --")
    ok_b = show_check("Breadth %",  float(m_live.get("breadth_pct", 0.0)), comp["breadth_pct"], TOL["breadth_pct"])
    ok_m = show_check("Momentum %", float(m_live.get("momentum_pct",0.0)), comp["momentum_pct"], TOL["momentum_pct"])
    ok_r = show_check("Rising %",   float(dir10.get("risingPct",0.0)),     comp["risingPct"],   TOL["risingPct"])
    ok_k = show_check("Risk-On %",  float(risk10.get("riskOnPct",0.0)),    comp["riskOnPct"],   TOL["riskOnPct"])

    # EMA checks (optional)
    ema_calc = recompute_ema_cross_and_dist()
    if ema_calc.get("present"):
        print("\n-- EMA10/20 (Polygon) --")
        print(f"ema_cross (calc): {ema_calc['ema_cross_calc']}  |  ema10_dist_pct (calc): {ema_calc['ema10_dist_pct_calc']:.2f}  |  dist_ATR: {ema_calc['ema10_dist_atr_calc']:.2f}")
        print(f"ema_cross (live): {m_live.get('ema_cross','n/a')}  |  ema10_dist_pct (live): {float(m_live.get('ema10_dist_pct',0.0)):.2f}")
    else:
        print("\n-- EMA10/20 (Polygon) -- Skipped (no POLYGON_API_KEY or fetch failed)")

    # Expected lights (what should be on)
    print("\n-- Expected 10m Engine Lights (from calc) --")
    accel = comp["breadth_pct"] - float(m_live.get("breadth_pct", comp["breadth_pct"])) + comp["momentum_pct"] - float(m_live.get("momentum_pct", comp["momentum_pct"]))
    # For expected lights, use recomputed comp + live reactive values conservatively:
    accel_now = (comp["breadth_pct"] - comp["breadth_pct"]) + (comp["momentum_pct"] - comp["momentum_pct"])  # 0; we don't carry prev here
    # Instead show rules plainly for operator:
    print("Rules:")
    print("  sigAccelUp     if ΔBreadth + ΔMomentum >= +3.0")
    print("  sigAccelDown   if ΔBreadth + ΔMomentum <= -3.0")
    print("  sigRiskOn      if Risk-On% >= 57")
    print("  sigRiskOff     if Risk-On% <= 43")
    print("  sigThrust      if Rising% >= 57")
    print("  sigWeak        if Rising% <= 43")

    should = {
        "sigRiskOn":  comp["riskOnPct"] >= 57.0,
        "sigRiskOff": comp["riskOnPct"] <= 43.0,
        "sigThrust":  comp["risingPct"] >= 57.0,
        "sigWeak":    comp["risingPct"] <= 43.0,
    }
    for k,v in should.items():
        print(f"  {k:13s}: {'ON ' if v else 'off'}  (riskOn={comp['riskOnPct']:.2f}, rising={comp['risingPct']:.2f})")

    # Summary & exit code
    all_ok = ok_b and ok_m and ok_r and ok_k
    print("\nSummary:", "PASS ✅" if all_ok else "FAIL ❌")
    sys.exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
