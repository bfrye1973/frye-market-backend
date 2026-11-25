#!/usr/bin/env python3
from scripts.build_outlook_source_from_polygon import fetch_range_daily, date_str, compute_intraday_flags
from datetime import datetime, timedelta

def check(symbol="AAPL"):
    end = datetime.utcnow().date(); start = end - timedelta(days=40)
    bars = fetch_range_daily(symbol, date_str(start), date_str(end))
    highs=[b["h"] for b in bars]; lows=[b["l"] for b in bars]; closes=[b["c"] for b in bars]
    highs_ex = highs[:-1]; lows_ex = lows[:-1]
    H10 = max(highs_ex[-10:]) if len(highs_ex)>=10 else (max(highs_ex) if highs_ex else None)
    L10 = min(lows_ex[-10:])  if len(lows_ex) >=10 else (min(lows_ex)  if lows_ex  else None)
    c1 = closes[-1] if closes else None; c2 = closes[-2] if len(closes)>1 else None
    # parity test using last bar as "today"
    day_high = highs[-1] if highs else None; day_low = lows[-1] if lows else None; last_price = c1
    nh,nl,u3,d3 = compute_intraday_flags(H10,L10,c2,c1,day_high,day_low,last_price)
    print(symbol, {"H10":H10,"L10":L10,"c2":c2,"c1":c1,"10NH":nh,"10NL":nl,"3U":u3,"3D":d3})

if __name__ == "__main__":
    for sym in ["AAPL","MSFT","XOM","JPM","XLU"]:
        check(sym)
