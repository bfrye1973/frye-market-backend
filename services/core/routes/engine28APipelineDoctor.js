// services/core/routes/engine28APipelineDoctor.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTPUT_FILE = path.resolve(
  __dirname,
  "../data/engine28a-pipeline-doctor.json"
);

router.get(
  "/engine28a/pipeline-doctor",
  (req, res) => {
    const symbol = String(
      req.query?.symbol || "ES"
    )
      .trim()
      .toUpperCase();

    if (symbol !== "ES") {
      return res.status(400).json({
        ok: false,
        error: "ENGINE28A_V1_ES_ONLY",
        symbol,
      });
    }

    if (!fs.existsSync(OUTPUT_FILE)) {
      return res.status(404).json({
        ok: false,
        error:
          "ENGINE28A_PIPELINE_DOCTOR_NOT_BUILT",
      });
    }

    try {
      const payload = JSON.parse(
        fs.readFileSync(
          OUTPUT_FILE,
          "utf8"
        )
      );

      res.setHeader(
        "Cache-Control",
        "no-store"
      );

      return res.json({
        ok: true,
        ...payload,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error:
          "ENGINE28A_PIPELINE_DOCTOR_UNREADABLE",
        detail: String(
          error?.message || error
        ),
      });
    }
  }
);

export default router;
