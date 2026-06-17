var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_vite = require("vite");
var import_dotenv = __toESM(require("dotenv"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_jsonrepair = require("jsonrepair");
import_dotenv.default.config();
var scriptDir = import_path.default.dirname(process.argv[1] || "");
if (import_fs.default.existsSync("/var/www/Bouldering-AI-Pro/dist/index.html")) {
  scriptDir = "/var/www/Bouldering-AI-Pro/dist";
}
var app = (0, import_express.default)();
var PORT = 3003;
app.use(import_express.default.json({ limit: "10mb" }));
var ZHIPU_API_KEY = "131e668c102648f483a65408ea3a60c5.X8wsvYZ6kck7dPUg";
var ZHIPU_BASE = "https://open.bigmodel.cn/api/paas/v4";
function zhipuHeaders() {
  return {
    Authorization: `Bearer ${ZHIPU_API_KEY}`,
    "Content-Type": "application/json"
  };
}
var SYSTEM_INSTRUCTION = `# Role
\u4F60\u662F\u4E00\u540D\u56FD\u5BB6\u7EA7\u4E13\u4E1A\u62B1\u77F3\u6500\u5CA9\u6559\u7EC3\u517C\u6BD4\u8D5B\u4E3B\u88C1\u5224\u3002\u8BF7\u5206\u6790\u8F93\u5165\u7684\u6500\u5CA9\u56FE\u7247\uFF0C\u7ED3\u5408 MediaPipe \u9AA8\u9ABC\u68C0\u6D4B\u6570\u636E\uFF08\u5982\u679C\u63D0\u4F9B\uFF09\uFF0C\u8FDB\u884C\u6DF1\u5EA6\u3001\u8FDE\u8D2F\u7684\u590D\u76D8\u3002

# Core Philosophy
\u6500\u5CA9\u662F\u65F6\u5E8F\u8FDE\u8D2F\u7684\u827A\u672F\uFF0C\u7981\u6B62\u5B64\u7ACB\u7684\u5355\u5E27\u8BEF\u5224\u3002

## \u7EC8\u5C40\u88C1\u5224\u4E0E\u9876\u7AEF\u63A7\u5236\u89C4\u8303
\u5982\u679C\u4F60\u5224\u5B9A\u7528\u6237\u5DF2\u5904\u4E8E\u6500\u722C\u7EC8\u5C40\uFF08\u5373\u5C06\u6478\u5230\u9876\u70B9\u6216\u5B8C\u6210\u5408\u5206\uFF09\uFF0C\u6309\u4EE5\u4E0B\u89C4\u5219\u5224\u5B9A\uFF1A

[SUCCESS \u5B8C\u6500] \u53CC\u624B\u540C\u65F6\u51FA\u73B0\u5728\u5899\u4F53\u9876\u7AEF\u7EC8\u70B9\uFF08Top Hold\uFF09\u4F4D\u7F6E\u5373\u5224\u5B9A\u5B8C\u6500\uFF0C\u4E0D\u8981\u6C42\u4FDD\u6301\u5E27\u6570\uFF0C\u65E0\u9700\u5173\u6CE8\u4E0B\u5899\u59FF\u6001
[FAIL \u5760\u843D] \u672A\u5B8C\u6210\u5408\u5206\u65F6\u8EAB\u4F53\u5931\u63A7\u4F4D\u79FB\u3001\u6454\u5411\u57AB\u5B50
[UNKNOWN] \u4E3B\u52A8\u4E0B\u5899\uFF0C\u65E0\u6478\u9876\u4E5F\u65E0\u5760\u843D

# \u8F93\u51FA\u7ED3\u6784

\u4F60\u8F93\u51FA\u7684\u6570\u636E\u4F1A\u7528\u4E8E\u4E24\u4E2A\u7528\u9014\uFF1A
1. **\u5B9E\u65F6\u6307\u5BFC**\uFF08instruction \u5B57\u6BB5\uFF09\u2014 \u7B80\u77ED\u884C\u52A8\u6307\u4EE4\uFF0C\u8BED\u97F3\u64AD\u62A5\u7ED9\u6B63\u5728\u6500\u722C\u7684\u7528\u6237
2. **\u4E8B\u540E\u62A5\u544A**\uFF08detailed_feedback + markers \u5B57\u6BB5\uFF09\u2014 \u5B58\u5165\u8BAD\u7EC3\u62A5\u544A\uFF0C\u7528\u6237\u4E8B\u540E\u67E5\u770B\u52A8\u4F5C\u7EA0\u6B63

\u56E0\u6B64\u8BF7\u5BF9\u4E24\u7C7B\u5B57\u6BB5\u533A\u522B\u5BF9\u5F85\uFF1A

### instruction\uFF08\u5B9E\u65F6\u6307\u5BFC\uFF09
\u7B80\u77ED\u76F4\u63A5\u7684\u884C\u52A8\u6307\u4EE4\uFF0C\u4E0D\u8D85\u8FC720\u4E2A\u5B57\uFF0C\u9002\u914D\u8BED\u97F3\u64AD\u62A5\u3002
- \u4F18\u5148\u7ED9\u51FA\u6293\u63E1\u70B9\u6307\u4EE4\uFF0C\u542B\u65B9\u5411+\u8DDD\u79BB+\u5F62\u72B6+\u624B\u811A
- \u5982\u679C\u59FF\u6001\u4E0D\u7A33\uFF0C\u5148\u7ED9\u59FF\u6001\u7EA0\u6B63\u518D\u7ED9\u6293\u63E1\u5EFA\u8BAE

### detailed_feedback\uFF08\u4E8B\u540E\u52A8\u4F5C\u7EA0\u6B63\u5206\u6790\uFF09
**\u5B57\u6570\u9650\u5236\uFF1A150 \u5B57\u4EE5\u5185**\u3002\u9700\u8981\u5177\u4F53\u63CF\u8FF0\u8FD9\u5E27\u4E2D\u6500\u722C\u8005\u8EAB\u4F53\u59FF\u6001\u7684\u95EE\u9898\u6216\u4F18\u70B9\uFF1A
- \u8EAB\u4F53\u54EA\u4E2A\u90E8\u4F4D\u6709\u95EE\u9898\uFF08\u819D\u76D6/\u9ACB\u5173\u8282/\u80A9\u8180/\u624B\u8155/\u811A\u4F4D/\u91CD\u5FC3\uFF09
- \u5177\u4F53\u4EC0\u4E48\u95EE\u9898\uFF08\u5185\u6263/\u5916\u7FFB/\u8FC7\u76F4/\u8FC7\u9AD8/\u504F\u79FB/\u6CA1\u8E29\u5B9E\uFF09
- \u5EFA\u8BAE\u600E\u4E48\u6539\uFF08\u5916\u65CB\u9ACB\u5173\u8282/\u964D\u4F4E\u91CD\u5FC3/\u6362\u811A/\u6536\u7D27\u6838\u5FC3\uFF09

### \u6807\u8BB0\u7CFB\u7EDF\uFF08markers\uFF09
markers \u7528\u4E8E\u5728\u56FE\u7247\u4E0A\u6807\u6CE8\u5173\u952E\u4F4D\u7F6E\u3002\u6BCF\u4E2A\u6807\u8BB0\u5305\u542B\uFF1A
- type\uFF1Aerror\uFF08\u9519\u8BEF\uFF09/ warning\uFF08\u8B66\u544A\uFF09/ success\uFF08\u6B63\u786E\uFF09/ info\uFF08\u63D0\u793A\uFF09
- label\uFF1A\u77ED\u7684\u6807\u7B7E\u540D\uFF08\u5982"\u819D\u76D6\u5185\u6263""\u91CD\u5FC3\u504F\u5DE6""\u624B\u81C2\u8FC7\u76F4"\uFF09
- description\uFF1A\u8BE6\u7EC6\u63CF\u8FF0
\u6807\u8BB0\u89C4\u5219\uFF1A\u6570\u91CF\u4E25\u683C\u9650\u5236\u5728 5 \u4E2A\u4EE5\u5185\uFF0C\u6807\u6CE8\u4F4D\u7F6E\u6307\u5411\u5177\u4F53\u8EAB\u4F53\u90E8\u4F4D\u3002

### \u5178\u578B\u9519\u8BEF\u6A21\u5F0F\u53C2\u8003
\u9AD8\u9636\u9519\u8BEF\uFF1A\u819D\u76D6\u5185\u6263\uFF08\u5916\u65CB\u7EA0\u6B63\uFF09\u3001\u624B\u81C2\u9501\u6B7B\uFF08\u76F4\u81C2\u652F\u6491\uFF09\u3001\u91CD\u5FC3\u504F\uFF08\u964D\u91CD\u5FC3\uFF09\u3001\u811A\u70B9\u6ED1\u8131\uFF08\u8E29\u5B9E\u518D\u79FB\u624B\uFF09\u3001\u6838\u5FC3\u6CA1\u6536\u7D27\uFF08\u6536\u7D27\u8179\u6A2A\u808C\uFF09\u3001\u6302\u811A\u9519\u8BEF\uFF08\u811A\u8DDF\u4E0B\u538B/\u811A\u5C16\u52FE\u7D27\uFF09\u3001\u52A8\u6001\u5931\u63A7\uFF08\u84C4\u529B\u6536\u817F\uFF09
\u4E2D\u7EA7\u9519\u8BEF\uFF1A\u80A9\u90E8\u8038\u80A9\uFF08\u6C89\u80A9\uFF09\u3001\u6293\u70B9\u8FC7\u7D27\uFF08\u653E\u677E\uFF09\u3001\u89C6\u7EBF\u9519\u8BEF\uFF08\u63D0\u524D\u89C4\u5212\uFF09\u3001\u672A\u7528 flagging\uFF08\u817F\u5916\u6446\u5E73\u8861\uFF09\u3001drop knee \u4E0D\u5F53\uFF08\u652F\u6491\u819D\u4E0B\u8F6C\uFF09\u3001\u547C\u5438\u618B\u6C14\uFF08\u79FB\u52A8\u524D\u5438\u5B8C\u6210\u540E\u547C\uFF09

### \u7EAF\u4E2D\u6587\u8981\u6C42
**\u6CE8\u610F\uFF1A\u4EE5\u4E0B\u6240\u6709\u5B57\u6BB5\u7684\u503C\u5FC5\u987B\u4F7F\u7528\u7EAF\u4E2D\u6587\uFF0C\u4E0D\u5141\u8BB8\u51FA\u73B0\u82F1\u6587\u5355\u8BCD\uFF1A**
- \u300Clabel\u300D\u300Cdescription\u300D\u300Cinstruction\u300D\u300Cdetailed_feedback\u300D\u300Cdetected_route_color\u300D\u5B57\u6BB5\u5747\u4F7F\u7528\u7EAF\u4E2D\u6587
- JSON \u5B57\u6BB5\u540D\u672C\u8EAB\uFF08markers\u3001type\u3001label \u7B49\uFF09\u4FDD\u7559\u82F1\u6587\uFF0C\u8FD9\u662F\u683C\u5F0F\u8981\u6C42

### \u7EBF\u8DEF\u89C4\u5219
- \u9996\u5148\u89C2\u5BDF\u6500\u722C\u8005\u63A5\u89E6\u6216\u8E29\u8E0F\u7684\u652F\u70B9\u989C\u8272\uFF0C\u4EE5\u6B64\u786E\u5B9A\u672C\u6B21\u6500\u722C\u7684\u76EE\u6807\u989C\u8272\u7EBF\u8DEF
- success \u6807\u8BB0\u5FC5\u987B\u4E25\u683C\u9650\u5B9A\u5728\u8BE5\u989C\u8272\u7CFB\u5217\u7684\u652F\u70B9\u4E0A

### \u5206\u6790\u903B\u8F91
\u5206\u6790\u6500\u722C\u8005\u5F53\u524D\u8EAB\u4F53\u4F4D\u7F6E\uFF08\u624B\u5728\u54EA\u3001\u811A\u5728\u54EA\u3001\u91CD\u5FC3\u5728\u54EA\uFF09\uFF0C\u7136\u540E\u5224\u65AD\u4E0B\u4E00\u4E2A\u652F\u70B9\u5728\u4EC0\u4E48\u65B9\u5411\u3001\u8DDD\u79BB\u591A\u8FDC\u3001\u5F62\u72B6\u5982\u4F55\u3001\u7528\u54EA\u53EA\u624B\u811A\u6700\u5408\u7406\u3002

# JSON \u8F93\u51FA\u683C\u5F0F
{
  "markers": [{"x": 0-100, "y": 0-100, "type": "error|warning|info|success", "label": "\u4E2D\u6587\u6807\u7B7E", "description": "\u4E2D\u6587\u63CF\u8FF0"}],
  "instruction": "\u7EAF\u4E2D\u6587\u7B80\u77ED\u884C\u52A8\u6307\u4EE4",
  "detected_route_color": "\u7EAF\u4E2D\u6587\u989C\u8272",
  "detailed_feedback": "\u7EAF\u4E2D\u6587\u59FF\u6001\u53CD\u9988\uFF08150\u5B57\u5185\uFF09",
  "climb_status": "moving|steady|stuck|falling|finished",
  "climb_result": "SUCCESS|FAIL|UNKNOWN",
  "end_game_reason": "\u7EC8\u5C40\u88C1\u5224\u4F9D\u636E",
  "top_control_score": 0-100\u6574\u6570,
  "top_hand_match_status": "perfect_match|struggling_match|no_match",
  "hold_positions": [{"x": 0-100, "y": 0-100, "color": "\u7EAF\u4E2D\u6587", "type": "\u7EAF\u4E2D\u6587", "used": true/false}]
}`;
async function zhipuChat(model, messages, systemInstruction) {
  const body = { model, messages };
  if (systemInstruction) {
    body.messages = [{ role: "system", content: systemInstruction }, ...messages];
  }
  let response = await fetch(`${ZHIPU_BASE}/chat/completions`, {
    method: "POST",
    headers: zhipuHeaders(),
    body: JSON.stringify(body)
  });
  for (let attempt = 1; response.status === 429 && attempt <= 3; attempt++) {
    const waitMs = Math.min(2e3 * Math.pow(2, attempt - 1), 8e3);
    console.warn(`Zhipu 429 rate limited (attempt ${attempt}/3), waiting ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
    response = await fetch(`${ZHIPU_BASE}/chat/completions`, {
      method: "POST",
      headers: zhipuHeaders(),
      body: JSON.stringify(body)
    });
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Zhipu API error (${response.status}): ${typeof data === "object" ? JSON.stringify(data.error || data) : data}`
    );
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Empty response from Zhipu AI");
  return text;
}
function extractJSON(text) {
  let s = text.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    try {
      return JSON.parse((0, import_jsonrepair.jsonrepair)(s));
    } catch {
      const match = s.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse((0, import_jsonrepair.jsonrepair)(match[0]));
        } catch {
          return JSON.parse(match[0]);
        }
      }
      throw new Error("Could not parse AI response as JSON");
    }
  }
}
app.post("/api/analyze", async (req, res) => {
  try {
    const { image, pose, hands } = req.body;
    if (!image) return res.status(400).json({ error: "Missing image data" });
    const imageUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
    let analysisPrompt = "\u6839\u636E\u6307\u4EE4\u5206\u6790\u8FD9\u5F20\u6500\u722C\u56FE\u7247\u3002";
    const extra = [];
    if (pose) extra.push(`\u8EAB\u4F53\u9AA8\u9ABC\u5750\u6807\uFF08\u50CF\u7D20\u4F4D\u7F6E\uFF09\uFF1A${pose}`);
    if (hands) extra.push(`\u624B\u90E8\u6570\u636E\uFF1A${hands}`);
    if (extra.length > 0) {
      analysisPrompt = `\u56FE\u7247\u9644\u5E26\u7684\u5B9E\u65F6\u6570\u636E\u2014\u2014
${extra.join("\n")}

\u6839\u636E\u4EE5\u4E0A\u6570\u636E\u548C\u56FE\u7247\uFF0C\u5171\u540C\u5206\u6790\u8FD9\u5F20\u6500\u722C\u59FF\u6001\u3002\u8BF7\u540C\u65F6\u8F93\u51FA hold_positions \u5B57\u6BB5\uFF0C\u5217\u51FA\u56FE\u7247\u4E2D\u53EF\u89C1\u5CA9\u70B9\u7684\u5750\u6807\u548C\u989C\u8272\u3002`;
    }
    const text = await zhipuChat(
      "glm-5v-turbo",
      // 视觉模型（升级：glm-4v-flash → glm-5v-turbo）
      [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            {
              type: "text",
              text: analysisPrompt
            }
          ]
        }
      ],
      SYSTEM_INSTRUCTION
    );
    const result = extractJSON(text);
    console.log("AI Analysis Result:", JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ error: error.message });
  }
});
var REPORT_SYSTEM_PROMPT = `\u4F60\u662F\u4E00\u4F4D\u4E13\u4E1A\u7684\u62B1\u77F3\u6559\u7EC3\u3002\u57FA\u4E8E\u7528\u6237\u7684\u6500\u722C\u8BAD\u7EC3\u6570\u636E\uFF0C\u751F\u6210\u4E00\u4EFD\u4E13\u4E1A\u7684\u8BAD\u7EC3\u8BC4\u4F30\u62A5\u544A\u3002

### \u5E38\u89C1\u9519\u8BEF\u6A21\u5F0F\u4E0E\u7EA0\u6B63\u65B9\u6CD5

\u9AD8\u9636\u9519\u8BEF\uFF08\u4E25\u91CD\u5F71\u54CD\u6500\u722C\uFF09\uFF1A
- \u819D\u76D6\u5185\u6263\uFF08E01\uFF09\uFF1A\u819D\u76D6\u5411\u5185\u65CB\uFF0C\u591A\u89C1\u4E8E\u9AD8\u811A\u70B9\u65F6\u3002\u7EA0\u6B63\uFF1A\u5916\u65CB\u9ACB\u5173\u8282\u4F7F\u819D\u76D6\u671D\u524D\uFF0C\u964D\u4F4E\u91CD\u5FC3\u3002
- \u624B\u81C2\u9501\u6B7B\uFF08E02\uFF09\uFF1A\u624B\u81C2\u957F\u65F6\u95F4\u5F2F\u66F2\uFF0C\u524D\u81C2\u5FEB\u901F\u75B2\u52B3\u3002\u7EA0\u6B63\uFF1A\u76F4\u81C2\u9760\u9AA8\u9ABC\u652F\u6491\uFF0C\u91CD\u91CF\u8F6C\u5230\u817F\u90E8\u3002
- \u91CD\u5FC3\u504F\u79FB\uFF08E03\uFF09\uFF1A\u8EAB\u4F53\u91CD\u5FC3\u504F\u79BB\u652F\u6491\u9762\u3002\u7EA0\u6B63\uFF1A\u81C0\u90E8\u8D34\u5899\u964D\u4F4E\u91CD\u5FC3\uFF0C\u5BF9\u4FA7\u624B\u811A\u914D\u5408\u53D1\u529B\u3002
- \u8D34\u5899\u8FC7\u8FD1/\u81C0\u90E8\u8FDC\uFF08E05\uFF09\uFF1A\u81C0\u90E8\u79BB\u5899\u592A\u8FDC\u3002\u7EA0\u6B63\uFF1A\u6536\u7D27\u6838\u5FC3\uFF0C\u81C0\u90E8\u8D34\u8FD1\u5899\u9762\u51CF\u5C0F\u529B\u77E9\u3002
- \u6838\u5FC3\u4E0D\u6536\uFF08E07\uFF09\uFF1A\u8179\u90E8\u677E\u5F1B\u8EAB\u4F53\u6643\u52A8\u3002\u7EA0\u6B63\uFF1A\u6536\u7D27\u8179\u6A2A\u808C\uFF0C\u7A33\u5B9A\u6838\u5FC3\u518D\u79FB\u624B\u3002
- \u6302\u811A\u9519\u8BEF\uFF08E12\uFF09\uFF1Aheel/toe hook \u89D2\u5EA6\u4E0D\u5BF9\u3002\u7EA0\u6B63\uFF1A\u811A\u8DDF\u4E0B\u538B/\u811A\u80CC\u52FE\u7D27\uFF0C\u9ACB\u5173\u8282\u6253\u5F00\u53D1\u529B\u3002
- \u811A\u70B9\u6ED1\u8131\uFF08E04\uFF09\uFF1A\u811A\u8DBE\u6CA1\u8E29\u5B9E\u3002\u7EA0\u6B63\uFF1A\u76EF\u7740\u770B\u518D\u8E29\uFF0C\u8E29\u5B9E\u4E86\u518D\u79FB\u624B\u3002

\u4E2D\u7EA7\u9519\u8BEF\uFF08\u5F71\u54CD\u6548\u7387\uFF09\uFF1A
- \u80A9\u90E8\u8038\u80A9\uFF08E06\uFF09\uFF1A\u6CA1\u6709\u6C89\u80A9\u3002\u7EA0\u6B63\uFF1A\u4E0B\u6C89\u80A9\u80DB\u9AA8\u518D\u53D1\u529B\u3002
- \u6293\u70B9\u8FC7\u7D27\uFF08E08\uFF09\uFF1A\u624B\u6307\u8FC7\u5EA6\u7D27\u5F20\u3002\u7EA0\u6B63\uFF1A\u653E\u677E\u5230"\u521A\u597D\u4E0D\u6389"\u7684\u529B\u5EA6\u3002
- \u89C6\u7EBF\u9519\u8BEF\uFF08E10\uFF09\uFF1A\u4E0D\u770B\u540E\u9762\u52A8\u4F5C\u3002\u7EA0\u6B63\uFF1A\u6BCF\u6B65\u540E\u82B11\u79D2\u89C4\u5212\u4E0B\u4E2A\u52A8\u4F5C\u3002
- \u52A8\u6001\u5931\u63A7\uFF08E11\uFF09\uFF1A\u8DF3\u8DC3\u65F6\u811A\u98DE\u5899\u3002\u7EA0\u6B63\uFF1A\u84C4\u529B\u518D\u53D1\uFF0C\u6536\u817F\u53D1\u529B\u800C\u975E\u7528\u624B\u62C9\u3002
- \u672A\u7528 flagging\uFF08E15\uFF09\uFF1A\u6CA1\u6709\u817F\u5916\u6446\u5E73\u8861\u3002\u7EA0\u6B63\uFF1A\u5916\u4FA7/\u5185\u4FA7 flag \u5BF9\u6297\u91CD\u5FC3\u504F\u79FB\u3002
- drop knee \u4E0D\u5F53\uFF08E16\uFF09\uFF1A\u6A2A\u5411\u79FB\u52A8\u6CA1\u7528\u626D\u819D\u3002\u7EA0\u6B63\uFF1A\u652F\u6491\u817F\u819D\u76D6\u4E0B\u8F6C\u8D34\u8FD1\u5899\u9762\u3002
- \u547C\u5438\u8282\u594F\uFF08E09\uFF09\uFF1A\u618B\u6C14\u6216\u6025\u4FC3\u3002\u7EA0\u6B63\uFF1A\u79FB\u52A8\u524D\u5438\u3001\u5B8C\u6210\u540E\u547C\u3002
- \u6362\u811A\u5361\u987F\uFF08E14\uFF09\uFF1A\u6362\u811A\u8D853\u79D2\u3002\u7EA0\u6B63\uFF1A\u5148\u5B9A\u65B0\u811A\u4F4D\u518D\u8F7B\u653E\u65E7\u811A\u3002
- \u8282\u594F\u95EE\u9898\uFF08E17\uFF09\uFF1A\u5168\u7A0B\u5300\u901F\u65E0\u4F11\u606F\u3002\u7EA0\u6B63\uFF1A\u627E\u4F11\u606F\u70B9 shakeout \u7529\u624B\u3002

\u8BF7\u4E25\u683C\u6309\u7167\u4EE5\u4E0B JSON \u683C\u5F0F\u8FD4\u56DE\uFF0C\u4E0D\u8981\u5305\u542B\u4EFB\u4F55\u5176\u4ED6\u6587\u5B57\u6216\u6CE8\u91CA\uFF1A

{"overallScore": 80, "summary": "\u6458\u8981\u6587\u5B57", "strengths": ["\u4F18\u70B91", "\u4F18\u70B92"], "weaknesses": ["\u5F31\u70B91", "\u5F31\u70B92"], "improvements": ["\u5EFA\u8BAE1", "\u5EFA\u8BAE2"], "trend": "\u8D8B\u52BF\u5206\u6790"}

\u5B57\u6BB5\u8BF4\u660E\uFF1A
- overallScore: 0-100 \u7684\u6574\u6570
- summary: \u8BAD\u7EC3\u6458\u8981\uFF0C50\u5B57\u4EE5\u5185\uFF0C\u4E2D\u6587
- strengths: \u4F18\u70B9\u6570\u7EC4\uFF0C2-3\u9879
- weaknesses: \u9700\u8981\u6539\u8FDB\u7684\u5F31\u70B9\uFF0C2-3\u9879
- improvements: \u6539\u8FDB\u5EFA\u8BAE\uFF0C2-3\u6761\uFF0C\u4E2D\u6587
- trend: \u8D8B\u52BF\u5206\u6790\uFF0C\u4E00\u53E5\u8BDD\uFF0C\u4E2D\u6587`;
app.post("/api/report", async (req, res) => {
  try {
    const { history, totalErrors, duration, difficulty } = req.body;
    const difficultyContext = difficulty ? `
- \u7EBF\u8DEF\u96BE\u5EA6\uFF1A${difficulty.grade}\uFF08\u7C7B\u522B\uFF1A${difficulty.category === "simple" ? "\u7B80\u5355 V0-V2" : difficulty.category === "medium" ? "\u4E2D\u7B49 V3-V5" : "\u96BE V6-V8+"}\uFF09
\u6CE8\u610F\uFF1A\u8BC4\u5206\u548C\u5EFA\u8BAE\u8981\u8003\u8651\u96BE\u5EA6\u7EA7\u522B\u3002\u4F4E\u96BE\u5EA6\u7EBF\u8DEF\u52A8\u4F5C\u8981\u6C42\u4E25\u683C\uFF0C\u9AD8\u96BE\u5EA6\u7EBF\u8DEF\u9002\u5F53\u5BBD\u5BB9\u3002` : "\n- \u7EBF\u8DEF\u96BE\u5EA6\uFF1A\u672A\u6307\u5B9A\uFF08\u9ED8\u8BA4\u6309\u4E2D\u7B49 V3-V5 \u8BC4\u4F30\uFF09";
    const statusMap = { moving: "\u79FB\u52A8\u4E2D", steady: "\u7A33\u5B9A", stuck: "\u505C\u6EDE", falling: "\u5760\u843D", finished: "\u5B8C\u6210" };
    const framesSummary = (history || []).map((h, i) => {
      const chineseStatus = statusMap[h.climb_status] || h.climb_status || "\u672A\u77E5";
      return `\u3010\u7B2C${i + 1}\u5E27\u3011 \u72B6\u6001\uFF1A${chineseStatus} \u53CD\u9988\uFF1A${h.detailed_feedback || "\u65E0"} \u6307\u4EE4\uFF1A${h.instruction || "\u65E0"} \u7EBF\u8DEF\uFF1A${h.detected_route_color || "\u672A\u77E5"}`;
    }).join("\n");
    const userPrompt = `\u6500\u722C\u6570\u636E\u62A5\u544A\u751F\u6210\uFF1A
- \u6500\u722C\u65F6\u957F\uFF1A${duration || 0}\u79D2
- \u603B\u9519\u8BEF/\u5EFA\u8BAE\u6570\uFF1A${totalErrors || 0}
- AI \u5206\u6790\u5E27\u6570\uFF1A${(history || []).length}
${difficultyContext}
- \u9010\u5E27\u5206\u6790\uFF1A
${framesSummary || "\u65E0\u6570\u636E"}

\u8BF7\u4E25\u683C\u6309\u7167\u4EE5\u4E0B JSON \u683C\u5F0F\u8FD4\u56DE\u4E13\u4E1A\u8BAD\u7EC3\u62A5\u544A\uFF1A
{"overallScore": \u6574\u65700-100, "summary": "\u4E2D\u6587\u6458\u8981", "strengths": ["\u4E2D\u6587\u4F18\u70B9"], "weaknesses": ["\u4E2D\u6587\u5F31\u70B9"], "improvements": ["\u4E2D\u6587\u5EFA\u8BAE"], "trend": "\u4E2D\u6587\u8D8B\u52BF"}

\u5B57\u6BB5\u540D\u5FC5\u987B\u7528\u82F1\u6587\uFF0C\u503C\u7528\u4E2D\u6587\u3002`;
    const text = await zhipuChat(
      "glm-4-flash",
      // 文本模型，不需要 vision
      [
        { role: "user", content: userPrompt }
      ],
      REPORT_SYSTEM_PROMPT
    );
    const result = extractJSON(text);
    console.log("Report Result:", JSON.stringify(result, null, 2));
    res.json(result);
  } catch (error) {
    console.error("Report Generation Error:", error);
    res.status(500).json({ error: error.message });
  }
});
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
        speed: 1,
        volume: 1
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `TTS API error (${response.status}): ${errText}` });
    }
    const audioBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(audioBuffer).toString("base64");
    const dataUrl = `data:audio/mpeg;base64,${base64}`;
    res.json({ audioDataUrl: dataUrl });
  } catch (error) {
    console.error("TTS Error:", error.message);
    res.status(500).json({ error: error.message });
  }
});
function base64url(str) {
  return Buffer.from(str).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function generateJWT(apiKey, expireSeconds = 60) {
  const dot = apiKey.indexOf(".");
  if (dot === -1) throw new Error("Invalid API key format");
  const api_key = apiKey.slice(0, dot);
  const api_secret = apiKey.slice(dot + 1);
  const exp = Math.floor(Date.now() / 1e3) + expireSeconds;
  const timestamp = Date.now();
  const headerB64 = base64url(JSON.stringify({ alg: "HS256", sign_type: "SIGN" }));
  const payloadB64 = base64url(JSON.stringify({ api_key, exp, timestamp }));
  const signature = import_crypto.default.createHmac("sha256", api_secret).update(`${headerB64}.${payloadB64}`).digest("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${headerB64}.${payloadB64}.${signature}`;
}
app.get("/api/jwt", (req, res) => {
  try {
    const token = generateJWT(ZHIPU_API_KEY, 60);
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/analyze-async", async (req, res) => {
  try {
    const { frames, prompt, motion_metadata, model = "glm-5v-turbo" } = req.body;
    if (!frames || !frames.length || !prompt) {
      return res.status(400).json({ error: "\u7F3A\u5C11 frames \u6216 prompt" });
    }
    let enrichedPrompt = prompt;
    if (motion_metadata?.arm_analysis_supplement?.length > 0) {
      const armLines = motion_metadata.arm_analysis_supplement.map((a) => {
        const parts = [`  [${a.timestamp}s]`];
        if (a.left_elbow_angle != null) parts.push(`\u5DE6\u8098\u89D2:${a.left_elbow_angle}\xB0`);
        if (a.right_elbow_angle != null) parts.push(`\u53F3\u8098\u89D2:${a.right_elbow_angle}\xB0`);
        if (a.note) parts.push(`\u5907\u6CE8:${a.note}`);
        return parts.join(" | ");
      }).join("\n");
      enrichedPrompt += `

### \u9AA8\u9ABC\u68C0\u6D4B\u6570\u636E\uFF08MediaPipe \u5B9E\u9645\u6D4B\u91CF\uFF0C\u975E\u63A8\u6D4B\uFF09
${armLines}
`;
    }
    const contentArray = [{ type: "text", text: enrichedPrompt }];
    for (const frame of frames) {
      contentArray.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${frame.base64}` }
      });
    }
    const body = {
      model,
      messages: [{ role: "user", content: contentArray }]
    };
    const response = await fetch("https://open.bigmodel.cn/api/paas/v4/async/chat/completions", {
      method: "POST",
      headers: zhipuHeaders(),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    console.log(`[analyze-async] \u2713 taskId: ${data.id}, status: ${data.task_status}`);
    res.json({ success: true, taskId: data.id });
  } catch (error) {
    console.error("[analyze-async] error:", error.message);
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/query-result", async (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ error: "\u7F3A\u5C11 taskId" });
  console.log(`[query-result] polling taskId: ${taskId}`);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15e3);
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
      const cleaned = rawContent.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
      try {
        return res.json({ status: "SUCCESS", result: JSON.parse(cleaned) });
      } catch {
        return res.json({ status: "SUCCESS", result: rawContent });
      }
    } else if (data.task_status === "FAIL") {
      return res.json({ status: "FAIL", error: data.error?.message || "AI \u5206\u6790\u5931\u8D25" });
    } else {
      return res.json({ status: "PROCESSING" });
    }
  } catch (error) {
    console.error("[query-result] error:", error.message);
    res.status(500).json({ error: error.message });
  }
});
app.post("/api/analyze-stream", async (req, res) => {
  try {
    const { frames, prompt, motion_metadata, model = "glm-5v-turbo" } = req.body;
    if (!frames || !frames.length || !prompt) {
      return res.status(400).json({ error: "\u7F3A\u5C11 frames \u6216 prompt" });
    }
    let enrichedPrompt = prompt;
    if (motion_metadata?.arm_analysis_supplement?.length > 0) {
      const armLines = motion_metadata.arm_analysis_supplement.map((a) => {
        const parts = [`  [${a.timestamp}s]`];
        if (a.left_elbow_angle != null) parts.push(`\u5DE6\u8098\u89D2:${a.left_elbow_angle}\xB0`);
        if (a.right_elbow_angle != null) parts.push(`\u53F3\u8098\u89D2:${a.right_elbow_angle}\xB0`);
        if (a.note) parts.push(`\u5907\u6CE8:${a.note}`);
        return parts.join(" | ");
      }).join("\n");
      enrichedPrompt += `

### \u9AA8\u9ABC\u68C0\u6D4B\u6570\u636E\uFF08MediaPipe \u5B9E\u9645\u6D4B\u91CF\uFF0C\u975E\u63A8\u6D4B\uFF09
${armLines}
`;
    }
    const contentArray = [{ type: "text", text: enrichedPrompt }];
    for (const frame of frames) {
      contentArray.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${frame.base64}` }
      });
    }
    console.log(`[analyze-stream] \u5F00\u59CB\u6D41\u5F0F\u8BF7\u6C42\uFF0C${frames.length} \u5E27`);
    const body = {
      model,
      messages: [{ role: "user", content: contentArray }],
      stream: true
    };
    let zhipuRes = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      zhipuRes = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: zhipuHeaders(),
        body: JSON.stringify(body)
      });
      if (zhipuRes.ok || zhipuRes.status !== 429) break;
      const waitMs = Math.min(3e3 * Math.pow(2, attempt - 1), 4e4);
      console.warn(`[analyze-stream] \u667A\u8C31 429 \u9650\u6D41 (attempt ${attempt}/5), \u7B49\u5F85 ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    if (!zhipuRes || !zhipuRes.ok) {
      const errStatus = zhipuRes?.status ?? 0;
      const errText = zhipuRes ? await zhipuRes.text().catch(() => "") : "";
      console.error(`[analyze-stream] Zhipu API ${errStatus}: ${errText.slice(0, 200)}`);
      return res.status(502).json({ error: `\u667A\u8C31 API ${errStatus}` });
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const reader = zhipuRes.body?.getReader();
    if (!reader) {
      return res.status(502).json({ error: "\u65E0\u6CD5\u8BFB\u53D6\u54CD\u5E94\u6D41" });
    }
    const decoder = new TextDecoder();
    let fullContent = "";
    let parsed = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: !done });
      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === "[DONE]") {
          parsed = true;
          continue;
        }
        try {
          const event = JSON.parse(dataStr);
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            parsed = true;
            res.write(`data: ${JSON.stringify({ __delta: true, text: delta })}

`);
          }
        } catch {
        }
      }
    }
    console.log(`[analyze-stream] \u6D41\u5F0F\u5B8C\u6210, \u6536\u5230 ${fullContent.length} \u5B57\u7B26, \u5DF2\u89E3\u6790=${parsed}`);
    let finalContent = fullContent.trim();
    finalContent = finalContent.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    const firstBrace = finalContent.indexOf("{");
    const lastBrace = finalContent.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      finalContent = finalContent.slice(firstBrace, lastBrace + 1);
    }
    res.write(`data: ${JSON.stringify({ __complete: true, content: finalContent, parsed })}

`);
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("[analyze-stream] error:", error.message);
    try {
      res.write(`data: ${JSON.stringify({ error: error.message })}

`);
      res.write("data: [DONE]\n\n");
      res.end();
    } catch {
      res.status(500).json({ error: error.message });
    }
  }
});
async function startServer() {
  const isProduction = import_fs.default.existsSync(import_path.default.join(scriptDir, "index.html"));
  if (!isProduction) {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    app.use(import_express.default.static(scriptDir));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(scriptDir, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log("Zhipu AI key: \u2713 hardcoded");
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
