// services/core/logic/engine28a/boundedObserverDispatch.js
//
// Engine 28A — bounded observer dispatch for #412 PAPER verification.
//
// Purpose: verification observers must never delay or change trading.
// - runBounded(): awaits an observer task for at most timeoutMs, then gives up.
//   It never throws, never retries and never changes the caller's result.
//   A timeout or failure is reported as an explicit UNKNOWN evidence gap.
// - createInFlightLimiter(): caps fire-and-forget observer writes in a
//   long-lived process, so a hung filesystem cannot pile up pending writes.
//   Writes beyond the cap are dropped and reported, never queued.
//
// This module has no trading, order, Journal or configuration authority.
// It does not read or write receipts itself; callers pass the task.

export const ENGINE28A_OBSERVER_DEFAULT_TIMEOUT_MS = 2000;
export const ENGINE28A_OBSERVER_MIN_TIMEOUT_MS = 100;
export const ENGINE28A_OBSERVER_MAX_TIMEOUT_MS = 10000;
export const ENGINE28A_OBSERVER_DEFAULT_MAX_IN_FLIGHT = 8;

export const GAP_EVENT = "ENGINE28A_OBSERVER_EVIDENCE_GAP";

function safeLog(log, record) {
  try {
    log?.(record);
  } catch {
    /* logging is diagnostic only */
  }
}

export function resolveObserverTimeoutMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return ENGINE28A_OBSERVER_DEFAULT_TIMEOUT_MS;
  return Math.min(
    ENGINE28A_OBSERVER_MAX_TIMEOUT_MS,
    Math.max(ENGINE28A_OBSERVER_MIN_TIMEOUT_MS, Math.floor(n))
  );
}

// Await `task()` for at most `timeoutMs`. Returns one of:
//   {status:"COMPLETED", value}
//   {status:"UNKNOWN", reason:"OBSERVER_TIMEOUT"|"OBSERVER_FAILED"}
export async function runBounded(task, { timeoutMs, label = "observer", log, now = () => new Date().toISOString() } = {}) {
  const limit = resolveObserverTimeoutMs(timeoutMs);
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: "UNKNOWN", reason: "OBSERVER_TIMEOUT" }), limit);
    // Not unref()'d on purpose: the timeout must fire even if nothing else
    // keeps the event loop alive, or an unsettled await could end the process.
  });
  let work;
  try {
    work = Promise.resolve(task()).then(
      (value) => ({ status: "COMPLETED", value }),
      () => ({ status: "UNKNOWN", reason: "OBSERVER_FAILED" })
    );
  } catch {
    work = Promise.resolve({ status: "UNKNOWN", reason: "OBSERVER_FAILED" });
  }
  const result = await Promise.race([work, timeout]);
  clearTimeout(timer);
  if (result.status !== "COMPLETED") {
    safeLog(log, { event: GAP_EVENT, label, reason: result.reason, timeoutMs: limit, at: now(), verification: "UNKNOWN" });
  }
  return result;
}

// Fire-and-forget with a hard cap on pending observer writes.
export function createInFlightLimiter({ max = ENGINE28A_OBSERVER_DEFAULT_MAX_IN_FLIGHT, log, now = () => new Date().toISOString() } = {}) {
  const cap = Number.isInteger(max) && max > 0 ? max : ENGINE28A_OBSERVER_DEFAULT_MAX_IN_FLIGHT;
  let inFlight = 0;
  let dropped = 0;
  let failed = 0;
  return {
    dispatch(label, task) {
      if (inFlight >= cap) {
        dropped += 1;
        safeLog(log, { event: GAP_EVENT, label, reason: "OBSERVER_BACKPRESSURE_DROPPED", inFlight, cap, at: now(), verification: "UNKNOWN" });
        return false;
      }
      inFlight += 1;
      let p;
      try {
        p = Promise.resolve(task());
      } catch {
        p = Promise.reject(new Error("OBSERVER_FAILED"));
      }
      p.catch(() => {
        failed += 1;
        safeLog(log, { event: GAP_EVENT, label, reason: "OBSERVER_FAILED", at: now(), verification: "UNKNOWN" });
      }).finally(() => {
        inFlight -= 1;
      });
      return true;
    },
    stats() {
      return { inFlight, dropped, failed, cap };
    },
  };
}
