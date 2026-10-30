#!/usr/bin/env python3
import csv,json,os,time,urllib.parse,urllib.request
from datetime import datetime,timedelta,timezone
from pathlib import Path

POLY="https://api.polygon.io"
KEY=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API")
UTC=timezone.utc

TARGETS={
 "2026-10-29":{"breadth":[224,157],"momentum":[27,23]},
 "2026-10-28":{"breadth":[215,119],"momentum":[25,19]},
 "2026-10-27":{"breadth":[203,175],"momentum":[25,34]},
 "2026-10-26":{"breadth":[197,269],"momentum":[30,73]},
 "2026-10-23":{"breadth":[239,292],"momentum":[46,108]},
 "2026-10-22":{"breadth":[245,275],"momentum":[46,104]},
 "2026-10-21":{"breadth":[220,247],"momentum":[35,74]},
}

def get_json(url,params):
    p=dict(params); p["apiKey"]=KEY
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

def fetch_history(sym,max_date,days=120):
    end=datetime.strptime(max_date,"%Y-%m-%d").date()
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

def slice_asof(bars,asof):
    return [b for b in bars if b["d"]<=asof]

def flags(bars):
    if len(bars)<31: return {}
    last=bars[-1]
    out={}

    # Breadth: did the stock print a 10-session breakout/breakdown during
    # the most recent N sessions?
    for mode in ("close","hilo"):
        for n_sessions in range(1,6):
            nh=0; nl=0
            start=max(10,len(bars)-n_sessions)
            for idx in range(start,len(bars)):
                prior=bars[idx-10:idx]; cur=bars[idx]
                if len(prior)<10: continue
                if mode=="close":
                    if cur["c"]>max(x["c"] for x in prior): nh=1
                    if cur["c"]<min(x["c"] for x in prior): nl=1
                else:
                    if cur["h"]>max(x["h"] for x in prior): nh=1
                    if cur["l"]<min(x["l"] for x in prior): nl=1
            out[f"breadth_{mode}_rolling{n_sessions}"]=(nh,nl)

    # Spreadsheet columns are 5U / 5D. Test a five-session close move
    # against conventional ADR windows.
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
                adr=sum(ranges)/len(ranges); adrp=sum(pct_ranges)/len(pct_ranges)
                suffix=f"{lookback}d_"+("incl" if include_latest else "prior")
                for mult in (2.5,2.75,3.0,3.25,3.5,3.75,4.0):
                    tag=str(mult).replace(".","p")
                    out[f"mom5_rawadr_{suffix}_{tag}"]=(int(move5>=mult*adr),int(move5<=-mult*adr))
                    out[f"mom5_pctadr_{suffix}_{tag}"]=(int(move5pct>=mult*adrp),int(move5pct<=-mult*adrp))

    # "3ADR up in 10 days vs 3ADR down in 10 days":
    # test whether a qualifying five-session move occurred at any point
    # during the most recent persistence window.
    for persistence in range(2,11):
        for lookback in (5,10,14,20):
            for include_event_day in (False,True):
                for mult in (2.5,2.75,3.0,3.25,3.5,3.75,4.0):
                    up=0; dn=0
                    start_idx=max(5,len(bars)-persistence)
                    for idx in range(start_idx,len(bars)):
                        if idx < 5: continue
                        event_move=bars[idx]["c"]-bars[idx-5]["c"]
                        src_end=idx+1 if include_event_day else idx
                        src=bars[:src_end]
                        sample=src[-lookback:]
                        if not sample: continue
                        ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
                        if not ranges: continue
                        adr=sum(ranges)/len(ranges)
                        if event_move >= mult*adr: up=1
                        if event_move <= -mult*adr: dn=1
                    tag=str(mult).replace(".","p")
                    suffix=f"{lookback}d_"+("incl" if include_event_day else "prior")
                    out[f"mom5roll{persistence}_rawadr_{suffix}_{tag}"]=(up,dn)
    return out

def symbols(path):
    with open(path,newline="",encoding="utf-8-sig") as f:
        return [(r.get("Symbol") or r.get("symbol") or "").strip().upper() for r in csv.DictReader(f) if (r.get("Symbol") or r.get("symbol") or "").strip()]

def score_candidates(totals,kind):
    scored=[]
    for candidate in next(iter(totals.values())).keys():
        if not candidate.startswith(kind): continue
        err=0
        per={}
        for date,target in TARGETS.items():
            got=totals[date].get(candidate,[0,0])
            want=target["breadth" if kind=="breadth_" else "momentum"]
            e=abs(got[0]-want[0])+abs(got[1]-want[1])
            err+=e
            per[date]={"got":got,"target":want,"absError":e}
        scored.append({"candidate":candidate,"totalAbsError":err,"perDate":per})
    return sorted(scored,key=lambda x:(x["totalAbsError"],x["candidate"]))

def main():
    if not KEY: raise SystemExit("POLYGON_API_KEY missing")
    csv_path="data/sectors/tech.csv"
    syms=symbols(csv_path)
    dates=sorted(TARGETS)
    totals={d:{} for d in dates}; valid={d:0 for d in dates}
    max_date=max(dates)
    for i,s in enumerate(syms,1):
        try:
            hist=fetch_history(s,max_date)
            for d in dates:
                b=slice_asof(hist,d); f=flags(b)
                if not f: continue
                valid[d]+=1
                for k,(u,dn) in f.items():
                    totals[d].setdefault(k,[0,0])
                    totals[d][k][0]+=u; totals[d][k][1]+=dn
        except Exception:
            pass
        if i%100==0: print(f"processed {i}/{len(syms)}",flush=True)

    breadth=score_candidates(totals,"breadth_")
    momentum=score_candidates(totals,"mom5_")
    out={
      "universe":"Tech",
      "symbols":len(syms),
      "validByDate":valid,
      "targets":TARGETS,
      "bestBreadth":breadth[:10],
      "bestMomentum":momentum[:10],
    }
    Path("/tmp/eod-research.json").write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__": main()
