// api/routes/sectorcards-10m.js

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");

// Load formulas + config from new algos folder
const FORMULAS = require("../../algos/index-sectors/10m/formulas");
const CONFIG = require("../../algos/index-sectors/10m/config.json");

// Route: /live/sectorcards-10m
router.get("/", async (req, res) => {
  try {
    const result = await FORMULAS.runSectorModel(CONFIG);
    return res.json({ ok: true, data: result });
  } catch (err) {
    console.error("sectorcards-10m error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
