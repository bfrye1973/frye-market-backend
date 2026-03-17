import { polygonLastTrade } from "./polygonClient.js";

const ALLOWED_SYMBOL = "SPY";

function nextTradingDayYmd(fromDate = new Date()) {
  // Use UTC to stay deterministic on backend
  const d = new Date(Date.UTC(
    fromDate.getUTCFullYear(),
    fromDate.getUTCMonth(),
    fromDate.getUTCDate()
  ));

  // move to next day first
  d.setUTCDate(d.getUTCDate() + 1);

  // skip weekend
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function biasToRight(bias) {
  const b = String(bias || "").toLowerCase();
  if (b === "long") return "CALL";
  if (b === "short") return "PUT";
  return null;
}

export async function selectScalpOption({ symbol, bias }) {
  const sym = String(symbol || "").toUpperCase();
  if (sym !== ALLOWED_SYMBOL) {
    return {
      ok: false,
      reason: "SYMBOL_NOT_ALLOWED",
      allowed: [ALLOWED_SYMBOL]
    };
  }

  const right = biasToRight(bias);
  if (!right) {
    return {
      ok: false,
      reason: "INVALID_BIAS",
      need: 'bias must be "long" or "short"'
    };
  }

  const spot = await polygonLastTrade(sym);
  const last = Number(spot?.last);

  if (!Number.isFinite(last) || last <= 0) {
    return {
      ok: false,
      reason: "SPOT_PRICE_UNAVAILABLE",
      spot
    };
  }

  const strike = Math.floor(last) + 1;
  const expiration = nextTradingDayYmd(new Date());

  return {
    ok: true,
    symbol: sym,
    strategyId: "intraday_scalp@10m",
    bias,
    right,
    underlyingLast: last,
    selection: {
      expiration,
      strike,
      right
    },
    rules: {
      expiration: "NEXT_TRADING_DAY",
      strike: "floor(SPY)+1"
    },
    ts: new Date().toISOString()
  };
}
