// POST /.netlify/functions/analyze — Frame analysis via GLM-4V-Flash
import { zhipuChat, extractJSON, corsHeaders, handleOptions, SYSTEM_INSTRUCTION } from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { image, pose } = body;
    if (!image) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing image data" }) };

    const imageUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

    let analysisPrompt = "根据指令分析这张攀爬图片。";
    if (pose) {
      analysisPrompt = `图片附带的实时骨骼坐标（像素位置）：${pose}\n\n根据以上坐标和图片共同分析这张攀爬姿态。`;
    }

    const text = await zhipuChat(
      "glm-4v-flash",
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: analysisPrompt },
          ],
        },
      ],
      SYSTEM_INSTRUCTION
    );

    const result = extractJSON(text);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  } catch (error) {
    console.error("analyze Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
