// Shared utilities for Bouldering AI Coach Netlify Functions
export const ZHIPU_API_KEY = "131e668c102648f483a65408ea3a60c5.X8wsvYZ6kck7dPUg";
export const ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";

export const SYSTEM_INSTRUCTION = `你是一位专业的抱石教练。
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
- 「label」字段：纯中文，如「膝盖内扣」，不要写「knee inward」
- 「description」字段：纯中文
- 「instruction」字段：纯中文，不超过20个字
- 「detailed_feedback」字段：纯中文，150字以内
- 「detected_route_color」字段：纯中文，如「红色」「蓝色」
- 不允许在以上字段中出现任何英文字母或英文标点

JSON 字段名本身（markers、type、label 等）保留英文，这是格式要求，不违反纯中文规则。

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
