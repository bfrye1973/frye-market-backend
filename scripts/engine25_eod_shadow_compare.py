#!/usr/bin/env python3
import csv,json,os,urllib.parse,urllib.request
from datetime import datetime,timedelta,timezone
from pathlib import Path

POLY="https://api.polygon.io"
KEY=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API")
LIVE_EOD=os.environ.get("ENGINE25_LIVE_EOD_URL","https://frye-market-backend-1.onrender.com/live/eod")
UTC=timezone.utc

SECTORS={
 "Tech":"data/sectors/tech.csv",
 "Consumer":"data/sectors/Consumer Discretionary.csv",
 "Healthcare":"data/sectors/Healthcare.csv",
 "Financials":"data/sectors/Financials.csv",
 "Energy":"data/sectors/Energy.csv",
 "Industrials":"data/sectors/Industrials.csv",
 "Materials":"data/sectors/Materials.csv",
}

def get_json(url,params=None):
    params=dict(params or {})
    if url.startswith(POLY):
        params["apiKey"]=KEY
    full=url+("?" + urllib.parse.urlencode(params) if params else "")
    req=urllib.request.Request(full,headers={"User-Agent":"engine25-eod-shadow"})
    with urllib.request.urlopen(req,timeout=30) as r:
        return json.loads(r.read().decode())

def symbols(path):
    with open(path,newline="",encoding="utf-8-sig") as f:
        return [(r.get("Symbol") or r.get("symbol") or "").strip().upper()
                for r in csv.DictReader(f)
                if (r.get("Symbol") or r.get("symbol") or "").strip()]

def history(sym,days=90):
    end=datetime.now(UTC).date()
    start=end-timedelta(days=days)
    j=get_json(f"{POLY}/v2/aggs/ticker/{sym}/range/1/day/{start}/{end}",
               {"adjusted":"true","sort":"asc","limit":50000})
    out=[]
    for r in j.get("results") or []:
        try:
            out.append({"o":float(r["o"]),"h":float(r["h"]),"l":float(r["l"]),"c":float(r["c"])})
        except Exception:
            pass
    return out

def shadow_flags(bars):
    if len(bars)<25: return (0,0,0,0)
    # Breadth: 10-day high/low event remains active for two sessions.
    nh=nl=0
    for idx in range(len(bars)-2,len(bars)):
        prior=bars[idx-10:idx]
        cur=bars[idx]
        if len(prior)<10: continue
        if cur["h"]>max(x["h"] for x in prior): nh=1
        if cur["l"]<min(x["l"] for x in prior): nl=1

    # Momentum: best universal compromise from PR #229 research.
    # Four-session close move vs exactly 3x 20-session raw ADR, current day included.
    idx=len(bars)-1
    move=bars[idx]["c"]-bars[idx-4]["c"]
    sample=bars[idx-19:idx+1]
    ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
    adr=sum(ranges)/len(ranges) if ranges else 0.0
    up=int(adr>0 and move>=3.0*adr)
    dn=int(adr>0 and move<=-3.0*adr)
    return nh,nl,up,dn

def main():
    if not KEY: raise SystemExit("POLYGON_API_KEY missing")
    live=get_json(LIVE_EOD)
    live_by={str(c.get("sector","")).lower():c for c in (live.get("sectorCards") or [])}
    out={"generatedAtUtc":datetime.now(UTC).isoformat(),"mode":"research-shadow","productionUrl":LIVE_EOD,
         "formula":{"breadth":"10-day high/low, 2-session persistence","momentum":"4-session close move vs 3x 20-session raw ADR, current day included"},
         "sectors":[]}
    for name,path in SECTORS.items():
        nh=nl=up=dn=0
        for sym in symbols(path):
            try:
                a,b,c,d=shadow_flags(history(sym))
                nh+=a; nl+=b; up+=c; dn+=d
            except Exception:
                pass
        bden=nh+nl; mden=up+dn
        shadow={"nh":nh,"nl":nl,"up":up,"down":dn,
                "breadth_pct":round(100*nh/bden,2) if bden else 50.0,
                "momentum_pct":round(100*up/mden,2) if mden else 50.0}
        # loose sector-name match against production
        prod=None
        for k,v in live_by.items():
            if name.lower() in k or k in name.lower():
                prod=v; break
        out["sectors"].append({"sector":name,"production":prod,"shadow":shadow})
        print(name,shadow,flush=True)
    Path("/tmp/engine25-eod-shadow-compare.json").write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__":
    main()
