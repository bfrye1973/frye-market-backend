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
    if len(bars)<21: return None
    last=bars[-1]
    prior10=bars[-11:-1]
    c10=[b["c"] for b in prior10]
    h10=[b["h"] for b in prior10]
    l10=[b["l"] for b in prior10]
    adr20=adr_raw(bars,20,True)
    if not adr20 or adr20<=0: return None
    close10_nh=int(last["c"]>max(c10)); close10_nl=int(last["c"]<min(c10))
    highlow10_nh=int(last["h"]>max(h10)); highlow10_nl=int(last["l"]<min(l10))
    start10=bars[-11]["c"]
    net10=last["c"]-start10
    excursion_up=last["c"]-min(c10)
    excursion_dn=max(c10)-last["c"]
    hi_exc=last["h"]-min(b["l"] for b in prior10)
    lo_exc=max(b["h"] for b in prior10)-last["l"]
    # Did this stock print a rolling 10-day breakout/breakdown at any point
    # during the most recent 10 completed sessions?
    rolling_close_nh = 0
    rolling_close_nl = 0
    rolling_hilo_nh = 0
    rolling_hilo_nl = 0
    if len(bars) >= 21:
        start = max(10, len(bars) - 10)
        for idx in range(start, len(bars)):
            prior = bars[idx-10:idx]
            cur = bars[idx]
            if len(prior) < 10:
                continue
            if cur["c"] > max(x["c"] for x in prior):
                rolling_close_nh = 1
            if cur["c"] < min(x["c"] for x in prior):
                rolling_close_nl = 1
            if cur["h"] > max(x["h"] for x in prior):
                rolling_hilo_nh = 1
            if cur["l"] < min(x["l"] for x in prior):
                rolling_hilo_nl = 1

    out = {
      "close10":(close10_nh,close10_nl),
      "highlow10":(highlow10_nh,highlow10_nl),
      "rolling10_close_break":(rolling_close_nh,rolling_close_nl),
      "rolling10_hilo_break":(rolling_hilo_nh,rolling_hilo_nl),
    }
    for mult in (2.5,3.0,3.5,4.0,4.5,5.0,5.5,6.0):
        tag=str(mult).replace(".","p")
        out[f"net10_{tag}adr"]=(int(net10>=mult*adr20),int(net10<=-mult*adr20))
        out[f"latest_vs_extreme_{tag}adr"]=(int(excursion_up>=mult*adr20),int(excursion_dn>=mult*adr20))
        out[f"range_excursion_{tag}adr"]=(int(hi_exc>=mult*adr20),int(lo_exc>=mult*adr20))
        out[f"net5_{tag}adr"]=(
          int(len(bars)>=6 and last["c"]-bars[-6]["c"]>=mult*adr20),
          int(len(bars)>=6 and last["c"]-bars[-6]["c"]<=-mult*adr20)
        )
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
