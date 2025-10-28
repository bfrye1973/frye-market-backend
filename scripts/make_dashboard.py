#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ferrari Dashboard — make_dashboard.py (Intraday 10m • Engine Lights + Market Meter aligned)

✅ Keeps all Fast-Pill and Engine-Light logic
✅ Restores Market-Meter JSON structure (so 10m lights show properly)
"""

from __future__ import annotations
import argparse, json, math, os, sys, time, urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

VERSION_TAG = "r12.7-fast-pills-mmfix"
PHX_TZ = "America/Phoenix"

POLY_10M_URL = (
    "https://api.polygon.io/v2/aggs/ticker/{sym}/range/10/minute/{start}/{end}"
    "?adjusted=true&sort=asc&limit=50000&apiKey={key}"
)

EMA_FAST_SHORT = 8
EMA_FAST_LONG  = 18
ACCEL_10M_ON  = 2.5
EARLY_GAP_PCT = 0.05
EARLY_VOL_MIN = 0.8
SQUEEZE_TIGHT = 80.0
SQUEEZE_EXP   = 60.0

OFFENSIVE = {"information technology","consumer discretionary","communication services","industrials"}
DEFENSIVE = {"consumer staples","utilities","health care","real estate"}

# ----------------------- utils -----------------------
def now_utc_iso(): return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def clamp(x, lo, hi): return max(lo, min(hi, x))
def pct(a,b): return 0.0 if b<=0 else 100.0*a/b

def fetch_json(url:str,timeout:int=30)->dict:
    req=urllib.request.Request(url,headers={"User-Agent":"make-dashboard/10m/1.0","Cache-Control":"no-store"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def fetch_polygon_10m(key:str,sym:str,lookback_days:int=5)->List[dict]:
    end=datetime.utcnow().date(); start=end-timedelta(days=lookback_days)
    url=POLY_10M_URL.format(sym=sym,start=start,end=end,key=key)
    try: js=fetch_json(url)
    except: return []
    rows=js.get("results") or []
    out=[]
    for r in rows:
        try:
            t=int(r["t"])//1000
            out.append({"time":t,"open":float(r["o"]),"high":float(r["h"]),
                        "low":float(r["l"]),"close":float(r["c"]),
                        "volume":float(r.get("v",0.0))})
        except: continue
    if out:
        BUCKET=600; now=int(time.time()); cur=(now//BUCKET)*BUCKET
        if (out[-1]["time"]//BUCKET)*BUCKET==cur: out=out[:-1]
    return out

def ema_series(vals:List[float],span:int)->List[float]:
    k=2.0/(span+1.0); e=None; out=[]
    for v in vals: e=v if e is None else e+k*(v-e); out.append(e)
    return out

def ema_last(vals:List[float],span:int)->Optional[float]:
    k=2.0/(span+1.0); e=None
    for v in vals: e=v if e is None else e+k*(v-e)
    return e

def tr_series(H,L,C): return [max(H[i]-L[i],abs(H[i]-C[i-1]),abs(L[i]-C[i-1])) for i in range(1,len(C))]

def lux_psi_from_closes(C:List[float],conv:int=50,length:int=20)->float:
    n=len(C); 
    if n<max(length+2,5): return 50.0
    maxv=minv=C[0]; max_arr=[0]*n; min_arr=[0]*n
    for i,v in enumerate(C):
        maxv=max(v,maxv-(maxv-v)/conv); minv=min(v,minv+(v-minv)/conv)
        max_arr[i]=maxv; min_arr[i]=minv
    diff=[math.log(max(max_arr[i]-min_arr[i],1e-12)) for i in range(n)]
    w=length; xs=range(n-w,n); ys=diff[-w:]; mx=sum(xs)/w; my=sum(ys)/w
    num=sum((x-mx)*(y-my) for x,y in zip(xs,ys))
    denx=math.sqrt(sum((x-mx)**2 for x in xs)); deny=math.sqrt(sum((y-my)**2 for y in ys))
    corr=(num/(denx*deny)) if (denx>0 and deny>0) else 0
    return -50*corr+50

def resample_10m_to_1h(bars):
    if not bars: return []
    out=[]; bucket=3600; cur=None; agg=None
    for b in bars:
        t=int(b["time"]); k=(t//bucket)*bucket
        if cur is None or k!=cur:
            if agg: out.append(agg)
            agg={"time":k,"open":b["open"],"high":b["high"],"low":b["low"],
                 "close":b["close"],"volume":b.get("volume",0.0)}
            cur=k
        else:
            agg["high"]=max(agg["high"],b["high"]); agg["low"]=min(agg["low"],b["low"])
            agg["close"]=b["close"]; agg["volume"]+=b.get("volume",0.0)
    if agg: out.append(agg)
    now=int(time.time()); cur=(now//bucket)*bucket
    if out and out[-1]["time"]==cur: out.pop()
    return out

def smi_kd_series(H,L,C,k_len=12,d_len=7,ema_len=5):
    n=len(C)
    if n<max(k_len,d_len)+6: return [],[]
    HH=[max(H[max(0,i-k_len+1):i+1]) for i in range(n)]
    LL=[min(L[max(0,i-k_len+1):i+1]) for i in range(n)]
    mid=[(HH[i]+LL[i])/2 for i in range(n)]
    rng=[(HH[i]-LL[i]) for i in range(n)]
    m=[C[i]-mid[i] for i in range(n)]
    m1=ema_series(m,k_len); m2=ema_series(m1,ema_len)
    r1=ema_series(rng,k_len); r2=ema_series(r1,ema_len)
    K=[max(-100,min(100,0 if (r2[i] or 0)==0 else 100*m2[i]/((r2[i] or 0)/2))) for i in range(n)]
    D=ema_series(K,d_len)
    return K,D

# ----------------------- builder -----------------------
def build_intraday(source_js=None, prev_out=None):
    cards=(source_js or {}).get("sectorCards") or []
    NH=NL=UP=DN=0.0
    for c in cards:
        NH+=float(c.get("nh",0)); NL+=float(c.get("nl",0))
        UP+=float(c.get("up",0)); DN+=float(c.get("down",0))
    breadth_slow=round(pct(NH,NH+NL),2) if NH+NL>0 else 50.0
    momentum_slow=round(pct(UP,UP+DN),2) if UP+DN>0 else 50.0

    key=os.getenv("POLYGON_API_KEY") or ""
    bars_10m=fetch_polygon_10m(key,"SPY",5) if key else []
    H=[b["high"] for b in bars_10m]; L=[b["low"] for b in bars_10m]
    C=[b["close"] for b in bars_10m]; V=[b["volume"] for b in bars_10m]

    ema8=ema_series(C,EMA_FAST_SHORT); ema18=ema_series(C,EMA_FAST_LONG)
    ema_sign=1 if ema8 and ema18 and ema8[-1]>ema18[-1] else (-1 if ema8 and ema18 and ema8[-1]<ema18[-1] else 0)
    ema_gap_pct=0.0 if not ema18 else (100*(ema8[-1]-ema18[-1])/ema18[-1])

    psi_10m=lux_psi_from_closes(C) if C else 50.0
    psi_prev=lux_psi_from_closes(C[:-1]) if len(C)>1 else psi_10m
    d_psi=round(psi_10m-psi_prev,2)

    K,D=smi_kd_series(H,L,C)
    smi_diff=(K[-1]-D[-1]) if (K and D) else 0.0
    ema_slope_score=clamp(50+50*clamp(ema_gap_pct/0.5,-1,1),0,100)
    momentum_combo_10m=round(clamp(0.7*ema_slope_score+0.3*(50+0.5*smi_diff),0,100),2)
    momentum_10m=momentum_combo_10m

    vol3=ema_last(V,3) or 0; vol12=ema_last(V,12) or 1
    liquidity_psi=clamp(100*(vol3/vol12),0,200)
    trs=tr_series(H,L,C); atr=ema_last(trs,3) if trs else 0
    volatility_pct=max(0,100*atr/C[-1]) if C else 0

    # fast risk-on proxy
    by={(c.get("sector") or "").strip().lower(): c for c in cards}
    off_pos=def_pos=0
    for s in OFFENSIVE:
        bp=by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)) and bp>50: off_pos+=1
    for s in DEFENSIVE:
        bp=by.get(s,{}).get("breadth_pct")
        if isinstance(bp,(int,float)) and bp<50: def_pos+=1
    cons=max(1,off_pos+def_pos)
    risk_on_10m=round(100*off_pos/cons,2)

    # accel
    pm=(prev_out or {}).get("metrics") or {}
    prev_b10=pm.get("breadth_10m_pct",breadth_slow)
    prev_m10=pm.get("momentum_10m_pct",momentum_slow)
    dB=round(breadth_slow-(prev_b10 or 0),2); dM=round(momentum_10m-(prev_m10 or 0),2)
    accel=round(dB+dM,2)

    metrics={
        "breadth_10m_pct":breadth_slow,
        "momentum_10m_pct":momentum_10m,
        "momentum_combo_10m_pct":momentum_combo_10m,
        "squeeze_psi_10m_pct":round(psi_10m,2),
        "squeeze_pct":round(psi_10m,2),
        "squeeze_expansion_pct":round(100-psi_10m,2),
        "liquidity_psi":round(liquidity_psi,2),
        "volatility_pct":round(volatility_pct,3),
        "ema_sign":ema_sign,
        "ema_gap_pct":round(ema_gap_pct,3),
        "breadth_slow_pct":breadth_slow,
        "momentum_slow_pct":momentum_slow
    }

    # sector direction/riskon nesting (Market Meter expects these inside intraday)
    intraday={
        "sectorDirection10m":{"risingPct":breadth_slow},
        "riskOn10m":{"riskOnPct":risk_on_10m},
        "overall10m":{
            "state":"bull" if ema_sign>0 and momentum_combo_10m>=60 else "bear" if ema_sign<0 and momentum_combo_10m<=40 else "neutral",
            "score":int(clamp(momentum_combo_10m if ema_sign>0 else (100-momentum_combo_10m),0,100)),
            "components":{}
        }
    }

    # engine lights section (preserve from your teammate)
    lights={}
    def put(n,a,s,r): lights[n]={"active":bool(a),"severity":s,"reason":r,
                                 "lastChanged":datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")}
    put("sigAccelUp",accel>=2.5,"info",f"ΔB+ΔM={accel:+.2f}")
    put("sigAccelDown",accel<=-2.5,"warn",f"ΔB+ΔM={accel:+.2f}")
    if psi_10m>=SQUEEZE_TIGHT: put("sigCompression",True,"warn",f"PSI={psi_10m:.1f}")
    elif psi_10m<=SQUEEZE_EXP or d_psi<=-3: put("sigExpansion",True,"info",f"PSI={psi_10m:.1f} Δ{d_psi:+.2f}")

    out={
        "version":VERSION_TAG,
        "updated_at":datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at_utc":now_utc_iso(),
        "metrics":metrics,
        "intraday":intraday,
        "engineLights":{
            "updatedAt":datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S"),
            "mode":"intraday",
            "live":True,
            "signals":lights
        },
        "sectorCards":cards
    }
    return out

# ----------------------- CLI -----------------------
def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--mode",default="intraday")
    ap.add_argument("--source",default="",help="optional source json (sectorCards)")
    ap.add_argument("--out",required=True)
    args=ap.parse_args()

    prev=None
    if os.path.exists(args.out):
        try: prev=json.load(open(args.out))
        except: prev=None

    src=None
    if args.source and os.path.exists(args.source):
        try: src=json.load(open(args.source))
        except: src=None

    out=build_intraday(src,prev)
    os.makedirs(os.path.dirname(args.out),exist_ok=True)
    with open(args.out,"w",encoding="utf-8") as f: json.dump(out,f,ensure_ascii=False,separators=(",",":"))
    print("[ok] wrote",args.out,"| version=",out.get("version"))

if __name__=="__main__":
    try: main()
    except Exception as e:
        print("[error]",e,file=sys.stderr); sys.exit(1)
