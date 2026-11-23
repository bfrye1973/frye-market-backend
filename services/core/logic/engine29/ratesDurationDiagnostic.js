// Engine 29 source-level rates diagnostics; existing scoring is untouched.
// Avoid conflating intentionally unavailable daily FRED intraday views with stale data.
const MEMBERS = Object.freeze(["US10Y", "US30Y", "TLT"]);
const FRAMES = Object.freeze({ oneWeek:"structural", oneHour:"tactical", thirtyMinute:"fastTactical" });
export function diagnoseEngine29RatesDuration(output) {
  const symbols=output?.symbols || {};
  const group=output?.groups?.ratesDuration || {};
  const timeframes={};
  for(const [name,key] of Object.entries(FRAMES)) {
    const level=group[key] || null;
    const members={};
    for(const symbol of MEMBERS) {
      const entry=symbols[symbol] || null;
      const data=entry?.[key] || null;
      const stale=data?.freshness?.stale===true;
      const available=Boolean(data);
      let reason;
      if (!entry) reason="SYMBOL_MISSING";
      else if (!available && entry?.provider==="FRED" && key!=="structural") reason="FRED_DAILY_NO_VERIFIED_INTRADAY_SOURCE";
      else if (!available) reason="SOURCE_MISSING";
      else if (stale) reason="SOURCE_STALE";
      else if (data?.latest?.close == null) reason="SOURCE_INVALID";
      else reason="AVAILABLE";
      members[symbol]={provider:entry?.provider ?? null,available,reason,
        freshness:data?.freshness ?? null,sourceSymbol:entry?.sourceSymbol ?? null,
        sourceSeriesId:entry?.sourceSeriesId ?? null,
        sourceTimestamp:data?.latest?.time ?? null};
    }
    timeframes[name]={
      groupState:level?.state ?? null,
      dataDegraded:level?.dataDegraded ?? true,
      missingRequiredMembers:level?.missingRequiredMembers || [],
      members,
    };
  }
  return { authority:"DIAGNOSTIC_ONLY",timeframes };
}
