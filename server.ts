import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
const PORT = 3001;

// Increase limit for base64 frames
app.use(express.json({ limit: "10mb" }));

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

你输出的数据会用于两个用途：
1. **实时指导**（instruction 字段）— 简短行动指令，语音播报给正在攀爬的用户
2. **事后报告**（detailed_feedback + markers 字段）— 存入训练报告，用户事后查看动作纠正

因此请对两类字段区别对待：

### instruction（实时指导）
简短直接的行动指令，不超过20个字，适配语音播报。
- 优先给出抓握点指令，含方向+距离+形状+手脚
- 如果姿态不稳，先给姿态纠正再给抓握建议
- 示例："右上红色三点点，左手抓"、"正上方30cm大把手，右手上"、"重心偏左，向右贴壁"

### detailed_feedback（事后动作纠正分析）【重点】
**字数限制：150 字以内**。需要具体描述这帧中攀爬者身体姿态的问题或优点：
- 身体哪个部位有问题（膝盖/髋关节/肩膀/手腕/脚位/重心）
- 具体什么问题（内扣/外翻/过直/过高/偏移/没踩实）
- 建议怎么改（外旋髋关节/降低重心/换脚/收紧核心）
- 示例："右膝内扣约15度，重心偏左偏移，导致左侧受力过大。建议外旋髋关节使膝盖朝前，同时降低重心2cm以稳定支撑。"
- 示例："起步姿势好，双脚间距与肩同宽，重心低且稳定。右手抓点姿势正确，肩胛骨收紧。继续保持。"

### 标记系统（markers）
markers 用于在图片上标注关键位置。每个标记包含：
- type：error（错误）/ warning（警告）/ success（正确）/ info（提示）
- label：短的标签名（如"膝盖内扣""重心偏左""手臂过直"）
- description：详细描述（如"右膝内扣约15度，导致左侧受力过大，有脱脚风险"）
  **注意**：error 和 warning 类型的 description 必须写具体问题和原因；success 类型的 description 必须写做得好的地方。

标记规则：
1. 如果不确定，标注 warning 而非 error
2. 标注位置（x, y）要指向具体的身体部位
3. **数量严格限制在 5 个以内**

### 纯中文要求
**注意：以下所有字段的值必须使用纯中文，不允许出现英文单词：**
- `label`：纯中文，如"膝盖内扣"，不要写"knee inward"
- `description`：纯中文
- `instruction`：纯中文，不超过20个字
- `detailed_feedback`：纯中文，150字以内
- `detected_route_color`：纯中文，如"红色""蓝色"
- 不允许在以上字段中出现任何英文字母或英文标点

JSON 字段名本身（markers, type, label 等）保留英文，这是格式要求，不违反纯中文规则。

### 线路规则
- 首先观察攀爬者接触或踩踏的支点颜色，以此确定本次攀爬的目标颜色线路
- success 标记必须严格限定在该颜色系列的支点上
- detected_route_color 输出中文字符串

### 分析逻辑
分析攀爬者当前身体位置（手在哪、脚在哪、重心在哪），然后判断：
- 下一个支点在当前位置的什么方向
- 距离大致多远
- 支点形状
- 用哪只手脚最合理

必须使用纯中文提供所有反馈（仅 JSON 字段名保留英文）。返回一个 JSON 对象，包含：
- markers: { x: number (0-100), y: number (0-100), type: 'error' | 'warning' | 'info' | 'success', label: string（中文标签）, description: string（中文描述） } 数组
- instruction: string（必须提供，纯中文，简短直接的行动指令）
- detected_route_color: string（纯中文，识别出的线路颜色）
- detailed_feedback: string（纯中文，**150字以内**，具体的姿态反馈和动作纠正分析，用于事后报告）
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

  // vision 模型不支持 response_format，所以不传 json_object

  let response = await fetch(`${ZHIPU_BASE}/chat/completions`, {
    method: "POST",
    headers: zhipuHeaders(),
    body: JSON.stringify(body),
  });

  // 429 重试：最多 3 次，指数退避
  for (let attempt = 1; response.status === 429 && attempt <= 3; attempt++) {
    const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
    console.warn(`Zhipu 429 rate limited (attempt ${attempt}/3), waiting ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    response = await fetch(`${ZHIPU_BASE}/chat/completions`, {
      method: "POST",
      headers: zhipuHeaders(),
      body: JSON.stringify(body),
    });
  }

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

/** Attempt to extract a JSON object from a string and parse it */
function extractJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse AI response as JSON");
  }
}

// ─── POST /api/analyze — Frame analysis (vision) ────────────────
app.post("/api/analyze", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "Missing image data" });

    // Ensure the image is a full data-url
    const imageUrl = image.startsWith("data:")
      ? image
      : `data:image/jpeg;base64,${image}`;

    const text = await zhipuChat(
      "glm-4v-flash", // 视觉模型
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text: "Analyze this bouldering frame according to your coach instructions. BE CONCISE.",
            },
          ],
        },
      ],
      SYSTEM_INSTRUCTION
    );

    const result = extractJSON(text);
    console.log("AI Analysis Result:", JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/report — AI-powered session report ────────────────
const REPORT_SYSTEM_PROMPT = `你是一位专业的抱石教练。基于用户的攀爬训练数据，生成一份专业的训练评估报告。

请严格按照以下 JSON 格式返回，不要包含任何其他文字或注释：

{"overallScore": 80, "summary": "摘要文字", "strengths": ["优点1", "优点2"], "weaknesses": ["弱点1", "弱点2"], "improvements": ["建议1", "建议2"], "trend": "趋势分析"}

字段说明：
- overallScore: 0-100 的整数
- summary: 训练摘要，50字以内，中文
- strengths: 优点数组，2-3项
- weaknesses: 需要改进的弱点，2-3项
- improvements: 改进建议，2-3条，中文
- trend: 趋势分析，一句话，中文`;

app.post("/api/report", async (req, res) => {
  try {
    const { history, totalErrors, duration } = req.body;

    // Build a concise summary of the session for the AI
    const statusMap: Record<string, string> = { moving: '移动中', steady: '稳定', stuck: '停滞', falling: '坠落', finished: '完成' };
    const framesSummary = (history || [])
      .map((h: any, i: number) => {
        const chineseStatus = statusMap[h.climb_status] || h.climb_status || '未知';
        return `【第${i + 1}帧】 状态：${chineseStatus} 反馈：${h.detailed_feedback || '无'} 指令：${h.instruction || '无'} 线路：${h.detected_route_color || '未知'}`;
      })
      .join('\n');

    const userPrompt = `攀爬数据报告生成：
- 攀爬时长：${duration || 0}秒
- 总错误/建议数：${totalErrors || 0}
- AI 分析帧数：${(history || []).length}
- 逐帧分析：
${framesSummary || "无数据"}

请严格按照以下 JSON 格式返回专业训练报告：
{"overallScore": 整数0-100, "summary": "中文摘要", "strengths": ["中文优点"], "weaknesses": ["中文弱点"], "improvements": ["中文建议"], "trend": "中文趋势"}

字段名必须用英文，值用中文。`;

    const text = await zhipuChat(
      "glm-4-flash", // 文本模型，不需要 vision
      [
        { role: "user", content: userPrompt },
      ],
      REPORT_SYSTEM_PROMPT
    );

    const result = extractJSON(text);
    console.log("Report Result:", JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error: any) {
    console.error("Report Generation Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/tts — Text-to-Speech via GLM-TTS ────────────────
app.post("/api/tts", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Missing text" });

    console.log(`TTS request: "${text}"`);

    const response = await fetch(`${ZHIPU_BASE}/audio/speech`, {
      method: "POST",
      headers: zhipuHeaders(),
      body: JSON.stringify({
        model: "glm-tts",
        input: text,
        voice: "female",
        response_format: "mp3",
        speed: 1.0,
        volume: 1.0,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `TTS API error (${response.status}): ${errText}` });
    }

    const audioBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    const dataUrl = `data:audio/mpeg;base64,${base64}`;

    res.json({ audioDataUrl: dataUrl });
  } catch (error: any) {
    console.error("TTS Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/jwt — Generate JWT for GLM-Realtime WebSocket ────
function base64url(str: string): string {
  return Buffer.from(str).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function generateJWT(apiKey: string, expireSeconds = 60): string {
  const dot = apiKey.indexOf(".");
  if (dot === -1) throw new Error("Invalid API key format");
  const api_key = apiKey.slice(0, dot);
  const api_secret = apiKey.slice(dot + 1);
  const exp = Math.floor(Date.now() / 1000) + expireSeconds;
  const timestamp = Date.now();
  const headerB64 = base64url(JSON.stringify({ alg: "HS256", sign_type: "SIGN" }));
  const payloadB64 = base64url(JSON.stringify({ api_key, exp, timestamp }));
  const signature = crypto
    .createHmac("sha256", api_secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${headerB64}.${payloadB64}.${signature}`;
}
app.get("/api/jwt", (req, res) => {
  try {
    const token = generateJWT(ZHIPU_API_KEY, 60);
    res.json({ token });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Vite dev server / static serve ─────────────────────────────
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("Zhipu AI key: ✓ hardcoded");
  });
}

startServer();
