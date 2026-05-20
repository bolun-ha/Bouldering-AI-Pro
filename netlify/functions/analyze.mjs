// POST /.netlify/functions/analyze — Frame analysis via GLM-4.6V-Flash
import { zhipuChat, extractJSON, corsHeaders, handleOptions, SYSTEM_INSTRUCTION } from "./_shared.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { image } = JSON.parse(event.body || "{}");
    if (!image) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing image data" }) };

    const imageUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

    const text = await zhipuChat(
      "glm-4v-flash",
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: "Analyze this bouldering frame according to your coach instructions. BE CONCISE." },
          ],
        },
      ],
      SYSTEM_INSTRUCTION
    );

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(extractJSON(text)) };
  } catch (error) {
    console.error("analyze Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
