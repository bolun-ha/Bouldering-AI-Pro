// POST /.netlify/functions/report — Session report via GLM-4-Flash
import { zhipuChat, extractJSON, corsHeaders, handleOptions } from "./_shared.mjs";

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

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { history, totalErrors, duration } = JSON.parse(event.body || "{}");

    const framesSummary = (history || [])
      .map((h, i) =>
        `[帧${i + 1}] 状态:${h.climb_status || "未知"} 反馈:${h.detailed_feedback || "无"} 指令:${h.instruction || "无"} 线路:${h.detected_route_color || "未知"}`
      )
      .join("\n");

    const userPrompt = `攀爬数据报告生成：
- 攀爬时长: ${duration || 0}秒
- 总错误/建议数: ${totalErrors || 0}
- AI 分析帧数: ${(history || []).length}
- 逐帧分析:
${framesSummary || "无数据"}

请严格按照以下 JSON 格式返回专业训练报告：
{"overallScore": 整数0-100, "summary": "中文摘要", "strengths": ["中文优点"], "weaknesses": ["中文弱点"], "improvements": ["中文建议"], "trend": "中文趋势"}

字段名必须用英文，值用中文。`;

    const text = await zhipuChat("glm-4-flash", [{ role: "user", content: userPrompt }], REPORT_SYSTEM_PROMPT);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(extractJSON(text)) };
  } catch (error) {
    console.error("report Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
