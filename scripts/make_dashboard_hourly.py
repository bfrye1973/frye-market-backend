#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard_hourly.py (1-Hour Market Meter, v1)

Builds /live/hourly with the v1-hourly contract:

metrics (1h, RTH+AH)
- breadth_1h_pct                  : 0.60*A + 0.40*B on 1h bars (A=%ETFs EMA10>EMA20, B=%ETFs close>open), L=1 (fast)
  components (QA): breadth_align_1h_pct(_fast), breadth_bar_1h_pct(_fast)
- momentum_1h_pct                 : sector ETF momentum (legacy; EMA10>EMA20 + cross boost)
- momentum_combo_1h_pct           : SPY 1h blend = 0.55*EMA_posture_1h + 0.20*SMI_1h + 0.25*SMI_4h (fallback to EMA)
- squeeze_1h_pct                  : Expansion% (Lux-style) on 1h (0=tight, 100=expanded)
- liquidity_1h                    : PSI = 100*EMA(Vol,3)/EMA(Vol,12) on 1h (cap 0..200)
- volatility_1h_pct               : 100*EMA(TR,3)/Close on 1h
- volatility_1h_scaled            : volatility_1h_pct * 6.25
- breadth_slow_pct, momentum_slow_pct (optional carry-forward for context)

hourly
- sectorDirection1h.risingPct     : % sectors breadth > 50
- riskOn1h.riskOnPct              : % offensive >50 + % defensive <50 normalized
- overall1h.{state, score, components}

Notes
- Include AH for squeeze & SMI (as requested).
- L=1 for A/B so 1h reacts within 2–3 bars (fast but stable enough).
"""

from __future__ import annotations

import argparse, json, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
import math

# ---------------------------- Config ----------------------------
HOURLY_URL_DEFAULT = "https://frye-market-backend-1.onrender.com/live/hourly"  # fallback cards only
POLY_1H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/60/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)
POLY_4H_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/240/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

SECTOR_ETFS = ["XLK","XLY","XLC","XLP","XLU","XLV","XLRE","XLE","XLF","XLB","XLI"]

# Overall weights (same as 10m)
W_EMA, W_MOM, W_BR, W_SQ, W_LIQ, W_RISK = 40, 25, 10, 10, 10, 5
FULL_EMA_DIST = 0.60  # % distance to reach full ±W_EMA

# SMI blend weights for 1h (fast but stable)
W_EMA_1H, W_SMI1H, W_SMI4H = 0.55, 0.20, 0.25  # clamp SMI4h ≤ 0.25

OFFENSIVE = {"information technology","consumer discretionary","communication services"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

# ------------------------- Utils -------------------------
def now_utc_iso() -> str: return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x: float, lo: float, hi: float) -> float: return max(lo, min(hi, x))
def pct(a: float, b: float) -> float: return 0.0 if b <= 0 else 100.0 * float(a) / float(b)

def fetch_json(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent":"make-dashboard/1h/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))

def fetch_polygon_bars(url_tmpl: str, key: str, sym: str, lookback_days: int = 20) -> List[dict]:
    end = datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)
    url = url_tmpl.format(sym=sym, start=start, end=end, key=key)
    try:
        js = fetch_json(url)
    except Exception:
        return []
    rows = js.get("results") or []
    out: List[dict] = []
    for r in rows:
        try:
            t = int(r.get("t",0)) // 1000
            out.append({"time":t,"open":float(r.get("o",0)),"high":float(r.get("h",0)),"low":float(r.get("l",0)),
                        "close":float(r.get("c",0)),"volume":float(r.get("v",0))})
        except Exception:
            continue
    # drop in-flight hour
    if out:
        bucket = 3600
        now = int(time.time())
        cur  = (now // bucket) * bucket
        if out[-1]["time"] == cur:
            out.pop()
    return out

def ema_series(vals: List[float], span: int) -> List[float]:
    k = 2.0 / (span + 1.0)
    out=[]; e=None
    for v in vals:
        e = v if e is None else e + k*(v - e)
        out.append(e)
    return out

def ema_last(vals: List[float], span: int) -> Optional[float]:
    k = 2.0 / (span + 1.0)
    e=None
    for v in vals:
        e = v if e is None else e + k*(v - e)
    return e

def tr_series(H: List[float], L: List[float], C: List[float]) -> List[float]:
    return [max(H[i]-L[i], abs(H[i]-C[i-1]), abs(L[i]-C[i-1])) for i in range(1,len(C))]

# ------------------------- SMI (EMA %K=12, %D=7, EMA=5) -------------------------
def smi_kd(H: List[float], L: List[float], C: List[float],
           k_len: int = 12, d_len: int = 7, ema_len: int = 5) -> Tuple[Optional[float], Optional[float]]:
    n = len(C)
    if n < max(k_len, d_len) + 6:
        return None, None
    HH=[]; LL=[]
    for i in range(n):
        i0=max(0, i-(k_len-1))
        HH.append(max(H[i0:i+1])); LL.append(min(L[i0:i+1]))
    mid=[(HH[i]+LL[i])/2.0 for i in range(n)]
    rng=[(HH[i]-LL[i]) for i in range(n)]
    m=[C[i]-mid[i] for i in range(n)]
    m1=ema_series(m,k_len); m2=ema_series(m1,ema_len)
    r1=ema_series(rng,k_len); r2=ema_series(r1,ema_len)
    kv=[]
    for i in range(n):
        denom=(r2[i] or 0.0)/2.0
        val=0.0 if denom==0 else 100.0*(m2[i]/denom)
        if not (val==val): val=0.0
        val=max(-100.0, min(100.0, val)); kv.append(val)
    dv=ema_series(kv,d_len)
    return float(kv[-1]), float(dv[-1])

# ------------------------- groups → sectorCards helper -------------------------
def groups_to_sector_cards(groups: Dict[str, dict]) -> List[dict]:
    ORDER=["information technology","materials","health care","communication services","real estate",
           "energy","consumer staples","consumer discretionary","financials","utilities","industrials"]
    alias={"healthcare":"health care","health-care":"health care","info tech":"information technology",
           "technology":"information technology","tech":"information technology",
           "communications":"communication services","comm services":"communication services","telecom":"communication services",
           "staples":"consumer staples","discretionary":"consumer discretionary",
           "finance":"financials","industry":"industrials","reit":"real estate","reits":"real estate"}
    def norm(s): return (s or "").strip().lower()
    by={}
    for name,g in (groups or {}).items():
        k=alias.get(norm(name), norm(name))
        nh=int((g or {}).get("nh",0)); nl=int((g or {}).get("nl",0))
        u =int((g or {}).get("u",0));  d =int((g or {}).get("d",0))
        b = 0.0 if (nh+nl)==0 else round(100.0*nh/(nh+nl),2)
        m = 0.0 if (u+d)==0  else round(100.0*u/(u+d),2)
        by[k]={"sector":k.title(),"breadth_pct":b,"momentum_pct":m,"nh":nh,"nl":nl,"up":u,"down":d}
    cards=[]
    for name in ORDER:
        cards.append(by.get(name, {"sector":name.title(),"breadth_pct":0.0,"momentum_pct":0.0,"nh":0,"nl":0,"up":0,"down":0}))
    return cards

# ------------------------- Overall scoring -------------------------
def lin_points(pct_val: float, weight: int) -> int:
    return int(round(weight * ((float(pct_val) - 50.0) / 50.0)))

def compute_overall1h(ema_sign: int, ema10_dist_pct: float,
                      momentum_pct: float, breadth_pct: float,
                      squeeze_expansion_pct: float, liquidity_pct: float, riskon_pct: float) -> Tuple[str,int,dict]:
    dist_unit = clamp(ema10_dist_pct / FULL_EMA_DIST, -1.0, 1.0)
    ema_pts = int(round(abs(dist_unit) * W_EMA)) * (1 if ema_sign > 0 else -1 if ema_sign < 0 else 0)
    m_pts  = lin_points(momentum_pct, W_MOM)
    b_pts  = lin_points(breadth_pct,  W_BR)
    sq_pts = lin_points(squeeze_expansion_pct, W_SQ)   # expansion drives composite
    lq_pts = lin_points(min(100.0, clamp(liquidity_pct, 0.0, 120.0)), W_LIQ)
    ro_pts = lin_points(riskon_pct, W_RISK)
    score  = int(clamp(50 + ema_pts + m_pts + b_pts + sq_pts + lq_pts + ro_pts, 0, 100))
    state  = "bull" if (ema_sign > 0 and score >= 60) else ("bear" if (ema_sign < 0 and score < 60) else "neutral")
    comps  = {"ema10": ema_pts, "momentum": m_pts, "breadth": b_pts, "squeeze": sq_pts, "liquidity": lq_pts, "riskOn": ro_pts}
    return state, score, comps

# ------------------------- Builder -------------------------
def build_hourly(source_js: Optional[dict], hourly_url: str) -> dict:
    """Compose the hourly v1 payload from source (groups or sectorCards) and bars."""
    # 1) sectorCards from source (groups → sectorCards if needed), else fallback
    cards=[]; cards_fresh=False
    if isinstance(source_js, dict):
        if isinstance(source_js.get("sectorCards"), list):
            cards = source_js["sectorCards"]; cards_fresh=True
        elif isinstance(source_js.get("sectors"), list):
            cards = source_js["sectors"]; cards_fresh=True
        elif isinstance(source_js.get("groups"), dict):
            cards = groups_to_sector_cards(source_js["groups"]); cards_fresh=True
    if not cards:
        try:
            h=fetch_json(hourly_url)
            if isinstance(h.get("sectorCards"), list):
                cards=h["sectorCards"]
            elif isinstance(h.get("sectors"), list):
                cards=h["sectors"]
            elif isinstance(h.get("groups"), dict):
                cards=groups_to_sector_cards(h["groups"])
            cards_fresh=False
        except Exception:
            cards=[]; cards_fresh=False

    # 2) summarize counts for rising/risk-on + slow snapshots
    NH=NL=UP=DN=0.0
    for c in cards or []:
        NH+=float(c.get("nh",0)); NL+=float(c.get("nl",0))
        UP+=float(c.get("up",0)); DN+=float(c.get("down",0))
    breadth_slow  = round(pct(NH,NH+NL), 2)
    momentum_slow = round(pct(UP,UP+DN), 2)
    good=total=0
    for c in cards or []:
        bp=c.get("breadth_pct")
        if isinstance(bp,(int,float)):
            total+=1; good+= 1 if bp>50.0 else 0
    rising_pct = round(pct(good,total), 2)

    by={(c.get("sector") or "").strip().lower(): c for c in cards or []}
    score=cons=0
    for s in OFFENSIVE:
        bp=by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)): cons+=1; score+= 1 if bp>50.0 else 0
    for s in DEFENSIVE:
        bp=by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)): cons+=1; score+= 1 if bp<50.0 else 0
    risk_on_pct = round(pct(score,cons), 2)

    # 3) bars (1h + 4h)
    key=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or ""
    bars_by_sym={}
    spy_1h=[]; spy_4h=[]
    if key:
        for s in SECTOR_ETFS:
            bars_by_sym[s]=fetch_polygon_bars(POLY_1H_URL,key,s,lookback_days=20)
        spy_1h=fetch_polygon_bars(POLY_1H_URL,key,"SPY",lookback_days=20)
        spy_4h=fetch_polygon_bars(POLY_4H_URL,key,"SPY",lookback_days=40)

    # 3a) breadth components (1h), L=1 fast
    align_1h=bar_1h=None
    syms=[s for s in SECTOR_ETFS if s in bars_by_sym and len(bars_by_sym[s])>=2]
    if syms:
        total=len(syms); aligned=0; barup=0
        for s in syms:
            bars=bars_by_sym[s]
            C=[b["close"] for b in bars]; O=[b["open"] for b in bars]
            e10=ema_series(C,10); e20=ema_series(C,20)
            if e10[-1] > e20[-1]: aligned+=1
            if C[-1]  > O[-1]:    barup  +=1
        align_1h = round(100.0*aligned/total,2)
        bar_1h   = round(100.0*barup/total,2)

    a_fast=align_1h; b_fast=bar_1h
    if a_fast is None and b_fast is None:
        breadth_1h = breadth_slow
    else:
        av = 0.0 if a_fast is None else float(a_fast)
        bv = 0.0 if b_fast is None else float(b_fast)
        breadth_1h = round(clamp(0.60*av + 0.40*bv, 0.0, 100.0), 2)

    # 3b) sector legacy momentum (for accel/QC)
    momentum_1h_legacy=None
    if syms:
        gt=up=dn=0
        for s in syms:
            bars=bars_by_sym[s]; C=[b["close"] for b in bars]
            e10=ema_series(C,10); e20=ema_series(C,20)
            if e10[-1] > e20[-1]: gt+=1
            if e10[-2] <= e20[-2] and e10[-1] > e20[-1]: up+=1
            if e10[-2] >= e20[-2] and e10[-1] < e20[-1]: dn+=1
        base=100.0*gt/len(syms); upx=100.0*up/len(syms); dnx=100.0*dn/len(syms)
        momentum_1h_legacy=round(clamp(base + 0.5*upx - 0.5*dnx, 0.0, 100.0), 2)

    # 3c) SPY 1h Momentum combo (EMA + SMI1h + SMI4h)
    momentum_combo_1h = 50.0
    ema_sign=0; ema10_dist_pct=0.0
    if len(spy_1h) >= 3:
        H=[b["high"] for b in spy_1h]; L=[b["low"] for b in spy_1h]; C=[b["close"] for b in spy_1h]
        e10=ema_series(C,10); e20=ema_series(C,20)
        ema10_dist_pct = 0.0 if e10[-1]==0 else 100.0*(C[-1]-e10[-1])/e10[-1]
        ema_sign = 1 if e10[-1]>e20[-1] else (-1 if e10[-1]<e20[-1] else 0)

        def ema_posture_1h(C: List[float]) -> float:
            e10=ema_series(C,10); e20=ema_series(C,20)
            d  = 0.0 if e20[-1]==0 else 100.0*(e10[-1]-e20[-1])/e20[-1]
            sign= 1.0 if d>0 else (-1.0 if d<0 else 0.0)
            mag = min(1.0, abs(d)/0.50)
            bonus = 0.0
            if len(e10)>=2 and len(e20)>=2:
                if e10[-2] <= e20[-2] and e10[-1] > e20[-1]: bonus = +5.0
                if e10[-2] >= e20[-2] and e10[-1] < e20[-1]: bonus = -5.0
            return clamp(50.0 + 50.0*sign*mag + bonus, 0.0, 100.0)

        ema_score=ema_posture_1h(C)

        # SMI 1h
        smi1h=None
        if len(C) >= 20:
            k1h,d1h=smi_kd(H,L,C, k_len=12, d_len=7, ema_len=5)
            if k1h is not None and d1h is not None:
                smi1h=clamp(50.0 + 0.5*(k1h-d1h), 0.0, 100.0)

        # SMI 4h
        smi4h=None
        if len(spy_4h) >= 10:
            H4=[b["high"] for b in spy_4h]; L4=[b["low"] for b in spy_4h]; C4=[b["close"] for b in spy_4h]
            k4,d4=smi_kd(H4,L4,C4, k_len=12, d_len=7, ema_len=5)
            if k4 is not None and d4 is not None:
                smi4h=clamp(50.0 + 0.5*(k4-d4), 0.0, 100.0)

        wE,w1,w4 = W_EMA_1H, W_SMI1H, min(W_SMI4H,0.25)
        if smi1h is None and smi4h is None:
            momentum_combo_1h = ema_score
        else:
            momentum_combo_1h = (wE*ema_score
                                 + w1*(smi1h if smi1h is not None else ema_score)
                                 + w4*(smi4h if smi4h is not None else ema_score))
    momentum_combo_1h = round(clamp(momentum_combo_1h, 0.0, 100.0), 2)
    if momentum_1h_legacy is None: momentum_1h_legacy = momentum_slow

    # 3d) Squeeze 1h (Expansion %)
    squeeze_1h = 50.0
    if len(spy_1h) >= 6:
        H=[b["high"] for b in spy_1h]; L=[b["low"] for b in spy_1h]; C=[b["close"] for b in spy_1h]
        mean=sum(C)/len(C); sd=(sum((x-mean)**2 for x in C)/len(C))**0.5
        bb_w=(mean+2*sd)-(mean-2*sd)
        prevs=C[:-1] + [C[-1]]
        trs=[max(H[i]-L[i], abs(H[i]-prevs[i]), abs(L[i]-prevs[i])) for i in range(len(C))]
        kc_w = 2.0*(sum(trs)/len(trs)) if trs else 0.0
        ratio = 0.0 if kc_w<=0 else clamp(100.0*(bb_w/kc_w), 0.0, 100.0)
        squeeze_1h = clamp(100.0 - ratio, 0.0, 100.0)  # 0=tight, 100=expanded

    # 3e) Liquidity / Volatility
    liquidity_1h = 50.0; volatility_1h = 0.0
    if len(spy_1h) >= 2:
        V=[b["volume"] for b in spy_1h]
        v3=ema_last(V,3); v12=ema_last(V,12)
        liquidity_1h = 0.0 if not v12 or v12<=0 else clamp(100.0*(v3/v12), 0.0, 200.0)
        H=[b["high"] for b in spy_1h]; L=[b["low"] for b in spy_1h]; C=[b["close"] for b in spy_1h]
        trs=tr_series(H,L,C); atr=ema_last(trs,3) if trs else None
        volatility_1h = 0.0 if not atr or C[-1]<=0 else max(0.0, 100.0*atr/C[-1])

    # 4) Overall 1h
    state, score, comps = compute_overall1h(
        ema_sign=ema_sign,
        ema10_dist_pct=ema10_dist_pct,
        momentum_pct=momentum_combo_1h,
        breadth_pct=breadth_1h,
        squeeze_expansion_pct=squeeze_1h,
        liquidity_pct=liquidity_1h,
        riskon_pct=risk_on_pct,
    )

    # 5) Pack
    metrics = {
        "breadth_1h_pct": breadth_1h,
        "breadth_align_1h_pct": a_fast,
        "breadth_align_1h_pct_fast": a_fast,
        "breadth_bar_1h_pct": b_fast,
        "breadth_bar_1h_pct_fast": b_fast,

        "momentum_1h_pct": momentum_1h_legacy,
        "momentum_combo_1h_pct": momentum_combo_1h,

        "squeeze_1h_pct": squeeze_1h,               # Expansion%
        "liquidity_1h": liquidity_1h,               # PSI (0..200)
        "volatility_1h_pct": round(volatility_1h, 3),
        "volatility_1h_scaled": round(volatility_1h * 6.25, 2),

        "breadth_slow_pct": breadth_slow,
        "momentum_slow_pct": momentum_slow
    }

    hourly = {
        "sectorDirection1h": {"risingPct": rising_pct},
        "riskOn1h": {"riskOnPct": risk_on_pct},
        "overall1h": {"state": state, "score": score, "components": comps}
    }

    out = {
        "version": "r1h-v1",
        "updated_at": datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc": now_utc_iso(),
        "metrics": metrics,
        "hourly": hourly,
        "sectorCards": cards,
        "meta": {"cards_fresh": bool(cards_fresh), "after_hours": False}
    }
    print(f"[1h] A={a_fast} B={b_fast} breadth_1h={breadth_1h} mom_combo_1h={momentum_combo_1h} "
          f"sq_1h={squeeze_1h} liq_1h={liquidity_1h} vol_1h_scaled={out['metrics']['volatility_1h_scaled']}")
    return out

# ------------------------------ CLI -------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", help="optional source json (sectorCards or groups)", default="")
    ap.add_argument("--out", required=True, help="Output file path (e.g., data/outlook_hourly.json)")
    ap.add_argument("--hourly_url", default=HOURLY_URL_DEFAULT)
    args = ap.parse_args()

    src = None
    if args.source and os.path.exists(args.source):
        try:
            with open(args.source, "r", encoding="utf-8") as f:
                src = json.load(f)
        except Exception:
            src = None

    out = build_hourly(source_js=src, hourly_url=args.hourly_url)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",",":"))

    ov = out.get("hourly", {}).get("overall1h", {})
    print("[ok] wrote", args.out, "| overall1h.state=", ov.get("state"), "score=", ov.get("score"))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("[error]", e, file=sys.stderr)
        sys.exit(2)
