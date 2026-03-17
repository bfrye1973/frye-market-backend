// src/services/core/routes/alerts.js
import express from "express";
import { runAlertGoSignals } from "../jobs/alertGoSignals.js";

export const alertsRouter = express.Router();

/**
 * POST /api/v1/alerts/check-go
 * - Cron-safe trigger
 * - Requires no payload
 */
alertsRouter.post("/check-go", async (req, res) => {
  const baseUrl =
    process.env.CORE_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `${req.protocol}://${req.get("host")}`;

  const out = await runAlertGoSignals({ baseUrl });
  res.status(out.ok ? 200 : 500).json(out);
});
