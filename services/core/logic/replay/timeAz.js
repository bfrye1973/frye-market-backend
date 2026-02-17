// services/core/logic/replay/timeAz.js
export function nowUtcIso() {
  return new Date().toISOString();
}

/**
 * Returns { dateYmd, timeHHMM } in America/Phoenix using Intl
 */
export function azDateTimeParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(d).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});

  const dateYmd = `${parts.year}-${parts.month}-${parts.day}`;
  const timeHHMM = `${parts.hour}${parts.minute}`;
  return { dateYmd, timeHHMM };
}
