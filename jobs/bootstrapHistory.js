import { aggsDaily } from '../polygon/rest.js';
import { Store } from '../data/store.js';
import { CONFIG } from '../config.js';

function ymd(d) { return d.toISOString().slice(0,10); }

export async function bootstrapHistory(allTickers) {
  const to = ymd(new Date());
  const fromDate = new Date(Date.now() - (CONFIG.lookbackDays + 10)*86400*1000);
  const from = ymd(fromDate);

  for (const t of allTickers) {
    try {
      const rows = await aggsDaily(t, from, to);
      const bars = rows.map(x => ({ t: Math.floor(x.t/1000), o:x.o, h:x.h, l:x.l, c:x.c }));
      Store.setDaily(t, bars);
      await new Promise(r => setTimeout(r, 120));
    } catch (e) {
      console.error('bootstrapHistory error', t, e?.message || e);
    }
  }
}
