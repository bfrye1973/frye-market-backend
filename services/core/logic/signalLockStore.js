import fs from "fs";

const LOCK_FILE = "/opt/render/project/src/services/core/data/signal-locks.json";

function loadLocks() {
  try {
    if (!fs.existsSync(LOCK_FILE)) return {};
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveLocks(data) {
  fs.writeFileSync(LOCK_FILE, JSON.stringify(data, null, 2));
}

export function updateSignalLock({ symbol, strategyId, signalEvent }) {
  if (!signalEvent || signalEvent.signalType === "NONE") {
    return getSignalLock(symbol, strategyId);
  }

  const locks = loadLocks();
  const key = `${symbol}:${strategyId}`;

  if (locks[key]) {
    return locks[key];
  }

  const newLock = {
    symbol,
    strategyId,
    signalType: signalEvent.signalType,
    direction: signalEvent.direction,
    signalTime: signalEvent.signalTime,
    signalPrice: signalEvent.signalPrice,
    signalSource: signalEvent.signalSource,
    lockedAt: new Date().toISOString(),
  };

  locks[key] = newLock;
  saveLocks(locks);

  return newLock;
}

export function getSignalLock(symbol, strategyId) {
  const locks = loadLocks();
  return locks[`${symbol}:${strategyId}`] || null;
}
