#!/usr/bin/env python3
import argparse,csv,json,math,os,time,urllib.parse,urllib.request
from datetime import datetime,timedelta,timezone
from pathlib import Path

POLY="https://api.polygon.io"
KEY=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API")
UTC=timezone.utc

def get_json(url,params):
    p=dict(params)
    p["apiKey"]=KEY
    full=url+"?"+urllib.parse.urlencode(p)
    last=None
    for attempt in range(4):
        try:
            req=urllib.request.Request(full,headers={"User-Agent":"engine25-eod-research"})
            with urllib.request.urlopen(req,timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last=e
            if attempt<3: time.sleep(0.4*(1.7**attempt))
    raise last

def bars_for(sym,asof,days=75):
    end=datetime.strptime(asof,"%Y-%m-%d").date()
    start=end-timedelta(days=days)
    url=f"{POLY}/v2/aggs/ticker/{sym}/range/1/day/{start}/{end}"
    j=get_json(url,{"adjusted":"true","sort":"asc","limit":50000})
    out=[]
    for r in j.get("results") or []:
        try:
            d=datetime.fromtimestamp(int(r["t"])/1000,UTC).date()
            if d<=end:
                out.append({"d":str(d),"o":float(r["o"]),"h":float(r["h"]),"l":float(r["l"]),"c":float(r["c"])})
        except Exception:
            pass
    return out

def adr_raw(bars,n=20,exclude_latest=False):
    src=bars[:-1] if exclude_latest else bars
    src=src[-n:]
    vals=[b["h"]-b["l"] for b in src if b["h"]>=b["l"]]
    return sum(vals)/len(vals) if vals else None

def flags(bars):
    if len(bars)<31: return None
    last=bars[-1]

    out={}

    # Breadth candidates:
    # "current" means today's bar only.
    # "rollingN" means the stock printed at least one 10-day breakout/breakdown
    # during the most recent N sessions.
    for mode in ("close","hilo"):
        for n_sessions in range(1,11):
            nh=0; nl=0
            start=max(10,len(bars)-n_sessions)
            for idx in range(start,len(bars)):
                prior=bars[idx-10:idx]
                cur=bars[idx]
                if len(prior)<10: continue
                if mode=="close":
                    if cur["c"]>max(x["c"] for x in prior): nh=1
                    if cur["c"]<min(x["c"] for x in prior): nl=1
                else:
                    if cur["h"]>max(x["h"] for x in prior): nh=1
                    if cur["l"]<min(x["l"] for x in prior): nl=1
            out[f"breadth_{mode}_rolling{n_sessions}"]=(nh,nl)

    # ADR momentum candidates. Spreadsheet columns are 5U / 5D, so test
    # a five-session close-to-close move against several conventional ADR
    # windows. ADR is the average daily high-low range.
    if len(bars)>=6:
        move5=last["c"]-bars[-6]["c"]
        move5pct=(last["c"]/bars[-6]["c"]-1.0) if bars[-6]["c"] else 0.0
        for lookback in (5,10,14,20):
            for include_latest in (False,True):
                src=bars if include_latest else bars[:-1]
                sample=src[-lookback:]
                ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
                pct_ranges=[(x["h"]-x["l"])/x["c"] for x in sample if x["c"] and x["h"]>=x["l"]]
                if not ranges or not pct_ranges: continue
                adr=sum(ranges)/len(ranges)
                adrp=sum(pct_ranges)/len(pct_ranges)
                suffix=f"{lookback}d_"+("incl" if include_latest else "prior")
                for mult in (2.5,2.75,3.0,3.25,3.5,3.75,4.0):
                    tag=str(mult).replace(".","p")
                    out[f"mom5_rawadr_{suffix}_{tag}"]=(int(move5>=mult*adr),int(move5<=-mult*adr))
                    out[f"mom5_pctadr_{suffix}_{tag}"]=(int(move5pct>=mult*adrp),int(move5pct<=-mult*adrp))
    return out

def symbols_from_csv(path):
    with open(path,newline="",encoding="utf-8-sig") as f:
        return [((r.get("Symbol") or r.get("symbol") or "").strip().upper()) for r in csv.DictReader(f) if (r.get("Symbol") or r.get("symbol") or "").strip()]

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--asof",default="2026-10-29")
    ap.add_argument("--csv",default="data/sectors/tech.csv")
    ap.add_argument("--out",default="/tmp/eod-research.json")
    args=ap.parse_args()
    if not KEY: raise SystemExit("POLYGON_API_KEY missing")
    syms=symbols_from_csv(args.csv)
    totals={}
    valid=0; errors=[]
    for i,s in enumerate(syms,1):
        try:
            b=bars_for(s,args.asof)
            f=flags(b)
            if not f: continue
            valid+=1
            for k,(u,d) in f.items():
                totals.setdefault(k,[0,0])
                totals[k][0]+=u; totals[k][1]+=d
        except Exception as e:
            errors.append({"symbol":s,"error":str(e)})
        if i%100==0: print(f"processed {i}/{len(syms)} valid={valid}",flush=True)
    out={"asof":args.asof,"csv":args.csv,"symbols":len(syms),"valid":valid,"totals":totals,"targetTech1029":{"breadth":[224,157],"momentum":[27,23]},"errors":errors[:25]}
    Path(args.out).write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__": main()
