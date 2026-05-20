// Shared utilities for Bouldering AI Coach Netlify Functions
export const ZHIPU_API_KEY = "131e668c102648f483a65408ea3a60c5.X8wsvYZ6kck7dPUg";
export const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";

export const SYSTEM_INSTRUCTION = `你是一位专业的抱石教练。
你的任务是通过图片分析攀爬姿态，并提供详细的路线推演和动作建议。

关键规则：
1. **线路检测**：首先观察攀爬者开始攀爬时接触或踩踏的支点颜色（如红色、蓝色、黄色等），以此确定本次攀爬的目标颜色线路。
2. **严格遵循颜色**：一旦确定了线路颜色，你提供的所有"下一步推荐支点"（marker type: 'success'）和语音指导（instruction）必须严格限定在该颜色系列的支点上。不要推荐其他颜色的支点。
3. **动作建议**：重点关注重心 (Center of gravity)、张力 (Body tension) 以及下一处移动的预测。识别错误，并主动指出下一处推荐的支点位置。

必须使用中文提供反馈。
返回一个 JSON 对象，包含：
- markers: { x: number (0-100), y: number (0-100), type: 'error' | 'warning' | 'info' | 'success', label: string (中文标签), description: string (描述该支点为何是最佳下一步) } 的数组。使用 'success' 类型标记推荐的相同颜色线路支点。**注意：数量严格限制在 5 个以内。**
- instruction: string (必须提供。针对该颜色线路的简短直接指令，如"左手抓上方蓝色点"、"右脚踩右侧红点"，最多15个字)
- detected_route_color: string (识别出的线路颜色，如 '蓝色', '红色', '黄色' 等)
- detailed_feedback: string (详细的路线分析、姿态反馈。**字数限制在 60 字以内**，中文)
- climb_status: 'moving' | 'steady' | 'stuck' | 'falling' | 'finished'`;

export async function zhipuChat(model, messages, systemInstruction) {
  const body = { model, messages };
  if (systemInstruction) {
    body.messages = [{ role: "system", content: systemInstruction }, ...messages];
  }

  const res = await fetch(`${ZHIPU_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZHIPU_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      `Zhipu error (${res.status}): ${
        typeof data === "object" ? JSON.stringify(data.error || data) : data
      }`
    );
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from Zhipu AI");
  return text;
}

export function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Could not parse AI response as JSON");
  }
}

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function handleOptions() {
  return { statusCode: 200, headers: corsHeaders, body: "" };
}
