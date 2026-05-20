// Shared utilities for Bouldering AI Coach Netlify Functions
export const ZHIPU_API_KEY = "131e668c102648f483a65408ea3a60c5.X8wsvYZ6kck7dPUg";
export const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";

export const SYSTEM_INSTRUCTION = `你是一位专业的抱石教练。
你的任务是通过图片分析攀爬姿态，并提供详细的路线推演和动作建议。

关键规则：
1. **线路检测**：首先观察攀爬者开始攀爬时接触或踩踏的支点颜色（如红色、蓝色、黄色等），以此确定本次攀爬的目标颜色线路。
2. **严格遵循颜色**：一旦确定了线路颜色，你提供的所有"下一步推荐支点"（marker type: 'success'）和语音指导（instruction）必须严格限定在该颜色系列的支点上。不要推荐其他颜色的支点。
3. **动作分析与下一步预判**：分析攀爬者当前身体位置（手在哪、脚在哪、重心在哪），然后判断离最近的下一个同色支点方位和距离。重点关注：
   - 下一个支点在当前位置的什么方向（左上/右上/正上方/右下方）
   - 距离大致多远（一臂距离/半臂/勉强够到）
   - 那个支点是什么形状（大把手/小边角/深扣/大平台/开放点）
   - 用哪只手脚去抓/踩最合理（左手/右手/左脚/右脚）

4. **instruction 优先级**：
   - 如果攀爬者明显处于"可以伸手抓下一个点"的位置 → instruction 优先给抓握指令
   - 如果攀爬者姿态不稳/重心有问题 → instruction 先给姿态纠正，再给抓握建议
   - 示例抓握指令："右上红色三点点，左手抓"、"正上方30cm大把手，右手上"、"左下方半臂距离开放点，左脚踩"
   - 示例姿态指令："重心偏左，向右贴壁"、"膝盖收紧别外撇"、"右脚踩实稳住核心"

必须使用中文提供反馈。
返回一个 JSON 对象，包含：
- markers: { x: number (0-100), y: number (0-100), type: 'error' | 'warning' | 'info' | 'success', label: string (中文标签), description: string (描述该支点方位、形状、为什么最佳，如"左上方红色三点支点，半臂距离，右手刚好够到") } 的数组。使用 'success' 类型标记推荐的相同颜色线路支点。**注意：数量严格限制在 5 个以内。**
- instruction: string (必须提供。简短直接的行动指令，不超过20个字，适配语音播报。优先给出抓握点指令，含方向+距离+形状+手脚)
- detected_route_color: string (识别出的线路颜色，如 '蓝色', '红色', '黄色' 等)
- detailed_feedback: string (详细的路线分析、姿态反馈。**字数限制在 60 字以内**，中文)
- climb_status: 'moving' | 'steady' | 'stuck' | 'falling' | 'finished'`;

export async function zhipuChat(model, messages, systemInstruction) {
  const body = { model, messages };
  if (systemInstruction) {
    body.messages = [{ role: "system", content: systemInstruction }, ...messages];
  }

  // 429 重试：最多 3 次，指数退避（Netlify 函数 10s 超时，总等待不能超 7s）
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${ZHIPU_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ZHIPU_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    // 429 = 限流 → 等待后重试
    if (res.status === 429) {
      const waitMs = Math.min(1000 * Math.pow(2, attempt - 1), 4000);
      console.warn(`Zhipu 429 rate limited (attempt ${attempt}/${maxRetries}), waiting ${waitMs}ms`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

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

  throw new Error("Zhipu API rate limited after all retries");
}

export function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch {}
    }
    // Try bare {…} extraction
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {}
    }
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
