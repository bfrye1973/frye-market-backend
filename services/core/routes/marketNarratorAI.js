// services/core/routes/marketNarratorAI.js
// AI Interpreter (text + image) for Market Narrator
// - Input: narratorJson (facts) + chart screenshot (png dataURL or base64)
// - Output: 3 paragraphs + optional tags
//
// Safety rules (locked):
// - If conflict → SLIGHT_BULLISH tilt (user chosen)
// - AI is narration-only (no execution, no GO, no permission changes)

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

function asDataUrlPng(input) {
  // Accept:
  // - data:image/png;base64,....
  // - raw base64 "iVBORw0KGgoAAA..."
  if (!input) return null;
  const s = String(input).trim();
  if (s.startsWith("data:image/")) return s;
  return `data:image/png;base64,${s}`;
}

async function callOpenAI({ narratorJson, chartDataUrl }) {
  // Responses API with multimodal input (text + image)
  // Docs: images can be provided as URL or Base64 data URL. :contentReference[oaicite:1]{index=1}
  const system = `
You are the Frye Dashboard Market Interpreter.
You will receive:
(1) JSON facts from a deterministic market narrator (zones, shelves, wicks, balance, macro shelves, wave/fibs).
(2) A chart screenshot showing zones (green negotiated, red/blue shelves).

RULES (LOCKED):
- Output EXACTLY 3 paragraphs separated by a blank line.
- Paragraph 1: summarize last 6 hours (sequence, wick defenses/rejections, defended levels).
- Paragraph 2: summarize what is happening now (phase/regime, price vs zones, macro shelf, wave+fib context).
- Paragraph 3: what you are watching next (specific levels, confirmations, invalidations; keep it actionable).
- If there is conflict (e.g., defended support but overhead supply), default to SLIGHT_BULLISH tilt (not neutral, not bearish).
- Do NOT invent levels. Only use numbers that are visible in the JSON or clearly on the chart.
- Do NOT output trading instructions like “buy/sell now.” Narration only.
`.trim();

  const userText = `
JSON_FACTS:
${JSON.stringify(narratorJson, null, 2)}
`.trim();

  const body = {
    model: "gpt-5", // you can change later (gpt-5-mini for cheaper)
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: system }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          { type: "input_image", image_url: chartDataUrl }, // base64 data url
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

  // Responses API returns content in output_text convenience sometimes,
  // but safest is to stitch from output[].content[].text
  const outText =
    json?.output_text ||
    json?.output?.flatMap(o => o.content || [])
      ?.filter(c => c.type === "output_text" || c.type === "text")
      ?.map(c => c.text || c.value || "")
      ?.join("\n")
      ?.trim() ||
    "";

  return { ok: true, status: 200, text: outText, raw: json };
}

// POST /api/v1/market-narrator-ai
// Body: { narratorJson: {...}, chartImage: "data:image/png;base64,..." OR "<raw base64>" }
router.post("/market-narrator-ai", express.json({ limit: "8mb" }), async (req, res) => {
  if (!mustHaveKey(res)) return;

  const narratorJson = req.body?.narratorJson;
  const chartImage = req.body?.chartImage;

  if (!narratorJson || typeof narratorJson !== "object") {
    return res.status(400).json({ ok: false, error: "MISSING_NARRATOR_JSON" });
  }
  const chartDataUrl = asDataUrlPng(chartImage);
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
      // keep raw response for debugging (optional; you can remove later)
      openai: { status: resp.status },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "MARKET_NARRATOR_AI_ERROR", message: String(e?.message || e) });
  }
});

export default router;
export { router as marketNarratorAIRouter };
