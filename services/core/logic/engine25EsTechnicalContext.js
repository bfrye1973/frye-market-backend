// services/core/logic/engine25EsTechnicalContext.js

const DEFAULT_BACKEND_BASE =
  process.env.ENGINE25_BACKEND_BASE ||
  process.env.CORE_BASE ||
  "https://frye-market-backend-1.onrender.com";

const DEFAULT_SYMBOL = "ES";

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pctDiff(value, base) {
  const v = Number(value);
  const b = Number(base);
  if (!Number.isFinite(v) || !Number.isFinite(b) || b === 0) return null;
  return Number((((v - b) / b) * 100).toFixed(3));
}

function ema(values, length) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (nums.length < length) return null;

  const k = 2 / (length + 1);
  let current = nums.slice(0, length).reduce((sum, v) => sum + v, 0) / length;

  for (let i = length; i < nums.length; i += 1) {
    current = nums[i] * k + current * (1 - k);
  }

  return Number(current.toFixed(2));
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 500)}`);
  }

  return json;
}

function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((bar) => ({
      time: bar.time,
      open: toNumber(bar.open),
      high: toNumber(bar.high),
      low: toNumber(bar.low),
      close: toNumber(bar.close),
      volume: toNumber(bar.volume, 0),
    }))
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close)
    );
}

async function fetchFuturesBars({ symbol, timeframe, limit = 160 }) {
  const url =
    `${DEFAULT_BACKEND_BASE}/api/v1/futures/ohlc` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(timeframe)}` +
    `&limit=${encodeURIComponent(String(limit))}`;

  const raw = await fetchJson(url);
  const bars = normalizeBars(raw);

  return {
    ok: bars.length > 0,
    url,
    symbol,
    timeframe,
    count: bars.length,
    bars,
  };
}

function buildTimeframeLayer({ label, bars }) {
  const closes = bars.map((bar) => bar.close);
  const latest = bars[bars.length - 1] || null;

  const ema10 = ema(closes, 10);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);

  const close = latest?.close ?? null;

  const aboveEma10 = close !== null && ema10 !== null ? close > ema10 : null;
  const aboveEma20 = close !== null && ema20 !== null ? close > ema20 : null;
  const aboveEma50 = close !== null && ema50 !== null ? close > ema50 : null;

  const distanceToEma10Pct = pctDiff(close, ema10);
  const distanceToEma20Pct = pctDiff(close, ema20);
  const distanceToEma50Pct = pctDiff(close, ema50);

  let state = "UNKNOWN";

  if (aboveEma10 && aboveEma20 && aboveEma50) {
    state = `${label}_BULLISH_STACK`;
  } else if (aboveEma20 && aboveEma50) {
    state = `${label}_HOLDING_CORE_TREND`;
  } else if (aboveEma50 && !aboveEma20) {
    state = `${label}_PULLBACK_TO_CORE_SUPPORT`;
  } else if (!aboveEma50) {
    state = `${label}_TREND_PRESSURE`;
  }

  return {
    label,
    latest,
    close,
    ema10,
    ema20,
    ema50,
    aboveEma10,
    aboveEma20,
    aboveEma50,
    distanceToEma10Pct,
    distanceToEma20Pct,
    distanceToEma50Pct,
    state,
  };
}

function deriveEsTechnicalState({ tenMinute, oneHour, fourHour, daily }) {
  const notes = [];
  let state = "UNKNOWN";
  let bias = "NEUTRAL";
  let permission = "WAIT";
  let requiredAction = "WAIT_FOR_CONFIRMATION";
  let sizeCap = 0.5;

  const dailyHolding20 =
    daily?.aboveEma20 === true || Number(daily?.distanceToEma20Pct) > -0.35;

  const dailyBelow20 =
    daily?.aboveEma20 === false && Number(daily?.distanceToEma20Pct) < -0.35;

  const fourHourWeak =
    fourHour?.aboveEma50 === false ||
    fourHour?.aboveEma20 === false ||
    fourHour?.aboveEma10 === false;

  const fourHourReclaiming =
    fourHour?.aboveEma10 === true && fourHour?.aboveEma20 === true;

  const oneHourReclaiming =
    oneHour?.aboveEma10 === true && oneHour?.aboveEma20 === true;

  const tenMinuteReclaiming =
    tenMinute?.aboveEma10 === true && tenMinute?.aboveEma20 === true;

  const lowerTimeframesReclaiming = oneHourReclaiming && tenMinuteReclaiming;

  if (dailyHolding20 && fourHourWeak) {
    state = "CONSTRUCTIVE_PULLBACK_WATCH";
    bias = "SELECTIVE_LONG";
    permission = "A_PLUS_LONGS_ONLY";
    requiredAction = "DAILY_20EMA_HOLD_PLUS_10M_1H_RECLAIM";
    sizeCap = 0.5;

    notes.push("Daily structure is still holding near/above EMA20.");
    notes.push("4H has weakened, so do not chase ES longs.");
    notes.push("Wait for 10m and 1H reclaim before ES long execution.");
  }

  if (dailyHolding20 && fourHourReclaiming && lowerTimeframesReclaiming) {
    state = "BULLISH_RECLAIM_CONFIRMING";
    bias = "LONG";
    permission = "LONGS_ALLOWED_CONFIRMED_RECLAIM";
    requiredAction = "CONFIRMED_RECLAIM_OR_CONTINUATION";
    sizeCap = 0.75;

    notes.push("Daily is holding EMA20 and lower timeframes are reclaiming.");
    notes.push("ES long continuation/reclaim setups are allowed if Engine 22 confirms.");
  }

  if (dailyBelow20) {
    state = "DAILY_20EMA_SUPPORT_FAILING";
    bias = "DEFENSIVE";
    permission = "NO_NORMAL_LONGS";
    requiredAction = "WAIT_FOR_SELLER_EXHAUSTION_OR_BREAKDOWN_CONFIRMATION";
    sizeCap = 0.25;

    notes.push("Daily EMA20 support is failing.");
    notes.push("Normal ES longs should be blocked until reclaim or seller exhaustion.");
    notes.push("Shorts require separate Engine 22 / Engine 16 breakdown confirmation.");
  }

  if (
    daily?.aboveEma20 === true &&
    daily?.aboveEma50 === true &&
    fourHour?.aboveEma20 === true &&
    oneHour?.aboveEma20 === true &&
    tenMinute?.aboveEma20 === true
  ) {
    state = "MULTI_TIMEFRAME_BULLISH_ALIGNMENT";
    bias = "LONG";
    permission = "LONGS_ALLOWED";
    requiredAction = "PULLBACK_OR_CONTINUATION_SETUP";
    sizeCap = 1.0;

    notes.push("Daily, 4H, 1H, and 10m are aligned bullish above EMA20.");
  }

  if (state === "UNKNOWN") {
    state = "MIXED_TECHNICAL_CONTEXT";
    bias = "NEUTRAL";
    permission = "WAIT_FOR_CLARITY";
    requiredAction = "WAIT_FOR_RECLAIM_OR_SUPPORT_BREAK";
    sizeCap = 0.5;

    notes.push("ES technical context is mixed. Wait for clearer reclaim or breakdown.");
  }

  return {
    state,
    bias,
    permission,
    requiredAction,
    sizeCap,
    notes,
    rules: {
      dailyHolding20,
      dailyBelow20,
      fourHourWeak,
      fourHourReclaiming,
      oneHourReclaiming,
      tenMinuteReclaiming,
      lowerTimeframesReclaiming,
    },
  };
}

export async function buildEngine25EsTechnicalContext({
  symbol = DEFAULT_SYMBOL,
} = {}) {
  const [tenMinuteRaw, oneHourRaw, fourHourRaw, dailyRaw] = await Promise.all([
    fetchFuturesBars({ symbol, timeframe: "10m", limit: 180 }),
    fetchFuturesBars({ symbol, timeframe: "1h", limit: 180 }),
    fetchFuturesBars({ symbol, timeframe: "4h", limit: 180 }),
    fetchFuturesBars({ symbol, timeframe: "1d", limit: 180 }),
  ]);

  const tenMinute = buildTimeframeLayer({
    label: "TEN_MINUTE",
    bars: tenMinuteRaw.bars,
  });

  const oneHour = buildTimeframeLayer({
    label: "ONE_HOUR",
    bars: oneHourRaw.bars,
  });

  const fourHour = buildTimeframeLayer({
    label: "FOUR_HOUR",
    bars: fourHourRaw.bars,
  });

  const daily = buildTimeframeLayer({
    label: "DAILY",
    bars: dailyRaw.bars,
  });

  const technicalRead = deriveEsTechnicalState({
    tenMinute,
    oneHour,
    fourHour,
    daily,
  });

  return {
    ok:
      tenMinuteRaw.ok &&
      oneHourRaw.ok &&
      fourHourRaw.ok &&
      dailyRaw.ok,
    engine: "engine25.esTechnicalContext.v0.1",
    symbol,
    backendBase: DEFAULT_BACKEND_BASE,
    updatedAt: new Date().toISOString(),
    sources: {
      tenMinute: {
        ok: tenMinuteRaw.ok,
        url: tenMinuteRaw.url,
        count: tenMinuteRaw.count,
      },
      oneHour: {
        ok: oneHourRaw.ok,
        url: oneHourRaw.url,
        count: oneHourRaw.count,
      },
      fourHour: {
        ok: fourHourRaw.ok,
        url: fourHourRaw.url,
        count: fourHourRaw.count,
      },
      daily: {
        ok: dailyRaw.ok,
        url: dailyRaw.url,
        count: dailyRaw.count,
      },
    },
    tenMinute,
    oneHour,
    fourHour,
    daily,
    technicalRead,
  };
}
