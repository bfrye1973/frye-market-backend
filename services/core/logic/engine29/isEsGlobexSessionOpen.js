// services/core/logic/engine29/isEsGlobexSessionOpen.js
//
// Standard CME Globex weekly session gate for ES.
// CME publishes ES hours as Sunday 6:00 p.m. ET through Friday 5:00 p.m. ET
// with a daily maintenance period from 5:00 p.m. to 6:00 p.m. ET.
//
// This helper handles the recurring weekly session and DST by evaluating in
// America/New_York. Exchange holiday exceptions remain external to this helper.

const ET_TIME_ZONE = "America/New_York";

function easternParts(nowMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));

  const get = (type) => parts.find((p) => p.type === type)?.value ?? null;

  const weekday = get("weekday");
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  return {
    weekday,
    hour,
    minute,
    minutes: hour * 60 + minute,
  };
}

export function isEsGlobexSessionOpen(nowMs = Date.now()) {
  const et = easternParts(nowMs);
  const m = et.minutes;

  let open = false;
  let reason = "WEEKLY_CLOSED";

  if (et.weekday === "Sun") {
    open = m >= 18 * 60;
    reason = open ? "ES_GLOBEX_OPEN" : "SUNDAY_PREOPEN";
  } else if (["Mon", "Tue", "Wed", "Thu"].includes(et.weekday)) {
    if (m >= 17 * 60 && m < 18 * 60) {
      open = false;
      reason = "DAILY_MAINTENANCE";
    } else {
      open = true;
      reason = "ES_GLOBEX_OPEN";
    }
  } else if (et.weekday === "Fri") {
    open = m < 17 * 60;
    reason = open ? "ES_GLOBEX_OPEN" : "WEEKLY_CLOSED";
  } else {
    open = false;
    reason = "WEEKLY_CLOSED";
  }

  return {
    open,
    reason,
    timeZone: ET_TIME_ZONE,
    weekday: et.weekday,
    hour: et.hour,
    minute: et.minute,
  };
}

export default isEsGlobexSessionOpen;
