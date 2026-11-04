#!/usr/bin/env python3
import json, math, os, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

KEY=os.environ.get("MASSIVE_API_KEY") or os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API")
BASE="https://api.polygon.io"
CONTRACT=os.environ.get("ES_RESEARCH_CONTRACT","ESZ6")
CUTOFF=datetime.fromisoformat(os.environ.get("ES_RESEARCH_CUTOFF","2026-10-29T15:00:00+00:00"))
UTC=timezone.utc

CFG={
 "10m":{"resolution":"10min","days":14,"weight":0.10,"seconds":600},
 "30m":{"resolution":"30min","days":45,"weight":0.15,"seconds":1800},
 "1h":{"resolution":"1hour","days":90,"weight":0.25,"seconds":3600},
 "4h":{"resolution":"4hour","days":240,"weight":0.30,"seconds":14400},
 "1d":{"resolution":"1day","days":1100,"weight":0.20,"seconds":86400},
}
FULL10=FULL30=FULL1H=0.60
SMI_K=12; SMI_D=5; SMI_E=5
RECLAIM10=0.10; RECLAIM50=0.15; GAP_STRONG=0.20

def clamp(x,lo=0,hi=100): return max(lo,min(hi,float(x)))
def avg(xs): return sum(xs)/len(xs) if xs else float("nan")
def ema(vals,n):
    k=2/(n+1); out=[]; e=None
    for v in vals:
        e=float(v) if e is None else e+k*(float(v)-e); out.append(e)
    return out
def posture(dist,full): return clamp(50+50*clamp(dist/max(full,1e-9),-1,1))
def near(p,e,tol): return abs((p-e)/e*100)<=tol if e else False
def get_json(url,params):
    p=dict(params); p["apiKey"]=KEY
    full=url+"?"+urllib.parse.urlencode(p)
    req=urllib.request.Request(full,headers={"User-Agent":"engine25-es-master-research"})
    with urllib.request.urlopen(req,timeout=40) as r: return json.loads(r.read().decode())

def ts_sec(v):
    n=int(v)
    if n>10**17:return n//10**9
    if n>10**14:return n//10**6
    if n>10**12:return n//1000
    return n

def fetch(tf):
    cfg=CFG[tf]
    start=(CUTOFF-timedelta(days=cfg["days"])).date().isoformat()
    end=(CUTOFF+timedelta(days=1)).date().isoformat()
    j=get_json(f"{BASE}/futures/v1/aggs/{CONTRACT}",{
      "resolution":cfg["resolution"],"window_start.gte":start,"window_start.lte":end,
      "sort":"asc","limit":50000
    })
    bars=[]
    for r in j.get("results") or []:
        try:
            t=ts_sec(r["window_start"])
            # Strict no-hindsight rule: only completed bars by cutoff.
            if tf=="1d":
                d=datetime.fromtimestamp(t,UTC).date()
                if d>=CUTOFF.date(): continue
            elif t+cfg["seconds"]>int(CUTOFF.timestamp()):
                continue
            bars.append({"time":t,"open":float(r["open"]),"high":float(r["high"]),"low":float(r["low"]),"close":float(r["close"]),"volume":float(r.get("volume",0) or 0)})
        except Exception: pass
    bars.sort(key=lambda x:x["time"])
    return bars[-260:]

def smi(bars):
    highs=[b["high"] for b in bars]; lows=[b["low"] for b in bars]; closes=[b["close"] for b in bars]
    hh=[];ll=[]
    for i in range(len(closes)):
        st=max(0,i-(SMI_K-1)); hh.append(max(highs[st:i+1])); ll.append(min(lows[st:i+1]))
    rng=[hh[i]-ll[i] for i in range(len(closes))]
    rel=[closes[i]-(hh[i]+ll[i])/2 for i in range(len(closes))]
    num=ema(ema(rel,SMI_D),SMI_D); den=ema(ema(rng,SMI_D),SMI_D)
    arr=[0 if d==0 else 200*n/d for n,d in zip(num,den)]
    sig=ema(arr,SMI_E)
    v=arr[-1]; s=sig[-1]; pct=clamp(50+0.5*v)
    state="BULL" if v>s else "BEAR" if v<s else "NEUTRAL"
    return {"smi":v,"signal":s,"pct":pct,"state":state}

def psi(closes,conv=50,length=20):
    mx=mn=None; dif=[]; eps=1e-12
    for src in closes:
        if mx is None: mx=mn=src
        else:
            mx=max(src,mx-(mx-src)/conv); mn=min(src,mn+(src-mn)/conv)
        dif.append(math.log(max(mx-mn,eps)))
    win=dif[-length:]; xs=list(range(length)); xb=avg(xs); yb=avg(win)
    num=sum((x-xb)*(y-yb) for x,y in zip(xs,win))
    dx=sum((x-xb)**2 for x in xs); dy=sum((y-yb)**2 for y in win)
    r=num/math.sqrt(dx*dy) if dx>0 and dy>0 else 0
    return clamp(-50*r+50)

def base(tf,bars):
    c=[b["close"] for b in bars]; close=c[-1]
    e8=ema(c,8)[-1]; e10=ema(c,10)[-1]; e18=ema(c,18)[-1]; e20=ema(c,20)[-1]; e50=ema(c,50)[-1]
    d10=(close-e10)/e10*100; d20=(close-e20)/e20*100
    gap=abs((e10-e20)/e20*100); g818=(e8-e18)/e18*100
    sm=smi(bars); sq=psi(c); ex=clamp(100-sq)
    tr=[]
    for i in range(1,len(bars)):
        h=bars[i]["high"]; l=bars[i]["low"]; pc=bars[i-1]["close"]; tr.append(max(h-l,abs(h-pc),abs(l-pc)))
    atr=ema(tr,14)[-1]; atrpct=atr/close*100; vol=clamp(100-clamp(atrpct*6.25))
    vols=[b["volume"] for b in bars]; v3=ema(vols,3)[-1]; v12=ema(vols,12)[-1]
    raw=clamp(100*v3/v12,0,200) if v12>0 else 50; liq=clamp(min(raw,120)/120*100)
    return dict(close=close,e8=e8,e10=e10,e18=e18,e20=e20,e50=e50,d10=d10,d20=d20,gap=gap,g818=g818,
                a10=close>e10,a20=close>e20,a50=close>e50,stack=e10>e20,smi=sm,sq=sq,ex=ex,vol=vol,liq=liq,rawliq=raw)

def finish(score,b):
    score=clamp(score); esign=1 if b["close"]>b["e10"] and b["close"]>b["e20"] else -1 if (not b["a10"] and not b["a20"]) else 0
    state="bull" if score>=70 else "bear" if ((esign<0 and score<50) or score<45) else "neutral"
    return score,state

def compute(tf,bars):
    b=base(tf,bars); reasons=[]
    if tf=="10m":
        ep=posture(b["d10"],FULL10); sp=posture(b["g818"],FULL10)
        mc=clamp(.40*ep+.40*b["smi"]["pct"]+.20*sp); bonus=2 if b["smi"]["state"]=="BULL" else -2 if b["smi"]["state"]=="BEAR" else 0
        score=clamp(.35*ep+.30*mc+.12*b["ex"]+.10*b["liq"]+.08*b["vol"]+bonus)
        if not b["a10"] and not b["a20"]: score=min(score,46 if b["a50"] else 38); reasons.append("BELOW_10_20")
        elif b["a10"] and not b["a20"]: score=min(score,52); reasons.append("BETWEEN_10_20")
        if b["smi"]["state"]=="BEAR" and not b["a10"]: score=min(score,42); reasons.append("SMI_BEAR_BELOW_10")
    elif tf=="30m":
        if (not b["a10"]) and (not b["a20"]) and b["a50"]: ss=42; tier="below_10_20_above_50"
        elif (not b["a10"]) and (not b["a20"]): ss=25; tier="below_both"
        elif b["a10"] and not b["a20"]: ss=30; tier="between_10_20"
        elif b["a10"] and b["a20"] and not b["stack"]: ss=40; tier="above_both_not_stacked"
        elif b["a10"] and b["a20"] and b["stack"] and not b["a50"]: ss=48; tier="above_both_stacked_below50"
        else:
            ss=56 if (b["gap"]<GAP_STRONG or near(b["close"],b["e50"],RECLAIM50)) else 64
            tier="above50_reclaim" if ss==56 else "above50_trend"
        sp=posture(b["g818"],FULL30); mc=clamp(.35*ss+.40*b["smi"]["pct"]+.25*sp); bonus=3 if b["smi"]["state"]=="BULL" else -3 if b["smi"]["state"]=="BEAR" else 0
        score=clamp(.48*ss+.27*mc+.10*b["ex"]+.08*b["liq"]+.07*b["vol"]+bonus)
        ab=0
        if b["close"]>b["e10"]:ab+=2
        if b["e10"]>b["e20"]:ab+=2
        if b["smi"]["state"]=="BULL":ab+=2
        if len(bars)>=2 and b["close"]>bars[-2]["close"]:ab+=1.5
        score=clamp(score+clamp(ab,0,6))
        if not b["a10"] and not b["a20"]: cap=42 if b["a50"] else 35
        elif b["a10"] and not b["a20"]: cap=46
        elif not b["a50"]: cap=44
        else: cap=49 if (near(b["close"],b["e50"],RECLAIM50) or b["gap"]<GAP_STRONG) else 58
        score=min(score,cap); reasons.append(tier)
    elif tf=="1h":
        ep=posture(b["d10"],FULL1H); mc=clamp(.45*ep+.45*b["smi"]["pct"]+.10*50); bonus=3 if b["smi"]["state"]=="BULL" else -3 if b["smi"]["state"]=="BEAR" else 0
        score=clamp(.35*ep+.25*mc+.10*b["ex"]+.10*b["liq"]+.07*b["vol"]+.13*50+bonus)
        if not b["a10"] and not b["a20"] and b["a50"]: score=min(score,48); reasons.append("BELOW_10_20_ABOVE_50")
        elif not b["a10"] and not b["a20"] and not b["a50"]: score=min(score,38); reasons.append("BELOW_10_20_50")
        elif b["a10"] and not b["a20"]: score=min(score,55); reasons.append("BETWEEN_10_20")
        elif b["a10"] and b["a20"] and not b["a50"]: score=min(score,58); reasons.append("ABOVE_10_20_BELOW_50")
        if b["smi"]["state"]=="BEAR" and not b["a10"]: score=min(score,46 if b["a50"] else 35); reasons.append("SMI_BEARISH_CONTROL")
    else:
        ep=posture(b["d10"],.90); mc=clamp(.50*ep+.50*b["smi"]["pct"]); bonus=3 if b["smi"]["state"]=="BULL" else -3 if b["smi"]["state"]=="BEAR" else 0
        score=clamp(.35*ep+.25*mc+.15*b["ex"]+.10*b["liq"]+.10*b["vol"]+bonus)
        if not b["a10"] and not b["a20"] and b["a50"]: score=min(score,58)
        if not b["a10"] and not b["a20"] and not b["a50"]: score=min(score,45)
    score,state=finish(score,b)
    return {"score":round(score,2),"state":state,"reasons":reasons,"lastBarUtc":datetime.fromtimestamp(bars[-1]["time"],UTC).isoformat(),
            "close":round(b["close"],2),"above10":b["a10"],"above20":b["a20"],"above50":b["a50"],"smiState":b["smi"]["state"],"smiPct":round(b["smi"]["pct"],2)}

def main():
    if not KEY: raise SystemExit("Polygon key missing")
    lights={}
    for tf in CFG:
        bars=fetch(tf)
        if len(bars)<60: raise SystemExit(f"insufficient {tf} bars: {len(bars)}")
        lights[tf]=compute(tf,bars)
        lights[tf]["bars"]=len(bars)
    master=sum(lights[tf]["score"]*CFG[tf]["weight"] for tf in CFG)
    state="bull" if master>=70 else "bear" if master<45 else "neutral"
    out={"cutoffUtc":CUTOFF.isoformat(),"cutoffArizona":os.environ.get("ES_RESEARCH_CUTOFF_AZ","2026-10-29T08:00:00-07:00"),"contract":CONTRACT,
         "method":"strict completed-bar no-hindsight reconstruction of production ES Master V2",
         "lights":lights,"master":{"score":round(master,2),"state":state,"weights":{tf:CFG[tf]["weight"] for tf in CFG}}}
    Path(os.environ.get("ES_RESEARCH_OUT","/tmp/es-master-0800.json")).write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__": main()
