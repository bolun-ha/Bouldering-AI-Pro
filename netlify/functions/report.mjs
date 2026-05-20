// POST /.netlify/functions/report — Session report via GLM-4-Flash
import { zhipuChat, extractJSON, corsHeaders, handleOptions } from "./_shared.mjs";

const REPORT_SYSTEM_PROMPT = `你是一位经验丰富的专业抱石教练。基于用户的攀爬训练数据（含 AI 逐帧分析结果），生成一份一份具体、到位的训练评估报告。

要求：
- **必须具体**：引用标记信息（如"重心偏左""手臂锁死"等），不要笼统说"动作需要改善"
- **必须引用时间点**：用 AI 分析帧中的标记数据说明具体问题发生在哪些动作
- **每个弱点/建议都要有对应证据**：基于标记数据给出针对性建议
- 评估要实用：用户看完知道该练什么、怎么改
- 语气专业但亲切，像真的教练在陪练

请严格按照以下 JSON 格式返回，不要包含任何其他文字或注释：

{"overallScore": 整数0-100, "summary": "中文摘要", "strengths": ["中文优点"], "weaknesses": ["中文弱点"], "improvements": ["中文建议"], "trend": "中文趋势"}`;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { history, totalErrors, duration } = JSON.parse(event.body || "{}");

    // 构建包含标记数据的帧摘要
    const framesSummary = (history || [])
      .map((h, i) => {
        const markerLabels = (h.markers || []).map(m => `${m.type === 'error' ? '❌' : m.type === 'warning' ? '⚠️' : m.type === 'success' ? '✅' : '💡'}${m.label || ''}${m.description ? ': ' + m.description : ''}`).join('; ');
        return `[帧${i + 1}] 状态:${h.climb_status || "未知"} 反馈:${h.detailed_feedback || "无"} 指令:${h.instruction || "无"} 线路:${h.detected_route_color || "未知"} 标记:${markerLabels || "无"}`;
      })
      .join("\n");

    const userPrompt = `攀爬数据报告生成：
- 攀爬时长: ${duration || 0}秒
- 总错误/建议数: ${totalErrors || 0}
- AI 分析帧数: ${(history || []).length}

逐帧分析结果（含 AI 标记标注）：
${framesSummary || "无数据"}

请给出具体、量化的训练评估。以下是一个好报告的例子（仿照其风格但不要照搬内容）：
- 优点要说具体："第3秒的勾脚动作控制得很好，重心低且稳定"
- 弱点要引数据："第5帧和第10帧都出现了右膝内扣（标记: 膝盖过直），说明右腿发力模式有问题"
- 建议要可执行："在平地上练习单腿深蹲，改善右腿发力时的膝盖稳定性"

字段名必须用英文，值用中文。`;

    const text = await zhipuChat("glm-4-flash", [{ role: "user", content: userPrompt }], REPORT_SYSTEM_PROMPT);
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(extractJSON(text)) };
  } catch (error) {
    console.error("report Error:", error.message);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
}
