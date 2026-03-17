// services/core/jobs/watchScalpGoAndRecord.js
// Scalp-only GO watcher -> calls /api/v1/replay/record-go on rising edge
// Safe: will not crash service if endpoints fail; logs errors only.

function coreBase() {
  const p = Number(process.env.PORT) || 10000;
  return (process.env.CORE_BASE_URL || `http://127.0.0.1:${p}`).replace(/\/+$/, "");
}

function nowIso() {
  return new Date().toISOString();
}

let lastSignal = false;
let lastGoKey = null;

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const text = await r.text().catch(() => "");
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${text.slice(0, 200)}`);
  return j;
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text().catch(() => "");
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { j = null; }
  if (!r.ok) throw new Error(`POST ${url} -> ${r.status} ${text.slice(0, 200)}`);
  return j;
}

async function tick() {
  const base = coreBase();

  // 1) Read current scalp GO
  const status = await getJson(`${base}/api/v1/scalp-status?t=${Date.now()}`);
  const go = status?.go || null;
  if (!go || typeof go.signal !== "boolean") return;

  const signal = go.signal === true;
  const strategyId = "intraday_scalp@10m";
  const symbol = String(status?.symbol || "SPY").toUpperCase();

  // rising edge only
  const rising = !lastSignal && signal;
  lastSignal = signal;

  if (!rising) return;

  // Build a stable goKey (same shape as record-go uses)
  const goAtUtc = go.atUtc || nowIso();
  const dir = (go.direction || "").toUpperCase() || "—";
  const goKey = `${symbol}|${strategyId}|${dir}|${goAtUtc}`;

  // extra guard in-process
  if (lastGoKey && lastGoKey === goKey) return;
  lastGoKey = goKey;

  // 2) Record GO into Replay
  const payload = {
    symbol,
    strategyId,
    direction: go.direction || null,
    triggerType: go.triggerType || null,
    triggerLine: go.triggerLine ?? null,
    price: go.price ?? null,
    atUtc: goAtUtc,
    cooldownUntilMs: go.cooldownUntilMs ?? 0,
    reasonCodes: Array.isArray(go.reasonCodes) ? go.reasonCodes : [],
    reason: go.reason || null,
  };

  const out = await postJson(`${base}/api/v1/replay/record-go`, payload);
  console.log("[watchScalpGo] recorded GO ->", out?.event?.snapshotFile || out);
}

async function main() {
  const intervalMs = Math.max(2000, Number(process.env.REPLAY_GO_WATCH_INTERVAL_MS || 10000));
  console.log(`[watchScalpGo] starting (interval=${intervalMs}ms) base=${coreBase()}`);

  // loop forever
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (e) {
      console.error("[watchScalpGo] tick error:", e?.message || e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch((e) => {
  console.error("[watchScalpGo] fatal:", e?.stack || e);
  process.exit(1);
});
