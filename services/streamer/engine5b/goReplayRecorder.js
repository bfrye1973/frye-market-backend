// services/streamer/engine5b/goReplayRecorder.js
// Fire-and-forget: runner.js is responsible for rising-edge detection.

function nowIso() {
  return new Date().toISOString();
}

export async function recordGoOnRisingEdge({ backend1Base, symbol = "SPY", strategyId, go }) {
  if (!backend1Base) return;
  if (!strategyId) return;
  if (!go || go.signal !== true) return; // should only be called on rising edge

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
