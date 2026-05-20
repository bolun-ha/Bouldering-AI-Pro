// POST /.netlify/functions/tts — Text-to-Speech via GLM-TTS
import { ZHIPU_API_KEY, ZHIPU_BASE, corsHeaders, handleOptions } from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { text } = JSON.parse(event.body || "{}");
    if (!text) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing text" }) };

    const res = await fetch(`${ZHIPU_BASE}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "glm-tts",
        input: text,
        voice: "female",
        response_format: "wav",
        speed: 1.0,
        volume: 1.0,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`TTS error (${res.status}): ${err}`);
    }

    const audioBuf = await res.arrayBuffer();
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "audio/wav" },
      isBase64Encoded: true,
      body: Buffer.from(audioBuf).toString("base64"),
    };
  } catch (error) {
    console.error("tts Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
