#!/usr/bin/env python3
import csv, json, os, urllib.parse, urllib.request, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

KEY=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_KEY") or os.environ.get("POLYGON_API")
BASE="https://api.polygon.io"
CUTOFF=os.environ.get("EOD_RESEARCH_SESSION","2026-10-28")
SECTORS_DIR=os.environ.get("EOD_RESEARCH_SECTORS_DIR","data/sectors")
OUT=os.environ.get("EOD_RESEARCH_OUT","/tmp/eod-shadow-2026-10-28.json")
MAX_WORKERS=int(os.environ.get("EOD_RESEARCH_WORKERS","8"))
UTC=timezone.utc

def fetch_json(url, params, timeout=35):
    p=dict(params); p["apiKey"]=KEY
    full=url+"?"+urllib.parse.urlencode(p)
    req=urllib.request.Request(full,headers={"User-Agent":"engine25-eod-historical-research"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req,timeout=timeout) as r:
                return json.loads(r.read().decode())
        except Exception:
            if attempt==3: raise
            time.sleep(0.35*(1.7**attempt))

def read_symbols(path):
    out=[]
    with open(path,newline="",encoding="utf-8-sig") as f:
        r=csv.DictReader(f)
        for row in r:
            s=(row.get("Symbol") or row.get("symbol") or "").strip().upper()
            if s: out.append(s)
    return out

def discover():
    sectors={}
    for name in os.listdir(SECTORS_DIR):
        if name.lower().endswith(".csv"):
            syms=read_symbols(os.path.join(SECTORS_DIR,name))
            if syms: sectors[os.path.splitext(name)[0]]=syms
    return sectors

def fetch_bars(sym):
    end=datetime.fromisoformat(CUTOFF).date()
    start=end-timedelta(days=90)
    j=fetch_json(f"{BASE}/v2/aggs/ticker/{urllib.parse.quote(sym)}/range/1/day/{start.isoformat()}/{end.isoformat()}",
                 {"adjusted":"true","sort":"asc","limit":5000})
    bars=[]
    for r in j.get("results") or []:
        try:
            d=datetime.fromtimestamp(int(r["t"])/1000,UTC).date().isoformat()
            if d>CUTOFF: continue
            bars.append({"d":d,"h":float(r["h"]),"l":float(r["l"]),"c":float(r["c"])})
        except Exception: pass
    bars.sort(key=lambda x:x["d"])
    return bars

def flags(bars):
    if len(bars)<22: return (0,0,0,0)
    idx=len(bars)-1
    nh=nl=0
    for event_idx in range(idx-1,idx+1):
        if event_idx<10: continue
        prior=bars[event_idx-10:event_idx]
        cur=bars[event_idx]
        if cur["h"]>max(x["h"] for x in prior): nh=1
        if cur["l"]<min(x["l"] for x in prior): nl=1
    move=bars[idx]["c"]-bars[idx-4]["c"]
    sample=bars[idx-19:idx+1]
    adr20=sum(x["h"]-x["l"] for x in sample)/len(sample)
    up=int(adr20>0 and move>=3.0*adr20)
    dn=int(adr20>0 and move<=-3.0*adr20)
    return nh,nl,up,dn

def process(sym):
    try:
        b=fetch_bars(sym)
        return sym,*flags(b)
    except Exception:
        return sym,0,0,0,0

def pct(a,b):
    d=a+b
    return 100*a/d if d else 50.0

def main():
    if not KEY: raise SystemExit("Polygon key missing")
    sectors=discover()
    cards=[]
    total_symbols=0
    for sec,syms in sorted(sectors.items()):
        total_symbols+=len(syms)
        nh=nl=up=dn=0
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            futs=[ex.submit(process,s) for s in syms]
            for fut in as_completed(futs):
                _,a,b,c,d=fut.result()
                nh+=a; nl+=b; up+=c; dn+=d
        cards.append({
          "sector":sec,"nh":nh,"nl":nl,"up":up,"down":dn,
          "breadth_pct":round(pct(nh,nl),2),
          "momentum_pct":round(pct(up,dn),2)
        })
        print(f"[{sec}] nh={nh} nl={nl} up={up} down={dn}",flush=True)
    avg_b=sum(c["breadth_pct"] for c in cards)/len(cards) if cards else 50
    avg_m=sum(c["momentum_pct"] for c in cards)/len(cards) if cards else 50
    score=max(10,min(100,(avg_b+avg_m)/2))
    state=("CONSTRUCTIVE" if score>=65 else "CONSTRUCTIVE_MIXED" if score>=55 else "MIXED" if score>=45 else "WEAK" if score>=35 else "BEARISH")
    # Source timestamp is the end of the completed cash session represented by this reconstruction,
    # not the time the reconstruction is run.
    source_ts=f"{CUTOFF}T20:00:00.000Z"
    out={
      "ok":True,
      "engine":"engine25.reconstructedEod.v1",
      "mode":"RETROSPECTIVE_RECONSTRUCTION",
      "updated_at_utc":source_ts,
      "reconstructedAtUtc":datetime.now(UTC).isoformat(),
      "completedSessionDate":CUTOFF,
      "score":round(score,1),
      "state":state,
      "breadthScore":round(avg_b,1),
      "momentumScore":round(avg_m,1),
      "sectorCards":cards,
      "productionAuthority":False,
      "provenance":{
        "kind":"RETROSPECTIVE_RECONSTRUCTION",
        "originallyPublished":False,
        "reconstructed":True,
        "formulaVersion":"engine25.reconstructedEod.v1",
        "completedSessionDate":CUTOFF
      },
      "formula":{
        "breadth":"10-session HIGH/LOW event with 2-session carry",
        "momentum":"4-session close move vs +/-3x ADR20",
        "adr":"20-session average daily HIGH-LOW, current completed day included"
      },
      "stocksInUniverse":total_symbols
    }
    Path(OUT).write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps({k:out[k] for k in ("completedSessionDate","score","state","breadthScore","momentumScore","stocksInUniverse")},indent=2))

if __name__=="__main__": main()
