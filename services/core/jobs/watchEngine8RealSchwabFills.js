// services/core/jobs/watchEngine8RealSchwabFills.js
// Long-running Engine 8 REAL Schwab fill watcher.
//
// Active CME-style session cadence defaults to 30 seconds.
// Quiet/maintenance cadence defaults to 60 seconds.
// Broker access remains GET-only; Engine 10 delivery is a Journal write only.

import {
  observeSchwabRealFills,
} from "../logic/trading/schwab/engine8RealFillObserver.js";

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(
    String(value ?? ""),
    10
  );

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function newYorkClock(date = new Date()) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "America/New_York",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }
    ).formatToParts(date);

  const get = (type) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value;

  return {
    weekday:
      get("weekday"),

    hour:
      Number(get("hour")),

    minute:
      Number(get("minute")),
  };
}

function cmeSessionActive(
  date = new Date()
) {
  const {
    weekday,
    hour,
  } = newYorkClock(date);

  if (weekday === "Sat") {
    return false;
  }

  if (weekday === "Sun") {
    return hour >= 18;
  }

  if (weekday === "Fri") {
    return hour < 17;
  }

  // Monday-Thursday:
  // treat the daily 17:00-18:00 ET
  // maintenance hour as quiet.
  if (
    [
      "Mon",
      "Tue",
      "Wed",
      "Thu",
    ].includes(weekday)
  ) {
    return hour !== 17;
  }

  return false;
}

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

const activeSeconds =
  positiveInt(
    process.env
      .ENGINE8_REAL_FILL_ACTIVE_POLL_SECONDS,
    30
  );

const quietSeconds =
  positiveInt(
    process.env
      .ENGINE8_REAL_FILL_QUIET_POLL_SECONDS,
    60
  );

console.log(
  JSON.stringify(
    {
      engine:
        "engine8.schwabRealFillWatcher.v1",

      activePollSeconds:
        activeSeconds,

      quietPollSeconds:
        quietSeconds,

      deliveryEnabled:
        process.env
          .ENGINE8_REAL_FILL_DELIVERY_ENABLED ===
        "1",

      startedAt:
        new Date().toISOString(),
    },
    null,
    2
  )
);

while (true) {
  const startedAt =
    new Date();

  try {
    const out =
      await observeSchwabRealFills({
        now: startedAt,
      });

    console.log(
      JSON.stringify({
        ts:
          new Date().toISOString(),

        status:
          out.status,

        ok:
          out.ok,

        accountsRead:
          out.accountsRead,

        transactionsRead:
          out.transactionsRead,

        futuresFillsNormalized:
          out.futuresFillsNormalized,

        delivered:
          out.delivered,

        alreadyDelivered:
          out.alreadyDelivered,

        pending:
          out.pending,

        errors:
          out.errors,
      })
    );
  } catch (error) {
    console.error(
      "[engine8 real fill watcher] iteration failed:",
      error?.stack ||
        error
    );
  }

  const delaySeconds =
    cmeSessionActive()
      ? activeSeconds
      : quietSeconds;

  await sleep(
    delaySeconds * 1000
  );
}
