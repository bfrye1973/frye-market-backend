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
export const ENGINE28A_OBSERVER_MAX_TIMEOUT_MS = 5000;
export const ENGINE28A_OBSERVER_DEFAULT_MAX_IN_FLIGHT = 8;
export const ENGINE28A_OBSERVER_MAX_IN_FLIGHT_CAP = 32;

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
//
// Limits (documented, not hidden): Promise.race stops WAITING at the timeout;
// it cannot interrupt synchronous work or cancel I/O already in flight. The
// executor calls process.exit() right after, which ends any pending I/O.
export async function runBounded(task, { timeoutMs, label = "observer", context = null, log, now = () => new Date().toISOString() } = {}) {
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
    safeLog(log, { event: GAP_EVENT, label, context, reason: result.reason, timeoutMs: limit, at: now(), verification: "UNKNOWN" });
  } else if (result.value && typeof result.value === "object" && result.value.status === "UNKNOWN") {
    // The observer finished but itself reported UNKNOWN (e.g. storage error it caught).
    safeLog(log, { event: GAP_EVENT, label, context, reason: "OBSERVER_REPORTED_UNKNOWN", at: now(), verification: "UNKNOWN" });
  }
  return result;
}

// Fire-and-forget with a hard cap on pending observer writes.
export function resolveMaxInFlight(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return ENGINE28A_OBSERVER_DEFAULT_MAX_IN_FLIGHT;
  return Math.min(ENGINE28A_OBSERVER_MAX_IN_FLIGHT_CAP, n);
}

export function createInFlightLimiter({ max, log, now = () => new Date().toISOString() } = {}) {
  const cap = resolveMaxInFlight(max);
  let inFlight = 0;
  let dropped = 0;
  let failed = 0;
  return {
    // `context` (e.g. {runId}) ties every gap to its scheduler run in private logs.
    dispatch(label, task, context = null) {
      if (inFlight >= cap) {
        dropped += 1;
        safeLog(log, { event: GAP_EVENT, label, context, reason: "OBSERVER_BACKPRESSURE_DROPPED", inFlight, cap, at: now(), verification: "UNKNOWN" });
        return false;
      }
      inFlight += 1;
      let p;
      try {
        p = Promise.resolve(task());
      } catch {
        p = Promise.reject(new Error("OBSERVER_FAILED"));
      }
      p.then((value) => {
        // A task that resolves with {status:"UNKNOWN"} caught its own failure: count it.
        if (value && typeof value === "object" && value.status === "UNKNOWN") {
          failed += 1;
          safeLog(log, { event: GAP_EVENT, label, context, reason: "OBSERVER_REPORTED_UNKNOWN", at: now(), verification: "UNKNOWN" });
        }
      }, () => {
        failed += 1;
        safeLog(log, { event: GAP_EVENT, label, context, reason: "OBSERVER_FAILED", at: now(), verification: "UNKNOWN" });
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
