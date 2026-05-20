// POST /.netlify/functions/tts — Text-to-Speech via GLM-TTS
import { ZHIPU_API_KEY, ZHIPU_BASE, corsHeaders, handleOptions } from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { text } = JSON.parse(event.body || "{}");
    if (!text) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing text" }) };
    }

    console.log(`TTS request: "${text.substring(0, 30)}..."`);

    // 先测试 Zhipu 基础连通性
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
        response_format: "mp3",
        speed: 1.0,
        volume: 1.0,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`TTS API error response (${res.status}):`, errBody.substring(0, 200));
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({
          error: `TTS API error (${res.status})`,
          detail: errBody.substring(0, 500),
        }),
      };
    }

    const audioBuf = await res.arrayBuffer();
    console.log(`TTS success: ${audioBuf.byteLength} bytes`);

    // 返回 base64 数据 URL，前端直接 new Audio(dataUrl)
    const base64 = Buffer.from(audioBuf).toString("base64");
    const dataUrl = `data:audio/mpeg;base64,${base64}`;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ audioDataUrl: dataUrl }),
    };
  } catch (error) {
    console.error("tts Error:", error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
