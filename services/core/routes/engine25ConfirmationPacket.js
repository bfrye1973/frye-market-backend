import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildEngine25ConfirmationPacket } from "../logic/engine25/buildConfirmationPacket.js";

const router = express.Router();
export default router;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");
const PARTICIPATION_FILE = path.join(DATA_DIR, "engine25-participation.json");

function selfBaseUrl() {
  const port = process.env.PORT || 10000;
  return "http://127.0.0.1:" + port;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("INVALID_JSON " + url + " " + text.slice(0, 180));
  }
  if (!response.ok) {
    throw new Error("HTTP_" + response.status + " " + url + " " + text.slice(0, 180));
  }
  return json;
}

function readParticipation() {
  if (!fs.existsSync(PARTICIPATION_FILE)) return null;
  return JSON.parse(fs.readFileSync(PARTICIPATION_FILE, "utf8"));
}

router.get("/engine25/confirmation-packet", async (req, res) => {
  // Historical asOf is served only by the offline archive-backed replay.
  // Never fetch today's live data then relabel it as a past observation.
  if (Object.prototype.hasOwnProperty.call(req.query, "asOf")) {
    return res.status(400).json({
      ok: false,
      schema: "engine25.confirmationPacket.v1",
      error: "HISTORICAL_ASOF_UNSUPPORTED_ON_LIVE_ENDPOINT",
      detail: "Use the isolated archive-backed research replay for historical cutoffs.",
    });
  }
  try {
    const base = selfBaseUrl();
    const asOfUtc = new Date().toISOString();

    const [marketMeter, reconstructedEod] = await Promise.all([
      fetchJson(base + "/api/v1/futures/market-meter?symbol=ES"),
      fetchJson(base + "/live/eod-shadow"),
    ]);

    const participationArtifact = readParticipation();

    const packet = buildEngine25ConfirmationPacket({
      marketMeter,
      reconstructedEod,
      participationArtifact,
      asOfUtc,
      mode: "LIVE",
      provenance: {
        esMaster: { kind: "LIVE_PUBLISHED", originallyPublished: true, reconstructed: false },
        fourHour: { kind: "LIVE_PUBLISHED", originallyPublished: true, reconstructed: false },
        reconstructedEod: {
          kind: "SHADOW_LIVE_PUBLISHED",
          originallyPublished: true,
          reconstructed: true,
          archiveReference: "data-live-eod/data/outlook_reconstructed_eod_shadow.json",
        },
      },
    });

    res.setHeader("Cache-Control", "no-store");
    return res.json(packet);
  } catch (error) {
    console.error("[engine25ConfirmationPacket] failed:", error?.stack || error);
    return res.status(500).json({
      ok: false,
      schema: "engine25.confirmationPacket.v1",
      error: "engine25_confirmation_packet_failed",
      detail: String(error?.message || error),
      generatedAtUtc: new Date().toISOString(),
    });
  }
});
