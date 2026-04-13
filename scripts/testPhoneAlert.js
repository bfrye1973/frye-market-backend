// services/core/scripts/testPhoneAlert.js
//
// Safe manual alert test
// - does NOT touch trading logic
// - does NOT place orders
// - does NOT fake market state
// - sends one clearly labeled TEST notification
//
// Expected env vars for Pushover:
//   PUSHOVER_USER_KEY
//   PUSHOVER_API_TOKEN
//
// If your project uses different env var names already,
// replace them below with the names your backend currently uses.

const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY || "";
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN || "";

// Optional extras
const PUSHOVER_DEVICE = process.env.PUSHOVER_DEVICE || "";
const APP_ENV = process.env.NODE_ENV || "development";

function fail(message) {
  console.error(`[testPhoneAlert] ERROR: ${message}`);
  process.exit(1);
}

function buildMessage() {
  const now = new Date().toISOString();

  return {
    title: "Frye Dashboard Test Alert",
    message:
      `[TEST ONLY] Phone notification path is working.\n` +
      `Environment: ${APP_ENV}\n` +
      `Time: ${now}\n` +
      `No trading action. No live signal. Manual test only.`,
    priority: 0,
    sound: "pushover",
  };
}

async function sendPushoverTest() {
  if (!PUSHOVER_USER_KEY) {
    fail("Missing PUSHOVER_USER_KEY");
  }

  if (!PUSHOVER_API_TOKEN) {
    fail("Missing PUSHOVER_API_TOKEN");
  }

  const body = buildMessage();

  const form = new URLSearchParams();
  form.set("token", PUSHOVER_API_TOKEN);
  form.set("user", PUSHOVER_USER_KEY);
  form.set("title", body.title);
  form.set("message", body.message);
  form.set("priority", String(body.priority));
  form.set("sound", body.sound);

  if (PUSHOVER_DEVICE) {
    form.set("device", PUSHOVER_DEVICE);
  }

  const response = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await response.text();

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    console.error("[testPhoneAlert] Pushover response:", parsed);
    fail(`HTTP ${response.status}`);
  }

  console.log("[testPhoneAlert] Success.");
  console.log(JSON.stringify(parsed, null, 2));
}

(async function main() {
  try {
    console.log("[testPhoneAlert] Sending safe manual test alert...");
    await sendPushoverTest();
    process.exit(0);
  } catch (err) {
    console.error("[testPhoneAlert] Unhandled error:", err);
    process.exit(1);
  }
})();
