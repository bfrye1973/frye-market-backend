#!/usr/bin/env python3
# scripts/make_dashboard.py
#
# INPUTS:
#   data/outlook_source.json  (per-sector NH/NL/3U/3D + "global" squeeze/vol/liquidity)
#   data/history.json         (optional: appended daily snapshots by the builder)
#
# OUTPUT:
#   data/outlook.json         (frontend payload, served at /api/dashboard)
#
# Adds:
#   - sectorCards[].counts = { nh, nl, u, d }
#   - sectorCards[].spark  = last 5 values of (NH - NL)
#   - gauges, odometers (breadth/momentum/squeeze)
#   - lights tokens: strong|improving|neutral|deteriorating|weak
#   - signals (starter set)
#   - summary { score, verdict, indices, states, sector participation }
#   - meta { ts, version }

import json, os
from datetime import datetime, timezone

SRC  = os.path.join("data", "outlook_source.json")
HIST = os.path.join("data", "history.json")
DST  = os.path.join("data", "outlook.json")

def clamp(v, lo, hi): return max(lo, min(hi, v))
def pct(a, b): return (a / max(1, a + b))

def load_json(path, default):
  try:
    with open(path, "r", encoding="utf-8") as f:
      return json.load(f)
  except Exception:
    return default

def squeeze_enum(s: str) -> str:
  s = (s or "").lower()
  if "firingdown" in s: return "firingDown"
  if "firingup"   in s or "release" in s or "expand" in s: return "firingUp"
  if "on" in s or "contract" in s or "tight" in s: return "on"
  return "none"

def last_n(lst, n): return lst[-n:] if lst else []

def linear_slope(vals):
  if len(vals) < 3: return 0.0
  n = len(vals); xs = list(range(n))
  xbar = sum(xs)/n; ybar = sum(vals)/n
  num = sum((x-xbar)*(y-ybar) for x, y in zip(xs, vals))
  den = sum((x-xbar)**2 for x in xs) or 1
  return num / den

def classify(index):
  if index >= 70: return "strong"
  if index >= 55: return "improving"
  if index >  45: return "neutral"
  if index >  30: return "deteriorating"
  return "weak"

def build_sector_cards(groups, history):
  Bs, Ms, comp_fracs, cards = [], [], [], []
  hist_days = history.get("days", [])

  series_netB, series_netM = [], []
  for day in hist_days:
    gmap = day.get("groups", {})
    tot_nh = sum(int(v.get("nh",0)) for v in gmap.values())
    tot_nl = sum(int(v.get("nl",0)) for v in gmap.values())
    tot_u  = sum(int(v.get("u" ,0)) for v in gmap.values())
    tot_d  = sum(int(v.get("d" ,0)) for v in gmap.values())
    series_netB.append(tot_nh - tot_nl)
    series_netM.append(tot_u  - tot_d)

  for sector, g in groups.items():
    nh = int(g.get("nh", 0)); nl = int(g.get("nl", 0))
    u  = int(g.get("u",  0)); d  = int(g.get("d",  0))

    B_s = (nh - nl) / max(1, nh + nl)
    M_s = (u  - d ) / max(1, u  + d )
    Bs.append(B_s); Ms.append(M_s)

    comp_fracs.append(d / max(1, u + d))

    spark_vals = []
    for day in hist_days[-5:]:
      gmap = day.get("groups", {})
      if sector in gmap:
        spark_vals.append(int(gmap[sector].get("nh",0)) - int(gmap[sector].get("nl",0)))
      else:
        spark_vals.append(0)
    spark = spark_vals if any(spark_vals) else []

    cards.append({
      "sector":  sector,
      "outlook": g.get("breadth_state", "Neutral"),
      "spark":   spark,
      "counts": {"nh": nh, "nl": nl, "u": u, "d": d}
    })

  mean_B = sum(Bs)/len(Bs) if Bs else 0.0
  mean_M = sum(Ms)/len(Ms) if Ms else 0.0
  breadth_idx  = clamp(round(50 * (1 + mean_B)),  0, 100)
  momentum_idx = clamp(round(50 * (1 + mean_M)),  0, 100)

  slopeB = linear_slope(last_n(series_netB, 7))
  slopeM = linear_slope(last_n(series_netM, 7))
  trend = {"breadthSlope": slopeB, "momentumSlope": slopeM}

  comp_avg = sum(comp_fracs)/len(comp_fracs) if comp_fracs else 0.5
  return cards, breadth_idx, momentum_idx, comp_avg, trend

def main():
  src  = load_json(SRC,  {"groups": {}, "global": {}})
  hist = load_json(HIST, {"days": []})
  groups    = src.get("groups", {})
  global_in = src.get("global", {})

  if not groups:
    raise SystemExit("No groups found in data/outlook_source.json")

  sector_cards, breadth_idx, momentum_idx, comp_avg, trend = build_sector_cards(groups, hist)

  # big gauges (−1000..+1000)
  rpm   = clamp(round(1000 * (breadth_idx/50 - 1)),  -1000, 1000)
  speed = clamp(round(1000 * (momentum_idx/50 - 1)), -1000, 1000)

  # mini gauges (Fuel/Temp/Oil)
  fuelPct   = clamp(int(round(global_in.get("squeeze_pressure_pct", 100 * comp_avg))), 0, 100)
  vol_pct   = clamp(int(global_in.get("volatility_pct", momentum_idx)), 0, 100)
  waterTemp = int(round(180 + 60 * (vol_pct / 100)))
  liq_pct   = int(global_in.get("liquidity_pct", 70))     # from builder (0..120)
  oilPsi    = clamp(liq_pct, 0, 120)

  squeeze_state = squeeze_enum(global_in.get("squeeze_state") or (groups.get("Tech") or groups.get("tech") or {}).get("vol_state", ""))

  NH_total = sum(int(g.get("nh",0)) for g in groups.values())
  NL_total = sum(int(g.get("nl",0)) for g in groups.values())
  U_total  = sum(int(g.get("u",0))  for g in groups.values())
  D_total  = sum(int(g.get("d",0))  for g in groups.values())
  NHpct = pct(NH_total, NL_total)
  Upct  = pct(U_total,  D_total)

  lights = {"breadth": classify(breadth_idx), "momentum": classify(momentum_idx)}

  sigBreakout     = (momentum_idx >= 60 and NHpct >= 0.66)
  sigDistribution = (NL_total > NH_total*1.5 or breadth_idx <= 45)
  sigTurbo        = (momentum_idx >= 70)
  sigCompression  = (squeeze_state == "on" or fuelPct >= 60)
  sigExpansion    = (squeeze_state in ("firingUp","firingDown") or (Upct >= 0.60 and momentum_idx >= 55))
  sigDivergence   = (trend["momentumSlope"] > 0 and trend["breadthSlope"] < 0) or (trend["momentumSlope"] < 0 and trend["breadthSlope"] > 0)
  sigOverheat     = (momentum_idx >= 85)
  sigLowLiquidity = (oilPsi <= 40)

  def sev(active, base="info"): return {"active": bool(active), "severity": base}

  # ---- summary ----
  tot = len(groups)
  up_breadth = sum(1 for g in groups.values() if int(g.get("nh",0)) > int(g.get("nl",0)))
  dn_breadth = tot - up_breadth
  up_momo    = sum(1 for g in groups.values() if int(g.get("u",0))  > int(g.get("d",0)))
  dn_momo    = tot - up_momo

  score   = int(round((breadth_idx + momentum_idx)/2))
  b_state = lights["breadth"]; m_state = lights["momentum"]

  verdict = "Neutral"
  if score >= 65 and up_breadth > dn_breadth and up_momo > dn_momo:
    verdict = "Bullish / Accumulation"
  elif score <= 35 and dn_breadth > up_breadth and dn_momo > up_momo:
    verdict = "Bearish / Distribution"
  elif b_state in ("weak","deteriorating") and m_state in ("weak","deteriorating"):
    verdict = "Risk-Off"
  elif b_state in ("strong","improving") and m_state in ("strong","improving"):
    verdict = "Risk-On"

  summary = {
    "score": score,
    "verdict": verdict,
    "breadthIdx":  breadth_idx,
    "momentumIdx": momentum_idx,
    "breadthState":  b_state,
    "momentumState": m_state,
    "sectors": {
      "total": tot,
      "upBreadth": up_breadth,  "downBreadth": dn_breadth,
      "upMomentum": up_momo,    "downMomentum": dn_momo
    }
  }

  payload = {
    "gauges": {
      "rpm": rpm,
      "speed": speed,
      "fuelPct": fuelPct,
      "waterTemp": waterTemp,
      "oilPsi": oilPsi
    },
    "odometers": {
      "breadthOdometer": breadth_idx,
      "momentumOdometer": momentum_idx,
      "squeeze": squeeze_state
    },
    "lights": lights,
    "signals": {
      "sigBreakout":     sev(sigBreakout,     "warn"),
      "sigDistribution": sev(sigDistribution, "warn"),
      "sigTurbo":        sev(sigTurbo,        "info"),
      "sigCompression":  sev(sigCompression,  "info"),
      "sigExpansion":    sev(sigExpansion,    "info"),
      "sigDivergence":   sev(sigDivergence,   "warn"),
      "sigOverheat":     sev(sigOverheat,     "danger"),
      "sigLowLiquidity": sev(sigLowLiquidity, "warn")
    },
    "outlook": {
      "dailyOutlook": clamp(round((breadth_idx + momentum_idx)/2), 0, 100),
      "sectorCards": sorted(sector_cards, key=lambda x: x["sector"].lower())
    },
    "summary": summary,
    "meta": {
      "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
      "version": "1.2"
    }
  }

  os.makedirs(os.path.dirname(DST), exist_ok=True)
  with open(DST, "w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
  print(f"[OK] wrote {DST}")

if __name__ == "__main__":
  main()
