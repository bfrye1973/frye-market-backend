#!/usr/bin/env python3
import json, zipfile, os
from pathlib import Path

# Research-only Market Health v2 shadow:
# v1 weights preserved except breadthParticipation (25%) is replaced by
# reconstructed EOD structure (breadth + momentum) score.

WEIGHTS={
  "macroAware":0.35,
  "eodStructure":0.25,
  "distributionSupport":0.20,
  "marketTrend":0.10,
  "creditFragility":0.05,
  "aiLeadership":0.05,
}

DATES=["2026-10-27","2026-10-28","2026-10-29","2026-10-30"]

def clamp(x):
    return max(0,min(100,round(float(x))))

def pct(up,down):
    den=up+down
    return 50.0 if den<=0 else 100.0*up/den

def eod_score_from_sector_rows(sector_rows):
    # Equal-average sector breadth and momentum, then average both dimensions.
    b=[]; m=[]
    for row in sector_rows.values():
        b.append(pct(row["nh"],row["nl"]))
        m.append(pct(row["up"],row["down"]))
    breadth=sum(b)/len(b) if b else 50
    momentum=sum(m)/len(m) if m else 50
    return clamp((breadth+momentum)/2), round(breadth,2), round(momentum,2)

def load_research():
    p="/mnt/data/engine25-eod-research-universal.zip"
    if not os.path.exists(p):
        raise SystemExit("missing research artifact")
    with zipfile.ZipFile(p) as z:
        return json.loads(z.read("eod-research.json"))

def main():
    research=load_research()
    sectors=["Tech","Consumer","Healthcare","Financials","Energy","Industrials","Materials"]
    mom_candidate="momfixed_span4_roll1_rawadr_20d_incl_3p0"

    rebuilt={}
    for d in DATES:
        rebuilt[d]={}
        for sec in sectors:
            r=research["results"][sec]
            breadth=r["bestBreadth"][0]["perDate"].get(d)
            if not breadth:
                continue
            mom=next(x for x in r["fixedMomentumAll"] if x["candidate"]==mom_candidate)["perDate"].get(d)
            if not mom: continue
            rebuilt[d][sec]={"nh":breadth["got"][0],"nl":breadth["got"][1],"up":mom["got"][0],"down":mom["got"][1]}

    # Historical production overlay rows are expected from a copied JSON argument
    # supplied by workflow before execution.
    src=json.load(open("/tmp/engine25-composite-overlay-6mo.json",encoding="utf-8"))
    bydate={r.get("date"):r for r in src.get("rows",[])}

    out={"mode":"research-shadow","formulaVersion":"engine25.marketHealth.v2.eodStructureShadow","weights":WEIGHTS,"rows":[]}
    for d in DATES:
        r=bydate.get(d)
        if not r or d not in rebuilt or not rebuilt[d]:
            out["rows"].append({"date":d,"available":False})
            continue
        comp=r.get("components") or {}
        macro=float(comp.get("macroAwareScore",50))
        dist=float(comp.get("distributionPressure",50))
        distSupport=100-dist
        trend=float(comp.get("marketTrend",50))
        credit=float(comp.get("creditFragility",50))
        ai=float(comp.get("aiLeadership",50))
        old=float(r.get("engine25CompositeScore",50))
        eod,eodb,eodm=eod_score_from_sector_rows(rebuilt[d])
        new=clamp(
            macro*WEIGHTS["macroAware"]+
            eod*WEIGHTS["eodStructure"]+
            distSupport*WEIGHTS["distributionSupport"]+
            trend*WEIGHTS["marketTrend"]+
            credit*WEIGHTS["creditFragility"]+
            ai*WEIGHTS["aiLeadership"]
        )
        out["rows"].append({
          "date":d,"available":True,
          "oldScore":old,"v2Score":new,"delta":new-old,
          "eodStructureScore":eod,"eodBreadthScore":eodb,"eodMomentumScore":eodm,
          "esClose":r.get("esClose"),
          "components":{"macroAware":macro,"distributionSupport":distSupport,"marketTrend":trend,"creditFragility":credit,"aiLeadership":ai}
        })
    Path("/tmp/engine25-market-health-v2-shadow.json").write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__": main()
