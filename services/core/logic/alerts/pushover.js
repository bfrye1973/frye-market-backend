// src/services/core/logic/alerts/pushover.js
// Pushover helper (safe, never throws to caller)

import https from "https";
import querystring from "querystring";

function envInt(name, fallback) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function pushoverConfig() {
  return {
    enabled: String(process.env.PUSHOVER_ENABLED || "0") === "1",
    token: process.env.PUSHOVER_APP_TOKEN || "",
    user: process.env.PUSHOVER_USER_KEY || "",
    priority: envInt("PUSHOVER_PRIORITY", 0),
    minIntervalSec: envInt("PUSHOVER_MIN_INTERVAL_SEC", 60),
    sound: process.env.PUSHOVER_SOUND || "",
  };
}

/**
 * sendPushover({ title, message, url })
 * - Returns { ok:true } or { ok:false, error }
 * - NEVER throws
 */
export function sendPushover({ title, message, url }) {
  const cfg = pushoverConfig();

  if (!cfg.enabled) return Promise.resolve({ ok: true, skipped: "disabled" });
  if (!cfg.token || !cfg.user) {
    return Promise.resolve({ ok: false, error: "Missing PUSHOVER_APP_TOKEN or PUSHOVER_USER_KEY" });
  }

  const payload = {
    token: cfg.token,
    user: cfg.user,
    title: title || "GO Alert",
    message: message || "",
    priority: String(cfg.priority ?? 0),
  };

  if (cfg.sound) payload.sound = cfg.sound;
  if (url) payload.url = url;

  const body = querystring.stringify(payload);

  const options = {
    hostname: "api.pushover.net",
    path: "/1/messages.json",
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 8000,
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (ok) return resolve({ ok: true, status: res.statusCode });
        return resolve({ ok: false, status: res.statusCode, error: data?.slice(0, 400) || "pushover error" });
      });
    });

    req.on("error", (err) => resolve({ ok: false, error: String(err?.message || err) }));
    req.on("timeout", () => {
      req.destroy(new Error("pushover timeout"));
    });

    req.write(body);
    req.end();
  });
}
