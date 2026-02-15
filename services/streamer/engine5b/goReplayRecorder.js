// services/streamer/lib/goReplayRecorder.js
const lastByKey = new Map(); // key -> last signal boolean

function nowIso() {
  return new Date().toISOString();
}

export async function recordGoOnRisingEdge({ strategyId, symbol = "SPY", go }) {
  if (!go || typeof go.signal !== "boolean") return;

  const key = `${symbol}|${strategyId}`;
  const prev = lastByKey.get(key) ?? false;
  const curr = go.signal === true;

  // update state immediately
  lastByKey.set(key, curr);

  // only fire on NO -> YES
  if (prev || !curr) return;

  const base = (process.env.BACKEND1_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    console.error("[goReplayRecorder] missing BACKEND1_BASE_URL");
    return;
  }

  const payload = {
    symbol,
    strategyId,
    direction: go.direction || null,
    triggerType: go.triggerType || null,
    triggerLine: go.triggerLine ?? null,
    price: go.price ?? null,
    atUtc: go.atUtc || nowIso(),
    cooldownUntilMs: go.cooldownUntilMs ?? 0,
    reasonCodes: Array.isArray(go.reasonCodes) ? go.reasonCodes : [],
    reason: go.reason || null,
  };

  try {
    const res = await fetch(`${base}/api/v1/replay/record-go`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("[goReplayRecorder] record-go failed", res.status, txt.slice(0, 250));
      return;
    }
    console.log("[goReplayRecorder] GO recorded", strategyId, payload.atUtc);
  } catch (e) {
    console.error("[goReplayRecorder] exception", e?.message || e);
  }
}
