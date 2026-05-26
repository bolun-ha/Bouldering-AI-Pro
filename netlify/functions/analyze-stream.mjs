// POST /.netlify/functions/analyze-stream — Multi-frame analysis via GLM-5V-Turbo (Netlify)
import { zhipuChat, extractJSON, corsHeaders, handleOptions } from "./_shared.mjs";

const STREAM_SYSTEM_PROMPT = `# Role
你是一名国家级专业抱石攀岩教练兼比赛主裁判。请分析输入的攀岩截图，进行深度、连贯的复盘。

# Core Philosophy
攀岩是时序连贯的艺术，禁止孤立的单帧误判。

## 终局裁判
[SUCCESS 完攀] 双手同时出现在墙体顶端终点（Top Hold）位置即判定完攀，不要求保持帧数，无需关注下墙姿态
[FAIL 坠落] 必须有明确失控证据（四肢失衡脱离岩墙），单凭"未观察到合分"不能判 FAIL
[UNKNOWN 默认] 既未确认合分成功，也无明确失控坠落证据

# 输出结构
评估维度（重要顺序）：
1. 手部问题（抓握方式、手指过度紧张、握点位置不合理）
2. 手臂状态（直臂挂肉省力 / 屈臂死锁费体能 / 顶端控制 KPI）
3. 下肢（膝盖内扣、脚点踩实、腿位平衡）
4. 核心与重心（是否收紧、是否偏出支撑面）
5. 整体节奏与策略

# JSON 输出格式
{
  "phases": [{"name": "Start|Transition|Crux|Finish", "start_time": 秒, "end_time": 秒, "description": "中文"}],
  "issues": [{"timestamp": 秒, "issue_type": "中文问题名", "severity": "high|mid|low", "suggestion": "中文建议", "correction_keywords": ["中文关键词"], "bbox": {"xmin": 0-1000, "ymin": 0-1000, "xmax": 0-1000, "ymax": 0-1000}}],
  "overall_score": 0-100整数,
  "summary": "一句话总评",
  "strengths": ["做得好的中文列表"],
  "improvements": ["需改进的中文列表"],
  "climb_result": "SUCCESS|FAIL|UNKNOWN",
  "end_game_reason": "裁判依据",
  "top_control_score": 0-100整数,
  "top_hand_match_status": "perfect_match|struggling_match|no_match"
}`;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { frames, prompt, motion_metadata } = body;
    if (!frames || !frames.length) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Missing frames" }) };
    }

    const systemPrompt = prompt || STREAM_SYSTEM_PROMPT;

    // Build content array: text + images
    const contentArray = [{ type: "text", text: systemPrompt }];
    for (const frame of frames) {
      contentArray.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
      });
    }

    const text = await zhipuChat(
      "glm-5v-turbo",
      [{ role: "user", content: contentArray }],
      null, // system already in user content
    );

    const result = extractJSON(text);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(result) };
  } catch (error) {
    console.error("analyze-stream Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
