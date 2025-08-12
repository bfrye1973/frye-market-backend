import { CONFIG } from '../config.js';
import { createClient } from 'redis';

const mem = {
  barsDaily: new Map(), // ticker -> [{ t,o,h,l,c }]
  metrics: null,
};

let rclient = null;
if (CONFIG.redisUrl) {
  try {
    rclient = createClient({ url: CONFIG.redisUrl });
    rclient.on('error', (e) => console.error('Redis error', e));
    rclient.connect().catch(()=>{});
  } catch {}
}

export const Store = {
  getDaily(ticker) { return mem.barsDaily.get(ticker) || []; },
  setDaily(ticker, bars) { mem.barsDaily.set(ticker, bars); },
  setTodaySample(ticker, sample) {
    const list = mem.barsDaily.get(ticker) || [];
    let last = list[list.length - 1];
    const day = (t) => Math.floor(t/86400)*86400;
    if (!last || day(last.t) !== day(sample.t)) {
      list.push({ t: sample.t, o: sample.o, h: sample.h, l: sample.l, c: sample.c });
    } else {
      last.h = Math.max(last.h, sample.h);
      last.l = Math.min(last.l, sample.l);
      last.c = sample.c;
    }
    mem.barsDaily.set(ticker, list);
  },

  getMetrics() { return mem.metrics; },
  async setMetrics(obj) {
    mem.metrics = obj;
    if (rclient) { try { await rclient.set('metrics', JSON.stringify(obj)); } catch {} }
  },
};
