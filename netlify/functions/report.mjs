// POST /.netlify/functions/report — Session report via GLM-4-Flash
import { zhipuChat, extractJSON, corsHeaders, handleOptions } from "./_shared.mjs";

const REPORT_SYSTEM_PROMPT = `你是一位专业的抱石教练。基于用户的攀爬训练数据，生成一份专业的训练评估报告。

请分析用户提供的攀爬数据，考虑以下维度：
1. 整体表现评分（0-100）
2. 训练摘要（客观评价整段表现）
3. 优点（2-3 个具体方面）
4. 需要改进的弱点（2-3 个具体方面）
5. 针对性的训练改进建议（2-3 条）
6. 趋势分析（如果数据点足够多）

必须严格返回 JSON 格式，不要包含任何其他文字。`;

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
请严格按照 JSON 格式生成专业训练报告。`;

    const text = await zhipuChat("glm-4-flash", [{ role: "user", content: userPrompt }], REPORT_SYSTEM_PROMPT);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(extractJSON(text)) };
  } catch (error) {
    console.error("report Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
