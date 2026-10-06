// services/core/routes/marketNarratorAI.js
// AI Interpreter (text + image) for Market Narrator
// - Input: narratorJson (facts) + chart screenshot (png/jpg dataURL or base64)
// - Output: EXACTLY 3 paragraphs (blank line between) + optional tags later
//
// Safety rules (LOCKED):
// - If conflict → SLIGHT_BULLISH tilt (user chosen)
// - Narration-only (no execution, no GO, no permission changes)
// - MUST mention Engine 2 wave + nearest fib levels every time
// - ✅ MUST align with EngineStack (Engines 1–5 summaries) when present
// - ✅ MUST use "1h CLOSE" wording for invalidation resets when invalidationMode="close"
// - ✅ Do NOT invent numbers. Prefer JSON. Use chart only if clearly readable.

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

function safeJsonString(obj, maxLen = 25000) {
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
(1) JSON facts from a deterministic Market Narrator.
    This includes: zones, balance/phase, macro shelves, Engine 2 (Primary/Intermediate/Minor) wave+fib,
    and may include engineStack summaries for Engines 1–5.
(2) A chart screenshot showing zones and levels.

OUTPUT FORMAT (LOCKED):
- Output EXACTLY 3 paragraphs separated by ONE blank line.
- Do NOT output bullet lists. Do NOT output titles. Paragraphs only.
- No emojis.

PARAGRAPH REQUIREMENTS (LOCKED):
1) Paragraph 1 (Last 24 hours):
   - Summarize the last 24 hours sequence: expansion vs rotation vs correction.
   - Mention wick behavior if present.
   - If a defended/held level is visible (repeated buybacks/sellbacks), say it.

2) Paragraph 2 (Right now):
   - Describe current phase/regime from JSON.
   - Describe price vs allowed zones (NEGOTIATED/INSTITUTIONAL) and macro shelves mapping.
   - MUST include Engine 2 wave context EVERY time:
     * Primary (1d): tag + invalidated flag (if present)
     * Intermediate (1h): tag + invalidated flag
     * Minor (1h): tag + invalidated flag
   - MUST include nearest fib levels EVERY time if present:
     * engine2.minor.nearestLevel (tag, price, distancePts)
     * engine2.intermediate.nearestLevel (tag, price, distancePts)
     If nearestLevel is missing/null, say: "Fib levels unavailable from Engine 2 anchors."

   - If engineStack is present, you MUST incorporate it once (without lists):
     * Engine 3: stage + reactionScore + armed
     * Engine 4: volumeRegime + pressureBias + volumeScore + volumeConfirmed
     * Engine 5: confluenceTotal (or total score) + tradeReady + any key reasonCodes
     If a given engineStack sub-block is missing or ok=false, say it is unavailable.

3) Paragraph 3 (What I'm watching next):
   - Give explicit confirmations + invalidations with exact levels (from JSON facts).
   - Reference negotiated/institutional zone edges.
   - Mention what would confirm acceptance vs rejection next.
   - If minor invalidated is true AND invalidationMode is "close":
     you MUST use the phrase "1h close back above <invalidation>" (not "reclaim and hold").

SAFETY / BEHAVIOR RULES (LOCKED):
- If there is conflict (e.g., defended support but overhead supply), default to SLIGHT_BULLISH tilt in tone.
- Narration-only: do NOT say "buy/sell now" or give orders.
- Do NOT invent numbers. Prefer JSON. Only use chart numbers if clearly readable.
- If Engine 2 says minor invalidated=true, treat that as an execution-layer stand-down condition until reset.
- Use "1h close" wording for resets when invalidationMode="close".
`.trim();
}

function extractOutputText(respJson) {
  const outText =
    respJson?.output_text ||
    respJson?.output
      ?.flatMap((o) => o.content || [])
      ?.filter((c) => c.type === "output_text" || c.type === "text")
      ?.map((c) => c.text || c.value || "")
      ?.join("\n")
      ?.trim() ||
    "";
  return outText;
}

function enforceThreeParagraphs(text) {
  const s = String(text || "").trim();

  // Normalize line breaks and collapse excessive blank lines
  const normalized = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Split by blank line(s)
  const parts = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (parts.length === 3) return parts.join("\n\n");

  // If model returned 1 long paragraph, try to split by sentences into 3
  if (parts.length === 1) {
    const body = parts[0];
    const sentences = body.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length >= 6) {
      const a = sentences.slice(0, Math.ceil(sentences.length / 3)).join(" ");
      const b = sentences.slice(Math.ceil(sentences.length / 3), Math.ceil((2 * sentences.length) / 3)).join(" ");
      const c = sentences.slice(Math.ceil((2 * sentences.length) / 3)).join(" ");
      return [a, b, c].map((x) => x.trim()).join("\n\n");
    }
  }

  // If more than 3, merge extras into paragraph 3
  if (parts.length > 3) {
    const p1 = parts[0];
    const p2 = parts[1];
    const p3 = parts.slice(2).join(" ");
    return [p1, p2, p3].join("\n\n");
  }

  // If 2, append a minimal third paragraph placeholder (rare)
  if (parts.length === 2) {
    return `${parts[0]}\n\n${parts[1]}\n\nWhat I’m watching next: watch acceptance vs rejection at the key zone edges and the nearest fib lines.`;
  }

  // Fallback
  return normalized;
}

async function callOpenAI({ narratorJson, chartDataUrl }) {
  const system = buildSystemPrompt();

  const userText = `
JSON_FACTS (deterministic truth; prefer these numbers):
${safeJsonString(narratorJson, 35000)}
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

  const outText = extractOutputText(json);
  const enforced = enforceThreeParagraphs(outText);

  return { ok: true, status: 200, text: enforced, raw: json };
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
