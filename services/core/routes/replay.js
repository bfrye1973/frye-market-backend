// services/core/routes/replay.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import {
  listDates,
  listTimes,
  readJson,
  snapshotPath,
  eventsPath,
} from "../logic/replay/replayStore.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "..", "data");

router.get("/replay/dates", (req, res) => {
  const dates = listDates(DATA_DIR);
  res.json({ ok: true, dates });
});

router.get("/replay/times", (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }
  const times = listTimes(DATA_DIR, date);
  res.json({ ok: true, date, times });
});

router.get("/replay/snapshot", (req, res) => {
  const date = String(req.query.date || "");
  const time = String(req.query.time || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }
  if (!/^\d{4}$/.test(time)) {
    return res.status(400).json({ ok: false, reason: "BAD_TIME", expected: "HHMM" });
  }
  const file = snapshotPath(DATA_DIR, date, time);
  const snap = readJson(file);
  if (!snap) return res.status(404).json({ ok: false, reason: "NOT_FOUND", date, time });
  res.json(snap);
});

router.get("/replay/events", (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, reason: "BAD_DATE", expected: "YYYY-MM-DD" });
  }
  const file = eventsPath(DATA_DIR, date);
  const events = readJson(file);
  res.json({ ok: true, date, events: Array.isArray(events) ? events : [] });
});

export default router;
