// services/streamer/engine5b/goReplayRecorder.js
// Sends GO to backend-1 replay recorder ONLY on rising edge (false -> true)

const lastSignalByStrategy = new Map(); // strategyId -> boolean

function nowIso() {
  return new Date().toISOString();
}

export async function recordGoOnRisingEdge({ backend1Base, symbol = "SPY", strategyId, go }) {
  if (!backend1Base) return;
  if (!strategyId) return;
  if (!go || typeof go.signal !== "boolean") return;

  const prev = lastSignalByStrategy.get(strategyId) ?? false;
  const curr = go.signal === true;

  // update stored state now
  lastSignalByStrategy.set(strategyId, curr);

  // only fire on NO -> YES
  if (prev || !curr) return;

  const base = String(backend1Base).replace(/\/+$/, "");
  const url = `${base}/api/v1/replay/record-go`;

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
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("[goReplayRecorder] record-go failed", res.status, text.slice(0, 200));
      return;
    }

    console.log("[goReplayRecorder] GO recorded", strategyId, payload.atUtc);
  } catch (e) {
    console.error("[goReplayRecorder] exception", e?.message || e);
  }
}
