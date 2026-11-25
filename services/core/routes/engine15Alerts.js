import express from "express";
import { runEngine15AlertCheck } from "../jobs/alertEngine15Signals.js";

export const engine15AlertsRouter = express.Router();

engine15AlertsRouter.post("/check-engine15", async (req, res) => {
  const out = await runEngine15AlertCheck();
  res.json(out);
});
