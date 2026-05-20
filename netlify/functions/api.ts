import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

// ─── Zhipu AI Configuration ─────────────────────────────────────
const ZHIPU_API_KEY = "131e668c102648f483a65408ea3a60c5.X8wsvYZ6kck7dPUg";
const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";

function zhipuHeaders() {
  return {
    Authorization: `Bearer ${ZHIPU_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// ─── AI Bouldering Coach System Instruction ─────────────────────
const SYSTEM_INSTRUCTION = `你是一位专业的抱石教练。
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

// ─── Helper: call Zhipu chat API ────────────────────────────────
async function zhipuChat(
  model: string,
  messages: any[],
  systemInstruction?: string
): Promise<string> {
  const body: any = { model, messages };
  if (systemInstruction) {
    body.messages = [{ role: "system", content: systemInstruction }, ...messages];
  }

  const response = await fetch(`${ZHIPU_BASE}/chat/completions`, {
    method: "POST",
    headers: zhipuHeaders(),
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Zhipu API error (${response.status}): ${
        typeof data === "object" ? JSON.stringify(data.error || data) : data
      }`
    );
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from Zhipu AI");
  return text;
}

function extractJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI response as JSON");
  }
}

// ─── Route handlers ─────────────────────────────────────────────

async function handleAnalyze(body: any) {
  const { image } = body;
  if (!image) return { statusCode: 400, body: JSON.stringify({ error: "Missing image data" }) };

  const imageUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;

  const text = await zhipuChat(
    "glm-4.6v-flash",
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

  return { statusCode: 200, body: JSON.stringify(extractJSON(text)) };
}

async function handleReport(body: any) {
  const REPORT_SYSTEM_PROMPT = `你是一位专业的抱石教练。基于用户的攀爬训练数据，生成一份专业的训练评估报告。

请分析用户提供的攀爬数据，考虑以下维度：
1. 整体表现评分（0-100）
2. 训练摘要（客观评价整段表现）
3. 优点（2-3 个具体方面）
4. 需要改进的弱点（2-3 个具体方面）
5. 针对性的训练改进建议（2-3 条）
6. 趋势分析（如果数据点足够多）

必须严格返回 JSON 格式，不要包含任何其他文字。`;

  const { history, totalErrors, duration } = body;
  const framesSummary = (history || [])
    .map((h: any, i: number) =>
      `[帧${i + 1}] 状态:${h.climb_status || "未知"} 反馈:${h.detailed_feedback || "无"} 指令:${h.instruction || "无"} 线路:${h.detected_route_color || "未知"}`
    )
    .join("\n");

  const userPrompt = `攀爬数据报告生成：
- 攀爬时长: ${duration || 0}秒
- 总错误/建议数: ${totalErrors || 0}
- AI 分析帧数: ${(history || []).length}
- 逐帧分析:
${framesSummary || "无数据"}
请严格按照 JSON 格式生成专业训练报告。`;

  const text = await zhipuChat("glm-4-flash", [{ role: "user", content: userPrompt }], REPORT_SYSTEM_PROMPT);
  return { statusCode: 200, body: JSON.stringify(extractJSON(text)) };
}

async function handleTTS(body: any) {
  const { text } = body;
  if (!text) return { statusCode: 400, body: JSON.stringify({ error: "Missing text" }) };

  const response = await fetch(`${ZHIPU_BASE}/audio/speech`, {
    method: "POST",
    headers: zhipuHeaders(),
    body: JSON.stringify({
      model: "glm-tts",
      input: text,
      voice: "female",
      response_format: "wav",
      speed: 1.0,
      volume: 1.0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS API error (${response.status}): ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return {
    statusCode: 200,
    headers: { "Content-Type": "audio/wav" },
    isBase64Encoded: true,
    body: base64,
  };
}

// ─── Main handler ───────────────────────────────────────────────
export const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  try {
    // event.path is e.g. "/.netlify/functions/api/analyze"
    const path = event.path.replace("/.netlify/functions/api", "").replace(/\/$/, "");
    const method = event.httpMethod;

    console.log(`[${method}] path: ${event.path} → stripped: "${path}"`);

    // CORS headers for all responses
    const baseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight
    if (method === "OPTIONS") {
      return { statusCode: 200, headers: baseHeaders, body: "" };
    }

    if (method !== "POST") {
      return { statusCode: 405, headers: baseHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const body = JSON.parse(event.body || "{}");

    let result: any;

    switch (path) {
      case "/analyze":
        result = await handleAnalyze(body);
        break;
      case "/report":
        result = await handleReport(body);
        break;
      case "/tts":
        result = await handleTTS(body);
        break;
      default:
        return { statusCode: 404, headers: baseHeaders, body: JSON.stringify({ error: `Not found: ${path}` }) };
    }

    return {
      ...result,
      headers: { ...baseHeaders, ...(result.headers || {}) },
    };
  } catch (error: any) {
    console.error("Function Error:", error);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message || "Internal server error" }),
    };
  }
};
