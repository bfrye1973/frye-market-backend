// src/services/core/logic/fibEngine.js
// Engine 2 — Fib Engine (manual anchors, geometric confluence only)
// LOCKED:
// - 1h only in v1 (job enforces)
// - 74% hard invalidation gate
// - 78.6% optional reference only
// - W2/W4 tagging is manual-only (context field), no guessing
// - ATR computed internally (optional, graceful fallback)

export function computeFibFromAnchors({
  symbol,
  tf,
  anchorLow,
  anchorHigh,
  context = null,
  bars = [],
  nowUtcISO = new Date().toISOString(),
  atrPeriod = 14,
  near50AtrFrac = 0.25,
  near50FixedMin = 0.25, // SPY-friendly default; if ATR missing, we still have a sane threshold
  minSpanAtr = 0, // v1: do NOT reject small spans (minute waves). Keep 0. If you later want it: set 3–5.
  invalidationGate = 0.74,
  invalidationRef = 0.786
}) {
  // Basic validation
  const low = Number(anchorLow);
  const high = Number(anchorHigh);

  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    return fail("BAD_ANCHORS", "Anchor prices must be numeric.", { symbol, tf, low, high });
  }
  if (high <= low) {
    return fail("BAD_ANCHORS", "Anchor high must be > anchor low.", { symbol, tf, low, high });
  }

  // Direction inference is neutral math — anchors define impulse
  // For v1 we store low/high explicitly; treat as bullish impulse low→high.
  const direction = "up";

  // Latest price from bars if available (close of last bar); else null
  const last = bars.length ? bars[bars.length - 1] : null;
  const price = last ? Number(last.c) : null;

  // Compute ATR (optional)
  const atr = computeATR(bars, atrPeriod);
  const atrOk = Number.isFinite(atr) && atr > 0;

  // Optional span vs ATR check (disabled by default)
  const span = high - low;
  const spanAtr = atrOk ? span / atr : null;
  if (minSpanAtr > 0 && atrOk && spanAtr < minSpanAtr) {
    return fail(
      "BAD_ANCHORS",
      `Anchor span too small vs ATR (spanAtr=${spanAtr.toFixed(2)} < ${minSpanAtr}).`,
      { symbol, tf, low, high, atr, span, spanAtr }
    );
  }

  // Fib levels (retracements measured from HIGH down)
  const r382 = round2(high - 0.382 * span);
  const r500 = round2(high - 0.5 * span);
  const r618 = round2(high - 0.618 * span);

  // Invalidation levels
  const invGate = round2(high - invalidationGate * span); // HARD FAIL
  const invRef = round2(high - invalidationRef * span);   // reference only

  // Retrace zone bounds (order-safe)
  const retraceLo = Math.min(r618, r382);
  const retraceHi = Math.max(r618, r382);

  // Signals
  const signals = {
    inRetraceZone: false,
    near50: false,
    invalidated: false,
    tag: context ?? null
  };

  // If we have a price, compute states
  if (Number.isFinite(price)) {
    // Hard invalidation (bullish: price below invGate)
    if (price < invGate) {
      return {
        ok: true,
        meta: {
          schema: "fib-levels@1",
          symbol,
          tf,
          generated_at_utc: nowUtcISO
        },
        anchors: { low, high, direction, context: context ?? null },
        fib: {
          r382,
          r500,
          r618,
          invalidation: invGate,
          reference_786: invRef
        },
        signals: {
          inRetraceZone: false,
          near50: false,
          invalidated: true,
          tag: context ?? null
        },
        diagnostics: {
          price,
          atr: atrOk ? round4(atr) : null,
          atrPeriod,
          near50Threshold: atrOk ? round4(Math.max(near50AtrFrac * atr, near50FixedMin)) : near50FixedMin,
          span: round4(span),
          spanAtr: atrOk ? round4(spanAtr) : null,
          note: "INVALIDATED: price breached 74% retrace gate."
        }
      };
    }

    // Retrace zone membership (38.2 → 61.8)
    signals.inRetraceZone = price >= retraceLo && price <= retraceHi;

    // Near 50% (center of gravity)
    const threshold = atrOk ? Math.max(near50AtrFrac * atr, near50FixedMin) : near50FixedMin;
    signals.near50 = Math.abs(price - r500) <= threshold;
  }

  // Normal valid output
  return {
    ok: true,
    meta: {
      schema: "fib-levels@1",
      symbol,
      tf,
      generated_at_utc: nowUtcISO
    },
    anchors: { low, high, direction, context: context ?? null },
    fib: {
      r382,
      r500,
      r618,
      invalidation: invGate,
      reference_786: invRef
    },
    signals,
    diagnostics: {
      price: Number.isFinite(price) ? round2(price) : null,
      atr: atrOk ? round4(atr) : null,
      atrPeriod,
      near50Threshold: atrOk ? round4(Math.max(near50AtrFrac * atr, near50FixedMin)) : near50FixedMin,
      span: round4(span),
      spanAtr: atrOk ? round4(spanAtr) : null,
      note: atrOk ? null : "NOT_ENOUGH_BARS: ATR not computable; near50 uses fixed fallback."
    }
  };
}

// ---------- Helpers ----------

function fail(code, message, extra = {}) {
  return {
    ok: false,
    reason: code,
    message,
    ...extra
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
function round4(x) {
  return Math.round(x * 10000) / 10000;
}

// Accept common bar shapes and normalize to {t,o,h,l,c,v}
export function normalizeBars(rawBars) {
  if (!Array.isArray(rawBars)) return [];
  const out = [];
  for (const b of rawBars) {
    if (!b || typeof b !== "object") continue;
    const t = b.t ?? b.ts ?? b.time ?? b.timestamp ?? b.date;
    const o = b.o ?? b.open;
    const h = b.h ?? b.high;
    const l = b.l ?? b.low;
    const c = b.c ?? b.close;
    const v = b.v ?? b.volume ?? null;

    const oo = Number(o), hh = Number(h), ll = Number(l), cc = Number(c);
    if (![oo, hh, ll, cc].every(Number.isFinite)) continue;

    out.push({
      t: t ?? null,
      o: oo,
      h: hh,
      l: ll,
      c: cc,
      v: v == null ? null : Number(v)
    });
  }
  // ensure chronological
  return out.sort((a, b) => {
    const at = a.t ?? 0;
    const bt = b.t ?? 0;
    return at > bt ? 1 : at < bt ? -1 : 0;
  });
}

// Wilder ATR(14) on OHLC bars (requires >= period+1 bars)
export function computeATR(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < period + 2) return null;

  // True range series
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    const hi = cur.h, lo = cur.l, prevClose = prev.c;
    const range1 = hi - lo;
    const range2 = Math.abs(hi - prevClose);
    const range3 = Math.abs(lo - prevClose);
    tr.push(Math.max(range1, range2, range3));
  }
  if (tr.length < period) return null;

  // Wilder smoothing: first ATR = SMA(TR, period), then ATR = (prevATR*(period-1) + TR)/period
  let atr = 0;
  for (let i = 0; i < period; i++) atr += tr[i];
  atr /= period;

  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}
