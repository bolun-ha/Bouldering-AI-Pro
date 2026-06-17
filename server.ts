import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import crypto from "crypto";
import { jsonrepair } from "jsonrepair";

dotenv.config();

// 获取当前脚本所在目录（兼容 ESM/tsx 和 CJS 产物）
// - tsx dev: process.argv[1] = "server.ts" → dirname = "." → index.html 在 dist/ 不存在 → Vite 中间件
// - CJS prod (ECS): process.argv[1] = "/var/www/dist/server.cjs" → dirname = "/var/www/dist/" → index.html 存在 → express.static
let scriptDir = path.dirname(process.argv[1] || '');

if (fs.existsSync('/var/www/Bouldering-AI-Pro/dist/index.html')) { scriptDir = '/var/www/Bouldering-AI-Pro/dist'; }    

const app = express();
const PORT = 3003;

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
const SYSTEM_INSTRUCTION = `# Role
你是一名国家级专业抱石攀岩教练兼比赛主裁判。请分析输入的攀岩图片，结合 MediaPipe 骨骼检测数据（如果提供），进行深度、连贯的复盘。

# Core Philosophy
攀岩是时序连贯的艺术，禁止孤立的单帧误判。

## 终局裁判与顶端控制规范
如果你判定用户已处于攀爬终局（即将摸到顶点或完成合分），按以下规则判定：

[SUCCESS 完攀] 双手同时出现在墙体顶端终点（Top Hold）位置即判定完攀，不要求保持帧数，无需关注下墙姿态
[FAIL 坠落] 未完成合分时身体失控位移、摔向垫子
[UNKNOWN] 主动下墙，无摸顶也无坠落

# 输出结构

你输出的数据会用于两个用途：
1. **实时指导**（instruction 字段）— 简短行动指令，语音播报给正在攀爬的用户
2. **事后报告**（detailed_feedback + markers 字段）— 存入训练报告，用户事后查看动作纠正

因此请对两类字段区别对待：

### instruction（实时指导）
简短直接的行动指令，不超过20个字，适配语音播报。
- 优先给出抓握点指令，含方向+距离+形状+手脚
- 如果姿态不稳，先给姿态纠正再给抓握建议

### detailed_feedback（事后动作纠正分析）
**字数限制：150 字以内**。需要具体描述这帧中攀爬者身体姿态的问题或优点：
- 身体哪个部位有问题（膝盖/髋关节/肩膀/手腕/脚位/重心）
- 具体什么问题（内扣/外翻/过直/过高/偏移/没踩实）
- 建议怎么改（外旋髋关节/降低重心/换脚/收紧核心）

### 标记系统（markers）
markers 用于在图片上标注关键位置。每个标记包含：
- type：error（错误）/ warning（警告）/ success（正确）/ info（提示）
- label：短的标签名（如"膝盖内扣""重心偏左""手臂过直"）
- description：详细描述
标记规则：数量严格限制在 5 个以内，标注位置指向具体身体部位。

### 典型错误模式参考
高阶错误：膝盖内扣（外旋纠正）、手臂锁死（直臂支撑）、重心偏（降重心）、脚点滑脱（踩实再移手）、核心没收紧（收紧腹横肌）、挂脚错误（脚跟下压/脚尖勾紧）、动态失控（蓄力收腿）
中级错误：肩部耸肩（沉肩）、抓点过紧（放松）、视线错误（提前规划）、未用 flagging（腿外摆平衡）、drop knee 不当（支撑膝下转）、呼吸憋气（移动前吸完成后呼）

### 纯中文要求
**注意：以下所有字段的值必须使用纯中文，不允许出现英文单词：**
- 「label」「description」「instruction」「detailed_feedback」「detected_route_color」字段均使用纯中文
- JSON 字段名本身（markers、type、label 等）保留英文，这是格式要求

### 线路规则
- 首先观察攀爬者接触或踩踏的支点颜色，以此确定本次攀爬的目标颜色线路
- success 标记必须严格限定在该颜色系列的支点上

### 分析逻辑
分析攀爬者当前身体位置（手在哪、脚在哪、重心在哪），然后判断下一个支点在什么方向、距离多远、形状如何、用哪只手脚最合理。

# JSON 输出格式
{
  "markers": [{"x": 0-100, "y": 0-100, "type": "error|warning|info|success", "label": "中文标签", "description": "中文描述"}],
  "instruction": "纯中文简短行动指令",
  "detected_route_color": "纯中文颜色",
  "detailed_feedback": "纯中文姿态反馈（150字内）",
  "climb_status": "moving|steady|stuck|falling|finished",
  "climb_result": "SUCCESS|FAIL|UNKNOWN",
  "end_game_reason": "终局裁判依据",
  "top_control_score": 0-100整数,
  "top_hand_match_status": "perfect_match|struggling_match|no_match",
  "hold_positions": [{"x": 0-100, "y": 0-100, "color": "纯中文", "type": "纯中文", "used": true/false}]
}`;

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
  // 去掉可能的 markdown 包裹
  let s = text.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

  // 多重修复策略
  const repair1 = (str: string) => {
    // 基础 jsonrepair
    try { return JSON.parse(jsonrepair(str)); } catch { return undefined; }
  };
  const repair2 = (str: string) => {
    // 先做预处理再 jsonrepair
    let t = str
      .replace(/'/g, '"')                 // 单引号→双引号
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":') // 补属性名引号
      .replace(/,\s*}/g, '}')             // 删除尾随逗号
      .replace(/,\s*\]/g, ']');
    try { return JSON.parse(jsonrepair(t)); } catch { return undefined; }
  };
  const repair3 = (str: string) => {
    // 提取首尾大括号，极端修复
    const m = str.match(/\{[\s\S]*\}/);
    if (!m) return undefined;
    let t = m[0]
      .replace(/'/g, '"')
      .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
      .replace(/,\s*}/g, '}')
      .replace(/,\s*\]/g, ']')
      .replace(/(\w+):/g, '"$1":')        // 补所有未引号的键名
      .replace(/:\s*'([^']*)'/g, ':"$1"') // 值里漏引号的情况
      .replace(/"\s*\+\s*"/g, '')         // 去除字符串拼接
      .replace(/\s+/g, ' ')               // 合并空白
      .replace(/,\s*$/, '');              // 去掉末尾逗号
    try { return JSON.parse(jsonrepair(t)); } catch { return undefined; }
  };

  // 按优先级顺序尝试
  let result = repair1(s);
  if (!result) result = repair2(s);
  if (!result) result = repair3(s);
  if (!result) throw new Error("Could not parse AI response as JSON");

  return result;
}

// ─── POST /api/analyze — Frame analysis (vision) ────────────────
app.post("/api/analyze", async (req, res) => {
  try {
    const { image, pose, hands } = req.body;
    if (!image) return res.status(400).json({ error: "Missing image data" });

    // Ensure the image is a full data-url
    const imageUrl = image.startsWith("data:")
      ? image
      : `data:image/jpeg;base64,${image}`;

    let analysisPrompt = "根据指令分析这张攀爬图片。";
    const extra = [];
    if (pose) extra.push(`身体骨骼坐标（像素位置）：${pose}`);
    if (hands) extra.push(`手部数据：${hands}`);
    if (extra.length > 0) {
      analysisPrompt = `图片附带的实时数据——\n${extra.join('\n')}\n\n根据以上数据和图片，共同分析这张攀爬姿态。请同时输出 hold_positions 字段，列出图片中可见岩点的坐标和颜色。`;
    }

    const text = await zhipuChat(
      "glm-5v-turbo", // 视觉模型（升级：glm-4v-flash → glm-5v-turbo）
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text: analysisPrompt,
            },
          ],
        },
      ],
      SYSTEM_INSTRUCTION
    );

    const result = extractJSON(text);
    console.log("AI Analysis Result:", JSON.stringify(result, null, 2));

    // 字段补全：AI 可能只返回部分字段
    const safeResult = {
      markers: Array.isArray(result.markers) ? result.markers : [],
      instruction: result.instruction || '保持当前攀爬姿势。',
      detailed_feedback: result.detailed_feedback || '暂无详细反馈。',
      detected_route_color: result.detected_route_color || '',
      climb_status: ['moving', 'steady', 'stuck', 'falling', 'finished'].includes(result.climb_status) ? result.climb_status : 'steady',
      hold_positions: Array.isArray(result.hold_positions) ? result.hold_positions : [],
      climb_result: ['SUCCESS', 'FAIL', 'UNKNOWN'].includes(result.climb_result) ? result.climb_result : 'UNKNOWN',
    };

    res.json(safeResult);
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/route-guide — 图片上传路线分析 ──────────────
app.post("/api/route-guide", async (req, res) => {
  try {
    const { frames, prompt, model = "glm-5v-turbo" } = req.body;
    if (!frames || !frames.length || !prompt) {
      return res.status(400).json({ error: "缺少 frames 或 prompt" });
    }

    const contentArray: any[] = [{ type: "text", text: prompt }];
    for (const frame of frames) {
      const imgData = frame.dataUrl || frame.base64;
      const imgUrl = imgData.startsWith("data:")
        ? imgData
        : `data:image/jpeg;base64,${imgData}`;
      contentArray.push({
        type: "image_url",
        image_url: { url: imgUrl },
      });
    }

    const text = await zhipuChat(model, [
      { role: "user", content: contentArray }
    ]);

    const result = extractJSON(text);
    if (!result.steps) result.steps = [];
    if (!result.tips) result.tips = [];

    console.log("Route Guide Result:", JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error: any) {
    console.error("Route Guide Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/report — AI-powered session report ────────────────
const REPORT_SYSTEM_PROMPT = `你是一位专业的抱石教练。基于用户的攀爬训练数据，生成一份专业的训练评估报告。

### 常见错误模式与纠正方法

高阶错误（严重影响攀爬）：
- 膝盖内扣（E01）：膝盖向内旋，多见于高脚点时。纠正：外旋髋关节使膝盖朝前，降低重心。
- 手臂锁死（E02）：手臂长时间弯曲，前臂快速疲劳。纠正：直臂靠骨骼支撑，重量转到腿部。
- 重心偏移（E03）：身体重心偏离支撑面。纠正：臀部贴墙降低重心，对侧手脚配合发力。
- 贴墙过近/臀部远（E05）：臀部离墙太远。纠正：收紧核心，臀部贴近墙面减小力矩。
- 核心不收（E07）：腹部松弛身体晃动。纠正：收紧腹横肌，稳定核心再移手。
- 挂脚错误（E12）：heel/toe hook 角度不对。纠正：脚跟下压/脚背勾紧，髋关节打开发力。
- 脚点滑脱（E04）：脚趾没踩实。纠正：盯着看再踩，踩实了再移手。

中级错误（影响效率）：
- 肩部耸肩（E06）：没有沉肩。纠正：下沉肩胛骨再发力。
- 抓点过紧（E08）：手指过度紧张。纠正：放松到"刚好不掉"的力度。
- 视线错误（E10）：不看后面动作。纠正：每步后花1秒规划下个动作。
- 动态失控（E11）：跳跃时脚飞墙。纠正：蓄力再发，收腿发力而非用手拉。
- 未用 flagging（E15）：没有腿外摆平衡。纠正：外侧/内侧 flag 对抗重心偏移。
- drop knee 不当（E16）：横向移动没用扭膝。纠正：支撑腿膝盖下转贴近墙面。
- 呼吸节奏（E09）：憋气或急促。纠正：移动前吸、完成后呼。
- 换脚卡顿（E14）：换脚超3秒。纠正：先定新脚位再轻放旧脚。
- 节奏问题（E17）：全程匀速无休息。纠正：找休息点 shakeout 甩手。

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
    const { history, totalErrors, duration, difficulty } = req.body;

    const difficultyContext = difficulty
      ? `\n- 线路难度：${difficulty.grade}（类别：${difficulty.category === 'simple' ? '简单 V0-V2' : difficulty.category === 'medium' ? '中等 V3-V5' : '难 V6-V8+'}）\n注意：评分和建议要考虑难度级别。低难度线路动作要求严格，高难度线路适当宽容。`
      : '\n- 线路难度：未指定（默认按中等 V3-V5 评估）';

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
${difficultyContext}
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

    // 字段补全：AI 可能只返回部分字段，确保前端不会崩
    const safeResult = {
      overallScore: typeof result.overallScore === 'number' ? result.overallScore : 75,
      summary: result.summary || '本期训练整体表现良好，继续保持。',
      strengths: Array.isArray(result.strengths) ? result.strengths : ['整体姿态标准', '动作流畅度良好'],
      weaknesses: Array.isArray(result.weaknesses) ? result.weaknesses : ['建议保持专注'],
      improvements: Array.isArray(result.improvements) ? result.improvements : ['继续练习，保持良好的攀爬习惯'],
      trend: result.trend || '持续稳步进步中',
    };

    res.json(safeResult);
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

// ─── POST /api/analyze-async — Submit multi-frame async analysis ─
app.post("/api/analyze-async", async (req, res) => {
  try {
    const { frames, prompt, motion_metadata, model = "glm-5v-turbo" } = req.body;
    if (!frames || !frames.length || !prompt) {
      return res.status(400).json({ error: "缺少 frames 或 prompt" });
    }

    // 注入骨骼数据小抄
    let enrichedPrompt = prompt;
    if (motion_metadata?.arm_analysis_supplement?.length > 0) {
      const armLines = motion_metadata.arm_analysis_supplement
        .map((a: any) => {
          const parts = [`  [${a.timestamp}s]`];
          if (a.left_elbow_angle != null) parts.push(`左肘角:${a.left_elbow_angle}°`);
          if (a.right_elbow_angle != null) parts.push(`右肘角:${a.right_elbow_angle}°`);
          if (a.note) parts.push(`备注:${a.note}`);
          return parts.join(' | ');
        })
        .join('\n');
      enrichedPrompt += `\n\n### 骨骼检测数据（MediaPipe 实际测量，非推测）\n${armLines}\n`;
    }

    const contentArray: any[] = [{ type: "text", text: enrichedPrompt }];
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

    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/async/chat/completions", {
      method: "POST",
      headers: zhipuHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log(`[analyze-async] ✓ taskId: ${data.id}, status: ${data.task_status}`);
    res.json({ success: true, taskId: data.id });
  } catch (error: any) {
    console.error("[analyze-async] error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/query-result — Poll async task status ────────────
app.get("/api/query-result", async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ error: "缺少 taskId" });
  console.log(`[query-result] polling taskId: ${taskId}`);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(
      `https://open.bigmodel.cn/api/paas/v4/async-result/${taskId}`,
      { headers: { Authorization: `Bearer ${ZHIPU_API_KEY}` }, signal: controller.signal }
    );
    clearTimeout(timer);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    console.log(`[query-result] task_status: ${data.task_status}`);

    if (data.task_status === "SUCCESS") {
      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) {
        return res.json({ status: "SUCCESS", result: null });
      }
      // 去掉 Markdown 代码块包裹（```json ... ```）
      const cleaned = rawContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      try {
        return res.json({ status: "SUCCESS", result: JSON.parse(cleaned) });
      } catch {
        return res.json({ status: "SUCCESS", result: rawContent });
      }
    } else if (data.task_status === "FAIL") {
      return res.json({ status: "FAIL", error: data.error?.message || "AI 分析失败" });
    } else {
      return res.json({ status: "PROCESSING" });
    }
  } catch (error: any) {
    console.error("[query-result] error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/analyze-stream — 同步流式分析（服务端收流 → 单次返回） ─
app.post("/api/analyze-stream", async (req, res) => {
  try {
    const { frames, prompt, motion_metadata, model = "glm-5v-turbo" } = req.body;
    if (!frames || !frames.length || !prompt) {
      return res.status(400).json({ error: "缺少 frames 或 prompt" });
    }

    // 注入骨骼数据小抄
    let enrichedPrompt = prompt;
    if (motion_metadata?.arm_analysis_supplement?.length > 0) {
      const armLines = motion_metadata.arm_analysis_supplement
        .map((a: any) => {
          const parts = [`  [${a.timestamp}s]`];
          if (a.left_elbow_angle != null) parts.push(`左肘角:${a.left_elbow_angle}°`);
          if (a.right_elbow_angle != null) parts.push(`右肘角:${a.right_elbow_angle}°`);
          if (a.note) parts.push(`备注:${a.note}`);
          return parts.join(' | ');
        })
        .join('\n');
      enrichedPrompt += `\n\n### 骨骼检测数据（MediaPipe 实际测量，非推测）\n${armLines}\n`;
    }

    const contentArray: any[] = [{ type: "text", text: enrichedPrompt }];
    for (const frame of frames) {
      contentArray.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
      });
    }

    console.log(`[analyze-stream] 开始流式请求，${frames.length} 帧`);

    const body = {
      model,
      messages: [{ role: "user", content: contentArray }],
      stream: true,
    };

    // 智谱 429 重试（指数退避，最多 5 次，最长等 40s）
    let zhipuRes: Response | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      zhipuRes = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: zhipuHeaders(),
        body: JSON.stringify(body),
      });
      if (zhipuRes.ok || zhipuRes.status !== 429) break;
      const waitMs = Math.min(3e3 * Math.pow(2, attempt - 1), 40e3);
      console.warn(`[analyze-stream] 智谱 429 限流 (attempt ${attempt}/5), 等待 ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    if (!zhipuRes || !zhipuRes.ok) {
      const errStatus = zhipuRes?.status ?? 0;
      const errText = zhipuRes ? await zhipuRes.text().catch(() => '') : '';
      console.error(`[analyze-stream] Zhipu API ${errStatus}: ${errText.slice(0, 200)}`);
      return res.status(502).json({ error: `智谱 API ${errStatus}` });
    }

    // 服务端收流：读取智谱 SSE 流，实时转发给前端
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const reader = zhipuRes.body?.getReader();
    if (!reader) {
      return res.status(502).json({ error: "无法读取响应流" });
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let parsed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: !done });

      // 逐行解析 SSE data: {...}
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') { parsed = true; continue; }
        try {
          const event = JSON.parse(dataStr);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            parsed = true;
            // 实时转发给前端：每段文字增量
            res.write(`data: ${JSON.stringify({ __delta: true, text: delta })}\n\n`);
          }
        } catch { /* 跳过无法解析的行 */ }
      }
    }

    console.log(`[analyze-stream] 流式完成, 收到 ${fullContent.length} 字符, 已解析=${parsed}`);

    // 尝试提取 JSON（AI 有时会在 JSON 前后加额外说明文字）
    let finalContent = fullContent.trim();
    // 去掉 markdown 代码块包裹
    finalContent = finalContent.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    // 提取 { ... } 之间的部分
    const firstBrace = finalContent.indexOf('{');
    const lastBrace = finalContent.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      finalContent = finalContent.slice(firstBrace, lastBrace + 1);
    }

    // 发送完整 JSON + 结束标志
    res.write(`data: ${JSON.stringify({ __complete: true, content: finalContent, parsed })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error: any) {
    console.error("[analyze-stream] error:", error.message);
    // 如果 headers 已经发送了，只能尝试写错误事件
    try {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {
      res.status(500).json({ error: error.message });
    }
  }
});

// ─── Vite dev server / static serve ─────────────────────────────
async function startServer() {
  // 自动判断：scriptDir 下 index.html 存在 → production（express.static），否则 dev（Vite 中间件）
  const isProduction = fs.existsSync(path.join(scriptDir, "index.html"));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(scriptDir));
    app.get("*", (req, res) => {
      res.sendFile(path.join(scriptDir, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("Zhipu AI key: ✓ hardcoded");
  });
}

startServer();
