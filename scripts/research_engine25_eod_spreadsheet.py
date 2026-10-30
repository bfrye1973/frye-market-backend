#!/usr/bin/env python3
import csv,json,os,time,urllib.parse,urllib.request
from datetime import datetime,timedelta,timezone
from pathlib import Path

POLY="https://api.polygon.io"
KEY=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API")
UTC=timezone.utc

DATES=["2026-10-29","2026-10-28","2026-10-27","2026-10-26","2026-10-23","2026-10-22","2026-10-21"]

SECTORS={
 "Tech":{
   "csv":"data/sectors/tech.csv",
   "targets":[[224,157,27,23],[215,119,25,19],[203,175,25,34],[197,269,30,73],[239,292,46,108],[245,275,46,104],[220,247,35,74]]
 },
 "Consumer":{
   "csv":"data/sectors/Consumer Discretionary.csv",
   "targets":[[205,99,14,17],[102,128,8,16],[120,117,9,19],[116,155,13,15],[179,154,24,16],[189,123,28,15],[145,103,28,9]]
 },
 "Healthcare":{
   "csv":"data/sectors/Healthcare.csv",
   "targets":[[379,68,37,11],[285,127,30,9],[211,164,27,7],[155,200,23,7],[215,181,25,10],[262,132,26,10],[239,107,19,10]]
 },
 "Financials":{
   "csv":"data/sectors/Financials.csv",
   "targets":[[333,100,30,21],[194,96,24,22],[277,126,37,25],[314,156,35,27],[386,153,49,17],[389,145,43,14],[286,144,29,17]]
 },
 "Energy":{
   "csv":"data/sectors/Energy.csv",
   "targets":[[96,39,5,7],[87,30,4,4],[90,37,2,4],[107,35,4,5],[101,77,3,4],[61,75,4,4],[84,33,14,4]]
 },
 "Industrials":{
   "csv":"data/sectors/Industrials.csv",
   "targets":[[254,83,29,10],[169,88,16,8],[150,93,26,13],[134,189,27,26],[153,214,31,34],[177,185,32,32],[142,167,21,31]]
 },
 "Materials":{
   "csv":"data/sectors/Materials.csv",
   "targets":[[84,66,2,11],[70,36,3,5],[60,99,4,15],[51,158,5,18],[70,164,6,23],[71,146,5,20],[64,92,3,10]]
 }
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
            if attempt<3: time.sleep(0.35*(1.7**attempt))
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

def flags(bars):
    if len(bars)<31: return {}
    last=bars[-1]
    out={}
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

    # Spreadsheet-documented momentum family:
    # "3ADR up in 10 days vs 3ADR down in 10 days".
    # Test the exact 10-session close-to-close move at a fixed 3.0x raw ADR.
    # Remaining ambiguities: ADR lookback, event-day inclusion, short persistence.
    for persistence in range(1,6):
        for lookback in (10,14,20):
            for include_event_day in (False,True):
                up=0; dn=0
                start_idx=max(10,len(bars)-persistence)
                for idx in range(start_idx,len(bars)):
                    event_move=bars[idx]["c"]-bars[idx-10]["c"]
                    src_end=idx+1 if include_event_day else idx
                    sample=bars[:src_end][-lookback:]
                    ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
                    if not ranges: continue
                    adr=sum(ranges)/len(ranges)
                    if event_move >= 3.0*adr: up=1
                    if event_move <= -3.0*adr: dn=1
                suffix=f"{lookback}d_"+("incl" if include_event_day else "prior")
                out[f"mom10roll{persistence}_rawadr_{suffix}_3p0"]=(up,dn)

    # Alternative reading of the spreadsheet wording: within the trailing
    # 10 trading sessions, did price complete a 3-ADR directional move over
    # any fixed sub-span? Both endpoints must lie inside that 10-session window.
    for move_span in range(1,10):
        for lookback in (10,14,20):
            for include_event_day in (False,True):
                up=0; dn=0
                window_start=max(move_span,len(bars)-10+move_span)
                for idx in range(window_start,len(bars)):
                    event_move=bars[idx]["c"]-bars[idx-move_span]["c"]
                    src_end=idx+1 if include_event_day else idx
                    sample=bars[:src_end][-lookback:]
                    ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
                    if not ranges: continue
                    adr=sum(ranges)/len(ranges)
                    if event_move >= 3.0*adr: up=1
                    if event_move <= -3.0*adr: dn=1
                suffix=f"{lookback}d_"+("incl" if include_event_day else "prior")
                out[f"momwithin10_span{move_span}_rawadr_{suffix}_3p0"]=(up,dn)

    # Test swing-anchored interpretation: within the trailing 10 sessions,
    # count UP only if price is at least 3 ADR above the lowest close seen
    # earlier in that window, and DOWN only if price is at least 3 ADR below
    # the highest close seen earlier in that window. This avoids arbitrary
    # endpoint pairs and better matches "3 ADR up/down in 10 days".
    for lookback in (10,14,20):
        for include_event_day in (False,True):
            up=0; dn=0
            window=bars[-10:]
            for j in range(1,len(window)):
                idx=len(bars)-10+j
                src_end=idx+1 if include_event_day else idx
                sample=bars[:src_end][-lookback:]
                ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
                if not ranges: continue
                adr=sum(ranges)/len(ranges)
                prior_closes=[x["c"] for x in window[:j]]
                cur=window[j]["c"]
                if prior_closes:
                    if cur-min(prior_closes) >= 3.0*adr: up=1
                    if max(prior_closes)-cur >= 3.0*adr: dn=1
            suffix=f"{lookback}d_"+("incl" if include_event_day else "prior")
            out[f"momswing10_rawadr_{suffix}_3p0"]=(up,dn)

    # Focused family: fixed multi-day close move at exactly 3 ADR,
    # with the event remembered for several sessions. This is the strongest
    # remaining hypothesis from the prior reconstruction work.
    for move_span in (3,4,5,6,7):
        for persistence in range(1,11):
            for lookback in (10,14,20):
                for include_event_day in (False,True):
                    up=0; dn=0
                    start_idx=max(move_span,len(bars)-persistence)
                    for idx in range(start_idx,len(bars)):
                        event_move=bars[idx]["c"]-bars[idx-move_span]["c"]
                        src_end=idx+1 if include_event_day else idx
                        sample=bars[:src_end][-lookback:]
                        ranges=[x["h"]-x["l"] for x in sample if x["h"]>=x["l"]]
                        if not ranges: continue
                        adr=sum(ranges)/len(ranges)
                        if event_move >= 3.0*adr: up=1
                        if event_move <= -3.0*adr: dn=1
                    suffix=f"{lookback}d_"+("incl" if include_event_day else "prior")
                    out[f"momfixed_span{move_span}_roll{persistence}_rawadr_{suffix}_3p0"]=(up,dn)

    # Preserve the earlier broad 5-session search as a control only.
    for persistence in range(2,11):
        for lookback in (5,10,14,20):
            for include_event_day in (False,True):
                for mult in (2.5,2.75,3.0,3.25,3.5,3.75,4.0):
                    up=0; dn=0
                    start_idx=max(5,len(bars)-persistence)
                    for idx in range(start_idx,len(bars)):
                        event_move=bars[idx]["c"]-bars[idx-5]["c"]
                        src_end=idx+1 if include_event_day else idx
                        sample=bars[:src_end][-lookback:]
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

def rank(totals,targets,prefixes,target_idx):
    keys=set()
    for d in DATES: keys.update(totals[d].keys())
    scored=[]
    for candidate in keys:
        if not any(candidate.startswith(p) for p in prefixes): continue
        err=0; per={}
        for i,date in enumerate(DATES):
            got=totals[date].get(candidate,[0,0])
            want=targets[i][target_idx:target_idx+2]
            e=abs(got[0]-want[0])+abs(got[1]-want[1])
            err+=e
            per[date]={"got":got,"target":want,"absError":e}
        scored.append({"candidate":candidate,"totalAbsError":err,"perDate":per})
    return sorted(scored,key=lambda x:(x["totalAbsError"],x["candidate"]))

def run_sector(name,cfg):
    syms=symbols(cfg["csv"])
    max_date=max(DATES)
    totals={d:{} for d in DATES}; valid={d:0 for d in DATES}
    for i,s in enumerate(syms,1):
        try:
            hist=fetch_history(s,max_date)
            for d in DATES:
                b=[x for x in hist if x["d"]<=d]
                f=flags(b)
                if not f: continue
                valid[d]+=1
                for k,(u,dn) in f.items():
                    totals[d].setdefault(k,[0,0])
                    totals[d][k][0]+=u; totals[d][k][1]+=dn
        except Exception:
            pass
        if i%100==0: print(f"{name}: processed {i}/{len(syms)}",flush=True)
    breadth=rank(totals,cfg["targets"],["breadth_"],0)
    momentum10=rank(totals,cfg["targets"],["mom10roll"],2)
    momentum_within10=rank(totals,cfg["targets"],["momwithin10_"],2)
    momentum_swing10=rank(totals,cfg["targets"],["momswing10_"],2)
    momentum_fixed=rank(totals,cfg["targets"],["momfixed_"],2)
    momentum5_control=rank(totals,cfg["targets"],["mom5roll"],2)
    return {
      "symbols":len(syms),
      "validByDate":valid,
      "bestBreadth":breadth[:3],
      "bestMomentum10Day3ADR":momentum10[:5],
      "bestMomentumWithin10DayWindow3ADR":momentum_within10[:5],
      "bestMomentumSwing10Day3ADR":momentum_swing10[:5],
      "bestMomentumFixedSpan3ADR":momentum_fixed[:10],
      "bestMomentum5DayControl":momentum5_control[:3]
    }

def main():
    if not KEY: raise SystemExit("POLYGON_API_KEY missing")
    out={"dates":DATES,"results":{}}
    for name,cfg in SECTORS.items():
        print(f"=== {name} ===",flush=True)
        out["results"][name]=run_sector(name,cfg)
    Path("/tmp/eod-research.json").write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__": main()
