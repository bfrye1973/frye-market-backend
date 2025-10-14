#!/usr/bin/env python3
"""
QA Meter Check — verifies Market Meter math vs current JSON and shows expected lights.

Run:
  python tools/qa_meter_check.py

Env (optional):
  LIVE_URL, SANDBOX_URL, POLYGON_API_KEY
"""

import os, sys, json, math, time, urllib.request
from datetime import datetime, timedelta

LIVE_URL    = os.environ.get("LIVE_URL",    "https://frye-market-backend-1.onrender.com/live/intraday")
SANDBOX_URL = os.environ.get("SANDBOX_URL", "https://raw.githubusercontent.com/bfrye1973/frye-market-backend/data-live-10min-sandbox/data/outlook_intraday.json")
POLY_KEY    = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLYGON_API")

TOL = { "breadth_pct":0.25, "momentum_pct":0.25, "risingPct":0.5, "riskOnPct":0.5 }

OFFENSIVE = {"Information Technology","Communication Services","Consumer Discretionary"}
DEFENSIVE = {"Consumer Staples","Utilities","Health Care","Real Estate"}

def get_json(url: str):
  u = url + ("&t=" if "?" in url else "?t=") + str(int(time.time()))
  req = urllib.request.Request(u, headers={"Cache-Control":"no-store","User-Agent":"qa-meter-check/1.0"})
  with urllib.request.urlopen(req, timeout=20) as resp:
    return json.loads(resp.read().decode("utf-8"))

def pct(a,b): return 0.0 if b == 0 else 100.0 * a / b

def recompute_from_cards(cards):
  nh=nl=up=dn=rising=off_up=def_dn=0
  for c in cards or []:
    nh += int(c.get("nh",0)); nl += int(c.get("nl",0))
    up += int(c.get("up",0)); dn += int(c.get("down",0))
    b = pct(int(c.get("nh",0)), int(c.get("nh",0))+int(c.get("nl",0)))
    if b > 50.0: rising += 1
    s = c.get("sector","")
    if s in OFFENSIVE and b > 50.0: off_up += 1
    if s in DEFENSIVE and b < 50.0: def_dn += 1
  return {
    "ΣNH":nh,"ΣNL":nl,"ΣUP":up,"ΣDOWN":dn,
    "breadth_pct":pct(nh,nh+nl),
    "momentum_pct":pct(up,up+dn),
    "risingPct":pct(rising,11.0),
    "riskOnPct":pct(off_up+def_dn, len(OFFENSIVE)+len(DEFENSIVE)),
  }

def near(a,b,tol): return abs((a or 0)-(b or 0)) <= tol

def show_check(name, live, calc, tol):
  d = (live or 0) - (calc or 0)
  ok = near(live, calc, tol)
  print(f"{'✅' if ok else '❌'} {name:12s} live={live:7.2f}  calc={calc:7.2f}  Δ={d:+6.2f} (tol ±{tol})")
  return ok

def fetch_spy_10m_last_n(n=60):
  if not POLY_KEY: return []
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

def ema_seq(vals,n):
  a = 2.0/(n+1.0); e=None; out=[]
  for v in vals:
    e = v if e is None else (e + a*(v - e))
    out.append(e)
  return out

def true_range(h,l,cprev): return max(h-l, abs(h-cprev), abs(l-cprev))

def recompute_ema_cross_dist():
  try:
    bars = fetch_spy_10m_last_n(60)
    if not bars or len(bars) < 25: return {"present":False}
    closes = [b["c"] for b in bars]
    ema10 = ema_seq(closes,10); ema20 = ema_seq(closes,20)
    e10p,e20p = ema10[-2],ema20[-2]; e10n,e20n = ema10[-1],ema20[-1]
    if e10p < e20p and e10n > e20n: cross="bull"
    elif e10p > e20p and e10n < e20n: cross="bear"
    else: cross="none"
    dist_pct = 0.0 if e10n==0 else 100.0*(closes[-1]-e10n)/e10n
    # ATR(10m) reactive (optional view)
    trs=[]; 
    for i,b in enumerate(bars):
      trs.append((b["h"]-b["l"]) if i==0 else true_range(b["h"], b["l"], bars[i-1]["c"]))
    # HL EMA=3 to approximate reactive ATR
    def ema_hl_seq(vals,hl):
      y=None; out=[]
      for v in vals:
        a = 1.0 - math.pow(0.5, 1.0/max(hl,0.5))
        y = v if y is None else (y + a*(v - y))
        out.append(y)
      return out
    atr10m = ema_hl_seq(trs,hl=3.0)[-1]
    return {"present":True,"ema_cross_calc":cross,"ema10_dist_pct_calc":dist_pct,"atr10m":atr10m}
  except Exception:
    return {"present":False}

def main():
  print("=== QA Meter Check ===")
  live = get_json(LIVE_URL)
  cards = live.get("sectorCards") or []
  m     = live.get("metrics") or {}
  dir10 = (live.get("intraday") or {}).get("sectorDirection10m") or {}
  risk  = (live.get("intraday") or {}).get("riskOn10m") or {}

  comp = recompute_from_cards(cards)

  print("\n-- Recomputed from sectorCards --")
  ok_b = show_check("Breadth %",  float(m.get("breadth_pct", 0.0)), comp["breadth_pct"],  TOL["breadth_pct"])
  ok_m = show_check("Momentum %", float(m.get("momentum_pct",0.0)), comp["momentum_pct"], TOL["momentum_pct"])
  ok_r = show_check("Rising %",   float(dir10.get("risingPct",0.0)), comp["risingPct"],   TOL["risingPct"])
  ok_k = show_check("Risk-On %",  float(risk.get("riskOnPct",0.0)),  comp["riskOnPct"],   TOL["riskOnPct"])

  ema = recompute_ema_cross_dist()
  if ema.get("present"):
    print("\n-- EMA10/20 (calc) --")
    print(f"ema_cross={ema['ema_cross_calc']}  ema10_dist_pct={ema['ema10_dist_pct_calc']:.2f}%  (live: cross={m.get('ema_cross','n/a')}  dist={float(m.get('ema10_dist_pct',0.0)):.2f}%)")
  else:
    print("\n-- EMA10/20 (calc) -- Skipped (no POLYGON_API_KEY or fetch failed)")

  print("\nSummary:", "PASS ✅" if (ok_b and ok_m and ok_r and ok_k) else "FAIL ❌")
  sys.exit(0 if (ok_b and ok_m and ok_r and ok_k) else 1)

if __name__ == "__main__":
  main()
