export function createAggregator(intervalSec, emit) {
  let cur = null;
  return {
    pushTick({ time, price }) {
      const bucket = Math.floor(time / intervalSec) * intervalSec;
      if (!cur || cur.time !== bucket) {
        if (cur) emit({ ...cur });
        cur = { time: bucket, open: price, high: price, low: price, close: price };
      } else {
        cur.high = Math.max(cur.high, price);
        cur.low  = Math.min(cur.low,  price);
        cur.close = price;
      }
    },
    pushBar(bar) {
      const bucket = Math.floor(bar.time / intervalSec) * intervalSec;
      if (!cur || cur.time !== bucket) {
        if (cur) emit({ ...cur });
        cur = { ...bar, time: bucket };
      } else {
        cur = {
          time: bucket,
          open: cur.open,
          high: Math.max(cur.high, bar.high),
          low: Math.min(cur.low, bar.low),
          close: bar.close
        };
      }
    },
    flush() { if (cur) emit({ ...cur }); }
  };
}
