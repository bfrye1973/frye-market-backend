#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_eod.py
Builds /live/eod (daily panel + sectorCards)

Daily tiles produced (in "daily"):
- trendPct          : avg sector breadth (% > 50 weights linearly)
- participationPct  : % sectors with breadth > 50
- squeezePct        : Lux-style SQUEEZE index on SPY daily (PSI 0..100, higher=tighter)
- volatilityPct     : ATR(14)/Close on SPY daily (percent)
- liquidityPct      : 5/20 day volume ratio (0..120)
- riskOnPct         : OFFENSIVE vs DEFENSIVE breadth (>=50 better), scaled %

Also writes 11 sectorCards with {breadth_pct, momentum_pct, nh/nl/up/down}.

R12.7 UPDATE:
- Adds daily.overallEOD {state, score, components} using a composite:
    score = 0.40*trend
          + 0.25*participation
          + 0.10*squeezeExpansion (100 - squeezePct)
          + 0.10*liquidityNorm
          + 0.10*volScore (higher when vol lower)
          + 0.05*riskOn
- Writes metrics.overall_eod_score and metrics.overall_eod_state.
"""

from __future__ import annotations
import argparse, json, os, sys, math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Tuple, Optional
import urllib.request

UTC = timezone.utc

SECTOR_ORDER = [
    "information technology","materials","health care","communication services",
    "real estate","energy","consumer staples","consumer discretionary",
    "financials","utilities","industrials",
]
ALIASES = {
    "healthcare":"health care","health-care":"health care",
    "info tech":"information technology","technology":"information technology","tech":"information technology",
    "communications":"communication services","comm services":"communication services","telecom":"communication services",
    "staples":"consumer staples","discretionary":"consumer discretionary",
    "finance":"financials","industry":"industrials","reit":"real estate","reits":"real estate",
}
OFFENSIVE = {"information technology","consumer discretionary","communication services"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

POLY_KEY = os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
POLY_BASE = "https://api.polygon.io"

# Composite weights for EOD overall (mirrors 10m/1h style)
W_TREND = 40
W_PART  = 25
W_SQ    = 10
W_LIQ   = 10
W_VOL   = 10
W_RISK  = 5

def clamp(x: float, lo: float, hi: float) -> float:
    try:
        return max(lo, min(hi, float(x)))
    except Exception:
        return lo

def pct(a: float, b: float) -> float:
    return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def lin_points(pct_val: float, weight: int) -> int:
    """Map 0–100 pct_val into +/-weight around 50."""
    try:
        v = float(pct_val)
    except Exception:
        v = 50.0
    return int(round(weight * ((v - 50.0) / 50.0)))

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"make-eod/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def poly_daily_bars(ticker: str, days: int = 260) -> List[dict]:
    end = datetime.now(UTC).date()
    start = (end - timedelta(days=days)).strftime("%Y-%m-%d")
    end_s = end.strftime("%Y-%m-%d")
    url = f"{POLY_BASE}/v2/aggs/ticker/{ticker}/range/1/day/{start}/{end_s}?adjusted=true&sort=asc&limit=50000&apiKey={POLY_KEY}"
    try:
        js = fetch_json(url)
        rows = js.get("results") or []
    except Exception:
        rows = []
    out=[]
    for r in rows:
        try:
            out.append({"t": int(r["t"])//1000, "o": float(r["o"]), "h": float(r["h"]),
                        "l": float(r["l"]), "c": float(r["c"]), "v": float(r.get("v",0.0))})
        except Exception:
            pass
    return out

def lux_psi_from_closes(closes: List[float], conv: int = 50, length: int = 20) -> Optional[float]:
    if len(closes) < length + 2: return None
    mx = mn = None
    diffs=[]
    for src in closes:
        mx = src if mx is None else max(mx - (mx - src) / conv, src)
        mn = src if mn is None else min(mn + (src - mn) / conv, src)
        span = max(mx - mn, 1e-12)
        diffs.append(math.log(span))
    n = length; xs=list(range(n)); win=diffs[-n:]
    xbar=sum(xs)/n; ybar=sum(win)/n
    num=sum((x-xbar)*(y-ybar) for x,y in zip(xs,win))
    den=(sum((x-xbar)**2 for x in xs)*sum((y-ybar)**2 for y in win)) or 1.0
    r=num/(den**0.5)
    psi = -50.0 * r + 50.0
    return float(max(0.0, min(100.0, psi)))

def volatility_pct_from_series(closes, highs, lows) -> float:
    if len(closes) < 20: return 50.0
    trs=[max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1])) for i in range(1,len(closes))]
    atr=sum(trs[-14:])/14.0
    return max(0.0, 100.0 * atr / closes[-1]) if closes[-1] > 0 else 0.0

def liquidity_pct_from_series(vols) -> int:
    if len(vols) < 20: return 70
    v5=sum(vols[-5:])/5.0; v20=sum(vols[-20:])/20.0
    return int(round(min(120.0, max(0.0, 100.0 * (v5/v20 if v20>0 else 0)))))

def norm(s: str) -> str:
    return (s or "").strip().lower()

def canon(n: str) -> str:
    n=norm(n); return ALIASES.get(n,n)

def groups_to_cards(groups: Dict[str, Dict[str,int]]) -> List[dict]:
    by={}
    for name,g in (groups or {}).items():
        k=canon(name)
        nh=int(g.get("nh",0)); nl=int(g.get("nl",0)); up=int(g.get("u",0)); dn=int(g.get("d",0))
        b=pct(nh, nh+nl); m=pct(up, up+dn)
        by[k]={"sector":k.title(),"breadth_pct":round(b,2),"momentum_pct":round(m,2),
               "nh":nh,"nl":nl,"up":up,"down":dn}
    out=[]
    for name in SECTOR_ORDER:
        out.append(by.get(name, {"sector":name.title(),"breadth_pct":0.0,"momentum_pct":0.0,"nh":0,"nl":0,"up":0,"down":0}))
    return out

def compute_daily_tiles(cards: List[dict]) -> dict:
    # trend = average breadth across sectors
    trend = round(sum(c.get("breadth_pct",0) for c in cards)/len(cards), 2) if cards else 50.0
    # participation = % sectors breadth>50
    part = round(100.0 * sum(1 for c in cards if c.get("breadth_pct",0)>50.0) / (len(cards) or 1), 2)
    # risk on via offensive vs defensive
    by={norm(c.get("sector","")): c for c in cards}
    score=considered=0
    for n in OFFENSIVE:
        b=by.get(n,{}).get("breadth_pct")
        if isinstance(b,(int,float)): considered+=1; score += (1 if b>50.0 else 0)
    for n in DEFENSIVE:
        b=by.get(n,{}).get("breadth_pct")
        if isinstance(b,(int,float)): considered+=1; score += (1 if b<50.0 else 0)
    riskon = round(pct(score, considered or 1), 2)

    # SPY daily metrics
    try:
        bars = poly_daily_bars("SPY", days=260)
    except Exception:
        bars = []
    C=[b["c"] for b in bars]; H=[b["h"] for b in bars]; L=[b["l"] for b in bars]; V=[b["v"] for b in bars]
    psi = lux_psi_from_closes(C, conv=50, length=20) or 50.0
    # NOTE: squeezePct here is PSI (tightness), matched to LuxAlgo indicator (0..100)
    squeeze_psi = round(psi, 2)
    vol_pct = round(volatility_pct_from_series(C,H,L), 2)
    liq_pct = liquidity_pct_from_series(V)

    return {
        "trendPct": trend,
        "participationPct": part,
        "squeezePct": squeeze_psi,       # psi tightness 0..100
        "volatilityPct": vol_pct,
        "liquidityPct": liq_pct,
        "riskOnPct": riskon,
        # aliases kept for older UI
        "trend": trend,
        "participation": part,
        "squeeze": squeeze_psi,
        "volatility": vol_pct,
        "liquidity": liq_pct,
        "riskOn": riskon
    }

def compute_overall_eod(daily: dict) -> dict:
    """
    Compute composite EOD Market Meter signal from daily tiles.

    Inputs (0..100):
      trendPct, participationPct, squeezePct (PSI), volatilityPct, liquidityPct, riskOnPct

    Internals:
      squeezeExp   = 100 - squeezePct    (higher = more open)
      volScore     = 100 - clamp(volatilityPct,0,200)  (lower vol = better)
      liqNorm      = liquidityPct mapped 0..120 -> 0..100
    """

    trend   = float(daily.get("trendPct", 50.0))
    part    = float(daily.get("participationPct", 50.0))
    sqPsi   = float(daily.get("squeezePct", 50.0))
    volPct  = float(daily.get("volatilityPct", 50.0))
    liqPct  = float(daily.get("liquidityPct", 70.0))
    riskOn  = float(daily.get("riskOnPct", 50.0))

    # Squeeze expansion (0=open, 100=very open)
    sqExp = clamp(100.0 - sqPsi, 0.0, 100.0)

    # Volatility: convert to "good" score (lower vol = better)
    volClamped = clamp(volPct, 0.0, 200.0)
    volScore = clamp(100.0 - volClamped, 0.0, 100.0)

    # Liquidity: 0..120 -> 0..100
    liqClamped = clamp(liqPct, 0.0, 120.0)
    liqNorm = liqClamped / 120.0 * 100.0

    # Composite score (same style as 10m/1h)
    score_f = (
        0.40 * trend +
        0.25 * part +
        0.10 * sqExp +
        0.10 * liqNorm +
        0.10 * volScore +
        0.05 * riskOn
    )
    score = float(clamp(score_f, 0.0, 100.0))

    if score >= 60.0:
        state = "bull"
    elif score <= 40.0:
        state = "bear"
    else:
        state = "neutral"

    components = {
        "trend":        lin_points(trend,   W_TREND),
        "participation":lin_points(part,    W_PART),
        "squeeze":      lin_points(sqExp,   W_SQ),
        "liquidity":    lin_points(liqNorm, W_LIQ),
        "volatility":   lin_points(volScore,W_VOL),
        "riskOn":       lin_points(riskOn,  W_RISK),
    }

    return {"state": state, "score": score, "components": components}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    try:
        src = json.load(open(args.source,"r",encoding="utf-8"))
    except Exception as e:
        print("[error] cannot read source:", e, file=sys.stderr)
        sys.exit(1)

    # Build sectorCards
    cards = src.get("sectorCards") or groups_to_cards(src.get("groups") or {})

    # Compute daily tiles
    daily = compute_daily_tiles(cards)
    overall_eod = compute_overall_eod(daily)
    daily["overallEOD"] = overall_eod

    # Metrics block
    metrics = {
        "daily_trend_pct": daily["trendPct"],
        "participation_pct": daily["participationPct"],
        "daily_squeeze_pct": daily["squeezePct"],  # PSI tightness
        "volatility_pct": daily["volatilityPct"],
        "liquidity_pct": daily["liquidityPct"],
        "risk_on_daily_pct": daily["riskOnPct"],
        # extras for Market Meter
        "overall_eod_score": overall_eod["score"],
        "overall_eod_state": overall_eod["state"],
    }

    out = {
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "metrics": metrics,
        "daily": daily,
        "sectorCards": cards
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out,"w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))
    print("[ok] wrote", args.out, "| daily:", daily)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(1)
