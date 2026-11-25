// services/core/logic/investigator/browserSession.js
//
// Trade Investigator browser session boundary. IN-MEMORY ONLY: nothing is
// written to disk, so the investigator keeps its no-write guarantee. A process
// restart clears every pairing and session; the owner simply pairs again.
//
// The browser NEVER receives TRADE_INVESTIGATOR_ACCESS_KEY:
//   1. Pairing code: issued only to a caller holding the access key (run
//      server-side, e.g. from the Render Shell). One active code, 5 minutes,
//      single use.
//   2. Redeem: the dashboard exchanges the code (from an allowed origin) for a
//      read-only bearer token bound to that origin, valid 4 hours. The token
//      lives in browser memory only.
//   3. The token authorizes GET /api/v1/trade-investigator and nothing else.
// Same design as the reviewed Engine 8D manual-paper pairing, minus the disk.

import crypto from "node:crypto";

const sha = (v) => crypto.createHash("sha256").update(String(v)).digest();

export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
export const MAX_SESSIONS = 20;
export const TOKEN_RE = /^[A-Za-z0-9_-]{40,128}$/;

export function createSessionStore({ now = () => Date.now() } = {}) {
  let pairing = null; // { hash: Buffer, expiresAt }
  const sessions = new Map(); // hex(sha(token)) -> { origin, expiresAt }

  function prune() {
    const t = now();
    for (const [k, s] of sessions) if (s.expiresAt <= t) sessions.delete(k);
    if (pairing && pairing.expiresAt <= t) pairing = null;
  }

  return {
    issuePairing() {
      prune();
      const code = crypto.randomBytes(24).toString("base64url");
      pairing = { hash: sha(code), expiresAt: now() + PAIRING_TTL_MS };
      return { pairingCode: code, expiresInSeconds: PAIRING_TTL_MS / 1000 };
    },
    redeem({ pairingCode, origin }) {
      prune();
      const code = typeof pairingCode === "string" ? pairingCode : "";
      if (code.length < 20 || code.length > 128) return { ok: false, error: "PAIRING_CODE_INVALID" };
      if (!pairing || !crypto.timingSafeEqual(pairing.hash, sha(code))) {
        return { ok: false, error: "PAIRING_CODE_INVALID_OR_EXPIRED" };
      }
      pairing = null; // single use
      if (sessions.size >= MAX_SESSIONS) {
        const oldest = [...sessions.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
        if (oldest) sessions.delete(oldest[0]);
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = now() + SESSION_TTL_MS;
      sessions.set(sha(token).toString("hex"), { origin, expiresAt });
      return { ok: true, accessToken: token, expiresAt: new Date(expiresAt).toISOString(), scope: "TRADE_INVESTIGATOR_READ_ONLY" };
    },
    verify({ token, origin }) {
      prune();
      if (!TOKEN_RE.test(String(token || ""))) return false;
      const s = sessions.get(sha(token).toString("hex"));
      return !!s && s.origin === origin && s.expiresAt > now();
    },
    revoke({ token }) {
      if (!TOKEN_RE.test(String(token || ""))) return false;
      return sessions.delete(sha(token).toString("hex"));
    },
    size() {
      prune();
      return sessions.size;
    },
  };
}
