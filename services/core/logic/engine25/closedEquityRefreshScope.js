// Closed ES must not freeze read-only equity participation context.
// This predicate NEVER authorizes trading or runs ES-specific LIVE jobs.
export function isClosedEquityRefresh({ mode, systemOperatingSession } = {}) {
  return mode === "live" && systemOperatingSession?.operating !== true;
}
