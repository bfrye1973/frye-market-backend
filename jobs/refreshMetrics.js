import { Store } from '../data/store.js';
import { adrPercent } from '../calc/adr.js';
import { isNewHigh, isNewLow } from '../calc/highsLows.js';
import { CONFIG } from '../config.js';

export function computeMetrics(sectors, broadcast) {
  const out = { timestamp: new Date().toISOString(), timeframeSec: CONFIG.timeframeSec, sectors: [] };

  for (const [sectorName, tickers] of Object.entries(sectors)) {
    let nh = 0, nl = 0, adrVals = [], adrUp = 0, adrDown = 0;

    for (const t of tickers) {
      const daily = Store.getDaily(t); // [{t,o,h,l,c}]
      const adr = adrPercent(daily, CONFIG.lookbackDays);
      if (adr != null) adrVals.push(adr);

      if (isNewHigh(daily, CONFIG.lookbackDays)) nh++;
      if (isNewLow(daily, CONFIG.lookbackDays)) nl++;

      if (daily.length >= CONFIG.lookbackDays + 2) {
        const prevRange = daily.slice(-CONFIG.lookbackDays-1, -1).map(b => (b.h - b.l));
        const prevMean = prevRange.reduce((a,b)=>a+b,0) / prevRange.length;
        const prevAdrPct = 100 * prevMean / daily[daily.length-2].c;
        if (adr != null) { if (adr > prevAdrPct) adrUp++; else adrDown++; }
      }
    }

    out.sectors.push({
      sector: sectorName,
      newHighs: nh,
      newLows: nl,
      adrAvg: adrVals.length ? Number((adrVals.reduce((a,b)=>a+b,0)/adrVals.length).toFixed(2)) : null,
      adrUpCount: adrUp,
      adrDownCount: adrDown
    });
  }

  Store.setMetrics(out);
  broadcast?.(out);
  return out;
}
