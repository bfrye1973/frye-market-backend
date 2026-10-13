import fs from "fs";

const FILE_PATH =
  "/opt/render/project/src/services/core/data/engine22-alert-log.json";

function nowPhoenix() {
  return new Date().toLocaleString("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function readLog() {
  try {
    if (!fs.existsSync(FILE_PATH)) return [];
    const raw = fs.readFileSync(FILE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeLog(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

function buildId(e) {
  return `${e.symbol}:${e.strategyId}:${e.status}:${e.triggeredAt}`;
}

export function logEngine22Alert(event) {
  if (!event || !event.status) return;

  const triggeredAt = event.triggeredAt || nowIso();
 
  const entry = {
    id: buildId({ ...event, triggeredAt }),
    symbol: event.symbol,
    strategyId: event.strategyId,
    tf: event.tf,
    engine: "engine22",
    type: event.type,
    status: event.status,
    direction: event.direction,
    price: event.price,
    confidence: event.confidence,
    targetMove: event.targetMove,
    invalidationLevel: event.invalidationLevel,
    triggeredAt,
    sentToPhone: false,
  };

  const log = readLog();

  if (log.some((x) => x.id === entry.id)) return;

  log.push(entry);
  writeLog(log.slice(-200));
}
