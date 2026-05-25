// POST /.netlify/functions/analyze-async
// 接收帧数组 → 提交 Zhipu async API → 返回 taskId
import { ZHIPU_API_KEY, corsHeaders, handleOptions } from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  try {
    const { frames, prompt, model = "glm-5v-turbo" } = JSON.parse(event.body || "{}");
    if (!frames || !frames.length || !prompt) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "缺少 frames 或 prompt" }),
      };
    }

    // 构建多图输入：text + 20 张 image_url
    const contentArray = [{ type: "text", text: prompt }];
    for (const frame of frames) {
      contentArray.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
      });
    }

    const body = {
      model,
      messages: [{ role: "user", content: contentArray }],
    };

    console.log(`[analyze-async] submitting ${frames.length} frames with model ${model}`);

    const res = await fetch("https://open.bigmodel.cn/api/paas/v4/async/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[analyze-async] submit failed:", res.status, err);
      return {
        statusCode: res.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: err.error?.message || `HTTP ${res.status}` }),
      };
    }

    const data = await res.json();
    console.log("[analyze-async] submitted, taskId:", data.id);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ success: true, taskId: data.id }),
    };
  } catch (error) {
    console.error("[analyze-async] error:", error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
