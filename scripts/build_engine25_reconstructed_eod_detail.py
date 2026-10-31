#!/usr/bin/env python3
import csv, json, os, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

UTC=timezone.utc
POLY_KEY=os.environ.get("POLYGON_API_KEY") or os.environ.get("POLY_API_KEY") or os.environ.get("POLY_KEY") or ""
FMP_KEY=os.environ.get("FMP_API_KEY") or ""
BACKEND_BASE=(os.environ.get("BACKEND_BASE") or "https://frye-market-backend-1.onrender.com").rstrip("/")
FMP_BASE="https://financialmodelingprep.com/stable"
POLY_BASE="https://api.polygon.io"

LARGE_MIN=10_000_000_000
MID_MIN=2_000_000_000

def read_json(path):
    return json.load(open(path,"r",encoding="utf-8"))

def fetch_json(url, timeout=40):
    req=urllib.request.Request(url,headers={"User-Agent":"engine25-eod-detail/1.0","Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return json.loads(r.read().decode())

def fetch_polygon_daily(symbol, start_date, end_date):
    q=urllib.parse.urlencode({"adjusted":"true","sort":"asc","limit":5000,"apiKey":POLY_KEY})
    url=f"{POLY_BASE}/v2/aggs/ticker/{urllib.parse.quote(symbol)}/range/1/day/{start_date}/{end_date}?{q}"
    j=fetch_json(url)
    out=[]
    for r in j.get("results") or []:
        try:
            out.append({"time":int(r["t"])//1000,"close":float(r["c"])})
        except Exception:
            pass
    return out

def fetch_es_daily():
    return fetch_json(f"{BACKEND_BASE}/api/v1/futures/ohlc?symbol=ES&timeframe=1d&limit=60")

def ma_read(symbol, bars, cutoff):
    rows=[]
    for b in bars or []:
        try:
            t=int(b.get("time") or b.get("t"))
            if t>10**12: t//=1000
            d=datetime.fromtimestamp(t,UTC).date().isoformat()
            c=float(b.get("close") if b.get("close") is not None else b.get("c"))
            if d<=cutoff:
                rows.append((d,c))
        except Exception:
            continue
    rows.sort()
    if len(rows)<21:
        return {"symbol":symbol,"available":False,"reason":"INSUFFICIENT_COMPLETED_DAILY_BARS","bars":len(rows)}
    closes=[x[1] for x in rows]
    ma10=sum(closes[-10:])/10
    ma10_prev=sum(closes[-11:-1])/10
    ma20=sum(closes[-20:])/20
    ma20_prev=sum(closes[-21:-1])/20
    up10=ma10>ma10_prev
    up20=ma20>ma20_prev
    if up10 and up20:
        state="GREEN"
    elif (not up10) and (not up20):
        state="RED"
    else:
        state="YELLOW"
    return {
      "symbol":symbol,"available":True,"state":state,
      "sessionDate":rows[-1][0],"close":round(rows[-1][1],4),
      "ma10":round(ma10,4),"ma20":round(ma20,4),
      "ma10Prior":round(ma10_prev,4),"ma20Prior":round(ma20_prev,4),
      "ma10Upsloping":up10,"ma20Upsloping":up20
    }

def batch_caps(symbols):
    # Prefer direct FMP when the workflow has a key. Otherwise use the
    # Render backend's cached cap-universe route so the key never leaves Render.
    if not FMP_KEY:
        try:
            j=fetch_json(f"{BACKEND_BASE}/api/v1/engine25/cap-universe",timeout=90)
            buckets=j.get("buckets") or {}
            synthetic={}
            for sym,bucket in buckets.items():
                if bucket=="large":
                    synthetic[sym]=LARGE_MIN
                elif bucket=="mid":
                    synthetic[sym]=MID_MIN
                elif bucket=="small":
                    synthetic[sym]=1
            if synthetic:
                return synthetic, None
            return {}, j.get("error") or "CAP_UNIVERSE_EMPTY"
        except Exception as e:
            return {}, f"CAP_UNIVERSE_ROUTE_FAILED:{e}"
    caps={}
    errors=[]
    for i in range(0,len(symbols),100):
        chunk=symbols[i:i+100]
        q=urllib.parse.urlencode({"symbols":",".join(chunk),"apikey":FMP_KEY})
        url=f"{FMP_BASE}/market-capitalization-batch?{q}"
        try:
            rows=fetch_json(url,timeout=45)
            if isinstance(rows,dict) and rows.get("Error Message"):
                errors.append(str(rows.get("Error Message")))
                continue
            for row in rows if isinstance(rows,list) else []:
                sym=str(row.get("symbol") or "").upper()
                cap=row.get("marketCap")
                try:
                    cap=float(cap)
                except Exception:
                    continue
                if sym and cap>0:
                    caps[sym]=cap
        except Exception as e:
            errors.append(str(e))
        time.sleep(0.03)
    reason=None if caps else ("; ".join(errors[:3]) or "FMP_MARKET_CAP_UNAVAILABLE")
    return caps,reason

def aggregate(rows):
    nh=sum(int(r.get("nh",0) or 0) for r in rows)
    nl=sum(int(r.get("nl",0) or 0) for r in rows)
    up=sum(int(r.get("up",0) or 0) for r in rows)
    down=sum(int(r.get("down",0) or 0) for r in rows)
    prior_nh=sum(int(r.get("prior_nh",0) or 0) for r in rows)
    prior_nl=sum(int(r.get("prior_nl",0) or 0) for r in rows)
    prior_up=sum(int(r.get("prior_up",0) or 0) for r in rows)
    prior_down=sum(int(r.get("prior_down",0) or 0) for r in rows)
    def p(a,b):
        d=a+b
        return round(100*a/d,2) if d else 50.0
    return {
        "members":len(rows),
        "nh":nh,"nl":nl,"up":up,"down":down,
        "breadth_pct":p(nh,nl),"momentum_pct":p(up,down),
        "prior":{"nh":prior_nh,"nl":prior_nl,"up":prior_up,"down":prior_down,
                 "breadth_pct":p(prior_nh,prior_nl),"momentum_pct":p(prior_up,prior_down)}
    }

def cap_groups(symbol_rows,caps):
    groups={"all":[],"large":[],"mid":[],"small":[],"unknown":[]}
    seen=set()
    for row in symbol_rows:
        sym=str(row.get("symbol") or "").upper()
        if not sym or sym in seen: continue
        seen.add(sym)
        groups["all"].append(row)
        cap=caps.get(sym)
        if cap is None:
            groups["unknown"].append(row)
        elif cap>=LARGE_MIN:
            groups["large"].append(row)
        elif cap>=MID_MIN:
            groups["mid"].append(row)
        else:
            groups["small"].append(row)
    out={k:aggregate(v) for k,v in groups.items()}
    out["thresholds"]={"largeMin":LARGE_MIN,"midMin":MID_MIN,"smallMaxExclusive":MID_MIN}
    out["classifiedMembers"]=out["large"]["members"]+out["mid"]["members"]+out["small"]["members"]
    out["classificationCoveragePct"]=round(100*out["classifiedMembers"]/max(1,out["all"]["members"]),2)
    return out

def main():
    import argparse
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",required=True)
    ap.add_argument("--out",required=True)
    args=ap.parse_args()
    src=read_json(args.source)
    cutoff=str(src.get("meta",{}).get("shadowCompletedSessionDate") or "")
    shadow_cards=src.get("shadowSectorCards") or []
    symbol_rows=src.get("shadowSymbolRows") or []
    avg_b=sum(float(c.get("breadth_pct",50)) for c in shadow_cards)/len(shadow_cards) if shadow_cards else 50
    avg_m=sum(float(c.get("momentum_pct",50)) for c in shadow_cards)/len(shadow_cards) if shadow_cards else 50
    score=max(10,min(100,(avg_b+avg_m)/2))
    state=("CONSTRUCTIVE" if score>=65 else "CONSTRUCTIVE_MIXED" if score>=55 else "MIXED" if score>=45 else "WEAK" if score>=35 else "BEARISH")

    start=(datetime.fromisoformat(cutoff).date().replace(day=1)).isoformat() if cutoff else "2026-01-01"
    # 90 calendar days is enough for 20-session MA slopes.
    from datetime import timedelta
    end_date=datetime.fromisoformat(cutoff).date() if cutoff else datetime.now(UTC).date()
    start_date=(end_date-timedelta(days=90)).isoformat()
    end_s=end_date.isoformat()

    index_reads={}
    try:
        index_reads["ES"]=ma_read("ES",fetch_es_daily(),cutoff)
    except Exception as e:
        index_reads["ES"]={"symbol":"ES","available":False,"reason":str(e)}
    for sym in ("QQQ","MDY","IWM"):
        try:
            index_reads[sym]=ma_read(sym,fetch_polygon_daily(sym,start_date,end_s),cutoff)
        except Exception as e:
            index_reads[sym]={"symbol":sym,"available":False,"reason":str(e)}

    symbols=sorted({str(r.get("symbol") or "").upper() for r in symbol_rows if r.get("symbol")})
    caps,cap_reason=batch_caps(symbols)
    cap_summary=cap_groups(symbol_rows,caps)
    cap_summary["marketCapSource"]="FMP_BATCH_MARKET_CAP"
    cap_summary["marketCapAvailable"]=bool(caps)
    cap_summary["marketCapReason"]=cap_reason

    by_sector={}
    for row in symbol_rows:
        sec=str(row.get("sector") or "")
        if sec:
            by_sector.setdefault(sec,[]).append(row)
    sector_prior={}
    for card in shadow_cards:
        sec=str(card.get("sector") or "")
        rows=by_sector.get(sec,[])
        if rows:
            sector_prior[sec]=aggregate(rows).get("prior")
        else:
            sector_prior[sec]=None

    out={
      "ok":True,"engine":"engine25.reconstructedEod.v1","mode":"SHADOW_ONLY",
      "updated_at_utc":datetime.now(UTC).isoformat(),
      "completedSessionDate":cutoff,"score":round(score,1),"state":state,
      "breadthScore":round(avg_b,1),"momentumScore":round(avg_m,1),
      "sectorCards":shadow_cards,
      "sectorPrior": sector_prior,
      "indicesVsMAs":index_reads,
      "capGroups":cap_summary,
      "formula":{
        "breadth":"10-session HIGH/LOW event with 2-session carry",
        "momentum":"4-session close move vs +/-3x ADR20",
        "adr":"20-session average daily HIGH-LOW, current completed day included",
        "indexMA":"10-session and 20-session simple moving-average slope",
        "capBuckets":"Large >= $10B; Mid $2B-$10B; Small < $2B"
      },
      "productionAuthority":False
    }
    Path(args.out).write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps({
      "completedSessionDate":out["completedSessionDate"],"score":out["score"],"state":out["state"],
      "indicesVsMAs":out["indicesVsMAs"],
      "capGroups":{k:out["capGroups"].get(k) for k in ("all","large","mid","small","unknown","classificationCoveragePct","marketCapReason")}
    },indent=2))

if __name__=="__main__":
    main()
