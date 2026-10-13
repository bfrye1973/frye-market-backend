// services/core/logic/trading/schwab/engine8AdminAuth.js
// Engine 8 — protects Schwab and future live-trading routes.

import crypto from "crypto";
import { getSchwabConfig } from "./schwabConfig.js";

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function requireEngine8Admin(req, res, next) {
  const config = getSchwabConfig();
  const expected = config.adminSecret;

  if (!expected) {
    return res.status(503).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_ADMIN_SECRET_NOT_CONFIGURED",
      reasonCodes: ["ENGINE8_ADMIN_SECRET_NOT_CONFIGURED"],
    });
  }

  const provided = String(
    req.headers["x-engine8-admin-secret"] || ""
  ).trim();

  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_ADMIN_UNAUTHORIZED",
      reasonCodes: ["ENGINE8_ADMIN_UNAUTHORIZED"],
    });
  }

  return next();
}

export default requireEngine8Admin;
