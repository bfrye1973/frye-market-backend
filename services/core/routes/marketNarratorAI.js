// services/core/routes/marketNarratorAI.js
// AI Interpreter (text + image) for Market Narrator
// - Input: narratorJson (facts) + chart screenshot (png/jpg dataURL or base64)
// - Output: EXACTLY 3 paragraphs (blank line between) + optional tags later
//
// Safety rules (LOCKED):
// - If conflict → SLIGHT_BULLISH tilt (user chosen)
// - Narration-only (no execution, no GO, no permission changes)
// - MUST mention Engine 2 wave + nearest fib levels (Minor + Intermediate) every time

import express from "express";

const router = express.Router();

// IMPORTANT: keep your OpenAI key on the SERVER only.
// Do NOT put it in the frontend.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function mustHaveKey(res) {
  if (!OPENAI_API_KEY) {
    res.status(500).json({ ok: false, error: "OPENAI_API_KEY_MISSING" });
    return false;
  }
  return true;
}

function asDataUrlImage(input) {
  // Accept:
  // - data:image/png;base64,....
  // - data:image/jpeg;base64,....
  // - raw base64
  if (!input) return null;
  const s = String(input).trim();
  if (s.startsWith("data:image/")) return s;

  // default to png if raw base64 provided
  return `data:image/png;base64,${s}`;
}

function safeJsonString(obj, maxLen = 20000) {
  // Prevent huge payloads from blowing up the prompt
  try {
    const s = JSON.stringify(obj, null, 2);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + "\n...<TRUNCATED>...";
  } catch {
    return "<UNSERIALIZABLE_JSON>";
  }
}

function buildSystemPrompt() {
  return `
You are the Frye Dashboard Market Interpreter.

You receive:
(1) JSON facts from a deterministic Market Narrator (zones, shelves, balance, wicks, macro shelves, Engine 2 wave/fibs).
(2) A chart screenshot showing zones (green negotiated, red/blue shelves) and sometimes fib/wave drawings.

OUTPUT FORMAT (LOCKED):
- Output EXACTLY 3 paragraphs separated by ONE blank line.
- Do NOT output bullet lists. Do NOT output titles. Paragraphs only.

PARAGRAPH REQUIREMENTS (LOCKED):
1) Paragraph 1 (Last 24 hours):
   - Summarize the last 24 hours sequence: expansion vs rotation vs correction.
   - Mention wick behavior if present (lower-wick buybacks / upper-wick rejections).
   - If a defended/held level is visible (e.g., repeated buybacks around same area), say it.

2) Paragraph 2 (Right now):
   - Describe current regime/phase (balance/correction/expansion) using JSON.
   - Describe price vs zones (negotiated/institutional) AND macro shelf mapping (SPX 6900 ≈ SPY 688).
   - MUST include Engine 2 wave context EVERY time:
     * Minor (1h): phase + invalidated flag
     * Intermediate (4h): phase + invalidated flag
   - MUST include nearest fib levels EVERY time if present:
     * engine2.minor.nearestLevel (tag, price, distancePts)
     * engine2.intermediate.nearestLevel (tag, price, distancePts)
     If nearestLevel is missing/null, say: "Fib levels unavailable from Engine 2 anchors."

3) Paragraph 3 (What I'm watching next):
   - Give explicit confirmations + invalidations with exact levels (from JSON facts or clearly on chart).
   - Reference negotiated/institutional zone edges.
   - Mention what would confirm acceptance vs rejection next.

SAFETY / BEHAVIOR RULES (LOCKED):
- If there is conflict (e.g., defended support but overhead supply), default to SLIGHT_BULLISH tilt.
- Narration-only: do NOT say "buy/sell now" or give orders.
- Do NOT invent numbers. Prefer JSON. Only use chart numbers if clearly readable.
- Never say "wave/fib inconclusive" if Engine 2 provided phase/nearestLevel. Summarize what is present.
`.trim();
}

async function callOpenAI({ narratorJson, chartDataUrl }) {
  const system = buildSystemPrompt();

  const userText = `
JSON_FACTS (deterministic truth; prefer these numbers):
${safeJsonString(narratorJson, 30000)}
`.trim();

  const body = {
    model: "gpt-5",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          { type: "input_image", image_url: chartDataUrl },
        ],
      },
    ],
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => null);

  if (!r.ok) {
    return { ok: false, status: r.status, json };
  }

  const outText =
    json?.output_text ||
    json?.output
      ?.flatMap((o) => o.content || [])
      ?.filter((c) => c.type === "output_text" || c.type === "text")
      ?.map((c) => c.text || c.value || "")
      ?.join("\n")
      ?.trim() ||
    "";

  return { ok: true, status: 200, text: outText, raw: json };
}

// POST /api/v1/market-narrator-ai
// Body: { narratorJson: {...}, chartImage: "data:image/png;base64,..." OR "<raw base64>" }
router.post("/market-narrator-ai", express.json({ limit: "12mb" }), async (req, res) => {
  if (!mustHaveKey(res)) return;

  const narratorJson = req.body?.narratorJson;
  const chartImage = req.body?.chartImage;

  if (!narratorJson || typeof narratorJson !== "object") {
    return res.status(400).json({ ok: false, error: "MISSING_NARRATOR_JSON" });
  }

  const chartDataUrl = asDataUrlImage(chartImage);
  if (!chartDataUrl) {
    return res.status(400).json({ ok: false, error: "MISSING_CHART_IMAGE" });
  }

  try {
    const resp = await callOpenAI({ narratorJson, chartDataUrl });

    if (!resp.ok) {
      return res.status(502).json({
        ok: false,
        error: "OPENAI_CALL_FAILED",
        status: resp.status,
        detail: resp.json,
      });
    }

    return res.json({
      ok: true,
      asOf: new Date().toISOString(),
      narrativeText: resp.text,
      openai: { status: resp.status },
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "MARKET_NARRATOR_AI_ERROR",
      message: String(e?.message || e),
    });
  }
});

export default router;
export { router as marketNarratorAIRouter };
