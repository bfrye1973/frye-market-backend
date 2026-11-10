#!/usr/bin/env python3
import json,sys
from pathlib import Path

# Shadow-only scoring layer for reconstructed EOD sector cards.
# Keeps reconstructed counts frozen and converts them into one 10-100 EOD score.

def clamp(x,lo=10.0,hi=100.0):
    return max(lo,min(hi,float(x)))

def avg(xs):
    xs=[float(x) for x in xs if x is not None]
    return sum(xs)/len(xs) if xs else 50.0

def sector_score(card):
    b=float(card.get("breadth_pct",50))
    m=float(card.get("momentum_pct",50))
    # Preserve simple spreadsheet semantics: breadth + momentum equally important.
    return clamp((b+m)/2.0)

def classify(score):
    if score>=80: return "FULL_SIZE_LONG"
    if score>=65: return "NORMAL_LONG"
    if score>=50: return "SMALL_LONG_NO_SIZE_UP"
    if score>=35: return "AVOID_NEW_LONGS"
    return "DEFENSIVE_BEARISH"

def main():
    if len(sys.argv)<3:
        raise SystemExit("usage: score_engine25_eod_shadow.py <shadow-json> <out-json>")
    src=json.load(open(sys.argv[1],encoding="utf-8"))
    rows=[]
    for item in src.get("sectors",[]):
        sh=item.get("shadow") or {}
        s=sector_score(sh)
        rows.append({"sector":item.get("sector"),"score":round(s,1),"breadth_pct":sh.get("breadth_pct"),"momentum_pct":sh.get("momentum_pct")})

    # Average all reconstructed sectors. This is intentionally transparent and slow-moving.
    eod=clamp(avg([r["score"] for r in rows]))
    out={
        "mode":"research-shadow",
        "formulaVersion":"engine25.eod.reconstructed.score.v1",
        "eodScore":round(eod,1),
        "permission":classify(eod),
        "sectorScores":rows,
        "combineRule":{"fourHourWeight":0.60,"eodWeight":0.40,"combined":"0.60*fourHourScore + 0.40*eodScore"},
        "thresholds":{"80":"FULL_SIZE_LONG","65":"NORMAL_LONG","50":"SMALL_LONG_NO_SIZE_UP","35":"AVOID_NEW_LONGS","10":"DEFENSIVE_BEARISH"}
    }
    Path(sys.argv[2]).write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps(out,indent=2))

if __name__=="__main__":
    main()
