// GET /.netlify/functions/query-result?taskId=xxx
// 轮询异步任务 → 返回当前状态/结果
import { ZHIPU_API_KEY, corsHeaders } from "./_shared.mjs";

export async function handler(event) {
  const { taskId } = event.queryStringParameters || {};
  if (!taskId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "缺少 taskId" }),
    };
  }

  try {
    const res = await fetch(
      `https://open.bigmodel.cn/api/paas/v4/async-result/${taskId}`,
      {
        headers: { Authorization: `Bearer ${ZHIPU_API_KEY}` },
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        statusCode: res.status,
        headers: corsHeaders,
        body: JSON.stringify({ error: err.error?.message || `HTTP ${res.status}` }),
      };
    }

    const data = await res.json();

    if (data.task_status === "SUCCESS") {
      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ status: "SUCCESS", result: null }),
        };
      }
      // 去除 Markdown 代码块包裹（```json ... ```）
      const cleaned = rawContent.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      try {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({
            status: "SUCCESS",
            result: JSON.parse(cleaned),
          }),
        };
      } catch {
        // 非纯 JSON 则原样返回
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ status: "SUCCESS", result: rawContent }),
        };
      }
    } else if (data.task_status === "FAIL") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          status: "FAIL",
          error: data.error?.message || "AI 分析失败",
        }),
      };
    } else {
      // PROCESSING / PENDING
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ status: "PROCESSING" }),
      };
    }
  } catch (error) {
    console.error("[query-result] error:", error.message);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: error.message }),
    };
  }
}
